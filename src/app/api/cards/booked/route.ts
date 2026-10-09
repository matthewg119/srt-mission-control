// A clinic booked the setup call. This is what tells Matthew.
//
// ‼️ IT EXISTS BECAUSE BOOKING NOTIFIED NOBODY. /api/cards posts the #hot-leads card the moment
// the questions are answered, and until this route the Calendly booking that followed set one
// boolean in the browser and nothing else. The lead and the booking are different events and the
// second one is the one worth interrupting somebody for: a clinic that answered six questions and
// never picked a time is a chase, and a clinic that picked one is a calendar entry.
//
// ‼️ IT REPLIES IN THE LEAD'S OWN THREAD AND DOES NOT POST A SECOND CARD. contacts.slack_thread_ts
// is written by ingestLead, so the booking lands under the card it belongs to. A top-level
// message would be the same lead twice in the channel, which is how a channel stops being read.
//
// ── THE FORGERY SURFACE ─────────────────────────────────────────────────────
//
// /api/onboarding2/booked's header spells this out and the same reasoning applies, at lower cost:
// this route provisions nothing and takes no pilot seat, so the worst a forged call buys is a
// Slack line about a booking that did not happen. That is still a lie in the one channel Matthew
// trusts, so it is guarded the same way.
//
//   1. The client checks the Calendly origin EXACTLY before posting here. Necessary, worth
//      nothing alone: anybody can POST to this route directly.
//   2. THE EVENT URI IS VERIFIED AGAINST CALENDLY'S API. A forged payload names an event that
//      does not exist and the fetch says so. With CALENDLY_API_TOKEN unset this cannot run, and
//      the Slack line says the booking is unverified rather than quietly claiming it is real.
//
// ‼️ AND A CONTACT ID FROM A REQUEST BODY IS NOT A CREDENTIAL. It only ever selects a thread to
// reply in, and it is used only after the event verifies, so a guessed id cannot by itself put a
// line in somebody's thread.

import { NextResponse } from "next/server";

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { verifyScheduledEvent } from "@/lib/calendly";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Calendly's own URIs, and nothing else, so a verify call cannot be pointed at another host. */
const EVENT_URI = /^https:\/\/api\.calendly\.com\/scheduled_events\/[A-Za-z0-9-]{1,64}$/;

export async function POST(req: Request): Promise<NextResponse> {
  let body: { contactId?: unknown; eventUri?: unknown; startTime?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const contactId = typeof body.contactId === "string" && UUID.test(body.contactId) ? body.contactId : null;
  const eventUri = typeof body.eventUri === "string" && EVENT_URI.test(body.eventUri) ? body.eventUri : null;

  // ‼️ 200 ON EVERY REFUSAL. The visitor has booked; their screen is finished and there is
  // nothing for them to retry. A failure here costs SRT a notification, which is ours to notice.
  if (!contactId) {
    console.error("[api/cards/booked] no usable contact id");
    return NextResponse.json({ ok: true, noted: false });
  }

  const check = await verifyScheduledEvent(eventUri);
  if (check.status === "not_found") {
    console.error("[api/cards/booked] Calendly does not know that event:", eventUri);
    return NextResponse.json({ ok: true, noted: false });
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("first_name, last_name, email, slack_thread_ts, slack_channel")
    .eq("id", contactId)
    .maybeSingle();

  if (!contact) {
    console.error("[api/cards/booked] no contact row", contactId);
    return NextResponse.json({ ok: true, noted: false });
  }

  const row = contact as Record<string, unknown>;
  const threadTs = (row.slack_thread_ts as string | null) ?? null;
  const channel = (row.slack_channel as string | null) || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  const who =
    [row.first_name, row.last_name].filter(Boolean).join(" ") ||
    (row.email as string | null) ||
    "A clinic";

  // The verified instant when there is one, and the client's own claim when there is not. Which
  // of the two it is appears on the line, because an unverified time is somebody else's word.
  const when = check.startTime ?? (typeof body.startTime === "string" ? body.startTime : null);
  const stamp = when
    ? new Date(when).toLocaleString("en-US", {
        timeZone: "America/New_York",
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
      })
    : "a time Calendly has not confirmed to us";

  const line =
    `:white_check_mark: *${who} booked the setup call* for ${stamp}.` +
    (check.verified ? "" : "\n_Unverified: CALENDLY_API_TOKEN is unset, so this is the browser's word._") +
    (check.joinUrl ? `\n${check.joinUrl}` : "");

  if (!channel) {
    console.error("[api/cards/booked] no channel to post into for", contactId);
    return NextResponse.json({ ok: true, noted: false });
  }

  try {
    if (threadTs) await slack.postThreadReply(channel, threadTs, line);
    // No thread means the lead card never posted, which ingestLead logs. The booking is still
    // worth saying out loud, so it goes top level rather than being dropped with it.
    else await slack.postMessage(channel, line);
  } catch (e) {
    console.error("[api/cards/booked] slack post failed:", (e as Error).message);
    return NextResponse.json({ ok: true, noted: false });
  }

  return NextResponse.json({ ok: true, noted: true, verified: check.verified });
}
