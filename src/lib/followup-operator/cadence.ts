// The clock. Turns PERMISSION_SEQUENCE[].day from a prompt label into real
// scheduling, and owns the two rules that keep the operator from behaving like
// a bulk sender: one channel per prospect per day, and any reply resets everything.

import { supabaseAdmin } from "@/lib/db";
import { PERMISSION_SEQUENCE } from "@/lib/audit-engine/email-assistant";
import type { OutreachProspectRow, ProspectState } from "./types";

const ET = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;

/** "D0" -> 0, "D+4" -> 4. Anything unparseable is treated as same-day. */
export function dayOffset(day: string): number {
  const m = /D\s*\+?\s*(\d+)/i.exec(day ?? "");
  return m ? Number(m[1]) : 0;
}

/** [0, 1, 2, 4, 7] derived from the sequence itself, so editing the ladder in
 *  email-assistant.ts reschedules the operator with it. */
export function stepOffsets(): number[] {
  return PERMISSION_SEQUENCE.map((s) => dayOffset(s.day));
}

export function totalSteps(): number {
  return PERMISSION_SEQUENCE.length;
}

/** Minutes ET is offset from UTC on a given instant (-240 EDT, -300 EST). */
function etOffsetMinutes(at: Date): number {
  const asET = new Date(at.toLocaleString("en-US", { timeZone: ET }));
  const asUTC = new Date(at.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((asET.getTime() - asUTC.getTime()) / 60000);
}

/** The Y/M/D of an instant as it reads on a calendar in Eastern time. */
export function etDateParts(at: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Move an instant to 09:00 Eastern on the same calendar day. The digest runs at
 *  09:00 ET, so anything due earlier in the day is due at the top of it. */
export function snapTo9amET(at: Date): Date {
  const { y, m, d } = etDateParts(at);
  const naiveUTC = Date.UTC(y, m - 1, d, 9, 0, 0, 0);
  // 9am ET expressed in UTC. Offset is negative, so this adds hours.
  const guess = new Date(naiveUTC - etOffsetMinutes(at) * 60000);
  return guess;
}

/**
 * The Eastern wall clock at an instant: what a person in New York would read off a clock.
 *
 * Asks Intl for the calendar reading rather than doing offset arithmetic, so DST is handled by
 * the runtime's tz database instead of by us. This is what the UTC crons check themselves
 * against: Vercel schedules in UTC, 7:30am ET is 11:30 UTC under EDT and 12:30 UTC under EST,
 * so the job fires at BOTH and only the firing that reads 7:30 here is allowed to act.
 */
export function etWallClock(at: Date): { y: number; m: number; d: number; hour: number; minute: number; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ET,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const num = (t: string) => Number(get(t) || "0");
  const days: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  // "24" is how en-CA/hour12:false renders midnight. Left as 24 it would fail every hour check.
  const hour = num("hour") % 24;
  return { y: num("year"), m: num("month"), d: num("day"), hour, minute: num("minute"), weekday: days[get("weekday")] ?? 0 };
}

/** The Eastern calendar date as "YYYY-MM-DD". The key for once-per-day guards. */
export function etDateKey(at: Date): string {
  const { y, m, d } = etDateParts(at);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Monday to Friday on the Eastern calendar. */
export function isETBusinessDay(at: Date): boolean {
  const { weekday } = etWallClock(at);
  return weekday >= 1 && weekday <= 5;
}

/**
 * The previous BUSINESS day in Eastern time, as a [start, end) instant pair.
 * Monday looks back to Friday; Tuesday through Friday look back one day.
 * No holiday calendar on purpose: a table of holidays is exactly the kind of thing that quietly
 * stops being maintained, and the cost of a nudge on the day after Thanksgiving is one email.
 */
export function previousBusinessDayET(at: Date): { start: Date; end: Date } {
  const { weekday } = etWallClock(at);
  const back = weekday === 1 ? 3 : weekday === 0 ? 2 : 1;
  const end = startOfETDay(at);
  const start = startOfETDay(new Date(end.getTime() - (back - 1) * DAY_MS - 1000));
  return { start, end: new Date(start.getTime() + DAY_MS) };
}

/** Start of the current Eastern calendar day, as an instant. */
export function startOfETDay(at: Date): Date {
  const { y, m, d } = etDateParts(at);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0) - etOffsetMinutes(at) * 60000);
}

/**
 * When the touch AFTER `step` is due, anchored on the day the first pitch went
 * out. Anchoring on first_sent_at rather than the last touch is deliberate: a
 * nudge Matthew approves two days late must not drag the whole ladder with it.
 *
 * `step` is 1-based. Returns null once the ladder is spent.
 */
export function nextTouchAt(step: number, firstSentAt: Date): Date | null {
  const offsets = stepOffsets();
  if (step >= offsets.length) return null;
  const dueDay = new Date(firstSentAt.getTime() + offsets[step] * DAY_MS);
  return snapTo9amET(dueDay);
}

/** The step label for display, e.g. "nudge 3 (D+2)". */
export function stepLabel(step: number): string {
  const s = PERMISSION_SEQUENCE[step - 1];
  if (!s) return `step ${step}`;
  return step === 1 ? `email 1 (D0)` : `nudge ${step} (${s.day})`;
}

/**
 * Which channel this prospect is due on.
 *
 * A call is earned, not scheduled up front: it happens once the email ladder is
 * half spent and still silent, or when a hot prospect has gone quiet for three
 * days. Phone numbers are not required, Matthew has them; the operator's job is
 * the words.
 */
export function channelFor(p: OutreachProspectRow): "email" | "call" {
  if (p.state === "ASKED_PRICE_HOT") {
    const since = p.last_touch_at ? Date.now() - new Date(p.last_touch_at).getTime() : 0;
    return since >= 3 * DAY_MS && p.call_attempts === 0 ? "call" : "email";
  }
  if (p.state === "SENT_NO_REPLY" && p.step >= 3 && p.call_attempts === 0) return "call";
  return "email";
}

export interface ReplyClassification {
  state: ProspectState;
  summary: string;
  askedPrice: boolean;
  wantsOut: boolean;
  deferDays?: number;
}

/**
 * What a reply does to the row. Every inbound resets the clock, and every
 * inbound cancels a queued call: phoning someone the morning after they emailed
 * reads as not having read it.
 */
export function applyReply(
  p: OutreachProspectRow,
  c: ReplyClassification,
  now = new Date()
): Partial<OutreachProspectRow> {
  const base: Partial<OutreachProspectRow> = {
    last_reply_at: now.toISOString(),
    next_channel: "email",
  };

  if (c.wantsOut || c.state === "CLOSED") {
    return { ...base, state: "CLOSED", closed_reason: c.summary, next_touch_at: null };
  }

  if (c.deferDays && c.deferDays > 0) {
    // They named a time. Freeze the ladder where it is and come back then.
    return {
      ...base,
      state: "SENT_NO_REPLY",
      next_touch_at: snapTo9amET(new Date(now.getTime() + c.deferDays * DAY_MS)).toISOString(),
    };
  }

  // Interested, price ask, objection: all owed an answer today.
  return { ...base, state: c.state, next_touch_at: now.toISOString() };
}

/**
 * Has an outbound touch already landed for this prospect today, Eastern time?
 *
 * The one exception is an unanswered call. It is logged with
 * metadata.counts_as_touch = false, because a call nobody picked up is not a
 * touch that landed, and the text and email that follow it are the whole point
 * of making it.
 */
export async function hasOutboundTouchToday(prospectId: string, now = new Date()): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("outreach_touches")
    .select("channel, metadata")
    .eq("prospect_id", prospectId)
    .eq("direction", "outbound")
    .gte("occurred_at", startOfETDay(now).toISOString());

  if (error || !data) return false;
  return data.some((t) => {
    const meta = (t.metadata ?? {}) as Record<string, unknown>;
    if (meta.counts_as_touch === false) return false;
    return t.channel !== "note";
  });
}
