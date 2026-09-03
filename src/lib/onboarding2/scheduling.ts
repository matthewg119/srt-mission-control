// Agreeing a day for the onboarding call, in conversation, with no calendar anywhere.
//
// ‼️ THE DAYS ARE COMPUTED HERE, ON THE SERVER, AND HANDED TO THE VISITOR AS FIXED OPTIONS. The
// model is never asked what today is and never asked to name a date. A model that invents
// "Thursday the 14th" when the 14th is a Tuesday has told a client something false about our own
// calendar, and it would read as confidently as the truth. Three buttons cannot be wrong.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THIS FILE USED TO SAY "A DAY AND A HALF OF IT, NEVER A CLOCK TIME", AND THE ARGUMENT WAS
// RIGHT FOR THE WORLD IT WAS WRITTEN IN. It read: we do not know the clinic's timezone, so
// offering "2:00 pm" would be offering a time in OUR zone while sounding like theirs, and
// storing it as a timestamptz would make a fabricated hour indistinguishable from a real one.
//
// WHAT CHANGED (2026-09-03): a Microsoft Graph calendar invite now goes out on the choice. While
// a person settled the hour on the phone, an ambiguous daypart cost nothing. An invite makes the
// hour REAL, and a fixed 2:00 pm Eastern is 11:00 am in Los Angeles, so a clinic that tapped
// AFTERNOON would receive a MORNING invite and the word they chose becomes false on their screen.
//
// SO THE ZONE IS ASKED, ONCE, WITH FOUR CHIPS. That is the ONE extra question in this close and
// it buys two things a default cannot: an hour that is real, and a daypart that still means what
// they tapped. The hour itself stays FIXED (see CALL_HOUR) rather than offered as a list of
// times, because picking from a grid of slots is the calendar this funnel deleted.
//
// ‼️ SCHEDULING_TZ IS STILL OURS AND IS STILL USED, FOR A DIFFERENT JOB. It decides which DAYS
// to offer, because "has today gone" is a question about our working day. The zone the client
// taps decides what the clock says when we get there. Two different questions, two different
// zones, and collapsing them would put a Pacific clinic's Monday on our Sunday.
// ─────────────────────────────────────────────────────────────────────────────
//
// PURE. No database, no network, no model. Every function takes `now` so the probes can drive it
// across a day boundary without waiting for one.

/**
 * ‼️ OURS, NOT THEIRS, AND IT IS STATED RATHER THAN IMPLIED. "Today" has to mean something, and
 * the only clock we can honestly speak from is SRT's own, in Greensboro. A clinic three timezones
 * west being offered "today" late in our afternoon is the cost, and it is small: they are picking
 * a DAY, and the worst case is they take tomorrow instead.
 */
export const SCHEDULING_TZ = "America/New_York";

export type Daypart = "morning" | "afternoon";

/**
 * The hour, in the CLIENT'S zone, per daypart. Fixed rather than chosen.
 *
 * ‼️ 10 AND 14 ARE INSIDE EVERY US TIME ZONE'S WORKING DAY AND INSIDE OURS. A clinic in Los
 * Angeles taking a 10:00 local call is 13:00 in Greensboro; a 14:00 local call there is 17:00
 * here, which is the latest this can produce and is still a working hour. Moving either number
 * outward pushes a Pacific afternoon past the end of our day, so check both ends before editing.
 */
export const CALL_HOUR: Record<Daypart, number> = { morning: 10, afternoon: 14 };

/** Long enough to walk the board, short enough that nobody declines on the length. */
export const CALL_MINUTES = 30;

/**
 * The zones offered, as IANA names.
 *
 * ‼️ IANA, NEVER "EST". Intl.DateTimeFormat throws a RangeError on an abbreviation, and the
 * abbreviations are ambiguous anyway (CST is Chicago in the US and Shanghai elsewhere). The
 * labels a client taps live in TIMEZONE_OPTIONS in config/onboarding2.ts; these are the values.
 */
export const CALL_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
] as const;

export type CallTimezone = (typeof CALL_TIMEZONES)[number];

/**
 * Read a zone out of what somebody tapped or typed.
 *
 * ‼️ IT RETURNS null RATHER THAN GUESSING, exactly like readDaypart. call_timezone is written to
 * a checked column and it decides the hour on a real invite, so a half-read answer is worse than
 * asking once more with the four buttons.
 */
export function readTimezone(text: string): CallTimezone | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const exact = CALL_TIMEZONES.find((z) => z.toLowerCase() === t);
  if (exact) return exact;
  // The chip labels, and the two spellings people type unprompted for each.
  // !! WORD BOUNDARIES ARE LOAD-BEARING HERE. Without them "et" matches inside "let me think"
  // and "pt" inside "captain", so a sentence with no zone in it resolves to a confident wrong
  // answer that then decides the hour on a real calendar invite.
  const words: Array<[RegExp, CallTimezone]> = [
    [/\b(eastern|et|est|edt|new york)\b/, "America/New_York"],
    [/\b(central|ct|cst|cdt|chicago)\b/, "America/Chicago"],
    [/\b(mountain|mt|mst|mdt|denver)\b/, "America/Denver"],
    [/\b(pacific|pt|pst|pdt|los angeles|california)\b/, "America/Los_Angeles"],
  ];
  const hits = words.filter(([re]) => re.test(t));
  return hits.length === 1 ? hits[0][1] : null;
}

/**
 * "10:00 am" / "2:00 pm", for the confirmation bubble.
 *
 * ‼️ THE ZONE IS NOT APPENDED HERE. The caller adds the label the client tapped ("Eastern"),
 * because that is the word they chose and an abbreviation we derived could disagree with it
 * across a DST boundary.
 */
export function clockLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:00 ${hour < 12 ? "am" : "pm"}`;
}

export interface DayOption {
  /** Stable id, sent back when they tap. `d0` is the first day offered, not necessarily today. */
  id: string;
  /** What the button says, and what lands in call_choice_label verbatim. */
  label: string;
  /** YYYY-MM-DD, in SCHEDULING_TZ. Goes into call_day. */
  date: string;
}

/** How many days we offer. Today, tomorrow, the day after, minus anything skipped. */
const OPTION_COUNT = 3;

/**
 * The last hour at which offering the rest of today is still polite.
 *
 * Somebody agreeing to a morning call at 11:40 is agreeing to something that has nearly gone, so
 * the offer moves to tomorrow instead of technically being true.
 */
const LAST_MORNING_HOUR = 10;
const LAST_AFTERNOON_HOUR = 15;

interface Parts {
  /** YYYY-MM-DD in SCHEDULING_TZ. */
  date: string;
  /** 0 to 23 in SCHEDULING_TZ. */
  hour: number;
  /** "Monday" .. "Sunday" in SCHEDULING_TZ. */
  weekday: string;
}

/**
 * The wall clock in SCHEDULING_TZ.
 *
 * Intl rather than a date library, because this repo has none and one function does not justify
 * one. `en-CA` is asked for the date because it formats as YYYY-MM-DD, which is the shape the
 * column wants and the shape that sorts.
 */
function partsIn(d: Date): Parts {
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULING_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: SCHEDULING_TZ,
      hour: "2-digit",
      hour12: false,
    }).format(d)
  );

  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULING_TZ,
    weekday: "long",
  }).format(d);

  return { date, hour: Number.isFinite(hour) ? hour % 24 : 12, weekday };
}

/** Calendar arithmetic on a YYYY-MM-DD string. UTC noon, so no DST shift can move the day. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d, 12) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(
    new Date(Date.UTC(y, m - 1, d, 12))
  );
}

function isWeekend(date: string): boolean {
  const w = weekdayOf(date);
  return w === "Saturday" || w === "Sunday";
}

/**
 * Three days to choose from, within the half of the day they asked for.
 *
 * ‼️ TODAY IS DROPPED WHEN TODAY HAS EFFECTIVELY GONE, which is the whole reason this takes the
 * current time at all. Offering "this morning" at 2pm is the kind of small wrongness that tells
 * somebody the thing they are talking to is not paying attention.
 *
 * ‼️ WEEKENDS ARE SKIPPED. Nothing asked for that; an onboarding call offered for Sunday morning
 * is the sort of detail that reads as automation rather than as a person, and the cost of the
 * rule is that Friday afternoon offers Monday next.
 */
export function dayOptions(daypart: Daypart, now: Date = new Date()): DayOption[] {
  const here = partsIn(now);
  const cutoff = daypart === "morning" ? LAST_MORNING_HOUR : LAST_AFTERNOON_HOUR;

  const out: DayOption[] = [];
  // Start today unless today has gone. Walk forward until three usable days are found; the bound
  // is generous rather than exact so a run of skipped days cannot loop.
  let offset = here.hour > cutoff ? 1 : 0;
  for (let guard = 0; guard < 14 && out.length < OPTION_COUNT; guard++, offset++) {
    const date = addDays(here.date, offset);
    if (isWeekend(date)) continue;
    out.push({
      id: `d${out.length}`,
      label: `${dayName(date, here.date)} ${daypart}`,
      date,
    });
  }
  return out;
}

/** "Today", "Tomorrow", or the weekday. Relative to the SCHEDULING_TZ date, not to UTC. */
function dayName(date: string, today: string): string {
  if (date === today) return "Today";
  if (date === addDays(today, 1)) return "Tomorrow";
  return weekdayOf(date);
}

/**
 * Read a daypart out of what somebody typed.
 *
 * ‼️ IT RETURNS null RATHER THAN GUESSING. The route asks once more with the two buttons rather
 * than recording a half-read answer, because call_daypart is written to a checked column and a
 * wrong one is worse than a second question.
 */
export function readDaypart(text: string): Daypart | null {
  const t = text.toLowerCase();
  const morning = /\b(morning|mornings|am|a\.m\.|early)\b/.test(t);
  const afternoon = /\b(afternoon|afternoons|pm|p\.m\.|later|evening)\b/.test(t);
  if (morning && !afternoon) return "morning";
  if (afternoon && !morning) return "afternoon";
  return null;
}

/**
 * Match a typed or tapped reply to one of the offered days.
 *
 * Tapping sends the label verbatim, so that is the common path. Typing "tomorrow" or "Thursday"
 * is matched on the day word alone. Anything else is null and the route re-offers the buttons.
 */
export function readDayChoice(text: string, options: DayOption[]): DayOption | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;

  const exact = options.find((o) => o.label.toLowerCase() === t);
  if (exact) return exact;

  const byId = options.find((o) => o.id === t);
  if (byId) return byId;

  // The day word is the first token of every label ("Today", "Tomorrow", "Thursday").
  const spoken = options.filter((o) => t.includes(o.label.split(" ")[0].toLowerCase()));
  return spoken.length === 1 ? spoken[0] : null;
}
