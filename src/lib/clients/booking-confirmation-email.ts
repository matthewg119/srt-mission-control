// The email a client gets the moment they book the onboarding call (2026-09-15).
//
// Matthew: "We want a welcome email with the confirmation of our appointment and invitation for our
// meeting". It replaces the /onboarding?t= intake-link welcome for the booking door: nothing is asked
// of the client before the call any more, so the email that used to hand them a form now confirms the
// time, gives them the join link and puts the meeting on their calendar.
//
// TRANSPORT and SIGNATURE are welcome-email.ts's, for the reasons recorded there: Graph from the
// outreach mailbox, the plain sign-off, no price.
//
// ‼️ CALENDLY ALSO SENDS A CONFIRMATION, WITH ITS OWN CALENDAR INVITE. The two .ics files carry
// different UIDs, so a client who accepts both gets two entries. Turn off the invitee confirmation on
// the Calendly event type (Notifications and cancellation policy) so this is the only one.
//
// ‼️ EVERY FIXED STRING GOES THROUGH guard(), so an em dash fails the build rather than shipping.

import { microsoft } from "@/lib/microsoft";
import { guard } from "@/lib/copy-guard";
import { CALL_LINE, WELCOME_SIGNATURE_HTML } from "./welcome-email";

const DEFAULT_TIMEZONE = "America/New_York";
const DEFAULT_MINUTES = 60;

const INTRO_LINE = guard("confirmation intro", "you're booked. Here are the details for our onboarding call.");
const PREP_LINE = guard(
  "confirmation prep line",
  "Before then I'll give you a quick call to confirm the one service we're building this around, so we can hit the ground running."
);
const RESCHEDULE_LINE = guard(
  "confirmation reschedule line",
  "Need a different time? Use the reschedule link in your Calendly confirmation, or just reply to this email."
);
const INVITE_LINE = guard("confirmation invite line", "The calendar invite is attached.");
const NO_LINK_LINE = guard(
  "confirmation no link line",
  "The meeting link is in your Calendly confirmation, and I'll send it again the morning of the call."
);
const EVENT_SUMMARY = guard("confirmation event summary", "Onboarding call with SRT Agency");

export interface BookingConfirmationParams {
  to: string;
  firstName?: string | null;
  businessName?: string | null;
  /** ISO instant, from the verified Calendly event or the chat's computed slot. */
  startsAt: string;
  endsAt?: string | null;
  /** IANA zone the client picked in the chat. */
  timeZone?: string | null;
  joinUrl?: string | null;
  /** Calendly scheduled-event uuid, for a stable .ics UID. */
  eventUuid?: string | null;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "Tuesday, September 16 at 3:00 PM EDT", in the client's zone. Exported for the probe. */
export function formatCallTime(startsAt: string, timeZone?: string | null): string {
  const zone = validZone(timeZone) ?? DEFAULT_TIMEZONE;
  const at = new Date(startsAt);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "long", month: "long", day: "numeric" }).format(at);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  })
    .format(at)
    // Intl puts a narrow no-break space before AM/PM, which some mail clients render as a box.
    .replace(/\u202f/g, " ");
  return `${day} at ${time}`;
}

function validZone(zone?: string | null): string | null {
  if (!zone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return null;
  }
}

export function confirmationSubject(startsAt: string, timeZone?: string | null): string {
  return `Confirmed: our onboarding call on ${formatCallTime(startsAt, timeZone)}`;
}

// ── The calendar invite ─────────────────────────────────────────────────────

function icsStamp(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** RFC 5545 TEXT escaping. */
function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 folds content lines at 75 octets; a long join URL is exactly the line that needs it. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  for (const ch of line) {
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (Buffer.byteLength(current + ch, "utf8") > limit) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

/** Exported for the probe. */
export function buildInviteIcs(args: {
  startsAt: string;
  endsAt?: string | null;
  organizerEmail: string;
  attendeeEmail: string;
  attendeeName?: string | null;
  joinUrl?: string | null;
  eventUuid?: string | null;
  businessName?: string | null;
}): string {
  const start = new Date(args.startsAt);
  const end = args.endsAt ? new Date(args.endsAt) : new Date(start.getTime() + DEFAULT_MINUTES * 60_000);
  const uid = `${args.eventUuid || `${icsStamp(start)}-${args.attendeeEmail}`}@srtagency.com`;
  const description = [
    args.businessName ? `Onboarding call for ${args.businessName}.` : "Onboarding call.",
    args.joinUrl ? `Join: ${args.joinUrl}` : "The meeting link is in your Calendly confirmation.",
  ].join("\n");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SRT Agency//Onboarding call//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:REQUEST",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${icsStamp(new Date())}`,
    `DTSTART:${icsStamp(start)}`,
    `DTEND:${icsStamp(end)}`,
    `SUMMARY:${icsText(EVENT_SUMMARY)}`,
    `DESCRIPTION:${icsText(description)}`,
    ...(args.joinUrl ? [`LOCATION:${icsText(args.joinUrl)}`, `URL:${args.joinUrl}`] : []),
    `ORGANIZER;CN=Matthew Garcia:mailto:${args.organizerEmail}`,
    `ATTENDEE;CN=${icsText(args.attendeeName || args.attendeeEmail)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${args.attendeeEmail}`,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "BEGIN:VALARM",
    "TRIGGER:-PT15M",
    "ACTION:DISPLAY",
    `DESCRIPTION:${icsText(EVENT_SUMMARY)}`,
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.map(fold).join("\r\n") + "\r\n";
}

// ── The email ───────────────────────────────────────────────────────────────

export function confirmationBodyHtml(p: BookingConfirmationParams): string {
  const when = formatCallTime(p.startsAt, p.timeZone);
  const joinBlock = p.joinUrl
    ? `
    <p style="margin:0 0 24px">
      <a href="${escapeHtml(p.joinUrl)}" style="display:inline-block;background:#00C9A7;color:#04252b;font-weight:700;text-decoration:none;padding:14px 28px;border-radius:8px">Join the call</a>
    </p>
    <p style="margin:0 0 24px;font-size:13px;color:#888888">Or paste this into your browser: ${escapeHtml(p.joinUrl)}</p>`
    : `<p style="margin:0 0 24px">${NO_LINK_LINE}</p>`;

  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0B1426;padding:28px 24px;text-align:center">
    <span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <p style="margin:0 0 16px">${escapeHtml(p.firstName || "Hi there")}, ${INTRO_LINE}</p>
    <p style="margin:0 0 8px"><strong>When:</strong> ${escapeHtml(when)}</p>
    ${p.businessName ? `<p style="margin:0 0 16px"><strong>For:</strong> ${escapeHtml(p.businessName)}</p>` : ""}
    ${joinBlock}
    <p style="margin:0 0 16px">${CALL_LINE}</p>
    <p style="margin:0 0 16px">${PREP_LINE}</p>
    <p style="margin:0 0 16px">${RESCHEDULE_LINE}</p>
    <p style="margin:0 0 24px">${INVITE_LINE}</p>
    ${WELCOME_SIGNATURE_HTML}
  </div>
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
    <p style="margin:0">SRT Agency LLC, Search Retrieval Tactics</p>
  </div>
</div>
  `;
}

export async function sendBookingConfirmation(p: BookingConfirmationParams): Promise<void> {
  const mailbox = process.env.OUTREACH_MAILBOX || "matthew@srtagency.com";
  const ics = buildInviteIcs({
    startsAt: p.startsAt,
    endsAt: p.endsAt,
    organizerEmail: mailbox,
    attendeeEmail: p.to,
    attendeeName: p.firstName,
    joinUrl: p.joinUrl,
    eventUuid: p.eventUuid,
    businessName: p.businessName,
  });

  await microsoft.sendMail({
    to: p.to,
    subject: confirmationSubject(p.startsAt, p.timeZone),
    body: confirmationBodyHtml(p),
    isHtml: true,
    fromMailbox: mailbox,
    attachments: [
      {
        name: "onboarding-call.ics",
        contentType: "text/calendar; method=REQUEST",
        contentBytes: Buffer.from(ics, "utf8").toString("base64"),
      },
    ],
  });
}
