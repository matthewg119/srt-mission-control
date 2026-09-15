// The Calendly booking, recorded. THIS IS WHAT STARTS A CLIENT NOW.
//
// ‼️ IT IS A CALENDLY RECEIVER AGAIN (2026-09-04), AFTER BEING ONE, THEN NOT BEING ONE.
// Its own header said "THIS IS NO LONGER A CALENDLY WEBHOOK RECEIVER (2026-09-03)". That was
// true for a day, while the funnel agreed a day in chat and MS Graph was supposed to send the
// invite. The four MS_CALENDAR_* vars were never set, so that path sent nothing, and Calendly is
// back. The history is left in this comment rather than tidied away, because the next person to
// wonder why there are two calendar implementations deserves the answer.
//
// ‼️ THIS ROUTE HAS TAKEN OVER PROVISIONING FROM /api/onboarding2/sign. The signature screens are
// gone from the funnel, so signing is no longer the moment somebody commits: BOOKING IS. Nothing
// else changed about the chain. It provisions, patches the signing row, upserts the lead, posts
// the top-level Slack card and opens the ops thread, in that order, exactly as finishSigning()
// did. What it does NOT do is email a PDF, because there is no signed PDF: the agreement is
// signed by hand on the call, at delivery step `agreement_signed`.
//
// ── THE FORGERY SURFACE, AND WHY IT IS NOT LEFT OPEN ────────────────────────
//
// The old header recorded the risk exactly: "without an origin check any opener could have posted
// a fake event_scheduled, fired a paid conversion and written a booking that never happened".
// That surface is back with the iframe, and it now costs MORE than a bad row, because this route
// provisions and provisioning takes one of six pilot seats.
//
// Two guards, and the client-side one is the weaker of them:
//   1. The client checks e.origin === "https://calendly.com" before posting here. Necessary, and
//      worth nothing on its own: anybody can POST to this route directly with a stolen token.
//   2. THE EVENT URI IS VERIFIED AGAINST CALENDLY'S API before anything is written. A forged
//      payload names an event that does not exist, and the fetch says so.
//
// ‼️ WHEN CALENDLY_API_TOKEN IS UNSET, GUARD 2 CANNOT RUN, AND THE ROUTE SAYS SO ON THE ROW
// RATHER THAN PRETENDING. `booking_verified` comes back false and the Slack card carries it.
// Refusing the booking instead would mean an unset token silently breaks the funnel; accepting it
// silently would mean a row nobody can tell apart from a verified one. Neither is acceptable, so
// it is recorded.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { clean } from "@/lib/medspa/validate";
import { loadByToken, patchDelivery } from "@/lib/onboarding2/session";
import { findLeadByEmail, leadEmailFor, upsertLead } from "@/lib/onboarding2/lead";
import { bookedCard } from "@/lib/onboarding2/card";
import { verifyScheduledEvent, type ScheduledEventCheck } from "@/lib/calendly";
import { hasBooked } from "@/lib/onboarding2/booking";
import { provisionFromSigning, type ProvisionResult } from "@/lib/onboarding2/provision";
import { intakePatchFrom } from "@/lib/onboarding2/delivery";
import { onboardingChannel } from "@/lib/onboarding2/constants";
import { openClientBoard, type OpenBoardResult } from "@/lib/clients/open-board";
import { sendBookingConfirmation } from "@/lib/clients/booking-confirmation-email";
import { splitName } from "@/lib/medspa/validate";
import type { Onboarding2SigningRow } from "@/lib/onboarding2/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
// finishBooking runs in waitUntil and opens the whole board; see the note at the call.
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const row = await loadByToken(body.sessionToken as string);
  if (!row) return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });

  // ‼️ IDENTITY, NOT A SIGNATURE. This used to refuse on `!row.signed_at`, which would now refuse
  // every booking there is. What still has to be true is that the session went through screen
  // one: a booking recorded against a row with no email has no lead to attach to and no client to
  // provision.
  const email = leadEmailFor(row);
  if (!email) return NextResponse.json({ ok: false, error: "Not identified." }, { status: 409 });

  const eventUri = clean(body.eventUri, 300);
  const inviteeUri = clean(body.inviteeUri, 300);

  const existing = await findLeadByEmail(email);
  // Idempotent. Calendly's embed can fire event_scheduled more than once on a slow connection,
  // and a second card in a thread somebody is reading is worse than a dropped one.
  // ‼️ SAME PREDICATE THE CHAT GATE USES. An unverified booking sets only calendly_event_uri,
  // so checking booked_slot_at here would let a second event_scheduled re-provision the client.
  if (hasBooked(existing)) {
    return NextResponse.json({ ok: true, alreadyBooked: true });
  }

  // ── Guard 2 ──
  const verified = await verifyScheduledEvent(eventUri);
  if (verified.status === "not_found") {
    console.error(`[onboarding2/booked] unverifiable event uri for signing ${row.id}`);
    return NextResponse.json({ ok: false, error: "Unknown booking." }, { status: 409 });
  }

  const stored = await upsertLead({
    email,
    // ‼️ THE REAL INSTANT WHEN CALENDLY GAVE US ONE, AND ONLY THEN. `startTime` comes off the
    // verified event, never off the request body. Falling back to now() would put a timestamp on
    // the row that reads as the appointment and is actually the moment somebody clicked.
    booked_slot_at: verified.startTime ?? null,
    calendly_event_uri: eventUri || inviteeUri || null,
  });

  if (!stored?.booked_slot_at && !stored?.calendly_event_uri) {
    // The same lesson this route's previous version records: report what was WRITTEN, not what
    // was sent. upsertLead swallows its own error and returns null, so a missing column or an RLS
    // refusal has to surface here rather than as a confident yes.
    return NextResponse.json({ ok: false, error: "Could not store the booking." }, { status: 500 });
  }

  // ‼️ EVERYTHING BELOW IS BEST-EFFORT AND NONE OF IT MAY COST THE BOOKING. The row is already
  // durable at this point. A provisioning failure is loud in Slack and leaves a real calendar
  // appointment intact, which is the right trade in that order and not the other one.
  //
  // ‼️ IN waitUntil, NOT AWAITED (2026-09-15). finishBooking now opens the whole board: 41 anchors,
  // the ready auto steps, the confirmation email. That is well past the minute this route had, and the
  // visitor's browser is waiting on this response to move the chat on to its first question.
  waitUntil(
    finishBooking(row, verified, stored?.booked_slot_at ?? null).catch((e) =>
      console.error("[onboarding2/booked] finishBooking:", (e as Error).message)
    )
  );

  return NextResponse.json({
    ok: true,
    stored: true,
    startsAt: stored?.booked_slot_at ?? null,
    // Reported so the walk probe and the Slack card agree about what was actually checked.
    verified: verified.verified,
  });
}

/**
 * Provision, open the board, confirm the appointment, announce. THE BOOKING IS THE DOOR (2026-09-15).
 *
 * ‼️ THE BOARD OPENS HERE NOW, WHICH REVERSES WHAT THIS COMMENT USED TO SAY. It waited for the last
 * of eight chat answers, because intake_received's verifier needs clients.intake_completed_at. So a
 * prospect who booked and closed the tab had a client row, a channel and no board, and Matthew had
 * nothing to work. Matthew: "once they book we automatically start onboarding them". openClientBoard
 * writes intake_completed_at on its claim, so step 1 is true the moment they book. The answers that
 * arrive afterwards fill columns in place (applyQualifyingAnswers in lib/onboarding2/delivery.ts).
 *
 * ‼️ NO SCAN. The audit they booked from (row.report_slug) is attached as step 2. See open-board.ts.
 *
 * ‼️ THE CARD IS POSTED LAST AND IT IS THE ONE ANNOUNCEMENT. It carries the channel link, the call
 * time, the board, the report, and what did not happen. Its ts is never clients.ops_thread_ts: that
 * header lives in the client's own channel and refreshHeader rewrites it in place.
 */
async function finishBooking(
  row: Onboarding2SigningRow,
  verified: ScheduledEventCheck,
  storedStartsAt: string | null
): Promise<void> {
  const provision: ProvisionResult = await provisionFromSigning(row).catch((e) => ({
    ok: false,
    clientId: null,
    slug: null,
    onboardingUrl: null,
    contactId: null,
    alreadyProvisioned: false,
    error: (e as Error).message,
    warnings: [(e as Error).message],
  }));

  if (provision.clientId || provision.contactId) {
    await patchDelivery(row.id, {
      client_id: provision.clientId,
      contact_id: provision.contactId,
    });
  }

  const businessName = row.business_legal_name || provision.report?.businessName || null;

  const lead = await upsertLead({
    email: leadEmailFor(row),
    business_name: businessName,
    contact_name: row.contact_name,
    signer_title: row.signer_title,
    phone: row.contact_phone,
    website: row.website || provision.report?.website || null,
    client_id: provision.clientId,
    contact_id: provision.contactId,
  }).catch(() => null);

  // ── The card, FIRST, and edited in place when the rest lands ──
  // Opening a board takes minutes and this all runs in waitUntil. Posted last, a background
  // function cut off at its limit would leave a real booking with no notification at all, which is
  // the one outcome worse than a card that says "opening". So it goes up now, with the channel link
  // already on it, and chat.update fills in the board and the email when they finish.
  const channel = onboardingChannel();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const earlyStartsAt = verified.startTime ?? storedStartsAt;
  const render = (extra: Partial<Parameters<typeof bookedCard>[0]>) => {
    const card = bookedCard({ row, lead, provision, startsAt: earlyStartsAt, appUrl, ...extra });
    if (!verified.verified) {
      card.blocks.push({
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text:
              ":warning: This booking was NOT verified against Calendly, because CALENDLY_API_TOKEN " +
              "is unset. Confirm the appointment exists before you prepare for it.",
          },
        ],
      });
    }
    return card;
  };

  let cardTs: string | null = null;
  if (channel) {
    const early = render({});
    if (provision.clientId && !row.is_demo) {
      early.blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: ":hourglass_flowing_sand: Opening the board and sending the confirmation..." }],
      });
    }
    const posted = await slack.postMessage(channel, early.text, early.blocks).catch((e) => {
      console.error("[onboarding2/booked] slack post failed:", (e as Error).message);
      return null;
    });
    // slackFetch never throws, so ok has to be checked rather than assumed.
    cardTs = posted && posted.ok ? (posted.ts as string) : null;
    if (cardTs) await patchDelivery(row.id, { slack_channel: channel, slack_thread_ts: cardTs });
  } else {
    console.error("[onboarding2/booked] SLACK_CLIENT_ONBOARDING_CHANNEL unset, no booked card.");
  }

  // ── The board ──
  let board: OpenBoardResult | null = null;
  if (provision.clientId && !row.is_demo) {
    const { patch } = intakePatchFrom(row, lead);
    // intakePatchFrom names the business off the chat's business_name answer, which comes AFTER
    // booking, and falls back to the person's name for dba_name. The report knows the business.
    if (businessName) {
      patch.legal_name = patch.legal_name ?? businessName;
      patch.dba_name = businessName;
    }
    board = await openClientBoard(provision.clientId, {
      name: businessName || row.contact_name || "New client",
      reportSlug: row.report_slug,
      intakePatch: patch,
    }).catch((e) => ({ claimed: false, adoptedReportId: null, warnings: [(e as Error).message] }));
  }

  // ── The confirmation email ──
  // Once per booking: the route already returned early on hasBooked(), so a re-fired
  // event_scheduled never reaches here. Not tied to the board claim, because a returning client
  // whose board is already open still booked a call and still needs the invite.
  let confirmation: { sent: boolean; error?: string | null } | null = null;
  const startsAt = verified.startTime ?? storedStartsAt;
  const to = leadEmailFor(row);
  if (!row.is_demo && startsAt && to) {
    const { firstName } = splitName(row.contact_name || row.print_name || "");
    confirmation = await sendBookingConfirmation({
      to,
      firstName: firstName || null,
      businessName,
      startsAt,
      endsAt: verified.endTime,
      timeZone: lead?.call_timezone ?? null,
      joinUrl: verified.joinUrl,
      eventUuid: verified.eventUuid,
    })
      .then(() => ({ sent: true }))
      .catch((e) => ({ sent: false, error: (e as Error).message }));
  } else if (!row.is_demo && !startsAt) {
    confirmation = { sent: false, error: "no appointment time came back from Calendly or the chat" };
  }

  if (!channel || !cardTs) return;
  const final = render({ board, confirmation });
  const updated = (await slack.updateMessage(channel, cardTs, final.text, final.blocks).catch(() => null)) as {
    ok?: boolean;
    error?: string;
  } | null;
  if (!updated?.ok) {
    // The card is up; say what the edit would have said rather than lose it.
    const lines = [
      board?.claimed ? ":white_check_mark: Board opened." : ":information_source: Board was not opened by this booking.",
      confirmation ? (confirmation.sent ? ":white_check_mark: Confirmation email sent." : `:x: Confirmation email failed: ${confirmation.error}`) : null,
      ...(board?.warnings ?? []).map((w) => `- ${w}`),
    ].filter(Boolean);
    await slack.postThreadReply(channel, cardTs, lines.join("\n")).catch(() => null);
  }
}
