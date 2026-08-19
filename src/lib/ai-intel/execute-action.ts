import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { addNote } from "@/lib/crm";
import type { PendingActionPayload } from "./types";
import { DEFAULTS } from "@/config/defaults";
import { EMAIL_SIGNATURE_HTML, SIGNATURE_S_HTML, resolveSubmissionSignature } from "@/config/email-signature";
import { advanceEnrollment, resetEnrollmentAfterCancel } from "@/lib/sequence-engine";

async function buildHtmlBody(body: string, isHtml: boolean, signatureName?: string): Promise<string> {
  if (isHtml) return body;
  // The "S" signature lives server-side as a stored constant — Microsoft Graph
  // does NOT expose Outlook roaming signatures (the /beta/me/mailboxSettings/
  // signatures endpoint doesn't exist), so the dialer's signature_name:"S" is
  // resolved here, not via Graph. An env override wins if set.
  // For any other named signature, fall back to the (best-effort) Graph helpers,
  // then the account default, then the hard-coded block.
  const sig =
    signatureName === "S"
      ? (process.env.SIGNATURE_S_HTML || SIGNATURE_S_HTML)
      : signatureName === "Submission"
        ? resolveSubmissionSignature()
        : ((signatureName ? await microsoft.getSignatureByName(signatureName).catch(() => null) : null) ??
          (await microsoft.getDefaultSignature().catch(() => null)) ??
          EMAIL_SIGNATURE_HTML);
  const htmlBody = body
    .split("\n")
    .map((line) => (line.trim() === "" ? "<br>" : `<p style="margin:0 0 8px 0;">${line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</p>`))
    .join("");
  return `${htmlBody}<br><br>${sig}`;
}
import { recordSend } from "./cadence-scheduler";
import type { CadenceTrack } from "./types";

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
      case "update_zoho":
        return await updateZoho(opts.payload);
      case "file_to_onedrive":
        return await fileToOneDrive(opts.payload);
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
  const replyToId = payload.reply_to_graph_message_id as string | undefined;
  if (replyToId) {
    // Threaded reply (e.g. statements received by email) — lands in the lead's
    // original conversation instead of a fresh message.
    await microsoft.sendReplyHtml({
      messageId: replyToId,
      html: htmlBody,
      mailbox: payload.from_mailbox as string | undefined,
      to: payload.to,
    });
  } else {
    await microsoft.sendMail({
      to: payload.to,
      subject: payload.subject,
      body: htmlBody,
      isHtml: true,
      fromMailbox: payload.from_mailbox as string | undefined,
    });
  }

  // Log the send back onto the lead (e.g. "Email sent successfully …").
  // Best-effort — a note failure must not mark the send as failed.
  if (payload.note && (payload.contact_id || payload.zoho_id)) {
    try {
      await addNote({
        contactId: payload.contact_id as string | undefined,
        zohoLeadId: payload.zoho_id as string | undefined,
        title: payload.note.title,
        content: payload.note.content,
        origin: "ai",
      });
    } catch (e) {
      console.error("[execute-action] sendEmail note write failed:", (e as Error).message);
    }
  }

  return { ok: true, details: { to: payload.to, subject: payload.subject } };
}

/**
 * Gated OneDrive filing for an inbound statements email whose deal match wasn't
 * confident enough to auto-file. Re-downloads the ORIGINAL message attachments at
 * approval time (so we don't bloat pending_slack_actions with base64 buffers) and
 * uploads the PDFs into Deals/{business}/Bank Statements — the same convention the
 * Slack-drop path (build-draft.ts) and the auto-file path use.
 */
async function fileToOneDrive(payload: PendingActionPayload): Promise<ExecuteResult> {
  const messageId = payload.source_message_id;
  if (!messageId) return { ok: false, error: "missing_source_message_id" };
  const mailbox = payload.source_mailbox || process.env.LEADS_MAILBOX || "matthew@srtagency.com";
  const biz = (payload.onedrive_business_name || "Applicant").replace(/[<>:"/\\|?*]/g, "_");

  const attachments = await microsoft.getMessageAttachments(messageId, mailbox);
  const pdfs = attachments.filter(
    (a) =>
      !a.isInline &&
      !!a.contentBytes &&
      (a.contentType === "application/pdf" || (a.name || "").toLowerCase().endsWith(".pdf"))
  );
  if (pdfs.length === 0) return { ok: false, error: "attachments_gone" };

  await microsoft.createDriveFolder("Bank Statements", `Deals/${biz}`).catch(() => {});
  let filed = 0;
  for (const p of pdfs) {
    try {
      await microsoft.uploadDriveFile(
        `Deals/${biz}/Bank Statements`,
        p.name || `statement-${filed + 1}.pdf`,
        Buffer.from(p.contentBytes, "base64"),
        "application/pdf"
      );
      filed++;
    } catch (e) {
      console.error("[execute-action] file_to_onedrive upload failed:", (e as Error).message);
    }
  }
  if (filed === 0) return { ok: false, error: "upload_failed" };
  return { ok: true, details: { filed, folder: `Deals/${biz}/Bank Statements` } };
}

// Historically "update the Zoho lead". It has been note-only for a long time
// (field writes were removed because each one tripped a Zoho workflow webhook
// against a 100/day limit), so with Zoho gone it is simply a note.
async function updateZoho(payload: PendingActionPayload): Promise<ExecuteResult> {
  if (!payload.contact_id && !payload.zoho_id) {
    return { ok: false, error: "missing_contact_id" };
  }
  if (payload.note) {
    await addNote({
      contactId: payload.contact_id as string | undefined,
      zohoLeadId: payload.zoho_id as string | undefined,
      title: payload.note.title,
      content: payload.note.content,
      origin: "ai",
    });
  }

  return {
    ok: true,
    details: {
      contact_id: payload.contact_id ?? null,
      note: !!payload.note,
      followup: payload.followup ?? null,
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

  // The portal magic link is gone with the funding portal. Drafts now close on
  // a reply rather than a login link, so the body ships as written.
  const bodyWithLink = payload.body;

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
    magic_link_token: null,
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

