// Lender fan-out after Matt replies with lender names in a deal thread.
//
// Entry point is submitToLenders() — it sends the approved draft to each
// matched lender's submission_email via Microsoft Graph, inserts/updates
// a deal_submissions row per lender, syncs the Zoho Lender_Submissions
// subform, writes a single Zoho Lead note summarizing the send, opens
// the per-deal Slack channel, posts a submission_sent update in it, and
// leaves a one-line pointer in the pipeline thread.
//
// Send failures per lender don't abort the rest — they're surfaced in the
// Zoho note and the Slack receipt so Matt can retry manually.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { addNoteToLead } from "@/lib/zoho";
import { syncLenderSubmissionsSubform } from "@/lib/zoho-mca-fields";
import { postDealThreadUpdate } from "./deal-thread";
import { ensureDealChannel } from "./deal-channel";

export interface SubmitToLendersOpts {
  dealId: string;
  contactId: string;
  zohoId: string | null;
  lenderIds: string[];
  draftSubject: string;
  draftBody: string;
  bankStmtDriveItemIds: string[];
  onedriveFolderUrl: string | null;
  amountRequested: number | null;
  clientNote?: string | null;
}

export interface SubmitToLendersResult {
  ok: boolean;
  sent: Array<{ id: string; name: string }>;
  failed: Array<{ id: string; name: string; error: string }>;
  skipped: Array<{ id: string; name: string; reason: string }>;
  channelId: string | null;
  channelName: string | null;
  error?: string;
}

interface LenderRow {
  id: string;
  name: string;
  submission_method: string | null;
  submission_email: string | null;
  cc_emails: string[] | null;
}

export async function submitToLenders(opts: SubmitToLendersOpts): Promise<SubmitToLendersResult> {
  const result: SubmitToLendersResult = {
    ok: true,
    sent: [],
    failed: [],
    skipped: [],
    channelId: null,
    channelName: null,
  };

  if (opts.lenderIds.length === 0) {
    return { ...result, ok: false, error: "no_lenders" };
  }

  const { data: lenders, error: lendersErr } = await supabaseAdmin
    .from("lenders")
    .select("id, name, submission_method, submission_email, cc_emails")
    .in("id", opts.lenderIds)
    .eq("is_active", true);

  if (lendersErr || !lenders || lenders.length === 0) {
    return { ...result, ok: false, error: lendersErr?.message ?? "no_matching_lenders" };
  }

  // Load deal thread + business name so we can pull the app PDF from
  // Deals/{business_name}/Completed Package/ and post an ephemeral warning
  // to Matt in the thread if it's missing.
  const { data: dealCtx } = await supabaseAdmin
    .from("deals")
    .select("slack_thread_ts, slack_channel, contacts:contact_id(business_name)")
    .eq("id", opts.dealId)
    .maybeSingle();
  const dealRow = (dealCtx ?? null) as {
    slack_thread_ts: string | null;
    slack_channel: string | null;
    contacts: { business_name: string | null } | null;
  } | null;
  const businessName = dealRow?.contacts?.business_name ?? null;
  const dealThreadTs = dealRow?.slack_thread_ts ?? null;
  const dealChannel = dealRow?.slack_channel ?? null;

  const { attachments, appPdfMissing } = await buildAttachments(opts.bankStmtDriveItemIds, businessName);

  if (appPdfMissing && businessName && dealChannel) {
    const matthewId = process.env.MATTHEW_SLACK_USER_ID ?? "";
    if (matthewId) {
      try {
        await slack.postEphemeral(
          dealChannel,
          matthewId,
          `Application PDF missing from Deals/${businessName}/Completed Package. Sent bank statements only. Upload the app PDF and re-send if needed.`,
          dealThreadTs ?? undefined,
        );
      } catch (e) {
        console.warn("[submit-to-lenders] ephemeral warning failed:", (e as Error).message);
      }
    }
  }

  for (const lender of lenders as LenderRow[]) {
    if (lender.submission_method !== "email" || !lender.submission_email) {
      // Portal-only lenders: still log a submission row so the Zoho subform
      // reflects the queue, but don't send email.
      await insertOrUpdateSubmission({
        contactId: opts.contactId,
        dealId: opts.dealId,
        lenderId: lender.id,
        amountRequested: opts.amountRequested,
        onedriveFolderUrl: opts.onedriveFolderUrl,
        notes: "Queued for portal submission",
        sent: false,
      });
      result.skipped.push({ id: lender.id, name: lender.name, reason: "portal_only" });
      continue;
    }

    try {
      const htmlBody = await buildSubmissionHtml(opts.draftBody, opts.clientNote ?? null);
      await microsoft.sendMail({
        to: lender.submission_email,
        bcc: lender.cc_emails && lender.cc_emails.length > 0 ? lender.cc_emails.join(",") : undefined,
        subject: opts.draftSubject,
        body: htmlBody,
        isHtml: true,
        attachments,
      });

      await insertOrUpdateSubmission({
        contactId: opts.contactId,
        dealId: opts.dealId,
        lenderId: lender.id,
        amountRequested: opts.amountRequested,
        onedriveFolderUrl: opts.onedriveFolderUrl,
        notes: "Sent via Vektor",
        sent: true,
      });

      result.sent.push({ id: lender.id, name: lender.name });
    } catch (e) {
      result.failed.push({ id: lender.id, name: lender.name, error: (e as Error).message });
    }
  }

  // Sync Zoho subform once after all rows are in place.
  try {
    await syncLenderSubmissionsSubform(opts.contactId);
  } catch (e) {
    console.warn("[submit-to-lenders] Zoho subform sync failed:", (e as Error).message);
  }

  // Zoho Lead note summarizing the send.
  if (opts.zohoId) {
    try {
      await addNoteToLead(
        opts.zohoId,
        `File sent to ${result.sent.length} lender(s)`,
        buildNoteContent(result),
      );
    } catch (e) {
      console.warn("[submit-to-lenders] Zoho note failed:", (e as Error).message);
    }
  }

  // Open (or look up) the per-deal channel and post the submission update there.
  const channel = await ensureDealChannel(opts.dealId);
  result.channelId = channel.channelId;
  result.channelName = channel.channelName;

  if (channel.channelId) {
    const lines: string[] = [];
    if (result.sent.length > 0) lines.push(`*Sent to:* ${result.sent.map((l) => l.name).join(", ")}`);
    if (result.failed.length > 0) lines.push(`*Failed:* ${result.failed.map((l) => `${l.name} (${l.error})`).join(", ")}`);
    if (result.skipped.length > 0) lines.push(`*Queued for portal:* ${result.skipped.map((l) => l.name).join(", ")}`);
    const text = lines.join("\n") || "No lenders processed.";

    await postDealThreadUpdate({
      dealId: opts.dealId,
      action: "submission_sent",
      text: `Submitted to ${result.sent.length} lender(s)`,
      blocks: [{ type: "section", text: { type: "mrkdwn", text: `📤 *Submission sent*\n${text}` } }],
      channelOverride: channel.channelId,
    });

    // Pointer back to the original pipeline thread so the pipeline view
    // links out to the dedicated channel.
    if (channel.created) {
      await postDealThreadUpdate({
        dealId: opts.dealId,
        action: "note",
        text: `Lender comms moved to <#${channel.channelId}|${channel.channelName ?? "deal"}>`,
      });
    }
  }

  return result;
}

async function insertOrUpdateSubmission(args: {
  contactId: string;
  dealId: string;
  lenderId: string;
  amountRequested: number | null;
  onedriveFolderUrl: string | null;
  notes: string;
  sent: boolean;
}): Promise<void> {
  const { data: existing } = await supabaseAdmin
    .from("deal_submissions")
    .select("id")
    .eq("deal_id", args.dealId)
    .eq("lender_id", args.lenderId)
    .limit(1)
    .maybeSingle();

  const patch: Record<string, unknown> = {
    status: "pending",
    notes: args.notes,
  };
  if (args.sent) patch.submitted_at = new Date().toISOString();
  if (args.onedriveFolderUrl) patch.onedrive_folder_url = args.onedriveFolderUrl;
  if (args.amountRequested != null) patch.amount_requested = args.amountRequested;

  if (existing?.id) {
    await supabaseAdmin.from("deal_submissions").update(patch).eq("id", existing.id);
  } else {
    await supabaseAdmin.from("deal_submissions").insert({
      merchant_id: args.contactId,
      deal_id: args.dealId,
      lender_id: args.lenderId,
      amount_requested: args.amountRequested,
      onedrive_folder_url: args.onedriveFolderUrl,
      status: "pending",
      notes: args.notes,
      ...(args.sent ? { submitted_at: new Date().toISOString() } : {}),
    });
  }
}

async function buildAttachments(
  driveItemIds: string[],
  businessName: string | null,
): Promise<{ attachments: Array<{ name: string; contentType: string; contentBytes: string }>; appPdfMissing: boolean }> {
  const out: Array<{ name: string; contentType: string; contentBytes: string }> = [];
  let appPdfMissing = false;

  // Prepend the lender-version application PDF from Deals/{business}/Completed Package
  // so funders see the application first and bank statements after.
  if (businessName) {
    const folderPath = `Deals/${businessName}/Completed Package`;
    try {
      const children = await microsoft.listFolderChildren(folderPath);
      const pdfChildren = children.filter((c) => c.isFile && /\.pdf$/i.test(c.name));
      const exactName = `Application Completed ${businessName}.pdf`.toLowerCase();
      const exact = pdfChildren.find((c) => c.name.toLowerCase() === exactName);
      const fallback = exact ?? pdfChildren.find((c) => /^application/i.test(c.name));
      if (fallback) {
        const file = await microsoft.downloadDriveItem(fallback.id);
        out.push({
          name: file.name,
          contentType: file.mimeType ?? "application/pdf",
          contentBytes: file.buffer.toString("base64"),
        });
      } else {
        appPdfMissing = true;
      }
    } catch (e) {
      console.warn("[submit-to-lenders] Completed Package lookup failed:", (e as Error).message);
      appPdfMissing = true;
    }
  }

  for (const id of driveItemIds) {
    try {
      const file = await microsoft.downloadDriveItem(id);
      out.push({
        name: file.name,
        contentType: file.mimeType ?? "application/pdf",
        contentBytes: file.buffer.toString("base64"),
      });
    } catch (e) {
      console.warn("[submit-to-lenders] attachment fetch failed:", id, (e as Error).message);
    }
  }
  return { attachments: out, appPdfMissing };
}

async function buildSubmissionHtml(plainBody: string, clientNote: string | null): Promise<string> {
  // Try to use the "Submission" Outlook signature; fall back to default
  const { EMAIL_SIGNATURE_HTML } = await import("@/config/email-signature");
  const sig = (await microsoft.getSignatureByName("Submission").catch(() => null))
    ?? (await microsoft.getDefaultSignature().catch(() => null))
    ?? EMAIL_SIGNATURE_HTML;

  const bodyLines = plainBody.split("\n").map((line) => {
    if (line.trim() === "") return "<br>";
    return `<p style="margin:0 0 8px 0;">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`;
  });

  // Inject client note in italic before the sign-off if provided
  if (clientNote) {
    const noteHtml = `<p style="margin:0 0 8px 0;"><em>${clientNote.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</em></p>`;
    // Insert before the last non-empty paragraph (the sign-off)
    const lastNonEmpty = bodyLines.reduceRight((acc, _, i) => acc === -1 && bodyLines[i] !== "<br>" ? i : acc, -1);
    if (lastNonEmpty > 0) {
      bodyLines.splice(lastNonEmpty, 0, noteHtml);
    } else {
      bodyLines.push(noteHtml);
    }
  }

  return `${bodyLines.join("")}<br><br>${sig}`;
}

function buildNoteContent(r: SubmitToLendersResult): string {
  const lines: string[] = [];
  if (r.sent.length > 0) {
    lines.push("Sent:");
    for (const l of r.sent) lines.push(`• ${l.name}`);
  }
  if (r.skipped.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Queued for portal submission:");
    for (const l of r.skipped) lines.push(`• ${l.name}`);
  }
  if (r.failed.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("Failed to send:");
    for (const l of r.failed) lines.push(`• ${l.name} — ${l.error}`);
  }
  return lines.length > 0 ? lines.join("\n") : "No lenders processed.";
}
