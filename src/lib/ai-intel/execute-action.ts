import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { addNoteToLead, updateLead } from "@/lib/zoho";
import type { PendingActionPayload } from "./types";
import { DEFAULTS } from "@/config/defaults";
import { EMAIL_SIGNATURE_HTML } from "@/config/email-signature";
import { advanceEnrollment, resetEnrollmentAfterCancel } from "@/lib/sequence-engine";

async function buildHtmlBody(body: string, isHtml: boolean, signatureName?: string): Promise<string> {
  if (isHtml) return body;
  // Prefer a named Outlook signature (e.g. "S") when requested, then the
  // account's default signature, then the hard-coded fallback.
  const sig =
    (signatureName ? await microsoft.getSignatureByName(signatureName).catch(() => null) : null) ??
    (await microsoft.getDefaultSignature().catch(() => null)) ??
    EMAIL_SIGNATURE_HTML;
  const htmlBody = body
    .split("\n")
    .map((line) => (line.trim() === "" ? "<br>" : `<p style="margin:0 0 8px 0;">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`))
    .join("");
  return `${htmlBody}<br><br>${sig}`;
}
import { substituteMagicLinkInBody } from "@/lib/portal-magic-link";
import { recordSend } from "./cadence-scheduler";
import type { CadenceTrack } from "./types";
import { postDraftSubmissionCard } from "./draft-submission-card";
import { submitToLenders } from "./submit-to-lenders";

export interface ExecuteResult {
  ok: boolean;
  error?: string;
  details?: Record<string, unknown>;
}

export async function executePendingAction(opts: {
  actionId: string;
  actionType: string;
  payload: PendingActionPayload;
  approvedBy: string;
}): Promise<ExecuteResult> {
  try {
    switch (opts.actionType) {
      case "send_email":
      case "reply_funder":
        return await sendEmail(opts.payload);
      case "send_marketing_email":
        return await sendMarketingEmail({ ...opts.payload, approvedBy: opts.approvedBy, slackTs: (opts.payload as { slackTs?: string }).slackTs });
      case "submit_deal":
        return await submitDeal(opts.payload);
      case "update_zoho":
        return await updateZoho(opts.payload);
      case "send_submission":
        return await sendSubmission(opts.payload);
      case "clear_lead_amounts":
        return await clearLeadAmounts(opts.payload);
      case "add_lender":
        return await addLender(opts.payload);
      default:
        return { ok: false, error: `unknown_action_type:${opts.actionType}` };
    }
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

async function sendEmail(payload: PendingActionPayload): Promise<ExecuteResult> {
  if (!payload.to || !payload.subject || !payload.body) {
    return { ok: false, error: "missing_email_fields" };
  }
  const htmlBody = await buildHtmlBody(payload.body, !!payload.is_html, payload.signature_name);
  await microsoft.sendMail({
    to: payload.to,
    subject: payload.subject,
    body: htmlBody,
    isHtml: true,
  });

  // Log the send back to the Zoho lead (e.g. "Email sent successfully …").
  // Best-effort — a note failure must not mark the send as failed.
  if (payload.zoho_id && payload.note) {
    try {
      await addNoteToLead(payload.zoho_id, payload.note.title, payload.note.content);
    } catch (e) {
      console.error("[execute-action] sendEmail note write failed:", (e as Error).message);
    }
  }

  return { ok: true, details: { to: payload.to, subject: payload.subject } };
}

async function submitDeal(payload: PendingActionPayload): Promise<ExecuteResult> {
  if (!payload.to || !payload.subject || !payload.body) {
    return { ok: false, error: "missing_submission_fields" };
  }
  const attachments: Array<{ name: string; contentType: string; contentBytes: string }> = [];
  for (const att of payload.attachments ?? []) {
    try {
      const res = await fetch(att.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      attachments.push({ name: att.name, contentType: att.contentType, contentBytes: buf.toString("base64") });
    } catch (e) {
      console.error("[execute] attachment fetch failed:", att.url, (e as Error).message);
    }
  }

  const htmlBody = await buildHtmlBody(payload.body, !!payload.is_html);

  await microsoft.sendMail({
    to: payload.to,
    bcc: DEFAULTS.submissionsFromAddress,
    subject: payload.subject,
    body: htmlBody,
    isHtml: true,
    attachments,
  });

  if (payload.deal_id) {
    await supabaseAdmin
      .from("deal_submissions")
      .update({ submitted_at: new Date().toISOString(), status: "pending" })
      .eq("deal_id", payload.deal_id)
      .eq("lender_id", payload.lender_id ?? "")
      .is("submitted_at", null);
  }

  return { ok: true, details: { to: payload.to, attachments: attachments.length } };
}

async function updateZoho(payload: PendingActionPayload): Promise<ExecuteResult> {
  if (!payload.zoho_id) return { ok: false, error: "missing_zoho_id" };
  // Lead_Status / field updates removed — each updateLead() call triggers a Zoho
  // workflow webhook (100/day limit). Stage changes go through the Mission Control
  // dashboard only.
  if (payload.note) {
    await addNoteToLead(payload.zoho_id, payload.note.title, payload.note.content);
  }

  // Follow-up chaining: bank-statement approvals set followup="draft_submission"
  // so the next card (draft email) posts into the same deal thread once the
  // Zoho write is confirmed. Best-effort — a failed card doesn't fail the
  // underlying Zoho update.
  if (payload.followup === "draft_submission" && payload.deal_id && payload.contact_id) {
    try {
      await postDraftSubmissionCard({
        dealId: payload.deal_id,
        contactId: payload.contact_id,
        zohoId: payload.zoho_id,
        revenueTable: payload.revenue_table ?? [],
        onedriveFolderUrl: payload.onedrive_folder_url,
        bankStmtDriveItemIds: payload.bank_stmt_drive_item_ids,
      });
    } catch (e) {
      console.error("[execute-action] draft-submission card failed:", (e as Error).message);
    }
  }

  return {
    ok: true,
    details: { zoho_id: payload.zoho_id, note: !!payload.note, followup: payload.followup ?? null },
  };
}

async function sendSubmission(payload: PendingActionPayload): Promise<ExecuteResult> {
  if (!payload.deal_id || !payload.contact_id) return { ok: false, error: "missing_deal_or_contact" };
  if (!payload.draft_subject || !payload.draft_body) return { ok: false, error: "missing_draft" };
  const lenderIds = (payload as { lender_ids?: string[] }).lender_ids ?? [];
  if (lenderIds.length === 0) return { ok: false, error: "no_lender_ids" };

  const result = await submitToLenders({
    dealId: payload.deal_id,
    contactId: payload.contact_id,
    zohoId: payload.zoho_id ?? null,
    lenderIds,
    draftSubject: payload.draft_subject,
    draftBody: payload.draft_body,
    bankStmtDriveItemIds: payload.bank_stmt_drive_item_ids ?? [],
    onedriveFolderUrl: payload.onedrive_folder_url ?? null,
    amountRequested: payload.amount ?? null,
    clientNote: (payload as { client_note?: string }).client_note ?? null,
  });

  return {
    ok: result.ok && result.sent.length + result.skipped.length > 0,
    error: result.error,
    details: {
      sent: result.sent.map((l) => l.name),
      failed: result.failed.map((l) => `${l.name}: ${l.error}`),
      skipped: result.skipped.map((l) => `${l.name} (${l.reason})`),
      channel_id: result.channelId,
      channel_name: result.channelName,
    },
  };
}

async function sendMarketingEmail(
  payload: PendingActionPayload & { approvedBy?: string; slackTs?: string }
): Promise<ExecuteResult> {
  if (!payload.to || !payload.subject || !payload.body) {
    return { ok: false, error: "missing_email_fields" };
  }
  if (!payload.contact_id) {
    return { ok: false, error: "missing_contact_id" };
  }

  // Substitute {magic_link} in the body with a freshly-minted Supabase magic
  // link so the CTA works for ~1 hour (Supabase default).
  const { body: bodyWithLink, token: magicToken } = await substituteMagicLinkInBody(
    payload.body,
    payload.to,
    payload.magic_link_redirect ?? "/portal/dashboard"
  );

  const htmlBody = await buildHtmlBody(bodyWithLink, true);

  await microsoft.sendMail({
    to: payload.to,
    subject: payload.subject,
    body: htmlBody,
    isHtml: true,
  });

  const sentAt = new Date().toISOString();
  const campaignKey = (payload.campaign_key as string) || "custom";
  const track: CadenceTrack = inferTrackFromCampaign(campaignKey);

  await supabaseAdmin.from("marketing_sends").insert({
    contact_id: payload.contact_id,
    campaign_key: campaignKey,
    cadence_day: payload.cadence_day ?? null,
    sequence_position: payload.sequence_position ?? null,
    zoho_lead_id: payload.zoho_id ?? null,
    subject: payload.subject,
    body_preview: bodyWithLink.replace(/<[^>]+>/g, "").slice(0, 500),
    magic_link_token: magicToken,
    sent_at: sentAt,
    slack_ts: payload.slackTs ?? null,
    approved_by: payload.approvedBy ?? null,
  });

  if (payload.cadence_day != null) {
    await recordSend({
      contactId: payload.contact_id,
      track,
      cadenceDay: payload.cadence_day,
      sentAt,
    });
  }

  // Advance the sequence enrollment step if this email came from the sequence runner
  if (payload.enrollment_id) {
    const slugFromCampaign = campaignKey.startsWith("new_lead") ? "fu-new-inbound" : campaignKey;
    await advanceEnrollment(payload.enrollment_id, slugFromCampaign).catch((e) =>
      console.error("[execute-action] advanceEnrollment failed:", (e as Error).message)
    );
  }

  return { ok: true, details: { to: payload.to, subject: payload.subject, campaign: campaignKey } };
}

/**
 * Called by the Slack 🚫 cancel handler when a marketing email draft is rejected.
 * Clears pending_action_id and pushes next_send_at out 3 days so the sequence retries.
 */
export async function handleMarketingEmailCancel(payload: PendingActionPayload): Promise<void> {
  if (payload.enrollment_id) {
    await resetEnrollmentAfterCancel(payload.enrollment_id).catch((e) =>
      console.error("[execute-action] resetEnrollmentAfterCancel failed:", (e as Error).message)
    );
  }
}

function inferTrackFromCampaign(campaignKey: string): CadenceTrack {
  if (campaignKey.startsWith("new_lead")) return "new_lead";
  if (campaignKey === "awaiting_statements") return "awaiting_statements";
  if (campaignKey === "approved_nurture") return "approved_nurture";
  if (campaignKey === "confirmation_daily") return "confirmation";
  return "new_lead";
}

export async function postExecutionReceipt(opts: { channel: string; threadTs: string; summary: string; success: boolean }): Promise<void> {
  const icon = opts.success ? "✅" : "⚠️";
  await slack.postThreadReply(opts.channel, opts.threadTs, `${icon} ${opts.summary}`);
}

async function addLender(payload: PendingActionPayload): Promise<ExecuteResult> {
  const name = payload.lender_name as string | undefined;
  if (!name) return { ok: false, error: "missing lender_name in payload" };

  const submissionEmail = (payload.submission_email as string | undefined) ?? null;
  const ccEmails = (payload.cc_emails as string[] | undefined) ?? [];
  const portalUrl = (payload.portal_url as string | undefined) ?? null;

  const { data, error } = await supabaseAdmin
    .from("lenders")
    .upsert(
      {
        name,
        tier: (payload.tier as number | undefined) ?? 2,
        is_active: true,
        submission_method: submissionEmail ? "email" : (portalUrl ? "portal" : "email"),
        submission_email: submissionEmail,
        cc_emails: ccEmails,
        portal_url: portalUrl,
        rep_name: (payload.rep_name as string | undefined) ?? null,
        rep_email: (payload.rep_email as string | undefined) ?? null,
        notes: [
          payload.docs_required ? `Docs: ${payload.docs_required}` : null,
          payload.subject_line_format ? `Subject: "${payload.subject_line_format}"` : null,
          payload.notes as string | undefined,
        ].filter(Boolean).join(" | ") || null,
      },
      { onConflict: "id" }
    )
    .select("id, name")
    .maybeSingle();

  if (error) {
    // No unique constraint on name — fall back to insert
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from("lenders")
      .insert({
        name,
        tier: (payload.tier as number | undefined) ?? 2,
        is_active: true,
        submission_method: submissionEmail ? "email" : (portalUrl ? "portal" : "email"),
        submission_email: submissionEmail,
        cc_emails: ccEmails,
        portal_url: portalUrl,
        rep_name: (payload.rep_name as string | undefined) ?? null,
        rep_email: (payload.rep_email as string | undefined) ?? null,
        notes: [
          payload.docs_required ? `Docs: ${payload.docs_required}` : null,
          payload.subject_line_format ? `Subject: "${payload.subject_line_format}"` : null,
          payload.notes as string | undefined,
        ].filter(Boolean).join(" | ") || null,
      })
      .select("id, name")
      .single();
    if (insertErr) return { ok: false, error: insertErr.message };
    return { ok: true, details: { lender: inserted.name, id: inserted.id, action: "inserted" } };
  }

  return { ok: true, details: { lender: data?.name ?? name, id: data?.id, action: "upserted" } };
}

async function clearLeadAmounts(payload: PendingActionPayload): Promise<ExecuteResult> {
  const targets = (payload.zoho_fields as { targets?: Array<{ zoho_lead_id: string; business_name: string; current_amount: number }> } | undefined)?.targets;
  if (!Array.isArray(targets) || targets.length === 0) {
    return { ok: false, error: "no_targets" };
  }
  const results: Array<{ zoho_lead_id: string; ok: boolean; error?: string }> = [];
  for (const t of targets) {
    try {
      await updateLead(t.zoho_lead_id, { MCA_Approved_Amount: null } as Parameters<typeof updateLead>[1]);
      results.push({ zoho_lead_id: t.zoho_lead_id, ok: true });
    } catch (e) {
      results.push({ zoho_lead_id: t.zoho_lead_id, ok: false, error: (e as Error).message });
    }
  }
  const succeeded = results.filter((r) => r.ok).length;
  return { ok: true, details: { cleared: succeeded, total: targets.length, results } };
}
