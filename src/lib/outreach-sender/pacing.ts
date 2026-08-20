// "How many emails have I sent today, and am I on pace."
//
// Counts outreach_touches, NOT the queue, and that is deliberate: the honest answer to that
// question includes the emails Matthew typed himself in Outlook, which the Sent Items sweep
// picks up and the queue never sees.

import { supabaseAdmin } from "@/lib/db";
import { startOfETDay, etWallClock, etDateKey } from "@/lib/followup-operator/cadence";
import { mailboxHeadroom, headroomGauge } from "@/lib/followup-operator/mailboxes";

/** The check-in times, Eastern. */
export const PACING_SLOTS = [12, 15, 18] as const;

/** The day's send target. Separate from the per-mailbox caps on purpose: a target equal to the
 *  ceiling reads "behind schedule" until the literal last email of the day. */
export function dailyTarget(): number {
  return Math.max(0, Number(process.env.OUTREACH_DAILY_TARGET) || 60);
}

/** Where the day should be by a given hour, if the work were spread across a 9am-6pm day. */
function expectedBy(hour: number, target: number): number {
  const start = 9;
  const end = 18;
  if (hour <= start) return 0;
  if (hour >= end) return target;
  return Math.round((target * (hour - start)) / (end - start));
}

export interface PacingReport {
  slot: number;
  dateKey: string;
  sentToday: number;
  target: number;
  expected: number;
  behindBy: number;
  queued: number;
  gauge: string;
  text: string;
}

export async function buildPacingReport(now = new Date()): Promise<PacingReport> {
  const clock = etWallClock(now);
  const target = dailyTarget();

  const { count: sentToday } = await supabaseAdmin
    .from("outreach_touches")
    .select("id", { count: "exact", head: true })
    .eq("direction", "outbound")
    .eq("channel", "email")
    .gte("occurred_at", startOfETDay(now).toISOString());

  const { count: queued } = await supabaseAdmin
    .from("outreach_send_queue")
    .select("id", { count: "exact", head: true })
    .in("status", ["queued", "sending"]);

  const sent = sentToday ?? 0;
  const expected = expectedBy(clock.hour, target);
  const behindBy = Math.max(0, expected - sent);
  const headroom = await mailboxHeadroom(now);
  const gauge = headroomGauge(headroom);
  const capacityLeft = headroom.reduce((n, h) => n + h.left, 0);

  const lines: string[] = [];
  const mark = sent >= expected ? ":white_check_mark:" : ":warning:";
  lines.push(`${mark} *Email pace, ${String(clock.hour).padStart(2, "0")}:00 ET* — *${sent}* of ${target} sent today.`);
  lines.push(`Expected by now: ${expected}. ${behindBy ? `Behind by *${behindBy}*.` : "On pace."}`);
  lines.push(`Mailboxes: ${gauge}. Capacity left today: ${capacityLeft}.`);
  if (queued) lines.push(`Queued and waiting to go out: ${queued}.`);

  // The gap between "behind" and "cannot catch up" is the number that actually decides whether
  // to do something about it today.
  if (behindBy > capacityLeft) {
    lines.push(`:no_entry: Catching up to ${target} is not possible today: only ${capacityLeft} of headroom left across both mailboxes.`);
  } else if (behindBy) {
    lines.push(`Send ${behindBy} more to be back on pace.`);
  }

  return {
    slot: clock.hour,
    dateKey: etDateKey(now),
    sentToday: sent,
    target,
    expected,
    behindBy,
    queued: queued ?? 0,
    gauge,
    text: lines.join("\n"),
  };
}

/**
 * The once-per-slot-per-Eastern-day guard, claimed rather than read.
 *
 * The cron fires at six candidate UTC hours to cover three Eastern slots across DST, so most
 * firings must do nothing. The claim key is "YYYY-MM-DD:hour".
 */
export async function claimPacingSlot(now: Date, slot: number): Promise<boolean> {
  const key = `${etDateKey(now)}:${slot}`;
  const { data } = await supabaseAdmin
    .from("outreach_sweep_state")
    .update({ last_pacing_slot: key, updated_at: now.toISOString() })
    .eq("id", 1)
    .or(`last_pacing_slot.is.null,last_pacing_slot.neq.${key}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}
