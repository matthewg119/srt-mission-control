// The card-led onboarding's only write: one lead, one Slack card, one booking link back.
//
// ‼️ PUBLIC BY DESIGN, LIKE EVERY OTHER FUNNEL DOOR, AND THAT IS WHY IT VALIDATES EVERYTHING.
// There is no session here and there must not be: a clinic reaches this from an email we sent.
// The client component validates the same fields for her benefit; this copy is the one that
// protects the row, because a browser check is a courtesy and never a boundary.
//
// ‼️ IT GOES THROUGH ingestLead() AND NOT TO `contacts` DIRECTLY. That is the one door every
// inbound lead in this app uses: it upserts the contact, normalises the phone, carries the utm
// columns, posts the Slack card and opens the per-lead thread. Writing the row here would mean a
// lead that exists in the database and nowhere Matthew looks, which is the thing he asked for
// ("make sure i get notified when we get the hot lead").
//
// ‼️ NO MODEL IN THIS PATH. The walk in front of it is a scripted array, not a conversation.

import { NextRequest, NextResponse } from "next/server";

import { ingestLead, pageFromRequest } from "@/lib/lead-intake";
import { validEmail, validName } from "@/lib/medspa/validate";
import { bookingPageUrl, calendlyEmbedUrl } from "@/lib/calendly";
import { CARDS_SOURCE, NO_WEBSITE, REVENUE_BANDS } from "@/config/onboarding-cards";
import { REVIEW_PLATFORMS } from "@/lib/hub/review-destinations";

export const dynamic = "force-dynamic";

const MAX = 200;

function clean(raw: unknown, max = MAX): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
}

/** One of a fixed list, or empty. The value reaches a Slack card and a column. */
function oneOf(raw: unknown, allowed: readonly string[]): string {
  const value = clean(raw);
  return allowed.includes(value) ? value : "";
}

/**
 * A website as typed, or empty. Identical rule to the client's cleanWebsite().
 *
 * ‼️ NO FETCH. Whether the site resolves is the crawler's question; a clinic whose host is down
 * for an hour must still be able to finish onboarding.
 */
function website(raw: unknown): string {
  const value = clean(raw, 253).replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  if (!value) return "";
  return /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/i.test(value) ? value : "";
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Bad request." }, { status: 400 });
  }

  const firstName = clean(body.firstName, 80);
  const lastName = clean(body.lastName, 80);
  const email = clean(body.email, 160).toLowerCase();

  // ‼️ THE THREE THAT ARE REALLY REQUIRED, AND NOTHING ELSE IS. A lead with no email is a lead
  // nobody can follow up, which is the only state worth refusing. Revenue, website and the
  // platform are all legitimately unknown.
  if (!validName(firstName) || !validName(lastName)) {
    return NextResponse.json({ ok: false, error: "We need a first and last name." }, { status: 400 });
  }
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, error: "That does not look like an email address." }, { status: 400 });
  }

  const rawSite = clean(body.website, 253);
  // ‼️ THE SENTINEL IS A REAL ANSWER AND SURVIVES AS ONE. "They told us they have no website"
  // earns the free-site line on the card; "we never asked" is a gap. An empty string after this
  // point means the latter.
  const saidNoWebsite = rawSite === NO_WEBSITE;
  const site = saidNoWebsite ? "" : website(rawSite);

  const revenue = oneOf(body.revenue, REVENUE_BANDS);
  const platform = oneOf(
    body.platform,
    REVIEW_PLATFORMS.map((p) => p.name)
  );
  const finish = oneOf(body.finish, ["call", "self"]);
  const daypart = oneOf(body.daypart, ["Mornings", "Afternoons"]);
  const freeWebsite = body.freeWebsite === true;

  const leadName = [firstName, lastName].filter(Boolean).join(" ");

  // ‼️ THE HEADLINE LEADS WITH THE BRANCH, because that is the only thing that changes what
  // Matthew does next: a booked call needs nothing from him, a self-serve clinic needs the setup
  // sheet emailing. The free-website ask is loud for the same reason the dropped-contact warning
  // is loud on the Index funnel: somebody has to act on it by hand, within 4 hours.
  const headline =
    (finish === "call" ? "CARDS, booking a call: " : "CARDS, self-serve: ") +
    `${leadName} · ${site || (saidNoWebsite ? "NO WEBSITE" : "?")} · ${revenue || "revenue ?"}` +
    (daypart ? ` · prefers ${daypart.toLowerCase()}` : "") +
    (freeWebsite ? " · ⚠️ WANTS THE FREE WEBSITE (4h)" : "") +
    (platform ? ` · reviews to ${platform}` : "");

  const result = await ingestLead({
    firstName,
    lastName,
    email,
    website: site,
    source: CARDS_SOURCE,
    sourcePage: pageFromRequest(req, `/${CARDS_SOURCE}`),
    noteTitle: "AI Referral Engine cards",
    headline,
    detailLines: [
      `Finishing by: ${finish === "call" ? "the setup call" : "setting it up themselves"}`,
      revenue ? `Yearly revenue: ${revenue}` : "",
      // A PREFERENCE and not a booking. The calendar is what books anybody; this is what they
      // said suits them, which is worth knowing if they never pick a slot.
      daypart ? `Prefers ${daypart.toLowerCase()} for the call` : "",
      saidNoWebsite ? "Website: they do not have one" : site ? `Website: ${site}` : "",
      freeWebsite ? "Free website: YES, options owed within 4 hours" : "",
      platform ? `Reviews should go to: ${platform}` : "",
      // Said plainly on the card, because the absence of it is what somebody would otherwise
      // have to infer from the branch.
      finish === "call"
        ? "Platform and offers are being decided on the call, not pre-set."
        : "No call booked. They still need the setup sheet and their referral offers.",
      "Read the compliance note: the BAA is owed only if automated texting is switched on.",
    ],
  });

  // ‼️ ingestLead RETURNS IDS, NOT AN OUTCOME, AND IT DOES NOT THROW. It swallows its own
  // failures on purpose: a Slack outage must never cost a lead. So the only thing worth checking
  // is whether a contact row exists, because that is the lead. A missing thread_ts means the card
  // did not post, which is Matthew's problem to notice and not a reason to tell the clinic their
  // details did not save.
  if (!result.contactId) {
    console.error("[api/cards] no contact row created for", email);
    return NextResponse.json(
      { ok: false, error: "That did not go through. Please reply to our email instead." },
      { status: 503 }
    );
  }
  if (!result.threadTs) {
    console.error(`[api/cards] lead saved but no Slack card posted for ${email}`);
  }

  // ‼️ ONLY FOR THE CALL BRANCH, AND null IS A FINE ANSWER. With Calendly unconfigured the walk
  // still completes and the closing line still makes sense; the client renders the calendar only
  // when there is a URL. A funnel that dead-ends on a missing env var would be worse than one
  // that quietly tells Matthew to send a link.
  //
  // ‼️ SHAPED FOR AN INLINE EMBED, NOT A LINK OUT. Matthew, 2026-10-05: onboarding2 "was adding a
  // widget to the thing making it better because they had to book the call inside of the UI which
  // is what i want". A clinic that has just answered six questions should not be handed off to
  // another tab to finish; every hop is somewhere to lose them. Their name and email are already
  // ours, so the calendar opens with both filled in.
  const booking =
    finish === "call"
      ? calendlyEmbedUrl(bookingPageUrl("install"), { name: leadName, email })
      : null;

  return NextResponse.json({ ok: true, bookingUrl: booking });
}
