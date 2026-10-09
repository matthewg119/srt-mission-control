// Two real openings for the setup call, on the day and half-day the clinic picked.
//
// ‼️ IT EXISTS BECAUSE THE TOKEN IS SERVER SIDE. CALENDLY_API_TOKEN reads availability and must
// never reach a browser, so the picker in /cards cannot ask Calendly itself. This route is the
// only thing between them, and it returns exactly what the screen draws: at most two slots, each
// with the booking URL Calendly itself minted for that one time.
//
// ‼️ PUBLIC BY DESIGN, LIKE THE REST OF THE FUNNEL DOOR, AND THEREFORE IT READS NOTHING AND
// WRITES NOTHING. It takes a day, a half-day and a timezone, and answers with public availability
// that anybody could see by opening the Calendly page. No lead id, no email, no row: a caller who
// hammers it learns which times are free, which is what the booking page tells them anyway.
//
// ‼️ AND IT CANNOT BOOK. Calendly's API does not create an invitee on this plan, so the slot's own
// scheduling_url is what finishes the job. That URL is the honest end of this: it is Calendly's,
// it confirms against live availability, and a slot taken in the meantime fails there rather than
// here. See CARDS_SLOTS in src/config/onboarding-cards.ts for why two and not thirty.

import { NextResponse } from "next/server";

import { endOfLocalDay, fetchSlots, safeTimeZone } from "@/lib/calendly";
import { CARDS_CALENDLY_KIND } from "@/config/onboarding-cards";

export const dynamic = "force-dynamic";

/**
 * The setup call, named once in the config this funnel shares with /api/cards.
 *
 * ‼️ IT USED TO SAY "install" AND THAT IS WHY THIS ROUTE HAD NEVER RETURNED A SLOT. See
 * CARDS_CALENDLY_KIND for the measurement: the install uuid is set in no environment, so every call
 * to this route answered { slots: [], reason: "unconfigured" } and the picker never drew.
 */
const KIND = CARDS_CALENDLY_KIND;

/** Two, because the whole point is a choice rather than a grid. */
const OFFER = 2;

/** How far out the day chips may reach. Matthew's question says three days; this is the guard. */
const MAX_DAYS_AHEAD = 3;

export async function POST(req: Request): Promise<NextResponse> {
  let body: { dayOffset?: unknown; daypart?: unknown; timeZone?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, slots: [] }, { status: 400 });
  }

  // ‼️ AN OFFSET AND NOT A DATE STRING. The visitor's "today" is decided in their zone, and a
  // date computed in a browser and parsed here is two timezone conversions that can disagree by
  // a day. An integer 0 to 3, resolved against their zone on this side, cannot.
  const offsetRaw = Number(body.dayOffset);
  const dayOffset =
    Number.isInteger(offsetRaw) && offsetRaw >= 0 && offsetRaw <= MAX_DAYS_AHEAD ? offsetRaw : 0;

  const wantsMorning = String(body.daypart ?? "").toLowerCase().startsWith("morning");
  const timeZone = safeTimeZone(typeof body.timeZone === "string" ? body.timeZone : null);

  const now = new Date();
  const { slots, reason } = await fetchSlots(KIND, "extended", timeZone, now);

  // ‼️ AN EMPTY LIST IS THE SAME ANSWER AS A BROKEN TOKEN, FROM OUT HERE. Both mean "no shortcut",
  // and the screen falls back to the full calendar either way. Telling them apart on the client
  // would be telling a visitor about our configuration.
  if (!slots || slots.length === 0) {
    return NextResponse.json({ ok: true, slots: [], reason });
  }

  // The chosen day, in the visitor's own zone.
  const dayStart = dayOffset === 0 ? now.getTime() : endOfLocalDay(now, timeZone, dayOffset - 1).getTime();
  const dayEnd = endOfLocalDay(now, timeZone, dayOffset).getTime();

  const hourFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    hour: "2-digit",
  });
  const labelFmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });

  const picked = slots
    .filter((s) => {
      const t = new Date(s.startTime).getTime();
      if (!Number.isFinite(t) || t < dayStart || t > dayEnd) return false;
      // Noon in THEIR zone is the line, the same rule bucketSlots() follows.
      const hour = Number(hourFmt.format(new Date(t)));
      return wantsMorning ? hour < 12 : hour >= 12;
    })
    .slice(0, OFFER)
    .map((s) => ({
      startTime: s.startTime,
      schedulingUrl: s.schedulingUrl,
      label: labelFmt.format(new Date(s.startTime)),
    }));

  return NextResponse.json({ ok: true, slots: picked, reason });
}
