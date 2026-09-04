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
import { slack } from "@/lib/slack-bot";
import { clean } from "@/lib/medspa/validate";
import { loadByToken, patchDelivery } from "@/lib/onboarding2/session";
import { findLeadByEmail, leadEmailFor, upsertLead } from "@/lib/onboarding2/lead";
import { bookedCard } from "@/lib/onboarding2/card";
import { verifyScheduledEvent } from "@/lib/calendly";
import { hasBooked } from "@/lib/onboarding2/booking";
import { provisionFromSigning } from "@/lib/onboarding2/provision";
import { openOpsThread } from "@/lib/onboarding2/delivery";
import { onboardingChannel } from "@/lib/onboarding2/constants";
import type { Onboarding2SigningRow } from "@/lib/onboarding2/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

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
  await finishBooking(row, verified.verified).catch((e) =>
    console.error("[onboarding2/booked] finishBooking:", (e as Error).message)
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
 * Provision, announce, open the ops thread. Lifted from finishSigning() in the sign route.
 *
 * ‼️ THE ORDER IS LOAD-BEARING AND IT IS NOT THE OBVIOUS ONE. The card is posted BEFORE the ops
 * thread, and its `ts` is NOT clients.ops_thread_ts: postDeliveryChecklist edits the ops thread
 * message in place to become the board header, so pointing ops_thread_ts at this card would erase
 * it the moment the board opened.
 *
 * ‼️ THE DELIVERY BOARD DOES NOT OPEN HERE, AND THAT IS DELIBERATE. startPilot and the ops thread
 * happen on booking so an abandoned chat is still visible in Slack; seedDeliverySteps and
 * intake_received wait for the LAST qualifying answer, because intake_received's verifier needs
 * clients.intake_completed_at and four steps are blocked behind it. Opening a board on a
 * half-finished intake produces one stalled on step 1. Same reasoning as at signature, one
 * trigger earlier.
 */
async function finishBooking(row: Onboarding2SigningRow, verified: boolean): Promise<void> {
  const provision = await provisionFromSigning(row).catch((e) => ({
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

  const lead = await upsertLead({
    email: leadEmailFor(row),
    business_name: row.business_legal_name,
    contact_name: row.contact_name,
    signer_title: row.signer_title,
    phone: row.contact_phone,
    website: row.website,
    client_id: provision.clientId,
    contact_id: provision.contactId,
  }).catch(() => null);

  const channel = onboardingChannel();
  const card = bookedCard({ row, lead, provision });

  if (!verified) {
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

  if (!channel) {
    console.error(
      "[onboarding2/booked] SLACK_CLIENT_ONBOARDING_CHANNEL unset. Card:\n" + card.text
    );
    return;
  }

  const posted = await slack.postMessage(channel, card.text, card.blocks).catch((e) => {
    console.error("[onboarding2/booked] slack post failed:", (e as Error).message);
    return null;
  });

  // slackFetch never throws, so ok has to be checked rather than assumed.
  const ts = posted && posted.ok ? (posted.ts as string) : null;
  if (ts) await patchDelivery(row.id, { slack_channel: channel, slack_thread_ts: ts });

  // postDeliveryChecklist REFUSES outright when ops_thread_ts is null, so if this post fails the
  // board can never open later. That is why the failure is a warning in the thread and not a log.
  if (provision.clientId) {
    const ops = await openOpsThread({
      clientId: provision.clientId,
      name: row.business_legal_name || row.contact_name || "New client",
    }).catch((e) => ({ ts: null, warning: (e as Error).message }));

    if (ops.warning && ts) {
      await slack
        .postThreadReply(
          channel,
          ts,
          [
            `:warning: The ops thread did not open: ${ops.warning}`,
            "The delivery board cannot post until it does.",
          ].join("\n")
        )
        .catch(() => null);
    }
  }
}
