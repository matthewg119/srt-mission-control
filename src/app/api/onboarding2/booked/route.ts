// The onboarding call day, recorded from outside the chat.
//
// ‼️ THIS IS NO LONGER A CALENDLY WEBHOOK RECEIVER (2026-09-03). There is no calendar in this
// funnel: the day is agreed in the chat and written by the scheduling branch of
// api/onboarding2/chat. This route survives as the out-of-band way to record the same fact, which
// is what the walk probe drives and what a support path would use, and it enforces the same two
// rules that branch does.
//
// ‼️ THE ORIGIN CHECK THAT USED TO MATTER IS GONE WITH THE FRAME IT GUARDED. The old client
// listened for a postMessage from calendly.com, and without an origin check any opener could have
// posted a fake event_scheduled, fired a paid conversion and written a booking that never
// happened. No frame, no listener, no forgery surface. What is left is the second half of that
// guard, which still applies: nothing may record a call against an unsigned session.

import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { clean } from "@/lib/medspa/validate";
import { loadByToken } from "@/lib/onboarding2/session";
import { findLeadByEmail, leadEmailFor, upsertLead } from "@/lib/onboarding2/lead";
import { callReply } from "@/lib/onboarding2/card";
import {
  dayOptions,
  readDayChoice,
  readDaypart,
  readTimezone,
  SCHEDULING_TZ,
} from "@/lib/onboarding2/scheduling";
import { scheduleCallAndInvite } from "@/lib/onboarding2/calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const row = await loadByToken(body.sessionToken as string);
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  // A call is a post-signature act. An unsigned session has nothing to schedule.
  if (!row.signed_at) {
    return NextResponse.json({ ok: false, error: "Not signed." }, { status: 409 });
  }

  const email = leadEmailFor(row);
  if (!email) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  const daypart = readDaypart(clean(body.daypart, 40));
  if (!daypart) {
    return NextResponse.json({ ok: false, error: "Unknown daypart." }, { status: 400 });
  }

  // ‼️ THE DAY IS MATCHED AGAINST THE OFFER, NOT TAKEN FROM THE REQUEST. Accepting an arbitrary
  // date here would let a call be written for a Sunday, or for last March, on a row a human then
  // reads as a commitment somebody made.
  const picked = readDayChoice(clean(body.day, 80), dayOptions(daypart));
  if (!picked) {
    return NextResponse.json({ ok: false, error: "Unknown day." }, { status: 400 });
  }

  // ‼️ THE ZONE IS OPTIONAL HERE AND REQUIRED IN THE CHAT, AND THAT ASYMMETRY IS DELIBERATE.
  // The chat asks four buttons and gets an answer; this route is the out-of-band path a support
  // call or the walk probe uses, and refusing a booking because nobody typed a timezone would
  // make the recovery path harder to use than the thing it is recovering. With none given it
  // falls back to SCHEDULING_TZ, which is OURS, and the row records that honestly: a reader can
  // tell an asked zone from an assumed one because the chat always writes one and this may not.
  const zone = readTimezone(clean(body.timezone, 60)) ?? SCHEDULING_TZ;

  const existing = await findLeadByEmail(email);
  // Idempotent. A double submit saying the same thing is noise in a thread somebody is reading.
  if (existing?.call_day) {
    return NextResponse.json({ ok: true, alreadyScheduled: true });
  }

  const stored = await upsertLead({
    email,
    call_daypart: daypart,
    call_day: picked.date,
    call_choice_label: picked.label,
    call_chosen_at: new Date().toISOString(),
  });

  // Same order as the chat close: the day is durable before Graph is asked, so an outage costs
  // the invite and never the booking.
  const lead = stored
    ? ((await scheduleCallAndInvite({
        lead: stored,
        date: picked.date,
        daypart,
        timeZone: zone,
        isDemo: Boolean(row.is_demo),
      })) ?? stored)
    : null;

  if (lead && row.slack_thread_ts && row.slack_channel && !row.is_demo) {
    const reply = callReply(lead);
    await slack
      .postThreadReply(row.slack_channel, row.slack_thread_ts, reply.text, reply.blocks)
      .catch((e) => console.error("[onboarding2/booked] slack reply failed:", (e as Error).message));
  }

  // ‼️ THE RESPONSE REPORTS WHETHER THE ROW WAS ACTUALLY WRITTEN, AND IT DID NOT UNTIL
  // 2026-09-03. upsertLead() catches its own error and returns null, so this route answered
  // `{ok:true, day, label}` off the PICKED object whether or not anything was stored. The walk
  // probe asserted on exactly those two fields and went green against a database missing the
  // call_starts_at column: the write failed on every request, the log said so, and the check
  // that exists to prove the close works said PASS.
  //
  // `stored` is read off the saved ROW rather than off the request, so a missing column, an RLS
  // refusal or a constraint violation all surface as ok:false instead of a confident yes.
  return NextResponse.json({
    ok: Boolean(lead?.call_day),
    stored: Boolean(lead?.call_day),
    day: picked.date,
    label: picked.label,
    // not_attempted is the default and honest state: MS_CALENDAR_* ships unset, and a demo host
    // never sends one at all.
    invite: lead?.call_invite_sent_at
      ? "sent"
      : lead?.call_invite_error
        ? "failed"
        : "not_attempted",
    // ‼️ REPORTED SEPARATELY FROM `stored`, BECAUSE THE TWO WRITES ARE SEPARATE ON PURPOSE. The
    // day lands first and the zone plus the computed instant land second, so a failure on the
    // second one costs the invite and never the booking. That is what makes this feature safe to
    // deploy before docs/2026-09-03-onboarding2-call-invite.sql has run: without those columns
    // the close degrades to exactly its old behaviour, a day agreed and an honest Slack card.
    // A null here on a request that supplied a zone means the migration is still owed.
    zone: lead?.call_timezone ?? null,
  });
}
