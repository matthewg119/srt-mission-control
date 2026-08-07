// Speed lane for PUBLIC free-audit leads: the moment the report is ready, the
// pitch is drafted, signed, and one tap from going out.
//
// These people filled out the form and asked for the report, so sending it is
// fulfillment, not cold outreach. That is why this lane may send at all, and why
// it is the ONLY lane that may: cold /audit runs stay behind the permission
// doctrine in email-assistant.ts and are never touched by anything here.
//
// Two speeds, and the second one is deliberately dormant:
//   1. APPROVAL (always on)  the card in #hot-leads carries Send it / Hold.
//   2. AUTO-SEND (off)       gated behind AUDIT_AUTOSEND_ENABLED. When enabled,
//      an untouched card sends itself after AUDIT_AUTOSEND_MINUTES. Until then
//      nothing in this system has ever sent a customer email unattended, and
//      turning it on is a one-line env change, not a code change.

import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { microsoft } from "@/lib/microsoft";
import { EMAIL_SIGNATURE_HTML } from "@/config/email-signature";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export const AUTOSEND_MINUTES = Math.max(1, Number(process.env.AUDIT_AUTOSEND_MINUTES) || 5);

/** The auto-send kill switch. Same convention as IMAGE_GEN_ENABLED / MAPS_PULL_ENABLED. */
export function autoSendEnabled(): boolean {
  return process.env.AUDIT_AUTOSEND_ENABLED === "1" || process.env.AUDIT_AUTOSEND_ENABLED === "true";
}

/**
 * Lead sources allowed to auto-send even while the GLOBAL switch is off.
 *
 * Added 2026-08-06 for the paid med spa lane. Someone who has just paid $39 for a
 * report cannot sit behind a manual "Send it" tap, but arming
 * AUDIT_AUTOSEND_ENABLED to fix that would also start sending unattended for every
 * /scan and /PDF lead, which is a behaviour change nobody asked for.
 *
 * Set AUDIT_AUTOSEND_SOURCES=medspa_paid and leave AUDIT_AUTOSEND_ENABLED unset.
 */
function autoSendSources(): string[] {
  return (process.env.AUDIT_AUTOSEND_SOURCES || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Is auto-send armed for THIS report? */
export function autoSendArmedFor(leadSource: string | null | undefined): boolean {
  if (autoSendEnabled()) return true;
  return autoSendSources().includes(leadSource ?? "");
}

/**
 * Is auto-send armed for anything at all?
 *
 * The backstop sweep needs this rather than autoSendEnabled(): with only a per-source
 * arm set, the global is off, and gating the sweep on the global would mean a paid
 * report whose in-process timer was lost to a cold start never sends. The sweep only
 * ever touches rows already stamped `pending` with a due `auto_send_at`, and only an
 * armed report gets stamped, so this cannot widen what sends.
 */
export function autoSendArmedForAnything(): boolean {
  return autoSendEnabled() || autoSendSources().length > 0;
}

/**
 * The signature that goes on every audit pitch.
 *
 * Read from Outlook by display name so Matthew can edit it in Outlook without a
 * deploy, exactly how submit-to-lenders.ts resolves the "Submission" signature.
 * Falls back to the repo constant when Microsoft is disconnected, because a
 * pitch with no sign-off is worse than one with a slightly stale one.
 */
export async function auditSignatureHtml(): Promise<string> {
  // "AI Ops" is the block's name in Outlook's signature list; its rendered content reads
  // "Matthew Garcia / AI Visibility - SRT". Naming it after the content would not find it.
  const name = process.env.AUDIT_SIGNATURE_NAME || "AI Ops";
  const fromOutlook = await microsoft.getSignatureByName(name).catch(() => null);
  if (fromOutlook) return fromOutlook;
  console.warn(`[lead-pitch] Outlook signature "${name}" not found, using the repo fallback`);
  return EMAIL_SIGNATURE_HTML;
}

/** Plain-text body + signature, as the HTML Outlook will store. */
export function buildPitchHtml(body: string, signatureHtml: string): string {
  const escaped = body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return (
    `<div style="white-space:pre-wrap;font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${escaped}</div>` +
    signatureHtml
  );
}

export interface PitchCardArgs {
  report: AuditReportRow;
  score: number;
  companyName: string;
  reportUrl: string;
  draftLink: string | null;
  subject: string | null;
  bodyPreview: string | null;
  autoSendAt: Date | null;
}

/** The Slack card: what it says, what it will do, and the two ways to steer it. */
export function buildPitchBlocks(args: PitchCardArgs): SlackBlock[] {
  const who = args.report.requester_name ? `${args.report.requester_name} · ` : "";
  const links = [
    args.draftLink ? `<${args.draftLink}|✉️ Open draft in Outlook>` : null,
    `<${args.reportUrl}|📊 View report>`,
  ]
    .filter(Boolean)
    .join(" · ");

  const head = args.draftLink
    ? `:fire: *Audit ready, pitch drafted* — *${args.companyName}* scored ${args.score}/100`
    : `:large_green_circle: *Audit ready* (Outlook draft failed, reconnect Microsoft 365) — *${args.companyName}* ${args.score}/100`;

  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${head}\nLead: ${who}${args.report.requester_email}\n${links}`,
      },
    } as SlackBlock,
  ];

  if (args.subject) {
    const preview = (args.bodyPreview ?? "")
      .split("\n")
      .filter(Boolean)
      .slice(0, 2)
      .map((l) => `> ${l}`)
      .join("\n");
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: `*Subject:* ${args.subject}\n${preview}` },
    } as SlackBlock);
  }

  if (args.draftLink) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "✅ Send it", emoji: true },
          style: "primary",
          action_id: "audit_send_now",
          value: args.report.id,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✋ Hold", emoji: true },
          action_id: "audit_hold",
          value: args.report.id,
        },
      ],
    } as SlackBlock);

    if (args.autoSendAt) {
      const when = args.autoSendAt.toLocaleTimeString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
        minute: "2-digit",
      });
      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `⏱️ Sends itself at ${when} ET unless you hold it.` }],
      } as unknown as SlackBlock);
    }
  }

  return blocks;
}

export type SendOutcome = "sent" | "already_sent" | "held" | "no_draft" | "error";

/**
 * Send the prepared Outlook draft for a report, once.
 *
 * Every path re-reads auto_send_state first, which is what makes the timer, the
 * button and the backstop sweep safe to race: the first one to flip the row to
 * 'sent' wins and the others become no-ops.
 */
export async function sendAuditPitch(
  reportId: string,
  actor: string
): Promise<{ outcome: SendOutcome; detail?: string }> {
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("id, requester_email, client_name, draft_message_id, auto_send_state")
    .eq("id", reportId)
    .maybeSingle();

  if (!data) return { outcome: "error", detail: "report not found" };
  if (data.auto_send_state === "sent") return { outcome: "already_sent" };
  if (data.auto_send_state === "held") return { outcome: "held" };
  if (!data.draft_message_id) return { outcome: "no_draft" };

  // Claim the send before doing it, so a concurrent tap cannot double-send.
  const { data: claimed } = await supabaseAdmin
    .from("audit_reports")
    .update({ auto_send_state: "sent", updated_at: new Date().toISOString() })
    .eq("id", reportId)
    .neq("auto_send_state", "sent")
    .select("id")
    .maybeSingle();

  if (!claimed) return { outcome: "already_sent" };

  try {
    await microsoft.sendDraft(data.draft_message_id as string);
  } catch (e) {
    // Put it back so the failure is retryable rather than silently swallowed.
    await supabaseAdmin
      .from("audit_reports")
      .update({ auto_send_state: "pending" })
      .eq("id", reportId);
    return { outcome: "error", detail: (e as Error).message };
  }

  await supabaseAdmin.from("system_logs").insert({
    event_type: "audit_pitch_sent",
    description: `Audit pitch sent to ${data.requester_email} (${data.client_name ?? reportId}) by ${actor}`,
    metadata: { report_id: reportId, actor },
  });

  await enrollSentPitch(reportId);
  return { outcome: "sent" };
}

/** Hand the recipient to the Follow-Up Operator so the ladder starts from a
 *  real send rather than waiting for tomorrow's Sent Items sweep. */
async function enrollSentPitch(reportId: string): Promise<void> {
  try {
    const { data: report } = await supabaseAdmin
      .from("audit_reports")
      .select("id, requester_email, requester_name, client_name, website, city, contact_id")
      .eq("id", reportId)
      .maybeSingle();
    if (!report?.requester_email) return;

    const { upsertProspect, updateProspect, logTouch } = await import("@/lib/followup-operator/prospects");
    const { nextTouchAt } = await import("@/lib/followup-operator/cadence");

    const prospect = await upsertProspect({
      email: report.requester_email as string,
      name: (report.requester_name as string | null) ?? null,
      company: (report.client_name as string | null) ?? null,
      website: (report.website as string | null) ?? null,
      city: (report.city as string | null) ?? null,
      contact_id: (report.contact_id as string | null) ?? null,
      audit_report_id: reportId,
      source: "audit",
      confirmed: true,
    });
    if (!prospect) return;

    const now = new Date();
    await logTouch({
      prospect_id: prospect.id,
      direction: "outbound",
      channel: "email",
      step: 1,
      outcome: "sent",
      metadata: { source: "lead_pitch" },
    });

    const due = nextTouchAt(1, now);
    await updateProspect(prospect.id, {
      first_sent_at: prospect.first_sent_at ?? now.toISOString(),
      last_touch_at: now.toISOString(),
      step: Math.max(prospect.step, 1),
      next_touch_at: due ? due.toISOString() : null,
    });
  } catch (e) {
    // Enrollment is a convenience: the Sent Items sweep would catch this
    // recipient tomorrow anyway, so a failure here must not fail the send.
    console.error("[lead-pitch] enrollment failed:", (e as Error).message);
  }
}

/**
 * Backstop for auto-send. The in-process timer lives inside one serverless
 * invocation, so a cold start or a redeploy can drop it; this re-checks the
 * table. Called from the daily digest cron.
 *
 * Only ever sends rows that are still 'pending' and already past their time, so
 * it cannot resurrect something that was held or already sent.
 */
export async function flushDueAutoSends(): Promise<{ sent: number; checked: number }> {
  if (!autoSendArmedForAnything()) return { sent: 0, checked: 0 };

  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("auto_send_state", "pending")
    .not("auto_send_at", "is", null)
    .lte("auto_send_at", new Date().toISOString())
    .limit(25);

  const rows = data ?? [];
  let sent = 0;
  for (const r of rows) {
    const res = await sendAuditPitch(r.id as string, "auto-send backstop");
    if (res.outcome === "sent") sent++;
  }
  return { sent, checked: rows.length };
}
