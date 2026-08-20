// The one send loop.
//
// Nudges and the existing auto-send pitch lane share this queue rather than running beside each
// other, because both need the same three things and building them twice is how two lanes end up
// disagreeing about the budget: pacing that survives a cold start, a daily budget counted off
// real sends, and a claim two overlapping cron ticks cannot both win.
//
// FIRST-CONTACT EMAILS DO NOT COME THROUGH HERE. Cold email 1 and the no-website pitch stay
// DRAFTS. The kind CHECK admits only 'nudge' and 'pitch'.
//
// Pacing lives in send_after, set at enqueue time, not in this drainer. A backlog therefore
// cannot be flushed by someone hitting the cron URL by hand.

import { supabaseAdmin } from "@/lib/db";
import { microsoft } from "@/lib/microsoft";
import { logTouch, updateProspect } from "@/lib/followup-operator/prospects";
import { nextTouchAt } from "@/lib/followup-operator/cadence";
import { mailboxHeadroom } from "@/lib/followup-operator/mailboxes";
import { toGraphMailbox } from "@/config/outreach-mailboxes";

const CLAIM_STALE_MS = 10 * 60 * 1000;

export function senderEnabled(): boolean {
  return process.env.OUTREACH_SENDER_ENABLED === "1" || process.env.OUTREACH_SENDER_ENABLED === "true";
}

/** Shared across mailboxes, counted exactly like the per-mailbox budget. */
export function nudgeDailyCap(): number {
  return Math.max(0, Number(process.env.NUDGE_DAILY_CAP) || 60);
}

function jitterRange(): { min: number; max: number } {
  const min = Math.max(1, Number(process.env.OUTREACH_QUEUE_JITTER_MIN) || 5);
  const max = Math.max(min, Number(process.env.OUTREACH_QUEUE_JITTER_MAX) || 8);
  return { min, max };
}

export interface EnqueueInput {
  prospectId: string;
  kind: "nudge" | "pitch";
  step?: number;
  recipient: string;
  mailbox: string;
  auditReportId?: string | null;
  draftMessageId?: string | null;
  replyToMessageId?: string | null;
  subject?: string | null;
  bodyHtml?: string | null;
  dedupeKey: string;
}

/**
 * Next eligible send time for a mailbox: at least `min` and at most `max` minutes after whatever
 * is already queued for it. Computed per mailbox at enqueue time so a whole 7:30am batch is
 * spread before the first tick runs.
 */
async function nextSendAfter(mailbox: string, now: Date): Promise<Date> {
  const { min, max } = jitterRange();
  const { data } = await supabaseAdmin
    .from("outreach_send_queue")
    .select("send_after")
    .eq("mailbox", mailbox)
    .in("status", ["queued", "sending"])
    .order("send_after", { ascending: false })
    .limit(1);

  const last = data?.[0]?.send_after ? new Date(data[0].send_after as string) : null;
  const base = last && last > now ? last : now;
  const gapMs = (min + Math.random() * (max - min)) * 60_000;
  return new Date(base.getTime() + gapMs);
}

export async function enqueueSend(
  input: EnqueueInput,
  now = new Date()
): Promise<{ id: string } | { skipped: "duplicate" | "capped" }> {
  const headroom = await mailboxHeadroom(now);
  const box = headroom.find((h) => h.address === input.mailbox.toLowerCase());

  // Committed = already sent today PLUS already queued for today. Refusing at enqueue rather
  // than at drain means the Slack card can report the true number instead of promising sends
  // that will be skipped one at a time.
  const { count: pending } = await supabaseAdmin
    .from("outreach_send_queue")
    .select("id", { count: "exact", head: true })
    .eq("mailbox", input.mailbox.toLowerCase())
    .in("status", ["queued", "sending"]);

  if (box && box.used + (pending ?? 0) >= box.cap) return { skipped: "capped" };

  const sendAfter = await nextSendAfter(input.mailbox.toLowerCase(), now);
  const { data, error } = await supabaseAdmin
    .from("outreach_send_queue")
    .upsert(
      {
        prospect_id: input.prospectId,
        audit_report_id: input.auditReportId ?? null,
        kind: input.kind,
        step: input.step ?? null,
        recipient: input.recipient,
        mailbox: input.mailbox.toLowerCase(),
        draft_message_id: input.draftMessageId ?? null,
        reply_to_message_id: input.replyToMessageId ?? null,
        subject: input.subject ?? null,
        body_html: input.bodyHtml ?? null,
        send_after: sendAfter.toISOString(),
        dedupe_key: input.dedupeKey,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true }
    )
    .select("id");

  if (error) throw new Error(`enqueueSend: ${error.message}`);
  const row = (data ?? [])[0] as { id: string } | undefined;
  return row ? { id: row.id } : { skipped: "duplicate" };
}

export interface DrainResult {
  released: number;
  sent: number;
  canceled: number;
  failed: number;
  skippedCapped: number;
  errors: string[];
}

/**
 * One tick. Sends at most ONE email per mailbox, nudges before pitches.
 *
 * One per mailbox per tick is what actually enforces "never two sends in the same minute from one
 * mailbox": send_after spaces them, and this is the belt to that braces.
 */
export async function drainSendQueue(opts?: { dry?: boolean }): Promise<DrainResult> {
  const now = new Date();
  const result: DrainResult = { released: 0, sent: 0, canceled: 0, failed: 0, skippedCapped: 0, errors: [] };

  // A claim that never came back. Released after ten minutes, NOT retried immediately: a Graph
  // 202 we failed to read is a SENT email, and re-sending it is the one unrecoverable mistake
  // available here.
  const { data: stale } = await supabaseAdmin
    .from("outreach_send_queue")
    .update({ status: "queued", error: "claim expired, released", updated_at: now.toISOString() })
    .eq("status", "sending")
    .lt("claimed_at", new Date(now.getTime() - CLAIM_STALE_MS).toISOString())
    .select("id");
  result.released = (stale ?? []).length;

  const { data: due } = await supabaseAdmin
    .from("outreach_send_queue")
    .select("*")
    .eq("status", "queued")
    .lte("send_after", now.toISOString())
    .order("send_after", { ascending: true });

  // Nudges drain first: a nudge is time-of-day sensitive, a pitch already waited for a human.
  const ordered = (due ?? []).sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "nudge" ? -1 : 1;
    return String(a.send_after).localeCompare(String(b.send_after));
  });

  const headroom = await mailboxHeadroom(now);
  const usedThisTick = new Set<string>();

  for (const row of ordered) {
    const mailbox = String(row.mailbox);
    if (usedThisTick.has(mailbox)) continue; // one per mailbox per tick

    const box = headroom.find((h) => h.address === mailbox);
    if (box && box.used >= box.cap) {
      result.skippedCapped++;
      continue;
    }

    if (opts?.dry) {
      usedThisTick.add(mailbox);
      continue;
    }

    // Claim before sending. A conditional UPDATE, not a read-then-write, so a concurrent tick
    // cannot also take it. Same shape sendAuditPitch already uses.
    const { data: claimed } = await supabaseAdmin
      .from("outreach_send_queue")
      .update({
        status: "sending",
        claimed_at: now.toISOString(),
        attempts: (row.attempts as number) + 1,
        updated_at: now.toISOString(),
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id")
      .maybeSingle();
    if (!claimed) continue;

    // Re-read the prospect immediately before the send, NOT once when the queue was built.
    // Selection happens at 07:30 and this may run at 09:15; that gap is exactly when a reply
    // arrives.
    const { data: p } = await supabaseAdmin
      .from("outreach_prospects")
      .select("id, email, step, first_sent_at, last_reply_at, paused, state, conversation_id, last_message_id")
      .eq("id", row.prospect_id)
      .maybeSingle();

    if (!p || p.last_reply_at || p.paused || p.state === "CLOSED") {
      await supabaseAdmin
        .from("outreach_send_queue")
        .update({ status: "canceled", error: p?.last_reply_at ? "replied" : "paused or closed", updated_at: new Date().toISOString() })
        .eq("id", row.id);
      result.canceled++;
      continue;
    }

    const graphMailbox = toGraphMailbox(mailbox);
    try {
      let messageId: string;
      if (row.draft_message_id) {
        // A reviewed draft is fired verbatim, so what goes out is byte for byte what was
        // approved, including any edit made in Outlook.
        messageId = String(row.draft_message_id);
      } else {
        const draft = await microsoft.createReplyDraft({
          messageId: String(row.reply_to_message_id),
          html: String(row.body_html),
          mailbox: graphMailbox,
        });
        messageId = draft.id;
      }

      // Durable ids BEFORE the send, so the touch dedupes against tomorrow's sweep.
      const keys = await microsoft
        .getMessageKeys(messageId, graphMailbox)
        .catch(() => ({ internetMessageId: null, conversationId: null }));

      await microsoft.sendDraft(messageId, graphMailbox);

      const sentAt = new Date();
      const step = row.kind === "nudge" ? (row.step as number) ?? 2 : 1;
      const logged = await logTouch({
        prospect_id: String(row.prospect_id),
        direction: "outbound",
        channel: "email",
        step,
        subject: (row.subject as string | null) ?? null,
        outcome: "sent",
        graph_message_id: messageId,
        internet_message_id: keys.internetMessageId,
        conversation_id: keys.conversationId,
        mailbox,
        occurred_at: sentAt.toISOString(),
        metadata: { source: "outreach_sender", kind: row.kind },
      });

      await supabaseAdmin
        .from("outreach_send_queue")
        .update({
          status: "sent",
          sent_at: sentAt.toISOString(),
          sent_touch_id: logged.status === "inserted" ? logged.id : null,
          graph_message_id: messageId,
          internet_message_id: keys.internetMessageId,
          updated_at: sentAt.toISOString(),
        })
        .eq("id", row.id);

      const due = nextTouchAt(step, new Date(p.first_sent_at ?? sentAt));
      await updateProspect(String(row.prospect_id), {
        step: Math.max(Number(p.step ?? 1), step),
        last_touch_at: sentAt.toISOString(),
        last_message_id: messageId,
        conversation_id: p.conversation_id ?? keys.conversationId,
        next_touch_at: due ? due.toISOString() : null,
      });

      if (box) box.used++;
      usedThisTick.add(mailbox);
      result.sent++;
    } catch (e) {
      const message = (e as Error).message;
      const transient = /\b(429|5\d\d)\b|timeout|ECONNRESET|token/i.test(message);
      const attempts = (row.attempts as number) + 1;
      await supabaseAdmin
        .from("outreach_send_queue")
        .update({
          status: transient && attempts < 3 ? "queued" : "failed",
          send_after: transient && attempts < 3 ? new Date(now.getTime() + 10 * 60_000).toISOString() : row.send_after,
          error: message.slice(0, 500),
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      result.failed++;
      result.errors.push(`${row.recipient}: ${message.slice(0, 160)}`);
      usedThisTick.add(mailbox);
    }
  }

  return result;
}
