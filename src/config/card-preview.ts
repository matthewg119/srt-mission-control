// /cards/p — the card a lead is SHOWN, before they are asked for anything.
//
// Matthew, 2026-10-09, after Volta Vitality replied "Yes, I would be interested" to the QR card
// email: "i want to be able to reply to the hot leads channel in slack and actually generate the
// cards in a website ... so they just click the link, see the card and if they want it they can
// click Get your Free Ai Referral engine ... i need a full on experience where they see the image
// with like a picture of someone scanning a qr code and says click or scan here, and it takes to
// the actual website where we ask for the review."
//
// ‼️ IT IS A THIRD DOOR ON THE SAME FUNNEL, NOT A THIRD FUNNEL. /onboarding2 sells the three
// offers. /cards is the back half of the outbound sequence, reached from an email that already
// said yes. This is reached from a HUMAN REPLY in a #hot-leads thread, which is one step earlier
// still: they said "yes I am interested" and have seen nothing. So the first thing this page does
// is show them the thing, and the ask comes after.
//
// WHAT THE TWO SCREENS ARE, AND WHY THERE ARE TWO
// "it needs to be like a 2 step or 2 screens, this is what your patients will scan, this is what
// they will see inside once they scan, but they need to click it to go inside". The order is the
// argument: a clinic owner looking at a QR card has no idea what is behind it, and the single most
// common objection to a review card is that it is one more thing at the desk that does nothing.
// Screen one is the object. Screen two is the proof, and it is a LIVE page rather than a picture
// of one, because a screenshot of a walkthrough is exactly what every competitor sends.
//
// ‼️ THE CARD'S DEFAULT WORDS ARE NOT MINE. src/lib/clients/artifacts/review-card.ts owns them
// and review-card-copy.ts is the one copy both it and this page read, so the neutral card on
// screen and the card that arrives in the post cannot drift. What a patient reads there carries
// no sentiment gate, no stars, no staff names and no incentive, and the question count is DERIVED
// from CARD_QUESTIONS because it is printed on card stock.
//
// ‼️ AND THERE IS NOW A SECOND SET OF WORDS, WHICH IS A REAL CHANGE. CARD_COPY_SETS.offer puts a
// deal on the card at Matthew's request on 2026-10-09. Read that constant's header before touching
// it: it reverses a rule he set himself, it names what the exposure is, and it lists the four
// parts of the old rule that are kept.
//
// ‼️ NOTHING HERE QUOTES A PRICE OR NAMES A PLAN, for the same reason /cards does not: the email
// that got them here offered a free batch of cards, and a price appearing on the page that shows
// them the cards would make that email a bait.

import { guard } from "@/lib/copy-guard";
import { REVIEW_CARD_COPY } from "@/lib/hub/review-card-copy";
import type { CardCopyKey } from "./card-designs";

/** Where the lead lands, and the value `contacts.source` carries. */
export const CARD_PREVIEW_SOURCE = "card_preview";

/**
 * The clinic the preview wears when nobody has been named.
 *
 * ‼️ A PLACEHOLDER AND NOT A FAKE CLINIC. /cards/p with no token is the link Matthew records his
 * onboarding video against, so it has to look finished; it must not look like somebody else's
 * business, because a recorded walkthrough of "Northlight Skin Studio" is a walkthrough of a
 * clinic that does not exist being passed off as a case study.
 */
export const PREVIEW_FALLBACK_NAME = guard("preview fallback name", "Your Clinic");

/**
 * The sample offer figure, and the ONLY one in the whole feature.
 *
 * ‼️ A NUMBER WE INVENTED, ON PURPOSE, IN EXACTLY ONE PLACE. review-script.ts's header is
 * blunt that "a figure typed here would be a price we invented turning up in a message a patient
 * sends to her friend", and nothing in src/lib/ carries one. This is not that: it is a MOCKUP
 * figure on a sales preview, it reaches no patient, no message and no printed card, and Matthew
 * chose it ("Scan for 80% off [offer]"). Keeping it as one named constant is what stops it
 * becoming three slightly different numbers across the artwork, and the probe asserts it is the
 * only one.
 *
 * ‼️ THE REAL CLINIC'S FIGURE IS NOT KNOWN AT THIS POINT IN THE CONVERSATION. It is the last
 * question in the chat below, which is AFTER they have looked at the card. Whoever builds the PDF
 * substitutes their answer; the Slack card carries both.
 */
export const PREVIEW_OFFER_SAMPLE = guard("preview offer sample", "80% off your first visit");

export interface CardCopySet {
  key: CardCopyKey;
  /** The line under the clinic's name, in the accent. */
  promise: string;
  /** The line under the code. */
  scanLine: string;
  /** Whether this set puts a deal on the card. Read by the Slack card and by the probe. */
  carriesOffer: boolean;
}

/**
 * Every set of words a card may carry. Two.
 *
 * ‼️ `neutral` IS NOT TYPED HERE. It is read straight out of review-card-copy.ts, which is
 * also what the printer reads, so the default card on the preview and the card that arrives in the
 * post are the same object down to the byte. That was the whole point of extracting that module
 * and it is unchanged.
 *
 * ‼️ `offer` IS A DELIBERATE REVERSAL OF A RULE MATTHEW HIMSELF SET, AND IT IS THE ONE THING
 * IN THIS FEATURE WORTH ARGUING ABOUT. The in-clinic referral lane's position was: the incentive
 * ban was NOT reversed, "the offer is consideration for a REFERRAL: it goes to the friend, before
 * she writes a word, conditional on nothing", and a probe failed the build if any copy tied an
 * offer to leaving a review. This card puts a deal and an invitation to rate the visit on the same
 * piece of stock, handed to the patient, and the page behind the code asks for a review before it
 * asks for a referral. That is consideration attached to a flow that produces reviews, which is
 * what FTC 16 CFR Part 465 and Google's own policy are about.
 *
 * His call, 2026-10-09, asked for in those words. What is kept of the old rule, because it costs
 * nothing and is the part that actually bites:
 *   - the printed-card copy module is untouched and still carries no offer at all
 *   - neither line here contains the word for what she writes, so the card never says the deal is
 *     for a review; the probe asserts that
 *   - the figure is one named constant, not prose sprinkled through the artwork
 *   - `carriesOffer` is on the Slack card, so every lead that picked this one is visible
 *
 * ‼️ AND review-card.ts CANNOT PRINT THIS YET. It renders the neutral copy only, so a clinic
 * choosing `offer` must not be sent a card generated by that path. Nothing generates a PDF in this
 * lane today (a person does it), and the Slack card names the variant for exactly that reason.
 */
export const CARD_COPY_SETS: Record<CardCopyKey, CardCopySet> = {
  neutral: {
    key: "neutral",
    promise: REVIEW_CARD_COPY.promise,
    scanLine: REVIEW_CARD_COPY.scanLine,
    carriesOffer: false,
  },
  offer: {
    key: "offer",
    promise: guard("card offer promise", `Scan for ${PREVIEW_OFFER_SAMPLE}`),
    // ‼️ "Rate your experience" AND NOT A ROW OF STARS. review-card.ts refuses to print a
    // rating because a star ticked on paper sorts a patient before she ever reaches the tool,
    // which is the exact gating this system exists to refuse. A line naming what the page does
    // next is not that: nobody marks anything on the card, and every patient gets the same one.
    scanLine: guard("card offer scan", "Rate your experience"),
    carriesOffer: true,
  },
};

/** The copy a design names, never undefined. */
export function copyFor(key: CardCopyKey): CardCopySet {
  return CARD_COPY_SETS[key] ?? CARD_COPY_SETS.neutral;
}

// ── The two screens ─────────────────────────────────────────────────────────

/**
 * Screen one. The object.
 *
 * ‼️ THE CALL TO ACTION ON THIS SCREEN IS NOT THE FUNNEL'S CALL TO ACTION. It moves to screen
 * two and nothing is asked for yet. A page that shows a card and immediately asks for an email is
 * a page that was never about the card.
 */
export const PREVIEW_SCAN = {
  eyebrow: guard("preview scan eyebrow", "Step 1 of 2"),
  title: guard("preview scan title", "This is what your patients scan"),
  // His own line, 2026-10-09, cut down from a sentence that was explaining three things at once.
  lede: guard("preview scan lede", "It sits at the front desk, same card for every patient."),
  /**
   * On the card itself, over the artwork.
   *
   * ‼️ "Click or scan here" IS HIS WORDING AND BOTH HALVES ARE TRUE ON THIS PAGE. The QR in the
   * preview resolves to the same walkthrough the button opens, so a clinic owner holding their
   * phone over their laptop gets the real thing. See cardQrTarget().
   */
  tap: guard("preview scan tap", "Click or scan here"),
  /**
   * ‼️ SAID ON THE SCREEN, BECAUSE THE QR ON A REAL CARD POINTS SOMEWHERE ELSE. The preview's
   * code opens our walkthrough; a printed card's code opens the clinic's own reviews page on their
   * own domain. Leaving that unsaid is how somebody prints a thousand cards pointing at a demo.
   */
  // ‼️ CUT TO ONE CLAUSE ON 2026-10-09. It read "On your printed cards this code points at your
  // own page, on your own domain", which spent two clauses defending a distinction nobody had
  // questioned yet. The point it has to make is that the code becomes THEIRS, and that is the
  // whole sentence.
  qrNote: guard("preview scan qr note", "This code will point at your own page."),
  cta: guard("preview scan cta", "Show me what they see"),
  /**
   * The way past screen two, beside the line about their own domain.
   *
   * ‼️ IT IS NOT A SECOND CALL TO ACTION, IT IS AN EXIT FROM A DEMO SOMEBODY HAS ALREADY
   * UNDERSTOOD. Matthew, 2026-10-09: "a small button for the smart people to skip step 2". The
   * walkthrough exists to answer "what is actually behind the code", and a clinic that already
   * knows is being made to sit through an answer they did not ask for. Grey and small for the
   * same reason the custom-design door is: the green button is still the path.
   *
   * ‼️ AND IT LANDS ON THE SAME FIRST QUESTION, with no opener of its own. Taking a shortcut
   * is not a different conversation, and a bubble acknowledging the skip would be the funnel
   * talking about itself.
   */
  skipToChat: guard("preview scan skip", "Skip the preview"),
} as const;

/**
 * Screen two. The proof.
 *
 * ‼️ "but they need to click it to go inside" IS A REQUIREMENT AND NOT A DETAIL. The frame shows
 * the real page and does not start interactive: a clinic owner who scrolls past an embedded page
 * has not understood that it is live. One deliberate tap is what turns a picture into a product.
 */
export const PREVIEW_INSIDE = {
  eyebrow: guard("preview inside eyebrow", "Step 2 of 2"),
  title: guard("preview inside title", "This is what they see inside"),
  lede: guard(
    "preview inside lede",
    "Their own phone, at home, in their own words. We never write the review and nothing is posted unless they post it."
  ),
  /** Over the frame, before the first tap. */
  tap: guard("preview inside tap", "Tap to try it yourself"),
  /** Once they have tapped. It is live from here, so the label stops claiming otherwise. */
  live: guard("preview inside live", "Live. Walk it like a patient would."),
  // ‼️ IT NAMES THE OBJECT NOW, NOT THE PRODUCT. "Get my free AI Referral Engine" asked a clinic
  // to want a thing they had no word for; "Download my custom QR card" is the card they are
  // looking at, with their name on it, and tapping it genuinely produces one. Matthew, 2026-10-09.
  cta: guard("preview inside cta", "Download my custom QR card"),
  /**
   * The grey one, where "Open it full screen" used to be.
   *
   * ‼️ IT GOES FORWARD, NOT SIDEWAYS, AND THAT IS THE WHOLE POINT OF IT. Matthew: "a 'dont like
   * it? custom design' mini button ... it takes them further down the funnel but it says, we will
   * email you a few options in the next 2 hours." A clinic that does not like either card is not a
   * lost lead, it is a lead with an opinion, and the old link sent them to another tab instead of
   * into the conversation.
   */
  custom: guard("preview inside custom", "Not quite right? Custom design"),
  foot: guard("preview inside foot", "Free. About two minutes."),
} as const;

// ── The chat ────────────────────────────────────────────────────────────────

/**
 * One step of the walk. The same five shapes /cards uses, minus the ones this door has no use
 * for: there is no consent step here (nothing is being set up yet) and no fork (there is one way
 * to finish, and it is the call).
 */
export type PreviewStep =
  | { kind: "say"; id: string; text: string }
  | {
      kind: "ask";
      id: string;
      key: PreviewKey;
      prompt: string;
      placeholder: string;
      validate: "name" | "email" | "free";
      /**
       * The escape hatch, when not answering is itself an answer.
       *
       * ‼️ IT STORES A REAL SENTENCE RATHER THAN A SENTINEL, and that is the difference from
       * NO_WEBSITE on /cards. That value is BRANCHED ON (it earns the free-site offer), so it has
       * to be unmistakable in code. This one is only ever printed on a Slack card and read by a
       * person on a call, so the honest thing to store is the thing they would have said. What it
       * must not be is an empty string: "they have not decided" and "they never got asked" are
       * different facts and the card says which.
       */
      skip?: { label: string; value: string };
    }
  | { kind: "chips"; id: string; key: PreviewKey; prompt: string; options: readonly string[] };

export type PreviewKey =
  | "email"
  | "firstName"
  | "lastName"
  | "topProduct"
  | "referralOffer"
  | "daypart"
  | "callDay";

/**
 * The questions, in Matthew's order.
 *
 * ‼️ THE EMAIL IS FIRST AND THAT IS HIS ORDER, NOT THE HOUSE ONE. /cards asks first name, last
 * name, then email, because that funnel opens a conversation. This one opens on a button that says
 * email me the card, so the first question is the address the card goes to. Asking somebody their
 * first name after they tapped "email me this" is the form arriving before the reason for it.
 *
 * ‼️ THE LAST TWO ARE THE SETUP CALL'S HOMEWORK AND THAT IS WHY THEY ARE HERE. "what is the most
 * sold product and the offer he wants to give discount to referrals" maps onto exactly one row of
 * client_service_offers: service_label and offer_text. Collected now, the setup call starts with
 * their own best seller already on the card instead of fifteen minutes of "what do you sell".
 *
 * ‼️ AND THE OFFER IS A FREE-TEXT ANSWER, NEVER A LIST OF PERCENTAGES. Nothing in src/ carries a
 * figure for this feature, deliberately: review-script.ts's header calls a number in our bundle
 * "a discount we invented turning up in a message a patient sends to her friend". The clinic says
 * what their deal is or says they have not decided.
 */
export const PREVIEW_SCRIPT: readonly PreviewStep[] = [
  {
    kind: "ask",
    id: "p_email",
    key: "email",
    prompt: guard("preview q email", "Where should we send it? Your best email."),
    placeholder: guard("preview q email hint", "you@yourclinic.com"),
    validate: "email",
  },
  {
    kind: "ask",
    id: "p_first",
    key: "firstName",
    prompt: guard("preview q first", "Got it. What is your first name?"),
    placeholder: guard("preview q first hint", "First name"),
    validate: "name",
  },
  {
    kind: "ask",
    id: "p_last",
    key: "lastName",
    prompt: guard("preview q last", "And your last name?"),
    placeholder: guard("preview q last hint", "Last name"),
    validate: "name",
  },
  {
    kind: "ask",
    id: "p_product",
    key: "topProduct",
    prompt: guard(
      "preview q product",
      "Last two. What is your best seller, the one treatment or product you do most?"
    ),
    placeholder: guard("preview q product hint", "Botox, facials, lip filler..."),
    validate: "free",
  },
  {
    kind: "ask",
    id: "p_offer",
    key: "referralOffer",
    // ‼️ IT ASKS WHAT THE FRIEND GETS, NOT WHAT THE PATIENT GETS, and the two are different
    // things on purpose. The referral deal goes to the person being referred, before they have
    // written a word, conditional on nothing. That is what keeps this a referral programme rather
    // than a paid review, and the whole lane is built on the distinction.
    prompt: guard(
      "preview q offer",
      "And what do you want a referred friend to get on their first visit?"
    ),
    placeholder: guard("preview q offer hint", "20% off, a free consult, not decided yet..."),
    validate: "free",
    // ‼️ MOST CLINICS BEING SHOWN THIS HAVE NEVER RUN A REFERRAL PROGRAMME, so "I have not worked
    // that out" is the single most likely honest answer and a text box is the wrong shape for it.
    // Matthew asked for the button after watching the walk. It is on this question only: a clinic
    // that does not know its own best seller is not a state worth designing for.
    skip: {
      label: guard("preview q offer skip", "Not sure yet"),
      value: guard("preview q offer skip value", "Not decided yet"),
    },
  },
];

/**
 * What is said once the five answers are in.
 *
 * ‼️ "shortly" IS HIS WORD AND IT IS THE HONEST ONE. Nothing in this lane renders a PDF yet: the
 * answers land on the lead's #hot-leads thread and a person sends the card. A line promising an
 * instant email would be the one lie this page could tell that somebody sits and waits for.
 */
export const PREVIEW_CLOSE = {
  /**
   * ‼️ IT NO LONGER PROMISES ANYTHING, BECAUSE THE CARD ARRIVES A BEAT LATER. This said "we will
   * send the email with your free PDF card shortly" for as long as nothing generated one. It does
   * now: PREVIEW_DOWNLOAD.ready follows this bubble with a button that produces the real card, and
   * the confirmation email carries the same bytes. Leaving "shortly" in would be the funnel
   * promising later what it is about to hand over.
   */
  sent: guard("preview close sent", "Perfect, that is everything we needed."),
  /** The pivot into the booking, as its own bubble so it reads as a second thought. */
  ask: guard(
    "preview close ask",
    "One more thing. When do you have 15 minutes to share your offer with us, and set up the internal streams for the new patients (emails, text messages, etc)?"
  ),
} as const;

/**
 * Mornings or afternoons, then a day, then two real times.
 *
 * ‼️ HIS ORDER IS DAYPART FIRST AND /cards DOES IT THE OTHER WAY ROUND. "offer mornings or
 * afternoons then give it 2 days or other option". Not a correction of that funnel: a clinic
 * answering an email on a Tuesday afternoon knows which half of a day it can spare before it knows
 * which day, and /cards asks somebody who has already committed to a setup call. Both end at the
 * same place, which is two real openings off Calendly's own availability.
 */
/**
 * What the custom-design door says before it asks anything.
 *
 * ‼️ TWO HOURS IS A PROMISE A PERSON HAS TO KEEP, and it is shorter than the four the free-website
 * offer makes on /cards. It earns the same treatment: the Slack card shouts it, because nothing in
 * this lane designs or sends anything by itself.
 */
export const PREVIEW_CUSTOM = {
  opener: guard(
    "preview custom opener",
    "No problem. We will email you a few options in the next 2 hours."
  ),
  /** On the Slack card, so the clock is visible in the channel and not only on their screen. */
  flag: "⚠️ WANTS A CUSTOM DESIGN (2h)",
} as const;

export const PREVIEW_DAYPART = {
  id: "p_daypart",
  key: "daypart" as const,
  prompt: guard("preview daypart", "Mornings or afternoons?"),
  options: [guard("preview daypart am", "Mornings"), guard("preview daypart pm", "Afternoons")],
} as const;

/**
 * Two days, and a way out of them.
 *
 * ‼️ TWO AND NOT THREE, AND THE DATES ARE COMPUTED AT RENDER TIME. "give it 2 days or other
 * option for buttons if they click other show calendly menu". The labels are three real dates in
 * the VISITOR's zone, so "Today" means their today; a static list here is three labels that drift
 * from the calendar behind them inside a day.
 */
export const PREVIEW_DAY = {
  id: "p_day",
  key: "callDay" as const,
  prompt: guard("preview day", "Which day suits you?"),
  /** The escape. Only this reveals the whole calendar, which is the point of offering two. */
  other: guard("preview day other", "Another day"),
  /** How many day chips are offered before the escape. */
  count: 2,
} as const;

/** The two openings, and what is said around them. The same shape /cards settled on. */
export const PREVIEW_SLOTS = {
  prompt: guard("preview slots", "Here are the two closest openings. Which works?"),
  another: guard("preview slots another", "I want another time"),
  /** Availability unreadable, or that half-day full. The calendar is the answer and says so. */
  none: guard(
    "preview slots none",
    "Nothing is open in that window. Here is the full calendar instead."
  ),
  booking: guard("preview slots booking", "Good. Confirm it here and you are done."),
  booked: guard("preview slots booked", "You are booked. We will see you then."),
} as const;

/**
 * The download, once the questions are answered.
 *
 * ‼️ THE CARD IS REAL AND IT ARRIVES ON THE SPOT. Until now this funnel's whole promise was a
 * PDF "shortly", made by a person, and a clinic had nothing in their hand at the end of it.
 * /api/cards/pdf/<token> renders their name onto the same card the delivery board prints, with a
 * code that opens their own page, so the thing they were shown is the thing they get.
 */
export const PREVIEW_DOWNLOAD = {
  /** The button, under the closing line. */
  cta: guard("preview download cta", "Download my card"),
  /** Said once, as its own bubble, before the booking ask. */
  ready: guard(
    "preview download ready",
    "Your card is ready. Download it now, and we will email you a copy too."
  ),
  /** Under the button, in the smallest type: what they are actually getting. */
  foot: guard(
    "preview download foot",
    "Print double sided on card stock. The code opens your own page."
  ),
} as const;

/** The step ids, for the probe. A walk whose ids drift is a walk whose analytics drift. */
export const PREVIEW_IDS: readonly string[] = [
  ...PREVIEW_SCRIPT.map((s) => s.id),
  PREVIEW_DAYPART.id,
  PREVIEW_DAY.id,
];

/**
 * Which Calendly event type this door books.
 *
 * ‼️ THE SAME ONE /cards BOOKS, IMPORTED RATHER THAN RETYPED. Two doors naming different event
 * types is two calendars, and the failure is silent: people get offered times off one and booked
 * onto the other. CARDS_CALENDLY_KIND's own header records the six weeks that fault survived.
 */
export { CARDS_CALENDLY_KIND } from "./onboarding-cards";
