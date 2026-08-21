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
import { PITCH_SIGNATURE_HTML } from "@/config/email-signature";
import type { AuditReportRow } from "@/lib/audit-engine/types";
import { DEFAULTS } from "@/config/defaults";

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
 * ‼️ THE OUTLOOK LOOKUP IS DEAD AND THE CONSTANT IS NOW THE REAL ANSWER, NOT THE FALLBACK.
 *
 * This was written to read the block out of Outlook by display name so Matthew could edit the
 * signature without a deploy. Microsoft has since removed the endpoint it depended on: a live
 * call to `GET /beta/me/mailboxSettings/signatures` answers
 *
 *     400  BadRequest  "Resource not found for the segment 'signatures'."
 *
 * getSignatureByName() swallows that and returns null, so this has ALWAYS taken the fallback
 * branch in production and nothing said so out loud except one console.warn per draft. Every
 * pitch for months was signed from code while the comment here claimed otherwise. Verify with
 * `bunx tsx --env-file=.env.local scripts/_probe-signature.ts` rather than by reading this.
 *
 * The lookup is KEPT rather than deleted, for two reasons: it costs one request against a lane
 * that is already several seconds of model work, and if Microsoft ever ships the endpoint on /v1.0
 * this starts working again with no code change. What changed is the fallback. It used to be
 * EMAIL_SIGNATURE_HTML, which is the heavy branded block, and that is why cold pitches were going
 * out with a "Get your free AI audit" BUTTON under an email whose entire rule is one ask and no
 * links. PITCH_SIGNATURE_HTML is the plain block, and it is what a cold pitch should look like.
 */
export async function auditSignatureHtml(): Promise<string> {
  // "AI Ops" is the block's name in Outlook's signature list. Kept so the day the endpoint comes
  // back, the name it looks for is still the right one.
  const name = process.env.AUDIT_SIGNATURE_NAME || "AI Ops";
  const fromOutlook = await microsoft.getSignatureByName(name).catch(() => null);
  if (fromOutlook) return fromOutlook;
  return PITCH_SIGNATURE_HTML;
}

/**
 * `**x**` -> `<strong>x</strong>`, and nothing else.
 *
 * ‼️ RUNS AFTER escape(), NEVER BEFORE, and that order is the safety property rather than a style
 * preference. By the time this sees the text, every real `<`, `>` and `&` is already an entity, so
 * the only thing left that can become a tag is the tag this function writes itself. Escaping does
 * not touch `*`, so the markers survive it intact and there is nothing a prospect's own copy could
 * smuggle through.
 *
 * Bold reaches here from exactly one lane. Every pre-pitch drafter calls polishBody with
 * allowEmphasis:false, which strips emphasis long before this point, so their HTML is unchanged
 * byte for byte. The hook lane passes allowEmphasis:true on purpose, for HOOK_PRETEXT_LINE.
 *
 * Single-line only (no `s` flag, `\n` excluded from the class): an unclosed `**` then cannot
 * swallow the rest of the email into one bold run.
 */
function bold(escaped: string): string {
  return escaped.replace(/\*\*(?=\S)([^*\n]+?)\*\*/g, "<strong>$1</strong>");
}

/**
 * Plain-text body + signature, as the HTML Outlook will store.
 *
 * Real <p> and <br> tags, NOT white-space:pre-wrap. Outlook's compose editor rewrites the HTML
 * it loads, and a pre-wrap div is a hint it is free to drop: when it does, every newline in the
 * body collapses and a six-paragraph email opens as one run-on block. Paragraph tags are
 * structure rather than styling, so nothing downstream is at liberty to flatten them.
 *
 * Blank lines separate paragraphs; a single newline inside one becomes a <br>. That distinction
 * is what keeps "Thanks," sitting directly on top of "Matthew Garcia" instead of a gap opening
 * between them.
 */
export function buildPitchHtml(body: string, signatureHtml: string): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const paragraphs = body
    .trim()
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="margin:0 0 12px 0;">${bold(escape(block)).replace(/\n/g, "<br>")}</p>`)
    .join("");
  return `<div style="font-family:'Segoe UI',Arial,sans-serif;font-size:14px;line-height:1.5">${paragraphs}</div>${signatureHtml}`;
}

/** The shared mailbox an outreach draft is copied into alongside Matthew's own. */
export function submissionsMailbox(): string {
  return process.env.SUBMISSIONS_MAILBOX || DEFAULTS.submissionsFromAddress;
}

/** One draft that exists in one mailbox. `mailbox: null` is the connected account (/me). */
export interface PlacedDraft {
  mailbox: string | null;
  id: string;
  url: string;
}

export interface PlaceDraftResult {
  placed: PlacedDraft[];
  /** Mailboxes that refused the write. Never includes the primary, which throws instead. */
  failed: Array<{ mailbox: string; error: string }>;
}

/**
 * Put one email into one or more Outlook drafts folders, replacing whatever was there before.
 *
 * The single implementation of "this email, into these mailboxes" — the audit thread and the
 * no-website pitch both come through here, so a draft cannot be composed one way from one lane
 * and another way from the other.
 *
 * `mailboxes` is ordered and `undefined` means /me. THE FIRST ENTRY IS THE PRIMARY and is the
 * only one allowed to fail loudly: it is the draft Matthew is going to send. A secondary mailbox
 * is a convenience copy, and its most likely failure is the delegated token lacking write rights
 * on a shared mailbox — a real possibility, since nothing in this codebase wrote to a mailbox
 * other than /me before. Losing the whole card over a missing copy would be the wrong trade, so
 * secondaries are collected into `failed` for the caller to print.
 *
 * `previous` is deleted first, matched per mailbox. microsoft.deleteDraft() re-checks isDraft
 * against Graph and refuses to touch anything already sent, so a stale id that now points at a
 * sent email cannot destroy it. Delete failures are ignored: the new draft is the point.
 *
 * A reply draft (replyToMessageId) can only ever exist in ONE mailbox. Graph anchors createReply
 * on a message id that lives in a specific mailbox, and that message is not in the shared one.
 * Passing both is a caller bug, not a runtime condition, so it throws.
 */
export async function placeOutreachDraft(params: {
  to?: string;
  subject: string;
  html: string;
  attachments?: Array<{ name: string; contentType: string; contentBytes: string }>;
  /** Ordered; `undefined` = /me. First entry is the primary. */
  mailboxes: Array<string | undefined>;
  replyToMessageId?: string;
  previous?: PlacedDraft[];
}): Promise<PlaceDraftResult> {
  const mailboxes = params.mailboxes.length > 0 ? params.mailboxes : [undefined];
  if (params.replyToMessageId && mailboxes.length > 1) {
    throw new Error("A reply draft cannot be placed in more than one mailbox");
  }

  const placed: PlacedDraft[] = [];
  const failed: Array<{ mailbox: string; error: string }> = [];

  for (const [i, mailbox] of mailboxes.entries()) {
    const key = mailbox ?? null;
    const stale = params.previous?.find((p) => p.mailbox === key);
    if (stale) await microsoft.deleteDraft(stale.id, mailbox).catch(() => "gone" as const);

    try {
      const made = params.replyToMessageId
        ? await microsoft.createReplyDraft({
            messageId: params.replyToMessageId,
            html: params.html,
            mailbox,
            to: params.to,
            attachments: params.attachments,
          })
        : await microsoft.createDraft({
            mailbox,
            to: params.to,
            subject: params.subject,
            body: params.html,
            attachments: params.attachments,
          });
      placed.push({ mailbox: key, id: made.id, url: made.webLink });
    } catch (e) {
      if (i === 0) throw e;
      failed.push({ mailbox: mailbox as string, error: (e as Error).message });
    }
  }

  return { placed, failed };
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

  // Read the durable ids BEFORE the send. internetMessageId is stamped at draft creation and
  // survives into Sent Items, so it is what lets tomorrow's sweep recognise this email as one
  // already logged instead of recording a second touch for the same send.
  const keys = await microsoft
    .getMessageKeys(data.draft_message_id as string)
    .catch(() => ({ internetMessageId: null, conversationId: null }));

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

  await enrollSentPitch(reportId, {
    graphMessageId: data.draft_message_id as string,
    internetMessageId: keys.internetMessageId,
    conversationId: keys.conversationId,
  });
  return { outcome: "sent" };
}

/** Hand the recipient to the Follow-Up Operator so the ladder starts from a
 *  real send rather than waiting for tomorrow's Sent Items sweep. */
async function enrollSentPitch(
  reportId: string,
  keys?: { graphMessageId: string | null; internetMessageId: string | null; conversationId: string | null }
): Promise<void> {
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
    const { connectedMailbox } = await import("@/config/outreach-mailboxes");

    // Carries the message ids on purpose. Without them this touch has a NULL message_key, which
    // never conflicts with anything, so the Sent Items sweep would log the SAME email again
    // tomorrow and advance the ladder a second time.
    const logged = await logTouch({
      prospect_id: prospect.id,
      direction: "outbound",
      channel: "email",
      step: 1,
      outcome: "sent",
      graph_message_id: keys?.graphMessageId ?? null,
      internet_message_id: keys?.internetMessageId ?? null,
      conversation_id: keys?.conversationId ?? null,
      mailbox: connectedMailbox(),
      occurred_at: now.toISOString(),
      metadata: { source: "lead_pitch" },
    });
    if (logged.status === "error") {
      console.error("[lead-pitch] send-time touch failed:", logged.message);
    }

    const due = nextTouchAt(1, now);
    await updateProspect(prospect.id, {
      first_sent_at: prospect.first_sent_at ?? now.toISOString(),
      last_touch_at: now.toISOString(),
      step: Math.max(prospect.step, 1),
      conversation_id: prospect.conversation_id ?? keys?.conversationId ?? null,
      last_message_id: keys?.graphMessageId ?? prospect.last_message_id ?? null,
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
