// Where a visitor who wants a call actually goes.
//
// ‼️ FOUR MODES AND EVERY ONE OF THEM IS A REAL ANSWER. Calendly ships unconfigured in this repo,
// so `unconfigured` is the DEFAULT path and not an edge case. calendly.ts already refuses to
// conflate an error with an empty diary, and this file refuses to conflate either with "no
// booking". A visitor is never shown a button that goes nowhere, which is the same doctrine as
// BOOKING_LINK in config/pitch.ts and CALENDLY_URL in config/medspa-funnel.ts.
//
// ‼️ A SLOT WE OFFERED IS NOT A BOOKING. calendly.ts says this in its header and it is still true
// here: the per-slot scheduling_url takes them to Calendly, and Calendly is what confirms. This
// module hands over a link to an exact time, nothing more. Nothing here may mark a session booked.
//
// ‼️ THE OWNER LANE IGNORES concierge_configs.booking_mode ON PURPOSE. That column describes where
// a CLINIC's patients book, which is a per-client setting a clinic chooses. An owner booking a
// call with SRT always goes to SRT's own calendar, so reading the column here would let a
// misconfigured tenant row silently redirect our own sales calls.

import { bookingPageUrl, bucketSlots, fetchSlots, safeTimeZone, type EventKind, type Window } from "@/lib/calendly";
import type { ConciergeConfig } from "./config";

/** The call SRT actually sells. `install` belongs to the post-sale lane and is never offered here. */
const OWNER_EVENT: EventKind = "15min";

/** How many times to put in front of somebody. A wall of buttons is a decision nobody makes. */
const MAX_SLOTS_SHOWN = 6;

export interface OfferedSlot {
  /** "Today 2:30 pm", read on the VISITOR's wall clock. */
  label: string;
  /** Calendly's single-use link for this exact time. */
  url: string;
  startTime: string;
}

export type BookingOffer =
  | { mode: "slots"; slots: OfferedSlot[]; window: Window; morePageUrl: string | null }
  /** The diary is genuinely empty in that window. NOT the same as a broken integration. */
  | { mode: "no_slots"; morePageUrl: string | null; window: Window }
  | { mode: "link"; url: string; label: string }
  | { mode: "phone"; phone: string }
  | { mode: "callback" };

/**
 * Format one slot the way a person reads a clock, in their own zone.
 *
 * Today and tomorrow are named rather than dated, because the whole speed frame of this call is
 * that it is soon. A slot further out carries its weekday instead, since "Thursday 10:00 am" is
 * something somebody can hold in their head and a date is not.
 */
function labelFor(startTime: string, timeZone: string, now: Date): string | null {
  const t = new Date(startTime);
  if (!Number.isFinite(t.getTime())) return null;

  const tz = safeTimeZone(timeZone);
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  const time = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true });

  const slotDay = day.format(t);
  const today = day.format(now);
  const tomorrow = day.format(new Date(now.getTime() + 24 * 3_600_000));

  const when =
    slotDay === today
      ? "Today"
      : slotDay === tomorrow
        ? "Tomorrow"
        : new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" }).format(t);

  // Lowercased am/pm, and a normal space, because this string is read aloud on a card and
  // "2:30 PM" reads as shouting next to the rest of the copy.
  return `${when} ${time.format(t).replace(/\s?([AP])M$/i, (_m, p) => ` ${String(p).toLowerCase()}m`)}`;
}

/**
 * Interleave morning and afternoon so a short list is not all one half of one day.
 *
 * Taking the first six in raw order gives six consecutive morning slots on the same day, which
 * reads as "these are the only times" and loses anybody whose mornings are full.
 */
function spread(
  buckets: ReturnType<typeof bucketSlots>
): Array<{ startTime: string; schedulingUrl: string }> {
  const lanes = [
    buckets.today.morning,
    buckets.today.afternoon,
    buckets.tomorrow.morning,
    buckets.tomorrow.afternoon,
  ];
  const out: Array<{ startTime: string; schedulingUrl: string }> = [];
  for (let i = 0; out.length < MAX_SLOTS_SHOWN; i++) {
    let took = false;
    for (const lane of lanes) {
      if (i < lane.length && out.length < MAX_SLOTS_SHOWN) {
        out.push(lane[i]);
        took = true;
      }
    }
    if (!took) break;
  }
  return out;
}

export interface BookingInput {
  config: ConciergeConfig;
  timeZone: string;
  window: Window;
  /** The onboarding2 handoff, used when Calendly cannot answer. Built by the caller. */
  fallbackUrl: string;
  now?: Date;
}

/**
 * What to put in front of this visitor, right now.
 *
 * The owner lane tries Calendly first and falls back to the onboarding2 link. The patient lane
 * never touches Calendly here: a clinic's own booking destination is its own config, and reaching
 * for SRT's calendar would book our sales call into a patient's consultation request.
 */
export async function resolveBooking(input: BookingInput): Promise<BookingOffer> {
  if (input.config.audience !== "owner") return patientOffer(input.config);

  const now = input.now ?? new Date();
  const result = await fetchSlots(OWNER_EVENT, input.window, input.timeZone, now);
  const morePageUrl = bookingPageUrl(OWNER_EVENT);

  // ‼️ unconfigured AND error BOTH FALL BACK, AND THEY ARE STILL DISTINGUISHED IN THE LOG. A
  // rotated token must not quietly become "there are no appointments", which is exactly what
  // collapsing these into one branch would produce on the day it happens.
  if (result.slots === null) {
    if (result.reason === "error") {
      console.error("[concierge] calendly errored, falling back to the onboarding link");
    }
    return { mode: "link", url: input.fallbackUrl, label: "Start here" };
  }

  if (result.slots.length === 0) return { mode: "no_slots", morePageUrl, window: input.window };

  const chosen = spread(bucketSlots(result.slots, input.timeZone, now));
  const slots: OfferedSlot[] = [];
  for (const s of chosen) {
    const label = labelFor(s.startTime, input.timeZone, now);
    if (!label) continue;
    slots.push({ label, url: s.schedulingUrl, startTime: s.startTime });
  }

  // Every slot Calendly returned was outside today and tomorrow, so bucketSlots dropped them all.
  // Reachable on the extended window, and it is a real "nothing in that window" rather than a bug.
  if (slots.length === 0) return { mode: "no_slots", morePageUrl, window: input.window };

  return { mode: "slots", slots, window: input.window, morePageUrl };
}

/** A clinic's own destination, tri-state, exactly as concierge_configs models it. */
function patientOffer(config: ConciergeConfig): BookingOffer {
  if (config.bookingMode === "link" && config.bookingUrl) {
    return { mode: "link", url: config.bookingUrl, label: "Book a consultation" };
  }
  if (config.bookingPhone) return { mode: "phone", phone: config.bookingPhone };
  return { mode: "callback" };
}
