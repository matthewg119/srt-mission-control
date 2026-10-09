// /cards/p's only write: one lead, one Slack card, one booking link back.
//
// ‼️ A SIBLING OF /api/cards AND NOT A MODE OF IT, for the reason that route is a sibling of
// /api/onboarding2: the two collect different things and the difference is the whole point. That
// one asks what the business is (website, revenue, which platform) because the clinic is about to
// be set up. This one asks what they SELL and what they want to GIVE AWAY, because the clinic has
// only just been shown the card and those two answers are the setup call's homework. Bolting a
// mode onto that route would have meant a conditional through its headline, its detail lines and
// its fork, and neither funnel would be readable afterwards.
//
// ‼️ PUBLIC BY DESIGN, LIKE EVERY OTHER FUNNEL DOOR, AND THAT IS WHY IT VALIDATES EVERYTHING.
// The client validates the same fields for their benefit; this copy is the one that protects the
// row, because a browser check is a courtesy and never a boundary.
//
// ‼️ IT GOES THROUGH ingestLead() AND NEVER WRITES `contacts` ITSELF. That is the one door every
// inbound lead in this app uses: it upserts the contact, carries the utm columns, and posts the
// #hot-leads card or threads under the one that already exists. See the note on the token below
// for the one case where that is not enough on its own.
//
// ‼️ NO MODEL IN THIS PATH. The walk in front of it is a scripted array, not a conversation.

import { NextRequest, NextResponse } from "next/server";

import { ingestLead, pageFromRequest } from "@/lib/lead-intake";
import { validEmail, validName } from "@/lib/medspa/validate";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { bookingPageUrl, calendlyEmbedUrl } from "@/lib/calendly";
import {
  CARDS_CALENDLY_KIND,
  CARD_PREVIEW_SOURCE,
  PREVIEW_CUSTOM,
  copyFor,
} from "@/config/card-preview";
import { designByKey } from "@/config/card-designs";
import { leadFromCardToken } from "@/lib/cards/preview-link";

export const dynamic = "force-dynamic";

const MAX = 200;

function clean(raw: unknown, max = MAX): string {
  return typeof raw === "string" ? raw.trim().slice(0, max) : "";
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

  // ‼️ THE THREE THAT ARE REALLY REQUIRED. A lead with no email is a lead nobody can send a card
  // to, which on this funnel is the whole promise. The best seller and the offer are legitimately
  // "not decided yet" and are never a reason to refuse somebody.
  if (!validName(firstName) || !validName(lastName)) {
    return NextResponse.json({ ok: false, error: "We need a first and last name." }, { status: 400 });
  }
  if (!validEmail(email)) {
    return NextResponse.json({ ok: false, error: "That does not look like an email address." }, { status: 400 });
  }

  // ‼️ FREE TEXT, NOT A LIST, AND NEITHER IS EVER CHECKED AGAINST ONE. "20% off" and "a free
  // consult" and "we have not decided" are all real answers from a clinic that has never run a
  // referral programme, and a validator here would turn the easiest question on the page into a
  // form error. They are printed on a Slack card for a person to read on a call.
  const topProduct = clean(body.topProduct, 120);
  const referralOffer = clean(body.referralOffer, 160);

  // Narrowed against the registry, never interpolated: this reaches a Slack line and, later, a
  // print job. An unknown key resolves to the first offered design rather than refusing.
  const design = designByKey(clean(body.design, 40));
  const copy = copyFor(design.copy);

  // ‼️ THEY PRESSED THE GREY BUTTON, WHICH IS A TWO HOUR PROMISE. Same shape as the free-website
  // flag on /cards: a boolean that nothing branches on except the loudness of the Slack card,
  // because the thing it triggers is a person opening a design tool.
  const customDesign = body.customDesign === true;

  // ‼️ THE TOKEN IS IDENTITY AND NOT AUTHORITY. It cannot create, grant or change anything; all
  // it does is tell us which conversation this page was opened from, so the answers can land in
  // the thread Matthew is already reading. An absent or forged one costs the lead nothing: the
  // walk still completes and ingestLead still opens a card for them.
  const fromLead = await leadFromCardToken(clean(body.token, 400));

  const leadName = [firstName, lastName].filter(Boolean).join(" ");
  const business = fromLead?.businessName || "";

  const headline =
    `CARD PREVIEW: ${leadName}` +
    (business ? ` · ${business}` : "") +
    (topProduct ? ` · best seller: ${topProduct}` : "") +
    ` · wants the "${design.label}" card` +
    (customDesign ? ` · ${PREVIEW_CUSTOM.flag}` : "") +
    " · ⚠️ OWES THEM THE PDF";

  const result = await ingestLead({
    firstName,
    lastName,
    email,
    // Carried from the lead the link was minted for, never asked for again. They have already
    // told us their company once, in the email thread this link came out of.
    businessName: business || undefined,
    website: fromLead?.website || undefined,
    city: fromLead?.city || undefined,
    source: CARD_PREVIEW_SOURCE,
    sourcePage: pageFromRequest(req, "/cards/p"),
    noteTitle: "AI Referral Engine card preview",
    headline,
    detailLines: [
      // Loud and first, because it is the only line with a clock on it: they were told the card
      // is coming and nothing in this lane renders or sends one yet.
      "⚠️ THEY ARE OWED A PDF CARD BY EMAIL. Nothing was sent automatically.",
      customDesign
        ? `${PREVIEW_CUSTOM.flag} They did not like either card and were told a few options are coming within 2 hours.`
        : "",
      `Card design they picked: ${design.label}`,
      // ‼️ WHICH WORDS, NOT JUST WHICH PALETTE, AND THE DISTINCTION MATTERS TO WHOEVER MAKES
      // THE PDF. review-card.ts renders the NEUTRAL copy only, so a clinic that chose the offer
      // card cannot be sent a file generated by that path without the card saying something
      // different from the one they approved. See CARD_COPY_SETS.
      copy.carriesOffer
        ? `‼️ That card LEADS WITH AN OFFER ("${copy.promise}") and says "${copy.scanLine}" under the code. ` +
          "The generator cannot produce it; it has to be made by hand, with their real figure in " +
          "place of the sample."
        : "Standard card wording, the same as the printed one.",
      topProduct ? `Best seller: ${topProduct}` : "Best seller: not answered",
      referralOffer
        ? `Offer for a referred friend: ${referralOffer}`
        : "Offer for a referred friend: not answered",
      // Said plainly, because it is what the next fifteen minutes are for and it is easy to
      // forget that these two answers are already a service offer in all but the row.
      "Those two are the setup call's homework: they become the service label and the friend's " +
        "offer on client_service_offers.",
      "They have seen the card and walked the patient side of it.",
    ],
  });

  if (!result.contactId) {
    console.error("[api/cards/preview] no contact row created for", email);
    return NextResponse.json(
      { ok: false, error: "That did not go through. Please reply to our email instead." },
      { status: 503 }
    );
  }

  // ‼️ THE ONE CASE ingestLead CANNOT SEE. findContact matches on email and phone, so a clinic
  // that opens the link and types a DIFFERENT address from the one we emailed becomes a second
  // contact with a second thread, and the conversation Matthew has been having with them goes
  // quiet with no explanation in it. The token knows better, so when the two disagree the original
  // thread is told where its lead went. Best effort, and never fatal: the lead is already saved.
  if (fromLead && fromLead.contactId !== result.contactId) {
    await crossPost(fromLead.contactId, leadName, email).catch(() => {});
  }

  // ‼️ SHAPED FOR AN INLINE EMBED, NOT A LINK OUT, and null is a fine answer. With Calendly
  // unconfigured the walk still finishes and the closing line still makes sense; the client
  // renders a calendar only when there is a URL. See calendlyEmbedUrl for why embed_type matters.
  const booking = calendlyEmbedUrl(bookingPageUrl(CARDS_CALENDLY_KIND), { name: leadName, email });

  return NextResponse.json({ ok: true, bookingUrl: booking, contactId: result.contactId });
}

/** A pointer in the original lead's thread, when the card preview opened a different contact. */
async function crossPost(contactId: string, leadName: string, email: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("contacts")
    .select("slack_thread_ts, slack_channel")
    .eq("id", contactId)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, unknown>;
  const threadTs = (row.slack_thread_ts as string | null) ?? null;
  const channel = (row.slack_channel as string | null) || process.env.SLACK_HOT_LEADS_CHANNEL || "";
  if (!threadTs || !channel) return;

  await slack.postThreadReply(
    channel,
    threadTs,
    `:card_index: They opened the card preview from this thread and finished it as *${leadName}* ` +
      `(${email}), which is a different address from the one on this contact. The answers are on ` +
      `that lead's own card.`
  );
}
