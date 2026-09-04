// Calendly v2, availability only.
//
// THE FIRST CALENDLY *API* CODE IN EITHER REPO. Everything before this is an embed plus one
// postMessage listener in srt-agwb/funnel.js. That listener stays exactly as it is and this
// module does not replace it: a booking is still confirmed by `calendly.event_scheduled` with
// its origin check, because a slot we offered is not a booking until Calendly says so.
//
// ‼️ TRI-STATE, AND NULL IS A REAL STATE. This ships with CALENDLY_API_TOKEN unset, so the
// unconfigured path is the DEFAULT path, not an edge case. It returns { slots: null } and the
// funnel renders the plain embed instead. Same doctrine as CALENDLY_URL in
// src/config/medspa-funnel.ts and BOOKING_LINK in src/config/pitch.ts: a link that goes
// nowhere is discovered by the prospect, so there is never a dead button.
//
// ‼️ AN ERROR AND AN EMPTY CALENDAR ARE NOT THE SAME ANSWER and this module refuses to
// conflate them. A 401 from a rotated token returns reason "error"; a genuinely full diary
// returns an empty array with reason "ok". The funnel shows the embed for the first and
// "nothing left in that window" for the second. Collapsing them would silently turn a broken
// integration into a page that calmly tells every visitor there are no appointments.

const API = "https://api.calendly.com";

/** Calendly caps event_type_available_times at a 7 day range and rejects anything wider. */
const MAX_RANGE_DAYS = 7;

export type EventKind = "15min" | "install";

export interface Slot {
  /** ISO 8601, UTC, as Calendly returns it. Formatted for display on the client. */
  startTime: string;
  /** Calendly's single-use booking link for this exact slot. */
  schedulingUrl: string;
}

export type SlotsResult =
  | { slots: Slot[]; reason: "ok" }
  | { slots: null; reason: "unconfigured" | "error" };

function token(): string | null {
  return process.env.CALENDLY_API_TOKEN || null;
}

/**
 * Accept either a bare uuid or a full event type URI in the env var.
 *
 * The variables are named CALENDLY_15MIN_UUID and CALENDLY_INSTALL_UUID, so a uuid is what
 * somebody will paste, but the value Calendly shows you in its own UI is the full URI. Taking
 * both costs three lines and removes the single most likely reason this ships misconfigured.
 */
export function eventTypeUri(kind: EventKind): string | null {
  const raw = kind === "install" ? process.env.CALENDLY_INSTALL_UUID : process.env.CALENDLY_15MIN_UUID;
  const v = (raw || "").trim();
  if (!v) return null;
  if (v.startsWith("https://")) return v;
  return `${API}/event_types/${v}`;
}

/** The public booking page, for "see more times" and for the unconfigured fallback. */
export function bookingPageUrl(kind: EventKind): string | null {
  const raw =
    kind === "install"
      ? process.env.NEXT_PUBLIC_CALENDLY_INSTALL_URL
      : process.env.NEXT_PUBLIC_CALENDLY_15MIN_URL;
  return raw || process.env.NEXT_PUBLIC_CALENDLY_URL || null;
}

export function isCalendlyConfigured(kind: EventKind): boolean {
  return Boolean(token() && eventTypeUri(kind));
}

/**
 * Does this scheduled-event URI actually exist, and when does it start?
 *
 * ‼️ THIS IS AN ANTI-FORGERY CHECK, NOT A CONVENIENCE LOOKUP. /api/onboarding2/booked provisions a
 * client and takes one of six pilot seats, and its only other evidence is a postMessage from an
 * iframe. An origin check in the browser stops nothing: anybody holding a session token can POST
 * to that route directly. Asking Calendly whether the event is real is the guard that cannot be
 * spoofed from the client.
 *
 * ‼️ THREE STATES, AND COLLAPSING THEM WOULD BE THE BUG. "Verified" and "we have no token, so
 * nobody checked" are not the same answer, and a caller that treated `unverified` as failure
 * would break every booking the moment CALENDLY_API_TOKEN went missing, while one that treated it
 * as success would have no way to tell a checked booking from an unchecked one. The caller
 * records which it got.
 */
export async function verifyScheduledEvent(uri: string | null | undefined): Promise<{
  status: "verified" | "unverified" | "not_found";
  verified: boolean;
  startTime: string | null;
}> {
  const key = token();
  // No token, or nothing to check: not a failure, and explicitly not a pass either.
  if (!key || !uri) return { status: "unverified", verified: false, startTime: null };

  // Only ever call Calendly's own host with something shaped like its own URI. A `uri` off a
  // request body is attacker-controlled, and handing it to fetch() unchecked is an SSRF.
  if (!/^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9_-]+$/.test(uri)) {
    return { status: "not_found", verified: false, startTime: null };
  }

  try {
    const res = await fetch(uri, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    if (res.status === 404) return { status: "not_found", verified: false, startTime: null };
    if (!res.ok) {
      const body = await res.text();
      console.error(`[calendly] verify ${res.status}: ${body.slice(0, 200)}`);
      // ‼️ A 500 OR A TIMEOUT IS `unverified`, NOT `not_found`. Calendly having a bad afternoon
      // must not read as "this person forged a booking", which would refuse a real appointment.
      return { status: "unverified", verified: false, startTime: null };
    }
    const json = (await res.json()) as {
      resource?: { status?: string; start_time?: string };
    };
    const resource = json.resource;
    // A cancelled event is not a booking. Calendly keeps the row and flips `status`.
    if (!resource || resource.status !== "active") {
      return { status: "not_found", verified: false, startTime: null };
    }
    return { status: "verified", verified: true, startTime: resource.start_time ?? null };
  } catch (e) {
    console.error("[calendly] verify failed:", (e as Error).message);
    return { status: "unverified", verified: false, startTime: null };
  }
}

// ---------------------------------------------------------------------------
// Time zones, without a date library
//
// The funnel promises "today or tomorrow", and today is the VISITOR'S today. A clinic in
// Phoenix opening the link at 9pm Eastern is still on today, and computing the boundary in
// the server's zone would show them tomorrow's slots under a heading that says today. So the
// client sends its IANA zone and these two helpers do the arithmetic in it.
//
// America/New_York is the fallback rather than UTC, because that is where the calls are
// taken, and being one zone wrong in a familiar direction beats being four wrong.
// ---------------------------------------------------------------------------

export const DEFAULT_TZ = "America/New_York";

/** How far `timeZone` is from UTC at this instant, in ms. Handles DST because Intl does. */
function offsetMs(at: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(at)) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour) % 24,
    Number(map.minute),
    Number(map.second)
  );
  return asUtc - at.getTime();
}

/** Y/M/D as they read on a wall clock in `timeZone`. */
function localParts(at: Date, timeZone: string): { y: number; m: number; d: number } {
  const dtf = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [y, m, d] = dtf.format(at).split("-").map(Number);
  return { y: y as number, m: m as number, d: d as number };
}

/**
 * The instant at which a local day ends, `daysAhead` days from now.
 *
 * The offset is resolved twice on purpose. The first pass uses the offset as it is right now,
 * which is wrong by an hour when the boundary sits on the other side of a DST change; feeding
 * that first guess back in and re-reading the offset there fixes it. Two passes is enough for
 * every real zone, and it is the standard fix for this exact problem.
 */
export function endOfLocalDay(now: Date, timeZone: string, daysAhead: number): Date {
  const { y, m, d } = localParts(now, timeZone);
  const wall = Date.UTC(y, m - 1, d + daysAhead, 23, 59, 59, 0);
  let guess = new Date(wall - offsetMs(now, timeZone));
  guess = new Date(wall - offsetMs(guess, timeZone));
  return guess;
}

export function safeTimeZone(tz: string | null | undefined): string {
  const v = (tz || "").trim();
  if (!v) return DEFAULT_TZ;
  try {
    // Throws RangeError on anything Intl does not recognise, which is the whole check. The
    // value arrives from a query string on a public route, so it is untrusted input going
    // into a formatter, not a decoration.
    new Intl.DateTimeFormat("en-US", { timeZone: v });
    return v;
  } catch {
    return DEFAULT_TZ;
  }
}

// ---------------------------------------------------------------------------
// Availability
// ---------------------------------------------------------------------------

export type Window = "today_tomorrow" | "extended";

/**
 * Fetch open slots.
 *
 * `today_tomorrow` is the default everywhere in this funnel and it is a SALES decision, not a
 * performance one. Showing two openings inside 48 hours is the speed frame the whole page is
 * built on; widening it by default would quietly undo that. It widens only when the visitor
 * asks for more times.
 */
export async function fetchSlots(
  kind: EventKind,
  window: Window,
  timeZone: string,
  now: Date = new Date()
): Promise<SlotsResult> {
  const key = token();
  const uri = eventTypeUri(kind);
  if (!key || !uri) return { slots: null, reason: "unconfigured" };

  // Calendly rejects a start_time that is not in the future. A minute of headroom covers the
  // round trip and any clock skew between this process and theirs.
  const start = new Date(now.getTime() + 60_000);
  const tz = safeTimeZone(timeZone);
  const wanted =
    window === "extended"
      ? new Date(now.getTime() + MAX_RANGE_DAYS * 24 * 3_600_000)
      : endOfLocalDay(now, tz, 1);

  // Never ask for more than Calendly allows, whatever the zone arithmetic produced. A visitor
  // on Kiritimati at 23:00 makes "end of tomorrow" further out than it looks from here.
  const cap = new Date(now.getTime() + MAX_RANGE_DAYS * 24 * 3_600_000 - 60_000);
  const end = wanted > cap ? cap : wanted;
  if (end <= start) return { slots: [], reason: "ok" };

  const url =
    `${API}/event_type_available_times` +
    `?event_type=${encodeURIComponent(uri)}` +
    `&start_time=${encodeURIComponent(start.toISOString())}` +
    `&end_time=${encodeURIComponent(end.toISOString())}`;

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // This sits in front of a visitor who has already tapped. Calendly hanging must not
      // hold the screen: the funnel falls back to the embed rather than spinning.
      signal: AbortSignal.timeout(6_000),
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.text();
      console.error(`[calendly] ${kind} ${res.status}: ${body.slice(0, 200)}`);
      return { slots: null, reason: "error" };
    }
    const json = (await res.json()) as {
      collection?: Array<{ status?: string; start_time?: string; scheduling_url?: string }>;
    };
    const slots: Slot[] = (json.collection ?? [])
      .filter((s) => s.status === "available" && s.start_time && s.scheduling_url)
      .map((s) => ({ startTime: s.start_time as string, schedulingUrl: s.scheduling_url as string }));
    return { slots, reason: "ok" };
  } catch (err) {
    console.error("[calendly] fetch failed", err instanceof Error ? err.message : err);
    return { slots: null, reason: "error" };
  }
}

/**
 * Split slots into the four buckets the picker offers.
 *
 * Noon in the VISITOR's zone is the morning/afternoon line, for the same reason today is
 * their today. A slot at 12:30 their time belongs in Afternoon even when it is 15:30 here.
 */
export function bucketSlots(
  slots: Slot[],
  timeZone: string,
  now: Date = new Date()
): { today: { morning: Slot[]; afternoon: Slot[] }; tomorrow: { morning: Slot[]; afternoon: Slot[] } } {
  const tz = safeTimeZone(timeZone);
  const todayEnd = endOfLocalDay(now, tz, 0).getTime();
  const tomorrowEnd = endOfLocalDay(now, tz, 1).getTime();
  const out = {
    today: { morning: [] as Slot[], afternoon: [] as Slot[] },
    tomorrow: { morning: [] as Slot[], afternoon: [] as Slot[] },
  };

  const hourFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour12: false, hour: "2-digit" });

  for (const s of slots) {
    const t = new Date(s.startTime).getTime();
    if (!Number.isFinite(t)) continue;
    const day = t <= todayEnd ? "today" : t <= tomorrowEnd ? "tomorrow" : null;
    if (!day) continue;
    const hour = Number(hourFmt.format(new Date(t)));
    const half = hour < 12 ? "morning" : "afternoon";
    out[day][half].push(s);
  }
  return out;
}
