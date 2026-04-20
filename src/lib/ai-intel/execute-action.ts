import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { slack } from "@/lib/slack-bot";
import { updateLead } from "@/lib/zoho";
import type { PendingActionPayload } from "./types";
import { DEFAULTS } from "@/config/defaults";
import { wrapWithSignature } from "@/config/email-signature";

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
  const stageField = payload.stage ? { Lead_Status: payload.stage as string } : {};
  await updateLead(payload.zoho_id as string, stageField);
  return { ok: true, details: { zoho_id: payload.zoho_id, stage: payload.stage } };
}

export async function postExecutionReceipt(opts: { channel: string; threadTs: string; summary: string; success: boolean }): Promise<void> {
  const icon = opts.success ? "✅" : "⚠️";
  await slack.postThreadReply(opts.channel, opts.threadTs, `${icon} ${opts.summary}`);
}
