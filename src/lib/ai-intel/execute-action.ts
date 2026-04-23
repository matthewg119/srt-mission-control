import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { addNoteToLead, updateLead } from "@/lib/zoho";
import type { PendingActionPayload } from "./types";
import { DEFAULTS } from "@/config/defaults";
import { wrapWithSignature } from "@/config/email-signature";
import { substituteMagicLinkInBody } from "@/lib/portal-magic-link";
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
      case "submit_deal":
        return await submitDeal(opts.payload);
      case "update_zoho":
        return await updateZoho(opts.payload);
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
  const htmlBody = payload.is_html ? payload.body : wrapWithSignature(payload.body, false);
  await microsoft.sendMail({
    to: payload.to,
    subject: payload.subject,
    body: htmlBody,
    isHtml: true,
  });
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

  const htmlBody = payload.is_html ? payload.body : wrapWithSignature(payload.body, false);

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
  const fields: Record<string, unknown> = {
    ...(payload.stage ? { Lead_Status: payload.stage } : {}),
    ...(payload.zoho_fields ?? {}),
  };
  const fieldKeys = Object.keys(fields);
  if (fieldKeys.length > 0) {
    await updateLead(payload.zoho_id, fields);
  }
  if (payload.note) {
    await addNoteToLead(payload.zoho_id, payload.note.title, payload.note.content);
  }
  return {
    ok: true,
    details: { zoho_id: payload.zoho_id, fields: fieldKeys, note: !!payload.note },
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

  // Always wrap with Matt's signature (matches Outlook Web default).
  const htmlBody = wrapWithSignature(bodyWithLink, true);

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

  return { ok: true, details: { to: payload.to, subject: payload.subject, campaign: campaignKey } };
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
