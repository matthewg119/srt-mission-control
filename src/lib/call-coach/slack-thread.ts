/**
 * SRT Call Coach — what was actually said in the audit's Slack thread.
 *
 * ## Why this exists
 *
 * The brief already reads Zoho live and the Outlook mailbox live. Slack was the hole: `brief.ts`
 * carried `slack_channel_id` / `slack_thread_ts` purely so the POST-call wrap knew where to post,
 * and never read a byte of the thread. So everything decided in `#ai-visibility-audits` — a
 * correction typed after a draft, an objection worked out in-thread, a note about who actually
 * answers the phone — was invisible on the call unless a recognised command happened to persist it
 * into a column. `intake_answers` was the only path in, and only for free text typed at exactly the
 * `awaiting_intake` stage.
 *
 * Read live at scan time rather than written through as it happens. A live read needs no new table,
 * no backfill of the audits that already exist, and cannot drift from the thread it is describing.
 * The scan is pre-call and already spends far longer on Zoho and Graph, so one more call is free.
 *
 * ‼️ Fails open, always. `conversationsReplies` already returns [] on any error, and the caller
 * wraps this in a catch as well. A Slack outage must never stop Matthew dialling.
 */

import { slack } from "@/lib/slack-bot";

/** Enough to cover a real audit conversation without paging. */
const FETCH_LIMIT = 40;

/**
 * Hard cap on what reaches the brief.
 *
 * ‼️ `/suggest` truncates the whole brief at MAX_BRIEF_CHARS (4000). Thread chatter is the least
 * important thing in there and the measured numbers are the most important, so this stays small
 * AND the caller appends it LAST. Anything that pushes the score off the end of the brief
 * reintroduces the exact bug this feature was built alongside.
 */
const MAX_BLOCK_CHARS = 800;

/**
 * Thread commands, not context.
 *
 * These are how Matthew drives the audit thread (`1` sends the draft, `call` prints the phone
 * script, `nudge 3` writes the next touch). They tell the coach nothing about the prospect, and
 * left in they read as if the prospect said them. Matched on the WHOLE message, so a sentence that
 * merely contains the word "call" survives.
 */
const COMMAND_ONLY =
  /^(?:\d{1,2}|y|yes|no|ok|okay|send it|send|hold|loom|script|image|avatars|reveal|call|close|draft|cancel|track|ignore|nudge\s*\d|email\s*\d|seed\s*\d|image\s+\w+)\.?$/i;

export interface AuditThreadNotes {
  /** Human messages, oldest first, already trimmed. */
  lines: string[];
  /** How many human messages existed before the char cap dropped any. */
  total: number;
}

/**
 * Human replies from the audit thread, oldest first.
 *
 * Bot messages are dropped wholesale. That is deliberate and it is most of the volume: the audit
 * card, every drafted email, every receipt and every agent reasoning reply are all bot posts, and
 * they are either already in the brief by another route or are output rather than input. What is
 * left is what a person typed, which is the only part nothing else captures.
 */
export async function readAuditThreadNotes(
  channel: string | null,
  threadTs: string | null,
  /**
   * Char budget for the kept lines. Defaults to the LIVE COACH's budget, which is small on purpose
   * (see the note on MAX_BLOCK_CHARS above) and must stay the default so nothing silently widens
   * the brief. The post-call email drafter passes a bigger number: it is not competing with a score
   * for room in a 4000-char brief, and for it the thread history IS the material.
   */
  maxChars: number = MAX_BLOCK_CHARS
): Promise<AuditThreadNotes | null> {
  if (!channel || !threadTs) return null;

  const raw = await slack.conversationsReplies(channel, threadTs, FETCH_LIMIT);
  if (!raw?.length) return null;

  const human: string[] = [];
  for (const m of raw) {
    const msg = m as { text?: string; bot_id?: string; subtype?: string; user?: string };
    // A bot post, a join notice, or anything without a real author.
    if (msg.bot_id || msg.subtype || !msg.user) continue;

    const text = (msg.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) continue;
    if (COMMAND_ONLY.test(text)) continue;
    // Bare mentions with nothing after them ("@Vektor") carry no content.
    const stripped = text.replace(/<[@#!][^>]+>/g, "").trim();
    if (stripped.length < 12) continue;

    human.push(stripped);
  }

  if (!human.length) return null;

  // Keep the NEWEST messages when trimming — the last thing decided outranks the first — but
  // render oldest-first so it reads as a conversation.
  const kept: string[] = [];
  let used = 0;
  for (let i = human.length - 1; i >= 0; i--) {
    const line = human[i];
    if (used + line.length > maxChars && kept.length) break;
    kept.unshift(line.slice(0, maxChars));
    used += line.length;
  }

  return { lines: kept, total: human.length };
}

/** The brief block. Empty string when there is nothing worth saying. */
export function formatAuditThreadNotes(notes: AuditThreadNotes | null): string {
  if (!notes?.lines.length) return "";
  const dropped = notes.total - notes.lines.length;
  return [
    `THREAD NOTES, what we said about this lead in Slack${dropped > 0 ? ` (newest ${notes.lines.length} of ${notes.total})` : ""}:`,
    ...notes.lines.map((l) => `- ${l}`),
    "These are OUR notes to each other, not things the prospect said. Never quote one back to them as if they had.",
  ].join("\n");
}
