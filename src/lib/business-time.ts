/**
 * Business-hours time. One timezone, used everywhere a DATE means "a day of
 * selling" rather than an instant.
 *
 * WHY THIS EXISTS
 * Vercel runs in UTC, so every `new Date(...)` without a zone and every
 * `getFullYear()/getMonth()/getDate()` comparison in this codebase is a UTC
 * comparison. For a US-East operator that is wrong by 4-5 hours, and it lands on
 * exactly the values the worklist is built out of:
 *
 *   - `isSameDay()` decided the `due_today` bucket in UTC, so a task due
 *     "today" fell out of the bucket at 8pm ET.
 *   - Zoho's `Due_Date` is date-only ("2026-08-16"). `new Date()` reads that as
 *     UTC midnight, which is 8pm the PREVIOUS evening in ET — so every imported
 *     task arrived already overdue.
 *   - `parseDate()` in crm-tools mapped a bare follow-up date to 09:00 with no
 *     zone, i.e. 5am ET.
 *
 * Together those meant the board would have opened with the entire Zoho task
 * history in `overdue` and nothing in `due_today`, which is precisely the signal
 * the user's core rule depends on.
 *
 * No dependency: Intl carries the IANA database, including DST history.
 */

export const BUSINESS_TZ = "America/New_York";

/** Follow-ups default to this hour when only a date is given. */
export const FOLLOW_UP_HOUR = 9;

const PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_TZ,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClock(instant: Date): WallClock {
  const parts: Record<string, string> = {};
  for (const p of PARTS.formatToParts(instant)) {
    if (p.type !== "literal") parts[p.type] = p.value;
  }
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    // hour12:false emits "24" for midnight in some ICU versions.
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** Offset of BUSINESS_TZ from UTC at this instant, in ms. Negative for ET. */
function offsetMsAt(instant: Date): number {
  const w = wallClock(instant);
  const asIfUtc = Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which BUSINESS_TZ's wall clock reads the given local time.
 *
 * Two passes: the first guess uses the offset in force at the naive instant,
 * which is wrong only when the guess falls on the far side of a DST boundary
 * from the answer. The second pass re-reads the offset at the corrected instant
 * and settles it. (In the one-hour gap that spring-forward deletes there is no
 * such instant at all; this resolves forward, which is what a follow-up date
 * wants.)
 */
export function businessTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = naive - offsetMsAt(new Date(naive));
  ts = naive - offsetMsAt(new Date(ts));
  return new Date(ts);
}

/** "YYYY-MM-DD" for an instant, as seen in BUSINESS_TZ. */
export function businessDayKey(d: Date): string {
  const w = wallClock(d);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

/** Do these two instants fall on the same business day? */
export function isSameBusinessDay(a: Date, b: Date): boolean {
  return businessDayKey(a) === businessDayKey(b);
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parse a user- or Zoho-supplied follow-up/due date.
 *
 * A bare "YYYY-MM-DD" is a DAY, not an instant, and is resolved to
 * FOLLOW_UP_HOUR in BUSINESS_TZ: late enough not to read as overdue the moment
 * the day starts, early enough to sit in `due_today` for the whole working day.
 * Anything carrying a time or a zone is trusted as the instant it states.
 */
export function parseBusinessDate(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return null;

  const m = DATE_ONLY.exec(s);
  if (m) {
    return businessTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), FOLLOW_UP_HOUR);
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The last instant of the business day a date-only string names. */
export function endOfBusinessDay(dateOnly: string): Date | null {
  const m = DATE_ONLY.exec(dateOnly.trim());
  if (!m) {
    const d = new Date(dateOnly);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return businessTimeToUtc(Number(m[1]), Number(m[2]), Number(m[3]), 23, 59, 59);
}
