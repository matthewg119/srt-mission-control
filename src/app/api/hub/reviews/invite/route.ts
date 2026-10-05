// The referral invite's only write, and the second API route reachable on a client-controlled
// hostname.
//
// ‼️ READ src/app/api/hub/reviews/submit/route.ts FIRST. This route copies its security model
// deliberately and must keep copying it: `x-hub-host` is the ONLY statement of which client the
// write belongs to, the body's clientId is never trusted for that, and the header is set by
// middleware for external hosts and STRIPPED on the internal host so it cannot be forged. That
// is also what makes every preview and the public demo non-persisting for free.
//
// ‼️ IT MUST NOT READ x-forwarded-for, for exactly the reason the submit route must not.
//
// ‼️ THIS IS THE ONE PLACE IN THE REFERRAL ENGINE THAT STORES A PERSON'S CONTACT DETAILS, AND IT
// IS A DIFFERENT TABLE ON PURPOSE.
//
// review_tool_submissions was built with no column for a name, an email, a phone, an IP, a user
// agent or a session id, and its migration says the absence of the column is the enforcement. A
// friend's phone number is worse than the patient's would be: it belongs to somebody who is not
// using the tool, did not scan anything and has agreed to nothing. So it goes to
// referral_invites, which carries a nullable FK POINTING AT a submission. The direction matters:
// the submissions table gains no column, so "we hold nothing that identifies the customer who
// wrote a review" stays literally true of it.
//
// ‼️ AND WE DO NOT SEND ANYTHING. There is no SMS client, no provider SDK and no outbound call in
// this file. The patient's own messages app sends the message; this route records that she opened
// it. See src/lib/hub/referral-invite.ts for why that is the design and not a stopgap.
//
// NO MODEL IN THIS PATH either. Nothing here imports the Anthropic SDK and nothing may.

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveHost } from "@/lib/hub/resolve";
import {
  INVITE_CHANNELS,
  claimUrl,
  inviteExpiry,
  normaliseCode,
  readInviteMode,
  templateByKey,
  type InviteChannel,
} from "@/lib/hub/referral-invite";
import { oneEmail, referralEmailConfig } from "@/lib/hub/referral-config";
import { emailReferralCreated } from "@/lib/hub/referral-emails";
import { appUrl } from "@/lib/onboarding2/constants";

export const dynamic = "force-dynamic";

/** Generous, and per client per day. Same doctrine as the submit route: never an IP bucket. */
const DAILY_CAP = 500;

/** A name, a number and an offer line are all short. Guards the columns, not the person. */
const MAX_FIELD = 200;
const MAX_OFFER = 600;

function text(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The channel, or null.
 *
 * ‼️ NULL IS CORRECT FOR `internal` MODE AND NOT A MISSING VALUE. Nothing was sent, so there was
 * no channel, and defaulting it to "sms" would record a text message that never existed.
 */
function readChannel(raw: unknown): InviteChannel | null {
  const hit = INVITE_CHANNELS.find((c) => c.key === raw);
  return hit ? hit.key : null;
}

export async function POST(req: Request): Promise<NextResponse> {
  const hubHost = req.headers.get("x-hub-host");
  if (!hubHost) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let resolved;
  try {
    resolved = await resolveHost(hubHost);
  } catch {
    return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 });
  }
  if (resolved.status !== "ok" || resolved.kind !== "reviews") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const clientId = resolved.client.id;

  let body: {
    submissionId?: unknown;
    serviceLabel?: unknown;
    offerText?: unknown;
    templateKey?: unknown;
    code?: unknown;
    friendName?: unknown;
    friendContact?: unknown;
    referrerOfferText?: unknown;
    mode?: unknown;
    channel?: unknown;
    referrerEmail?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const code = normaliseCode(text(body.code, 32) ?? "");
  const offerText = text(body.offerText, MAX_OFFER);

  // ‼️ NO OFFER MEANS NO ROW. The offer snapshot is the whole point of the record: it is what the
  // clinic promised at the moment she was shown it, and a later edit to their deals must not be
  // able to change what a friend walks in holding. A row with an empty snapshot would be a code
  // nobody can honour and nobody can price.
  if (!code || !offerText) {
    return NextResponse.json({ error: "Nothing to store" }, { status: 400 });
  }

  const since = new Date(Date.now() - 86_400_000).toISOString();
  const { count } = await supabaseAdmin
    .from("referral_invites")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId)
    .gte("created_at", since);

  if ((count ?? 0) >= DAILY_CAP) {
    // 200, not 429, same as the submit route. She has already opened her messages app; there is
    // nothing for her to retry and nothing she did wrong. The cap protects the table.
    console.error(`[hub/reviews/invite] daily cap hit for client ${clientId}`);
    return NextResponse.json({ id: null });
  }

  const serviceLabel = text(body.serviceLabel, MAX_FIELD);
  const templateKey = templateByKey(text(body.templateKey, 40) ?? "").key;
  const mode = readInviteMode(body.mode);
  const referrerOfferText = text(body.referrerOfferText, MAX_OFFER);

  const { data, error } = await supabaseAdmin
    .from("referral_invites")
    .insert({
      client_id: clientId,
      // Nullable, and null is ordinary rather than a fault: the referral is settled BEFORE she
      // writes her review, so at this point there is usually no submission row yet.
      submission_id: text(body.submissionId, 64),
      service_label: serviceLabel,
      // BOTH deals, frozen. A later edit to the clinic's offers must not be able to change what
      // either person was promised: the friend has a text message quoting one of them.
      offer_snapshot: { serviceLabel, offerText, referrerOfferText, templateKey },
      code,
      friend_name: text(body.friendName, MAX_FIELD),
      friend_contact: text(body.friendContact, MAX_FIELD),
      // ‼️ HER OWN ADDRESS, OPTIONAL, AND IT IS THE ONLY WAY SHE IS EVER WRITTEN TO. It buys one
      // message, at the moment her friend claims, telling her the reward she has earned. No
      // address means no message and nothing chases her for one: see
      // src/lib/hub/referral-emails.ts for why that is the design rather than a gap.
      referrer_email: oneEmail(body.referrerEmail),
      mode,
      channel: readChannel(body.channel),
      // ‼️ ONLY SET WHEN A MESSAGE WAS ACTUALLY OPENED. In `internal` mode nothing was sent, so
      // this stays null rather than recording a delivery that did not happen. Even in `text`
      // mode it means "she got as far as her keyboard": we are not the sender and cannot know
      // whether she pressed send.
      sent_at: mode === "text" ? new Date().toISOString() : null,
      expires_at: inviteExpiry().toISOString(),
    })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[hub/reviews/invite] insert failed:", error.message);
    // Still 200. The message is already on her screen; a failed write is SRT losing the
    // attribution, which is not her problem to see.
    return NextResponse.json({ id: null });
  }

  // ── The clinic hears about it ───────────────────────────────────────────────
  //
  // ‼️ AFTER THE ROW, AND IT CANNOT FAIL THIS REQUEST. emailReferralCreated() returns off its own
  // catch, and the config gate means a clinic that has not switched this on sends nothing. This
  // is the lead in `internal` mode: nobody messaged the friend, and before this the row sat in a
  // table that nothing read.
  //
  // ‼️ AWAITED RATHER THAN LEFT HANGING, because an un-awaited promise in a serverless function
  // is dropped the moment the response is returned and the instance freezes. The cost is one
  // Graph call on her last step, which is the same shape /api/notify/funnel already accepts.
  await emailReferralCreated({
    clinicName: resolved.client.displayName,
    config: referralEmailConfig(resolved.client),
    friendName: text(body.friendName, MAX_FIELD),
    friendContact: text(body.friendContact, MAX_FIELD),
    serviceLabel,
    friendOfferText: offerText,
    referrerOfferText,
    code,
    mode,
    // Rebuilt here from the host the request arrived on rather than taken from the body: a URL
    // from a request body is a URL somebody else chose to put in an email we send.
    claimUrl: claimUrl(hubHost, code, appUrl()),
  });

  return NextResponse.json({ id: (data?.id as string | undefined) ?? null });
}
