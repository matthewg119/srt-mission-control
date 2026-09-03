// The onboarding call, as a real calendar event with a real invite. No link, anywhere.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ WHY NOT CALENDLY, CHECKED RATHER THAN ASSUMED (2026-09-03).
//
// The brief said "Calendly v2 has NO endpoint that creates a booking". That was true when
// src/lib/calendly.ts was written and it is NOT true any more: Calendly shipped a Scheduling API
// in October 2025 with a Create Event Invitee endpoint that books on behalf of an invitee with
// no redirect and no Calendly UI. So the premise is out of date and the conclusion still holds,
// for three reasons that have nothing to do with capability:
//
//   1. It needs a PAID Calendly plan and CALENDLY_API_TOKEN, which is unset. calendly.ts ships
//      with the unconfigured path as the DEFAULT path, by design.
//   2. It books against a Calendly EVENT TYPE, which means Calendly's own confirmation and
//      reschedule mail, which carries links. This funnel had its calendar deliberately removed.
//   3. Graph is already authenticated in this app and already sends as the mailbox that emails
//      these people anyway.
//
// src/lib/calendly.ts is untouched and still holds fetchSlots() for the med spa funnel.
// ─────────────────────────────────────────────────────────────────────────────
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ A SEPARATE AZURE APP REGISTRATION, AND THAT IS A DELIBERATE ISOLATION RATHER THAN A
// PREFERENCE. Matthew's call, 2026-09-03, and it dodges a live outage:
//
// src/lib/microsoft.ts sends `scope: SCOPES` on EVERY refresh_token grant. Adding
// Calendars.ReadWrite to that array would make the next refresh ask for a scope the stored grant
// does not cover, Azure answers AADSTS65001, getValidAccessToken() throws, and EVERY email path
// in Mission Control goes down inside an hour until somebody reconnects at
// /dashboard/integrations. A second app cannot do that: it has its own client id, its own
// secret and its own token, and microsoft.ts never learns it exists.
//
// ‼️ APP-ONLY (client_credentials), NOT DELEGATED. There is no refresh token to lapse, which is
// the failure documented in reference_graph_subscription_gotcha and the reason
// MICROSOFT_GRAPH_APP_AUTH exists in the mail client. An onboarding invite fires days after
// anybody last signed in to anything, so a delegated token is the wrong shape.
//
// ‼️ APPLICATION Calendars.ReadWrite GRANTS EVERY MAILBOX IN THE TENANT. Scope it down with an
// Exchange Application Access Policy to MS_CALENDAR_MAILBOX alone. The command is in the setup
// notes; skipping it works and is broader than this feature needs.
// ─────────────────────────────────────────────────────────────────────────────

const GRAPH = "https://graph.microsoft.com/v1.0";

function cfg() {
  return {
    clientId: (process.env.MS_CALENDAR_CLIENT_ID || "").trim(),
    clientSecret: (process.env.MS_CALENDAR_CLIENT_SECRET || "").trim(),
    tenantId: (process.env.MS_CALENDAR_TENANT_ID || "").trim(),
    mailbox: (process.env.MS_CALENDAR_MAILBOX || "matthew@srtagency.com").trim(),
  };
}

/**
 * ‼️ TRI-STATE, AND UNCONFIGURED IS THE DEFAULT PATH RATHER THAN AN EDGE CASE. This ships with
 * nothing set, exactly like CALENDLY_API_TOKEN, so the fallback has to be the good path: the
 * Slack card says NO INVITE HAS BEEN SENT and a human picks the hour on the phone. That card is
 * honest and it already exists. Replacing an honest card with a broken integration is the one
 * outcome worse than not building this at all.
 */
export function isCalendarConfigured(): boolean {
  const c = cfg();
  return Boolean(c.clientId && c.clientSecret && c.tenantId && c.tenantId !== "common");
}

let cached: { token: string; expiresAt: number } | null = null;

async function appToken(): Promise<string> {
  const c = cfg();
  const now = Math.floor(Date.now() / 1000);
  if (cached && cached.expiresAt > now + 300) return cached.token;

  const res = await fetch(`https://login.microsoftonline.com/${c.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: "client_credentials",
      scope: "https://graph.microsoft.com/.default",
    }).toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`calendar token request failed: ${await res.text()}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: now + json.expires_in };
  return json.access_token;
}

// ─────────────────────────────────────────────────────────────────────────────
// Local wall clock to a real instant
// ─────────────────────────────────────────────────────────────────────────────

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
  for (const p of dtf.formatToParts(at)) if (p.type !== "literal") map[p.type] = p.value;
  // !! THE MILLISECONDS ARE TRUNCATED OUT OF BOTH SIDES, AND SKIPPING THAT PUTS A RAGGED TIME ON
  // A CALENDAR INVITE. formatToParts resolves only to the second, so the reconstructed UTC value
  // carries ms = 0 while at.getTime() carries whatever the clock was on: the difference is not
  // the zone offset, it is the offset MINUS the current milliseconds. Downstream that produced a
  // call starting at 2:00:00.532 pm, which is a real event a real person receives. Found by
  // _probe-onboarding2-chat's "one hour apart" check rather than by reading this.
  const whole = Math.floor(at.getTime() / 1000) * 1000;
  return (
    Date.UTC(
      Number(map.year),
      Number(map.month) - 1,
      Number(map.day),
      Number(map.hour) % 24,
      Number(map.minute),
      Number(map.second)
    ) - whole
  );
}

/**
 * "2026-09-14" at 14:00 in America/Los_Angeles, as a real instant.
 *
 * ‼️ THE OFFSET IS RESOLVED TWICE, AND THE SECOND PASS IS NOT OPTIONAL. Reading the offset as it
 * is right now is wrong by an hour whenever the target date sits on the other side of a DST
 * change, which for a call three days out happens twice a year and produces an invite that is
 * confidently one hour wrong. Feeding the first guess back in and re-reading the offset there
 * fixes it. Identical technique and identical reasoning to endOfLocalDay() in src/lib/calendly.ts.
 */
export function localToInstant(date: string, hour: number, timeZone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const wall = Date.UTC(y, m - 1, d, hour, 0, 0, 0);
  const now = new Date();
  let guess = new Date(wall - offsetMs(now, timeZone));
  guess = new Date(wall - offsetMs(guess, timeZone));
  return guess;
}

// ─────────────────────────────────────────────────────────────────────────────
// The event
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarResult =
  | { ok: true; eventId: string }
  | { ok: false; reason: "unconfigured" | "error"; detail?: string };

export interface EventInput {
  /** YYYY-MM-DD in the CLIENT's zone. */
  date: string;
  /** 0 to 23 in the CLIENT's zone. */
  hour: number;
  /** IANA. Theirs, not ours. */
  timeZone: string;
  minutes: number;
  attendeeEmail: string;
  attendeeName: string | null;
  businessName: string | null;
  /** Printed in the invite body so they know what is about to happen. */
  attendeePhone: string | null;
}

/**
 * Create the event on the organizer's calendar and let Exchange send the invite.
 *
 * ‼️ NO LINK IN THE BODY AND NO ONLINE MEETING ATTACHED. `isOnlineMeeting` would put a Teams
 * join URL in the invite, which is a calendar link inside the one flow whose whole design point
 * is that it has none, and it also fails outright on a mailbox with no Teams license. This is a
 * phone call: the invite says who is calling whom, on what number.
 *
 * ‼️ THE INSTANT IS COMPUTED HERE AND SENT AS UTC. Graph accepts a named zone and the temptation
 * is to hand it the client's, but then the DST arithmetic belongs to a service whose behaviour we
 * cannot test from here. localToInstant() is testable and the attendee's Outlook renders the
 * instant in their own zone regardless.
 */
export async function createOnboardingEvent(input: EventInput): Promise<CalendarResult> {
  if (!isCalendarConfigured()) return { ok: false, reason: "unconfigured" };

  const c = cfg();
  const start = localToInstant(input.date, input.hour, input.timeZone);
  const end = new Date(start.getTime() + input.minutes * 60_000);

  const who = input.businessName || input.attendeeName || "your clinic";
  const lines = [
    `Onboarding call with SRT Agency and ${escapeHtml(who)}.`,
    input.attendeePhone
      ? `Matthew will call ${escapeHtml(input.attendeePhone)} at the scheduled time.`
      : "Matthew will call you at the scheduled time.",
    "We will walk through what we are building for you and what we need from your side.",
    "If this time does not work, reply to this invite and we will move it.",
  ];

  try {
    const res = await fetch(`${GRAPH}/users/${encodeURIComponent(c.mailbox)}/events`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await appToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        subject: `SRT onboarding call: ${who}`,
        body: { contentType: "HTML", content: lines.map((l) => `<p>${l}</p>`).join("") },
        start: { dateTime: graphDateTime(start), timeZone: "UTC" },
        end: { dateTime: graphDateTime(end), timeZone: "UTC" },
        attendees: [
          {
            emailAddress: { address: input.attendeeEmail, name: input.attendeeName || undefined },
            type: "required",
          },
        ],
        // Exchange sends the invite on create. This is the whole point: no link is ever shown to
        // anybody, and the attendee gets an .ics in their inbox like any other meeting.
        responseRequested: true,
        allowNewTimeProposals: true,
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) {
      const detail = (await res.text()).slice(0, 400);
      console.error(`[onboarding2/calendar] ${res.status}: ${detail}`);
      return { ok: false, reason: "error", detail: `${res.status} ${detail}` };
    }
    const json = (await res.json()) as { id?: string };
    if (!json.id) return { ok: false, reason: "error", detail: "Graph returned no event id" };
    return { ok: true, eventId: json.id };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[onboarding2/calendar] create failed:", detail);
    return { ok: false, reason: "error", detail };
  }
}

/** Graph wants a local-looking string with no offset on it, paired with an explicit timeZone. */
function graphDateTime(d: Date): string {
  return d.toISOString().replace(/\.\d{3}Z$/, "");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────────────────────────────────────
// The one place a chosen day becomes an invite.
//
// ‼️ IT LIVES HERE RATHER THAN IN A ROUTE BECAUSE TWO ROUTES NEED IT. The chat close writes the
// day, and POST /api/onboarding2/booked records the same fact out of band (the walk probe drives
// that one, and a support path would use it). Two copies of "compute the instant, call Graph,
// patch the row" is two places for the fallback behaviour to diverge, and the fallback is the
// path that actually runs today.
// ─────────────────────────────────────────────────────────────────────────────

import { upsertLead } from "./lead";
import { CALL_HOUR, CALL_MINUTES, type Daypart } from "./scheduling";
import type { Onboarding2LeadRow } from "./types";

/**
 * Turn (day, daypart, zone) into a stored instant and, if Graph is configured, a real invite.
 *
 * ‼️ THE INSTANT IS STORED EVEN WHEN NO INVITE GOES OUT, and that is not a consolation prize.
 * The hour is now a fact the client was told out loud in the chat, so it belongs on the row
 * whether or not Microsoft was reachable. Storing it only on success would mean the Slack card
 * and the confirmation bubble disagreed about what time the call is.
 *
 * ‼️ A FAILURE IS RECORDED AND NEVER THROWN. The day is already agreed and already confirmed on
 * screen by the time this runs; letting a Graph outage take down the close would lose the
 * booking to protect the invite. call_invite_error is what the card reads to decide whether to
 * say an invite exists.
 */
export async function scheduleCallAndInvite(args: {
  lead: Onboarding2LeadRow;
  date: string;
  daypart: Daypart;
  timeZone: string;
  /** Demo hosts run everything for real and let nothing escape. An invite escapes. */
  isDemo: boolean;
}): Promise<Onboarding2LeadRow | null> {
  const { lead, date, daypart, timeZone } = args;
  const hour = CALL_HOUR[daypart];
  const startsAt = localToInstant(date, hour, timeZone).toISOString();

  const base = {
    email: lead.email,
    call_timezone: timeZone,
    call_starts_at: startsAt,
  };

  // ‼️ NO INVITE FROM A DEMO HOST, EVER. localhost and *.vercel.app run everything for real and
  // let nothing escape, and a calendar invite lands in a real human's inbox. The row still gets
  // its instant, so a walk probe still proves the arithmetic.
  if (args.isDemo || !isCalendarConfigured()) {
    return upsertLead(base);
  }

  const result = await createOnboardingEvent({
    date,
    hour,
    timeZone,
    minutes: CALL_MINUTES,
    attendeeEmail: lead.email,
    attendeeName: lead.contact_name,
    businessName: lead.business_name,
    attendeePhone: lead.phone,
  });

  if (result.ok) {
    return upsertLead({
      ...base,
      call_event_id: result.eventId,
      call_invite_sent_at: new Date().toISOString(),
      call_invite_error: null,
    });
  }

  return upsertLead({
    ...base,
    call_invite_error: result.reason === "unconfigured" ? "unconfigured" : (result.detail ?? "error"),
  });
}
