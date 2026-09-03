// Reads Matthew's Outlook Sent Items and turns real sent pitches into pipeline
// rows. This is the piece that makes the operator honest: it follows what he
// actually sent, including emails he typed himself, rather than only knowing
// about drafts the system generated.
//
// Graph note: listMessages hardcodes $orderby=receivedDateTime desc, and Graph
// rejects a $filter on one date property combined with an $orderby on another
// ("InefficientFilter"). So the window filters on receivedDateTime, which Graph
// populates on sent mail too, and sentDateTime is only read for display.
//
// ‼️ IT SWEEPS EVERY MAILBOX IN outreachMailboxes(), NOT JUST /me, and that is what makes the
// rotation's daily caps real rather than decorative. Mail sent from submissions@ lands in
// submissions@'s Sent Items and /me never sees it. Reading /me alone meant that mailbox's `used`
// count stayed at 0 forever, so it was never `full`, so once matthew@ hit its cap EVERY pitch
// drafted from submissions@ from then on, uncapped. A one-way door, not a rotation, and the exact
// deliverability risk the caps exist to prevent. Each touch is attributed to the mailbox it was
// actually found in, which is what mailboxHeadroom() groups by.

import { supabaseAdmin } from "@/lib/db";
import { microsoft, type GraphMessage } from "@/lib/microsoft";
import { logTouch, upsertProspect, updateProspect, getProspectByEmail, getProspectByConversation, normalizeEmail } from "./prospects";
import { nextTouchAt, snapTo9amET, totalSteps } from "./cadence";
import { outreachMailboxes, toGraphMailbox, type OutreachMailbox } from "@/config/outreach-mailboxes";
import type { OutreachProspectRow } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;
const OVERLAP_MS = 30 * 60 * 1000; // absorbs clock skew and a mid-run failure
const FIRST_RUN_LOOKBACK_MS = 7 * DAY_MS;
const DEFAULT_MAX = 300;

export interface SweepResult {
  scanned: number;
  matched: number;
  created: number;
  skippedExcluded: number;
  skippedDuplicate: number;
  windowStart: string;
  error?: string;
}

/** Our own domain plus anything Matthew adds. A pitch is never sent to us. */
export function excludedDomains(): string[] {
  const extra = (process.env.OUTREACH_EXCLUDE_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return ["srtagency.com", ...extra];
}

export function isExcluded(email: string, domains: string[]): boolean {
  const at = email.lastIndexOf("@");
  if (at < 0) return true;
  const domain = email.slice(at + 1);
  return domains.some((d) => domain === d || domain.endsWith(`.${d}`));
}

function recipientsOf(msg: GraphMessage): string[] {
  const all = [...(msg.toRecipients ?? []), ...(msg.ccRecipients ?? [])];
  return all
    .map((r) => (r.emailAddress?.address ?? "").trim().toLowerCase())
    .filter(Boolean);
}

async function readSweepState(): Promise<{ last_sent_scan_at: string | null }> {
  const { data } = await supabaseAdmin
    .from("outreach_sweep_state")
    .select("last_sent_scan_at")
    .eq("id", 1)
    .maybeSingle();
  return { last_sent_scan_at: (data?.last_sent_scan_at as string | null) ?? null };
}

async function writeSweepState(at: Date): Promise<void> {
  await supabaseAdmin
    .from("outreach_sweep_state")
    .upsert({ id: 1, last_sent_scan_at: at.toISOString(), updated_at: at.toISOString() });
}

/** Resolve a recipient address to a prospect, creating one when the audit
 *  engine already knows who they are.
 *
 *  ‼️ RETURNS null FOR ANYTHING IT DOES NOT ALREADY KNOW. It used to enroll: an auto-confirmed row
 *  when audit_reports held the address, an unconfirmed one otherwise. Both were removed 2026-09-03
 *  when the Loom handover became the only door onto the board. See the note in the body. */
async function resolveProspect(
  address: string,
  msg: GraphMessage
): Promise<{ prospect: OutreachProspectRow; created: boolean } | null> {
  const existing = await getProspectByEmail(address);
  if (existing) return { prospect: existing, created: false };

  // Same Outlook conversation, different address: an assistant replied, or a
  // second person at the clinic was added. That is the same file, not a new one.
  const byThread = msg.conversationId ? await getProspectByConversation(msg.conversationId) : null;
  if (byThread) return { prospect: byThread, created: false };

  // ‼️ THE SWEEP NO LONGER CREATES PROSPECTS. IT ONLY RECOGNISES THEM. (2026-09-03)
  //
  // Everything above this line still runs: an existing prospect is matched by address or by
  // Outlook conversation, and recordOutbound() advances their ladder exactly as before. That is
  // the sweep's real job, keeping the board honest about what was actually sent.
  //
  // What is switched off is enrolment. Matthew: "every message in follow ups channel should be
  // from people we already sent the loom to." Wiping outreach_prospects would not have achieved
  // that on its own: this function was minting a row for every address in Sent Items, 86 of the
  // 104 rows in the table came from here, and the board would have refilled itself from ordinary
  // mail within a day of the reset. The Loom handover is the only door now.
  //
  // What was removed, so the day somebody wants a second door they know what used to be here:
  //   - an `audit_reports.prospect_email` match enrolled auto-confirmed, source "audit"
  //   - anything else enrolled unconfirmed, source "outlook_sweep", awaiting one tap in the digest
  // Both are in git at a9dc805. Restoring either means deciding what it does to the board's
  // promise that everybody on it has already had the Loom.
  //
  return null;
}

/** Advance the ladder for an outbound email that actually went out. */
async function recordOutbound(p: OutreachProspectRow, msg: GraphMessage, sentAt: Date): Promise<void> {
  const isFirst = !p.first_sent_at;
  const step = isFirst ? 1 : Math.min(p.step + 1, totalSteps());
  const firstSent = isFirst ? sentAt : new Date(p.first_sent_at as string);

  const patch: Record<string, unknown> = {
    step,
    last_touch_at: sentAt.toISOString(),
    conversation_id: msg.conversationId ?? p.conversation_id,
    thread_subject: p.thread_subject ?? msg.subject ?? null,
    last_message_id: msg.id,
  };
  if (isFirst) patch.first_sent_at = sentAt.toISOString();

  // Unconfirmed rows get the history but never a schedule.
  if (p.confirmed && p.state !== "CLOSED") {
    if (p.state === "SENT_NO_REPLY") {
      const due = nextTouchAt(step, firstSent);
      patch.next_touch_at = due ? due.toISOString() : null;
      if (!due) {
        patch.state = "CLOSED";
        patch.closed_reason = "sequence_exhausted";
      }
    } else {
      // Replied states are answered by hand; the next check-in is a day out.
      patch.next_touch_at = snapTo9amET(new Date(sentAt.getTime() + DAY_MS)).toISOString();
    }
  }

  await updateProspect(p.id, patch);
}

/** One sent message, and which mailbox it was found in. */
interface SentSighting {
  msg: GraphMessage;
  mailbox: string;
}

/**
 * Every sent message across every mailbox in the rotation, in the order they should be processed.
 *
 * ‼️ REPLAY SORTS ACROSS ALL MAILBOXES, NOT WITHIN EACH ONE, and that is the whole reason this is
 * a function rather than a nested loop. recordOutbound() sets first_sent_at on the FIRST sighting
 * of a prospect and derives the entire ladder from it, so a backfill that finished matthew@ before
 * starting submissions@ would anchor a prospect first emailed from submissions@ in January on
 * whatever matthew@ sent them in June, and walk their steps backwards. Sorting per mailbox looks
 * correct and reintroduces exactly the bug the replay flag exists to prevent.
 *
 * BOTH paths buffer, and only the SORT is conditional. The daily path used to stream, which was
 * worth it when there was one mailbox and one iterator; with several read one after another the
 * saving is gone and the shapes would have to differ for no benefit. The buffer is bounded by
 * `max` PER MAILBOX, so it is a few hundred message summaries at worst.
 *
 * Unsorted is the right daily order, not an oversight: a 24h window cannot hold two touches for
 * one prospect out of order in a way that matters.
 *
 * ‼️ THE CAP IS PER MAILBOX. A single cumulative counter lets a busy first mailbox starve the
 * second of its whole window, which is silent data loss dressed up as a limit.
 */
async function sentMessages(
  mailboxes: OutreachMailbox[],
  windowStart: string,
  max: number,
  replay?: boolean
): Promise<SentSighting[]> {
  const all: SentSighting[] = [];

  for (const box of mailboxes) {
    let taken = 0;
    const pageSource = microsoft.listMessages({
      // undefined for the connected account, which Graph reaches as /me. Everything else needs
      // /users/{address} plus Mail.Read.Shared, which the delegated token holds. Verify with
      // scripts/_probe-mailbox-read.ts rather than by assuming.
      mailbox: toGraphMailbox(box.address),
      folder: "sentitems",
      filter: `receivedDateTime ge ${windowStart}`,
      top: 50,
      select: [
        "id",
        "conversationId",
        "subject",
        "toRecipients",
        "ccRecipients",
        "receivedDateTime",
        "sentDateTime",
        "bodyPreview",
        "isDraft",
        // The real idempotency key. Stable across the send and across mailboxes, unlike `id`,
        // which Graph scopes to one mailbox.
        "internetMessageId",
      ],
    });

    for await (const msg of pageSource) {
      all.push({ msg, mailbox: box.address });
      if (++taken >= max) break;
    }
  }

  if (replay) {
    const at = (s: SentSighting) =>
      (s.msg as GraphMessage & { sentDateTime?: string }).sentDateTime ?? s.msg.receivedDateTime ?? "";
    all.sort((a, b) => at(a).localeCompare(at(b)));
    console.log(`[followup] replay: ${all.length} messages across ${mailboxes.length} mailbox(es), oldest first`);
  }

  return all;
}

/**
 * Sweep Sent Items and enroll or advance every prospect Matthew emailed.
 *
 * Idempotent by Graph message id: the window deliberately overlaps the previous
 * run, and a message already in outreach_touches leaves the clock untouched.
 */
export async function runSentMailSweep(opts?: {
  sinceISO?: string;
  max?: number;
  /**
   * Process the whole window OLDEST FIRST, across every mailbox at once.
   *
   * listMessages hardcodes $orderby=receivedDateTime desc, and recordOutbound() sets
   * first_sent_at on the FIRST sighting of a prospect and derives the whole ladder from it.
   * So a wide newest-first replay anchors every prospect on their most recent email and walks
   * the steps backwards. Harmless for the daily 24h window, wrong for a 60-day backfill.
   *
   * "Across every mailbox at once" is load-bearing now that there is more than one: see
   * sentMessages(), which sorts the combined list rather than each mailbox's.
   */
  replay?: boolean;
  /** Backfills pass false: the watermark is correctly parked at today and must not rewind. */
  writeWatermark?: boolean;
}): Promise<SweepResult> {
  const now = new Date();
  const max = opts?.max ?? DEFAULT_MAX;
  const domains = excludedDomains();
  // ORDERED, and the order is outreachMailboxes()'s. Deduplication is on message_key
  // (internetMessageId), which is stable across mailboxes, so a message visible in two of them
  // writes one row attributed to whichever comes first here. Deterministic, and the same answer
  // every run.
  const mailboxes = outreachMailboxes();

  const state = await readSweepState();
  const windowStart =
    opts?.sinceISO ??
    new Date(
      state.last_sent_scan_at
        ? new Date(state.last_sent_scan_at).getTime() - OVERLAP_MS
        : now.getTime() - FIRST_RUN_LOOKBACK_MS
    ).toISOString();

  const result: SweepResult = {
    scanned: 0,
    matched: 0,
    created: 0,
    skippedExcluded: 0,
    skippedDuplicate: 0,
    windowStart,
  };

  try {
    // ‼️ ONE WATERMARK FOR THE WHOLE RUN, written once below after every mailbox is swept.
    // last_sent_scan_at is a single column on a single row; stamping it per mailbox would let
    // the second mailbox window start after the first one had already consumed it.
    for (const { msg, mailbox } of await sentMessages(mailboxes, windowStart, max, opts?.replay)) {
      result.scanned++;
      if (msg.isDraft) continue;

      const sentAt = new Date(
        (msg as GraphMessage & { sentDateTime?: string }).sentDateTime ?? msg.receivedDateTime ?? now.toISOString()
      );

      for (const address of recipientsOf(msg)) {
        if (isExcluded(address, domains)) {
          result.skippedExcluded++;
          continue;
        }

        const resolved = await resolveProspect(normalizeEmail(address), msg);
        if (!resolved) continue;
        if (resolved.created) result.created++;

        // The idempotency gate. A repeat sighting logs nothing and moves nothing.
        const logged = await logTouch({
          prospect_id: resolved.prospect.id,
          direction: "outbound",
          channel: "email",
          step: resolved.prospect.first_sent_at ? resolved.prospect.step + 1 : 1,
          subject: msg.subject ?? null,
          body: msg.bodyPreview ?? null,
          outcome: "sent",
          graph_message_id: msg.id,
          internet_message_id:
            (msg as GraphMessage & { internetMessageId?: string }).internetMessageId ?? null,
          mailbox,
          conversation_id: msg.conversationId ?? null,
          occurred_at: sentAt.toISOString(),
          metadata: { source: "sent_sweep" },
        });

        // A failed write is NOT a duplicate, and conflating the two is what kept this table
        // empty for three weeks while the cron went green every morning. Throw, so the catch
        // below leaves the watermark alone and the next run re-reads the same window.
        if (logged.status === "error") {
          throw new Error(`logTouch failed for ${address}: ${logged.message}`);
        }

        if (logged.status === "duplicate") {
          result.skippedDuplicate++;
          continue;
        }

        result.matched++;
        await recordOutbound(resolved.prospect, msg, sentAt);
      }
    }

    if (opts?.writeWatermark !== false) await writeSweepState(now);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[followup] sent sweep failed:", message);
    result.error = message;
    // Deliberately do NOT advance the watermark: the next run re-reads the window.
  }

  if (result.skippedExcluded || result.error) {
    await supabaseAdmin.from("system_logs").insert({
      event_type: "outreach_sweep",
      description: `sent sweep: ${result.matched} matched, ${result.created} new, ${result.skippedExcluded} excluded, ${result.skippedDuplicate} already seen`,
      metadata: result as unknown as Record<string, unknown>,
    });
  }

  return result;
}
