// The Calendly handoff for /onboarding2.
//
// ‼️ CALENDLY IS BACK IN THIS FUNNEL AND THE 2026-09-03 REMOVAL WAS NOT WRONG. It was removed in
// favour of a Microsoft Graph calendar on a separate Azure app, for a good reason recorded in
// src/lib/onboarding2/calendar.ts: adding Calendars.ReadWrite to the shared microsoft.ts scope
// array would make the next refresh_token grant ask for a scope the stored grant does not cover,
// AADSTS65001, and every email path in Mission Control dies within the hour. That reasoning
// still stands and calendar.ts is untouched.
//
// What changed is the FACT ON THE GROUND: the four MS_CALENDAR_* vars have never been set in any
// environment, so that path has sent exactly zero invites, while NEXT_PUBLIC_CALENDLY_URL and
// CALENDLY_API_TOKEN are configured and working on /chatgpt-ads today. A booking flow whose
// confirmation is real beats one that is correct in principle and has never fired.
//
// ‼️ THE MODEL NEVER SEES A URL FROM THIS FILE. Everything here is called by the scheduling state
// machine in app/api/onboarding2/chat/route.ts, on turns that never reach Claude, and the URL is
// returned to the CLIENT as a field on the JSON response. The rule in config/onboarding2.ts that
// the assistant may not hand out a calendar link is unchanged, because there is still no path by
// which it could.
//
// ‼️ NO SLOTS API, ON PURPOSE. src/lib/calendly.ts can list available times, and /chatgpt-ads
// uses it to render a today/tomorrow picker. It is not used here for two reasons: bucketSlots()
// only knows today and tomorrow, while dayOptions() can offer a day further out, so the two
// disagree about what a day is; and Calendly's own embed already lists that day's times better
// than we can, from the same availability, with no token required. Prefilling the date is the
// whole job.

import { bookingPageUrl } from "@/lib/calendly";
import type { Onboarding2LeadRow } from "./types";

/**
 * Which of the two event types an onboarding call is.
 *
 * ‼️ bookingPageUrl() FALLS BACK TO NEXT_PUBLIC_CALENDLY_URL when the install-specific var is
 * unset, which it is. That fallback is why this works today on the one link Matthew actually
 * uses rather than waiting on a second event type being created.
 */
const KIND = "install" as const;

/**
 * The embed URL for a lead who has agreed a day, or null when nothing is configured.
 *
 * ‼️ NULL IS A HANDLED STATE, NOT AN ERROR. With no public URL the chat says
 * SCHEDULING_UI.noCalendar and the agreed day is still stored, so the booking is recoverable by
 * hand. Same tri-state every other booking surface in this repo uses, and the reason this
 * function returns a value rather than throwing.
 *
 * ‼️ THE DATE IS A SUGGESTION, NOT A CONSTRAINT. Calendly still shows its full availability, so
 * somebody who wants a different day can take one. That is correct: the day agreed in chat was
 * agreed against OUR working-day arithmetic, not against the real calendar, and a funnel that
 * refuses the time somebody actually wants is worse than one that opens on a suggestion.
 */
export function bookingUrlFor(lead: Onboarding2LeadRow, date: string | null): string | null {
  const base = bookingPageUrl(KIND);
  if (!base) return null;

  let url: URL;
  try {
    url = new URL(base);
  } catch {
    // A malformed env var is worth surfacing as "no calendar" rather than as a broken iframe.
    return null;
  }

  if (lead.contact_name) url.searchParams.set("name", lead.contact_name);
  if (lead.email) url.searchParams.set("email", lead.email);
  // Calendly hides its own cookie banner inside an embed when asked.
  url.searchParams.set("hide_gdpr_banner", "1");

  // YYYY-MM-DD. Anything else is dropped rather than passed through, because a bad `date`
  // parameter makes Calendly render its error page inside our iframe.
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    url.searchParams.set("month", date.slice(0, 7));
    url.searchParams.set("date", date);
  }

  return url.toString();
}
