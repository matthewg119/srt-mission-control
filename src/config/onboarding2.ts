// Everything a visitor to /onboarding2 reads that is NOT the contract.
//
// The contract lives in src/config/onboarding2-agreement.ts and is frozen into a snapshot per
// signing. This file is ordinary marketing and product copy, edited freely, read live.
//
// ‼️ ISOMORPHIC. onboarding2-client.tsx imports it, so no `node:` builtin may ever appear here.
// Same boundary src/lib/chatgpt-ads/params.ts warns about in its own header.
//
// Every visitor-facing string is wrapped in guard(), which throws at module evaluation on an em
// dash, an en dash or "--", failing `next build` rather than shipping.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THE RULE THIS WHOLE FILE IS ORGANISED AROUND (Matthew, 2026-09-03):
// IF WE HAVE ALREADY COLLECTED A PIECE OF DATA, NOTHING LATER IN THE FUNNEL MAY ASK FOR IT AGAIN.
//
// Screen one collects the whole identity: full name, company, title, website, email, phone. The
// signature screen therefore collects a signature, a date and a business address, and shows the
// rest back read-only. The assistant asks a handful of questions, none of which is a field anybody has
// already typed, and it never asks a clarifying follow-up.
// ─────────────────────────────────────────────────────────────────────────────

import { guard } from "@/lib/copy-guard";
import {
  GUARANTEE_COUNT,
  GUARANTEE_WINDOW,
  PRICE_CONCIERGE,
  PRICE_MONTH,
  PRICE_YEAR_AMOUNT,
  PRICE_YEAR_EQUIV,
  REFUND_AMOUNT,
} from "@/config/pitch";
import { REVIEW_PLATFORMS } from "@/lib/hub/review-destinations";

// ─────────────────────────────────────────────────────────────────────────────
// Screen 1. THE WHOLE IDENTITY, IN ONE PLACE, ONCE.
// ─────────────────────────────────────────────────────────────────────────────

export const LANDING = {
  eyebrow: guard("l eyebrow", "SRT Agency"),
  heading: guard("l heading", "Let's get you started."),
  promise: guard(
    "l promise",
    "You don't pay us a dollar until ChatGPT sends you 5 new qualified appointments."
  ),
  body: guard(
    "l body",
    "First we need a few details for the agreement. Then you read and sign it, which takes about four minutes. You initial each page as you go and sign at the end."
  ),

  // ‼️ SIX FIELDS, ALL REQUIRED, AND EVERY ONE OF THEM IS HERE BECAUSE OF SOMETHING DOWNSTREAM.
  //
  //   name     -> print_name on the contract, and clients.dba_name. clients.legal_name is NOT
  //               NULL and startPilot falls back to the EMAIL ADDRESS with no name, which puts
  //               an email where a company name goes on every board in Mission Control.
  //   company  -> business_legal_name, the party bound by the agreement.
  //   title    -> the authority to bind it. A contract signed by "the front desk" is a problem
  //               nobody notices until it matters.
  //   website  -> clients.domain, via normalizeTarget. hostsFor(), seedDnsRecords() and the whole
  //               hub lane are built from that column, so eight delivery steps refuse without it.
  //               This used to be qualifying question 1, asked after signature.
  //   email    -> where the executed contract goes, and the key the lead row is written under.
  //   phone    -> E.164 for the CRM plus the raw typed string for the record.
  nameLabel: guard("l name label", "Your full name"),
  nameHelp: guard("l name help", "The name that goes on the agreement, and your initials."),
  companyLabel: guard("l company label", "Business legal name"),
  companyHelp: guard("l company help", "Exactly as it reads on your registration."),
  titleLabel: guard("l title label", "Your title"),
  titleHelp: guard("l title help", "Owner, Medical Director, Practice Manager."),
  websiteLabel: guard("l website label", "Your website"),
  websiteHelp: guard("l website help", "Where patients find you today."),
  emailLabel: guard("l email label", "Your business email"),
  emailHelp: guard("l email help", "We send your signed copy here. Nothing else goes to it."),
  phoneLabel: guard("l phone label", "Your phone"),
  phoneHelp: guard("l phone help", "So we can reach you about the onboarding call."),

  cta: guard("l cta", "Read the agreement"),
  fine: guard(
    "l fine",
    "No card, no setup fee, and nothing is charged today. You can cancel with 30 days notice at any time."
  ),
};

// ‼️ THE VALUE STACK IS GONE FROM THE LANDING SCREEN (2026-09-02, Matthew's call).
// `SHOW_VALUE_STACK` and the `valueStack` useMemo in onboarding2-client.tsx were deleted with
// it. LANDING.fine is now the last line on screen one. The figures still live in exactly one
// place, OFFER_INCLUDES in config/pitch.ts, and section 1 of the agreement still composes its
// annotations from there. Do not reintroduce a second copy of them here.

// ─────────────────────────────────────────────────────────────────────────────
// The agreement screen. ONE SCREEN NOW, NOT NINE.
// ─────────────────────────────────────────────────────────────────────────────

export const AGREEMENT_UI = {
  initialsLabel: guard("a initials label", "Initial here"),
  initialsHelp: guard(
    "a initials help",
    "Tap the box and your initials drop in. Initialling a page records that you read it, and you can change any of them until you sign."
  ),
  next: guard("a next", "Next"),
  finalCta: guard("a final cta", "Go to the signature"),
  askHelp: guard("a ask help", "Question about any of this? Tap the chat bubble."),
  staleTitle: guard("a stale title", "This agreement was updated"),
  staleBody: guard(
    "a stale body",
    "The document changed while this page was open, so we stopped rather than record you as agreeing to wording you did not read. Reload and it will start again from the top."
  ),
};

export const SIGNATURE_UI = {
  heading: guard("sig heading", "Sign the agreement"),
  body: guard(
    "sig body",
    "By signing you confirm you have the authority to bind your business to this agreement, and that you understand the guarantee: no payment until ChatGPT sends you 5 new qualified appointments."
  ),
  // ‼️ A RECAP, NOT A FORM, AND THE DIFFERENCE IS THE WHOLE POINT OF THIS SCREEN.
  // Every field below it is read-only. Showing somebody the party they are binding is not the
  // same as asking them to type it again, and a signature screen that never names the company
  // would be a real weakness in the document rather than a tidy one.
  recapHeading: guard("sig recap heading", "You are signing as"),
  recapEdit: guard("sig recap edit", "Not right? Go back and fix it."),
  cta: guard("sig cta", "Sign and start onboarding"),
  working: guard("sig working", "Recording your signature"),
  fine: guard(
    "sig fine",
    "We store the exact text you just read, a fingerprint of it, and every initial, so your copy always reads the way it did today."
  ),
};

export const SIGNED_UI = {
  heading: guard("done heading", "Signed. Welcome to SRT."),
  // ‼️ ONE BUTTON ON THIS SCREEN (Matthew, 2026-09-03). The download link was deleted: the
  // executed contract is emailed, and offering a second way to get it here made the screen a
  // fork at the exact moment we want one forward path.
  body: guard(
    "done body",
    "We are emailing a copy of the executed contract to the address you gave us. Two minutes of questions and we are done."
  ),
  cta: guard("done cta", "Start the questions"),
};

// ─────────────────────────────────────────────────────────────────────────────
// The qualifying questions, asked AFTER signing. Seven as of 2026-09-03.
//
// ‼️ NOT ONE OF THEM IS SOMETHING ALREADY ON THE ROW. Name, company, title, website,
// email, phone, address and date were all collected before the signature. Asking again for
// something somebody just typed into a contract reads as a system that was not listening.
//
// ‼️ WHAT WAS DELETED ON 2026-09-03 AND WHY, BECAUSE NOTHING ELSE NOW RECORDS IT:
//
//   website          MOVED to screen one. It is the source of clients.domain and the hub lane
//                    cannot run without it, so it had no business being the ninth thing somebody
//                    might abandon before answering.
//   top_objection    DELETED. It fed ideal_patient.objections and objection_1, which harvest.ts
//                    and ownerPhrases() read. Those now build with no owner input. A later lane
//                    replaces that supply from our own audit data.
//   top_competitor   DELETED. It fed services.competitors, which competitors.ts:141 and
//                    question-sets.ts:264 read. Same story.
//
// ‼️ THE ACCESS INVENTORY IS DELIBERATELY NOT HERE. GBP logins, Yelp, the registrar, the site
// platform, analytics, prior agencies, the eight review-process questions, hours, payment types,
// credentials and service area all stay in the token-gated /onboarding intake
// (src/config/client-intake.ts), collected AFTER the call. Those are delivery input. These six
// are booking input, and the difference is why the v1 intake's forty fields do not belong on a
// funnel somebody reached from an ad.
// ─────────────────────────────────────────────────────────────────────────────

export interface QualifyingQuestion {
  /** Stable id. Stored on the row, so it may never be renamed once anything has answered. */
  key: string;
  question: string;
  /** Tappable options. Empty means free text, which is only true of the first one now. */
  options: string[];
  /** Rendered under the question when the assistant needs to nudge. */
  help?: string;
  freeText?: boolean;
  /**
   * The option that means "none of these". Tapping it opens a small box asking them to be
   * specific, rather than recording the word "Other" as an answer nobody can use.
   */
  otherOption?: string;
}

export const QUALIFYING_QUESTIONS: QualifyingQuestion[] = [
  {
    // ‼️ FIRST, AND IT IS HERE BECAUSE THE IDENTITY FORM STOPPED ASKING IT (2026-09-04).
    //
    // The form collected `businessLegalName` before anything else. The chat intake that replaced
    // it asks for the website, the name, the email and the phone, and deliberately not this: four
    // questions before a booking is already the ceiling, and this one is not needed to BOOK.
    //
    // It is needed afterwards, twice, which is why it did not simply disappear. `clients.legal_name`
    // is NOT NULL and startPilot falls back to the EMAIL ADDRESS when it has no name, which puts
    // "someone@clinic.com" where a company name goes on every board in Mission Control. And the
    // agreement, now signed by hand on the call, binds "[Client Business Legal Name]".
    //
    // Asked first of the post-booking set because it is the easiest question in it: they have just
    // booked, and typing their own clinic's name is a warm-up, not an interrogation.
    key: "business_name",
    question: guard("q0", "What is the name of your business?"),
    help: guard("q0 help", "However it is registered, if you know it."),
    options: [],
    freeText: true,
  },
  {
    key: "highest_margin_service",
    // OPEN TEXT as of 2026-09-03. The option list was a med-spa menu, and a clinic whose best
    // margin is something not on it had to pick "Something else", which is the answer that
    // teaches us nothing. ideal_patient.highest_margin is the winner of the [treatment]
    // substitution chain, so this string ends up inside generated pages: it wants their words.
    question: guard("q1", "Which service is your highest margin?"),
    help: guard("q1 help", "In your own words is fine."),
    options: [],
    freeText: true,
  },
  // ‼️ SECOND, RIGHT AFTER THE MARGIN QUESTION, BECAUSE THE PAIR IS ONE THOUGHT AND SPLITTING
  // THEM WOULD MAKE BOTH READ AS A REPEAT. The two are genuinely different answers: the most
  // profitable service and the one an owner wants more of are usually not the same, and it is
  // THIS one the pages, the posts and the free offer get aimed at.
  //
  // It exists because `services.primary_treatment` had a reader and no writer. deep-research-run
  // interpolates it into three sentences of the research prompt, and with nothing writing it
  // every live client's prompt said "Sells: not recorded" and asked who buys "this".
  //
  // Open text for the same reason q1 is: a menu here would come back as "Something else", which
  // is the one answer that cannot be interpolated into a sentence.
  {
    key: "primary_treatment",
    question: guard("q1b", "And which one do you most want more appointments for?"),
    help: guard("q1b help", "Often the same answer, often not. One service."),
    options: [],
    freeText: true,
  },
  {
    key: "avg_patient_value",
    // ‼️ TAKE IT FLAT. It used to say "on that service", which invited the assistant to ask which
    // service they meant, and a clarifying follow-up on a number somebody already gave is the
    // single most annoying thing a form can do.
    question: guard("q2", "What is a patient worth to you on that first visit?"),
    options: [
      guard("q2 o1", "Under $500"),
      guard("q2 o2", "$500 to $1,500"),
      guard("q2 o3", "$1,500 to $3,000"),
      guard("q2 o4", "More than $3,000"),
    ],
  },
  {
    key: "new_patients_monthly",
    question: guard("q3", "How many new patients do you see in a month?"),
    options: [
      guard("q3 o1", "Fewer than 10"),
      guard("q3 o2", "10 to 25"),
      guard("q3 o3", "25 to 50"),
      guard("q3 o4", "More than 50"),
    ],
  },
  {
    key: "monthly_revenue",
    question: guard("q4", "Roughly what is the clinic doing a month?"),
    help: guard("q4 help", "There is no wrong answer, and nobody sees it but us."),
    options: [
      guard("q4 o1", "Under $10k"),
      guard("q4 o2", "$10k to $50k"),
      guard("q4 o3", "$50k to $150k"),
      guard("q4 o4", "More than $150k"),
    ],
  },
  {
    key: "booking_software",
    question: guard("q5", "What system do you use to book and schedule?"),
    options: [
      guard("q5 o1", "Boulevard"),
      guard("q5 o2", "Vagaro"),
      guard("q5 o3", "Zenoti"),
      guard("q5 o4", "Mindbody"),
      guard("q5 o5", "Square or Acuity"),
      guard("q5 o6", "Phone and paper"),
      guard("q5 o7", "Other"),
    ],
    // Handled by the CLIENT, in a popup, before anything is sent. The alternative is the model
    // asking "which one?", and the whole point of this pass is that it never asks a follow-up.
    otherOption: guard("q5 other", "Other"),
  },
  {
    key: "has_gbp",
    question: guard("q6", "Do you have a Google Business Profile?"),
    options: [guard("q6 o1", "Yes"), guard("q6 o2", "No")],
  },
  {
    // ‼️ THIS ASKS FOR A PLATFORM, NOT A URL, AND THE DIFFERENCE IS THE WHOLE DESIGN.
    //
    // It answers "which of the six review destinations does this client want", which is what
    // decides the order of the buttons in the AI Referral Engine and which URL field the Review
    // handover panel needs filled. It does NOT produce a link. A review URL typed by a client
    // into a chat box, or worse constructed by us from a business name, is a link that can send
    // a real patient to somebody else's profile. destinationsFor() in
    // app/hub/[host]/reviews/referral-engine.tsx renders a destination only where a human pasted the
    // actual URL, and that stays true.
    //
    // ‼️ THE OPTIONS ARE THE SHARED TABLE, NOT A COPY OF IT (2026-09-08). They used to be six
    // literals with a comment asking whoever read it to keep them in step with PLATFORMS in
    // referral-engine.tsx and with the boxes on the Review handover panel. The panel had two of the
    // six, so a client picking Trustpilot here chose a destination nothing could ever render.
    // A name offered here now cannot exist without a URL field to hold its link.
    key: "review_destination",
    question: guard("q7", "Where do you want your patient reviews to go?"),
    options: REVIEW_PLATFORMS.map((p) => guard(`q7 ${p.key}`, p.name)),
    help: guard(
      "q7 help",
      "Wherever you pick is where the AI Referral Engine sends your patients when they finish writing."
    ),
  },
];

/** The popup behind the "Other" chip. Client-side, so it costs no model turn. */
export const OTHER_PROMPT = {
  heading: guard("other heading", "Please be specific"),
  body: guard("other body", "Type the name of the system you use."),
  cta: guard("other cta", "Send"),
  cancel: guard("other cancel", "Back"),
};

// ‼️ THE COUNT IS INTERPOLATED, NOT TYPED. This said "Six questions" while the array held seven,
// because primary_treatment was added and the prose was not. A funnel that promises six and asks
// seven is a small lie told at the exact moment somebody has just signed something, which is the
// worst possible moment to look like a system that was not paying attention.
export const QUALIFYING_INTRO = guard(
  "qual intro",
  `To make sure we have everything ready by the time of our call, answer these ${QUALIFYING_QUESTIONS.length} questions. About a minute, and nothing you have already told us gets asked twice.`
);

/**
 * The opener, sent the moment the chat takes over from screen one.
 *
 * ‼️ THE CALL IS BOOKED BEFORE THE QUESTIONS ARE ASKED, REVERSED 2026-09-04. It used to be the
 * other way round, gated in makeExecutor so offer_booking refused until every answer was in.
 * Matthew's call: the booking is the commitment and the questions are preparation for it, so
 * somebody who books and then abandons question four has still done the thing that matters. The
 * gate did not move, it INVERTED: scheduling now runs before the model sees a turn at all.
 */
export const SCHEDULING_INTRO: string[] = [
  guard("sched intro 1", "You are in. Let us get your onboarding call booked."),
  guard("sched intro 2", "What works better for you, mornings or afternoons?"),
];

// ─────────────────────────────────────────────────────────────────────────────
// The close, said once every question is answered.
//
// ‼️ THESE LINES ARE SENT VERBATIM BY THE ROUTE, NOT WRITTEN BY THE MODEL. A prompt telling a
// model what to say at the end is a prompt a model can talk itself past, and it only has to
// happen once. The scheduling turns are likewise a deterministic state machine in
// src/app/api/onboarding2/chat/route.ts keyed off the lead row.
//
// ‼️ THERE IS NOW EXACTLY ONE CALENDAR IN THIS FLOW AND THE MODEL STILL CANNOT REACH IT.
// This header used to read "NO CALENDAR LINK, ANYWHERE IN THIS FLOW" and that stopped being
// true on 2026-09-04, when the Calendly embed came back ahead of the questions. The GUARANTEE
// is unchanged and is worth restating because it is the reason the old rule existed: the embed
// is rendered by the client from a URL the ROUTE returns, on a turn the model never sees. No
// prompt produces a link, no tool returns one, and CHAT_HARD_LINES still forbids the assistant
// from offering one. What changed is that the funnel has a calendar; what did not change is
// that the assistant has no way to hand one out.
//
// Three messages, sent one after another like somebody actually texting.
// ─────────────────────────────────────────────────────────────────────────────

export const CLOSING_MESSAGES: string[] = [
  guard("close 1", "That is everything, thank you."),
  guard(
    "close 2",
    "Matthew has what he needs to get your build started before the call."
  ),
  guard("close 3", "See you then."),
];

export const DAYPART_OPTIONS = {
  morning: guard("daypart am", "Mornings"),
  afternoon: guard("daypart pm", "Afternoons"),
};

/**
 * The card that ends the conversation.
 *
 * ‼️ THE LAST THING THEY SEE IS WHAT THEY BOUGHT, NOT A CHAT LOG (Matthew, 2026-09-03). Somebody
 * who has just signed and answered every question is at the highest point of their confidence in
 * this decision, and a thread that simply stops leaves them there with nothing to hold. A
 * headline, the offer restated, and the five things we start on now.
 *
 * ‼️ THE WORK LIST IS COMPOSED FROM OFFER_INCLUDES, NOT RETYPED. config/pitch.ts is the only place
 * a figure of ours may live, and the agreement's section 1 already composes from the same array
 * for the same reason. The AI Skin Concierge line carries NO figure because OFFER_INCLUDES does
 * not price it, and inventing a fifth figure to fill that gap is exactly what pitch.ts forbids.
 */
export const CLOSING_SUMMARY = {
  eyebrow: guard("sum eyebrow", "You are in"),
  headline: guard("sum headline", "Here is what we start building for you."),
  subheadline: guard(
    "sum sub",
    "You don't pay us a dollar until ChatGPT sends you 5 new qualified appointments. No setup fee, no monthly fee, nothing until the 5th one lands."
  ),
  worksHeading: guard("sum works heading", "Starting now"),
  /** The one deliverable OFFER_INCLUDES does not price. Listed without a figure, on purpose. */
  conciergeLine: guard(
    "sum concierge",
    "Install the AI Skin Concierge on your site, so high-intent visitors get a personalized skin assessment and book themselves in"
  ),
  callHeading: guard("sum call heading", "Your onboarding call"),
  callFallback: guard("sum call fallback", "We will confirm a time with you shortly."),
  footer: guard(
    "sum footer",
    "Your signed copy is on its way to your inbox. Matthew will reach out before the call for your Google Business Profile details."
  ),
};

/**
 * The four zones, and the ONE extra question in this whole close.
 *
 * ‼️ IT WAS ADDED BECAUSE THE INVITE MADE THE HOUR REAL (2026-09-03). While a human settled the
 * time on the phone, "morning" being ours rather than theirs cost nothing, and
 * src/lib/onboarding2/scheduling.ts says so in as many words. The moment a calendar invite goes
 * out, a fixed 2:00 pm Eastern is 11:00 am in Los Angeles: a clinic that tapped AFTERNOON gets a
 * MORNING invite, so the daypart they chose becomes false on their own screen. One tap fixes
 * both the hour and the meaning of the daypart, which is a better trade than any default.
 *
 * ‼️ FOUR OPTIONS AND NO "OTHER". Every US med spa is in one of these, and a free-text zone is a
 * string somebody types "EST" into, which is not an IANA name and cannot be handed to Intl. A
 * clinic outside them is a conversation, not a chip.
 */
export const TIMEZONE_OPTIONS = [
  { zone: "America/New_York", label: guard("tz et", "Eastern") },
  { zone: "America/Chicago", label: guard("tz ct", "Central") },
  { zone: "America/Denver", label: guard("tz mt", "Mountain") },
  { zone: "America/Los_Angeles", label: guard("tz pt", "Pacific") },
] as const;

export const SCHEDULING_UI = {
  /** Sent with the four timezone buttons, straight after the daypart. */
  askZone: guard("sched ask zone", "Got it. Which time zone are you in?"),
  /** Sent with the three day buttons. */
  askDay: guard("sched ask day", "Perfect. Which of these works?"),
  /**
   * Sent once they pick. `{day}` is the label they tapped, `{time}` the hour in THEIR zone.
   *
   * ‼️ IT SAYS THE HOUR AND THE ZONE OUT LOUD. An invite is about to land in their inbox, and a
   * confirmation that hides the time somebody is about to be committed to is how a client
   * discovers the hour by being called at it.
   */
  confirmed: guard("sched confirmed", "Locked in for {day} at {time}. The invite is on its way."),
  /**
   * The same moment when no invite could be sent. Nothing is promised that did not happen.
   *
   * ‼️ THE HONEST HALF OF THE TRI-STATE, AND IT IS THE DEFAULT PATH. MS_CALENDAR_* ships unset,
   * so this is what a client sees until the Azure app exists. Same doctrine as the Slack card in
   * src/lib/onboarding2/card.ts, which states what did NOT happen.
   */
  confirmedNoInvite: guard("sched confirmed plain", "Locked in for {day}. I will send the details over."),
  closing: guard("sched closing", "That is everything. Talk soon."),
  /** When a typed reply is not readable as a daypart, a zone or a day. Asked once, not argued. */
  reask: guard("sched reask", "Just tap one of the options below and we are done."),

  // ── The Calendly handoff (2026-09-04) ────────────────────────────────────
  //
  // ‼️ THE DAY IS AGREED IN CONVERSATION AND THE HOUR IS PICKED ON CALENDLY, and the split is
  // deliberate. The daypart, zone and day are what make the calendar SHORT: Calendly opens on
  // the day they already chose, filtered to the half of it they already chose, so they are
  // picking between three slots rather than scrolling a month. Asking all of it on Calendly
  // would work and would convert worse; asking all of it here would need a booking API this
  // account does not have.
  /** Sent with the embed, once the day is agreed. `{day}` is the label they tapped. */
  pickTime: guard("sched pick time", "Great, {day} it is. Pick a time that suits you."),
  /**
   * ‼️ SAID ONLY AFTER CALENDLY REPORTS event_scheduled, NEVER WHEN THE EMBED IS SHOWN.
   * The email is Calendly's, and it is real: it goes out the moment the booking lands. Saying it
   * a screen early would be the funnel promising an email that nothing has sent yet, which is
   * the exact failure confirmedNoInvite above exists to avoid.
   */
  emailSent: guard(
    "sched email sent",
    "You are booked. We just sent an email with your appointment confirmation."
  ),
  /**
   * The honest state when there is no Calendly URL configured at all.
   *
   * ‼️ TRI-STATE, LIKE EVERY OTHER BOOKING SURFACE IN THIS REPO. With no token AND no public
   * URL, the screen offers the phone number rather than a button that opens nothing.
   */
  noCalendar: guard(
    "sched no calendar",
    "I will confirm the exact time with you by email shortly."
  ),
};

// ─────────────────────────────────────────────────────────────────────────────
// The grounded assistant
// ─────────────────────────────────────────────────────────────────────────────

export const CHAT_UI = {
  title: guard("chat title", "Questions about the agreement"),
  placeholderPre: guard("chat ph pre", "Ask about any section"),
  placeholderPost: guard("chat ph post", "Type your answer"),
  offline: guard(
    "chat offline",
    "The assistant is not available right now. Text Matthew on 336-833-2303 and he will answer."
  ),
  capped: guard(
    "chat capped",
    "That is as much as I can answer here. Text Matthew on 336-833-2303 and he will pick it up."
  ),
  // ‼️ THERE IS NO `thinking` STRING ANY MORE (2026-09-03). The waiting state is three animated
  // dots, the way a texting app shows it. The old one said "Reading the agreement", which was
  // both a claim about what the model was doing and plainly wrong once the questions started.
  //
  // ‼️ THE DETERMINISTIC LINE FOR A PRICE HANDOFF. A turn that ends on a tool call returns no
  // text, and grounded mode's only other fallback is the "assistant unavailable" message, which
  // would be a lie told at the exact moment somebody asked for a discount. This says the one
  // thing we want said and cannot be argued with, because no model wrote it.
  priceHandoff: guard(
    "chat price handoff",
    "Pricing is not something I can move on. Matthew will pick that up with you directly, on 336-833-2303."
  ),
  opener: guard(
    "chat opener",
    "I can answer questions about this agreement. I only answer from the document itself, so if it does not say, I will tell you that rather than guess."
  ),
};

/**
 * Facts the assistant may state that are NOT in the agreement.
 *
 * ‼️ CONSTANTS, NEVER MODEL-WRITTEN, AND DELIBERATELY TINY. Everything the assistant is allowed
 * to say about terms comes from the snapshot. This block exists only so it can hand somebody to
 * a human, and every line added here is a line that can be said without the document backing it.
 */
export const CHAT_FACTS: string[] = [
  guard("f1", "SRT Agency LLC is based in Greensboro, North Carolina."),
  guard("f2", "Matthew Garcia is the CEO and signs on behalf of SRT."),
  guard("f3", "Anything this agreement does not cover can go to Matthew on 336-833-2303."),
  guard("f4", "The signer keeps a PDF copy of exactly what they signed, emailed on signature."),
];

/**
 * The refusals, stated as prohibitions.
 *
 * ‼️ THE PROMPT IS THE COSMETIC HALF OF THIS GATE. The structural half is that the grounded
 * assistant is handed the agreement and one tool and nothing else: no CRM, no report, no pricing
 * table, no AI_TOOLS. It cannot leak what it was never given. Same lesson recorded in
 * call-coach-price-gate.ts after a prompt-level rule leaked the number in 2 of 3 live runs:
 * absent beats forbidden.
 */
export const CHAT_HARD_LINES: string[] = [
  guard(
    "hl1",
    "Answer only from the agreement sections given to you. If the answer is not in them, say plainly that the agreement does not cover it and offer to have Matthew answer."
  ),
  guard(
    "hl2",
    "Never give legal advice. Never say whether a term is enforceable, standard, fair, typical, or in the reader's interest."
  ),
  guard(
    "hl3",
    "Never offer to change a term, never say a term is negotiable, and never say what SRT would probably do."
  ),
  guard(
    "hl4",
    "Never state a figure the agreement does not contain. No price, no discount, no term length, no notice period, no timeline that is not written in a section."
  ),
  // ‼️ THE PRICE-NEGOTIATION LINE. Reading (b), Matthew's call 2026-09-02: the assistant may
  // still answer "what does it cost?" from Section 4 (Section 2 before the v5 renumber), but the moment the question is a
  // NEGOTIATION it must not restate the fee at all. It used to answer "Can you do it for $299?"
  // with "the agreement states $499 per month in Section 4", which is the bot haggling on our
  // behalf. The structural half of this gate is in makeExecutor: flag_for_human carries a
  // `reason`, and price_negotiation comes back with a refusal the model reads as a tool result
  // rather than as a rule it can argue past.
  guard(
    "hl5",
    "You may state the monthly fee when somebody plainly asks what it costs. If they propose a different number, ask for a discount, ask what SRT would accept, or push back on the price, do NOT restate the fee and do NOT engage with their number. Call flag_for_human with reason price_negotiation and tell them Matthew will answer that one."
  ),
  guard(
    "hl6",
    "Do not explain what a section means beyond restating what it says. Point at the section number when you answer."
  ),
  guard("hl7", "Never use an em dash or an en dash. Use commas, periods and single hyphens."),
  guard(
    "hl8",
    "Keep answers under 90 words. This is a chat bubble on a phone, not a memo."
  ),
];

export interface Faq {
  /**
   * WHICH CLAUSE this is drawn from, by key rather than by number.
   *
   * ‼️ IT WAS A NUMBER UNTIL 2026-09-16 AND THAT IS THE BUG THIS FIXES. Clause numbers move every
   * time the document is restructured: v4 renumbered fourteen clauses to nine, v5 shifted
   * everything after 1 by two, and v6 split one document into three that number DIFFERENTLY from
   * each other. A number stored here is a promise about a layout, and the layout is the thing
   * most likely to change.
   *
   * ‼️ AND IT IS WHAT FILTERS THE LIST PER OFFER, WHICH IS THE BETTER HALF. An FAQ keyed
   * `guarantee_yearly` simply is not in the monthly document, so faqsFor() drops it and the
   * assistant never sees a question about a guarantee that does not exist. Answering "there is no
   * guarantee on this plan" is then the only thing it can do, and it comes for free from the key
   * being absent rather than from a rule somebody has to remember to write.
   *
   * null means the answer does not rest on any one clause.
   */
  sectionKey: string | null;
  q: string;
  /**
   * The answer.
   *
   * ‼️ WRITE "{s:some_key}" WHERE A CLAUSE NUMBER BELONGS, NEVER A DIGIT. faqsFor() substitutes
   * the number that clause actually has in THIS signer's document. A literal "Section 5" here is
   * correct in one of three documents and confidently wrong in the other two.
   */
  a: string;
}

/**
 * The grounded FAQ set.
 *
 * ‼️ EVERY ANSWER RESTATES THE AGREEMENT AND ADDS NOTHING. Where an answer would need a fact the
 * document does not contain, it says so instead. These are a convenience so common questions get
 * a consistent answer, NOT a second source of terms: the assistant is told that where an FAQ and
 * a section disagree, the section wins.
 *
 * ‼️ THIRTY BECAME TWENTY AT v4, AND v6 REBUILT THEM AGAINST KEYS. The v4 note is kept below
 * because it is the reason ten of them do not exist. What changed at v6 is that an FAQ no longer
 * claims a clause NUMBER, so a renumber cannot desync it, and an FAQ belonging to a clause this
 * offer does not have removes itself from the prompt.
 *
 * ‼️ NO PRICE IS TYPED IN AN ANSWER. The fee answers interpolate from config/pitch.ts, which is
 * the single home for a figure. faq5a used to read "$499 per month" as a literal and went on
 * saying it after the offer changed.
 *
 *   DELETED AT v4, ten, because nothing in the document supports them any more:
 *     faq13, faq14   old 4, the access list and the pause on the timeline
 *     faq15          patient records, old 6
 *     faq19, faq20, faq21  old 5, HIPAA scope, transcript ownership, software ownership
 *     faq22          old 7, what you keep if you leave
 *     faq24          old 11, the 3-month walk-away remedy
 *     faq26, faq27   old 6, fake reviews and changing the site without asking
 *
 *   DELETED AT v6, because the arrangement they describe no longer exists on any offer:
 *     faq1, faq7     "you owe nothing until the 5th qualified appointment". Both paid plans are
 *                    paid up front, so these are now false rather than merely out of date.
 */
export const CHAT_FAQS: Faq[] = [
  // ── What we do. One per variant, because the Concierge differs. ──
  { sectionKey: "what_we_do_yearly", q: guard("faq11qy", "What exactly do you do for me?"), a: guard("faq11ay", "Section {s:what_we_do_yearly} lists five things: rewrite key pages so ChatGPT can quote them, turn happy patients into review evidence, fix NAP mismatches across directories, install the AI Skin Concierge on your site at no extra charge, and send a monthly AI Visibility Report.") },
  { sectionKey: "what_we_do_monthly", q: guard("faq11qm", "What exactly do you do for me?"), a: guard("faq11am", "Section {s:what_we_do_monthly} lists five things: rewrite key pages so ChatGPT can quote them, turn happy patients into review evidence, fix NAP mismatches across directories, the AI Skin Concierge if you choose to add it, and send a monthly AI Visibility Report.") },
  { sectionKey: "what_we_do_yearly", q: guard("faq12qy", "What is NAP?"), a: guard("faq12ay", "Name, Address and Phone. Section {s:what_we_do_yearly} says we fix every mismatch across every directory we can find you on.") },
  { sectionKey: "what_we_do_monthly", q: guard("faq12qm", "What is NAP?"), a: guard("faq12am", "Name, Address and Phone. Section {s:what_we_do_monthly} says we fix every mismatch across every directory we can find you on.") },

  // ── The Concierge. Answers only what the disclosure bullet says, and no more. ──
  //
  // ‼️ THESE WERE REWRITTEN, NOT DELETED, WHEN v4's SECTION 5 WENT. They answer ONLY what the
  // what-we-do disclosure bullet says, which is less than old section 5 said. Anything beyond it
  // (HIPAA posture, transcript ownership, who owns the software) is no longer in the document and
  // the assistant must fall through to flag_for_human rather than answer from memory.
  { sectionKey: "what_we_do_yearly", q: guard("faq16qy", "What is the AI Skin Concierge?"), a: guard("faq16ay", "Section {s:what_we_do_yearly}. A skin analysis widget we install on your site. It captures high-intent visitors, gives them a personalized skin assessment, and books qualified consultations into your calendar. On this plan it is included at no extra charge.") },
  { sectionKey: "what_we_do_monthly", q: guard("faq16qm", "What is the AI Skin Concierge?"), a: guard("faq16am", `Section {s:what_we_do_monthly}. A skin analysis widget we install on your site. It captures high-intent visitors, gives them a personalized skin assessment, and books qualified consultations into your calendar. On this plan it is optional and billed separately at ${PRICE_CONCIERGE}.`) },
  { sectionKey: "what_we_do_yearly", q: guard("faq17qy", "Is the Concierge a medical device?"), a: guard("faq17ay", "No. Section {s:what_we_do_yearly} states it is not a medical device and it does not diagnose or treat.") },
  { sectionKey: "what_we_do_monthly", q: guard("faq17qm", "Is the Concierge a medical device?"), a: guard("faq17am", "No. Section {s:what_we_do_monthly} states it is not a medical device and it does not diagnose or treat.") },
  { sectionKey: "what_we_do_yearly", q: guard("faq18qy", "What happens to the photos?"), a: guard("faq18ay", "Section {s:what_we_do_yearly}: any facial photo a visitor submits is used only for that analysis and deleted within 24 hours.") },
  { sectionKey: "what_we_do_monthly", q: guard("faq18qm", "What happens to the photos?"), a: guard("faq18am", "Section {s:what_we_do_monthly}: any facial photo a visitor submits is used only for that analysis and deleted within 24 hours.") },

  // ── The money. Interpolated, never typed. ──
  { sectionKey: "fee_yearly", q: guard("faq5qy", "What does this cost?"), a: guard("faq5ay", `Section {s:fee_yearly}. ${PRICE_YEAR_AMOUNT} for twelve months, due on signing. That works out at ${PRICE_YEAR_EQUIV}, and there is nothing else to pay for the rest of the year.`) },
  { sectionKey: "fee_monthly", q: guard("faq5qm", "What does this cost?"), a: guard("faq5am", `Section {s:fee_monthly}. ${PRICE_MONTH}, billed on the same day each month. No setup fee and no cancellation fee.`) },
  { sectionKey: "fee_yearly", q: guard("faq6qy", "What does that cover?"), a: guard("faq6ay", "Section {s:fee_yearly}: ongoing page updates, reviews, NAP maintenance, AI Skin Concierge hosting and improvements, and the monthly report. No setup fee, no per-page fee and no hidden costs.") },
  { sectionKey: "fee_monthly", q: guard("faq6qm", "What does that cover?"), a: guard("faq6am", `Section {s:fee_monthly}: ongoing page updates, reviews, NAP maintenance and the monthly report. The AI Skin Concierge is not included. If you want it, it is ${PRICE_CONCIERGE} on top and you can add or drop it at any time.`) },
  { sectionKey: "fee_yearly", q: guard("faq8qy", "Am I locked into a year?"), a: guard("faq8ay", "Yes, and that is the trade. Section {s:fee_yearly} is a twelve month arrangement paid once up front, which is what pays for the guarantee. If you would rather not commit, the month to month plan has no term and no guarantee.") },
  { sectionKey: "fee_monthly", q: guard("faq8qm", "Am I locked into a year?"), a: guard("faq8am", "No. Section {s:fee_monthly}: no annual contract, and you can cancel with 30 days written notice at any time.") },

  // ── The guarantee. YEARLY ONLY, and it removes itself from the monthly prompt. ──
  { sectionKey: "guarantee_yearly", q: guard("faq1q6", "What is the guarantee?"), a: guard("faq1a6", `Section {s:guarantee_yearly}. We bring you ${String(GUARANTEE_COUNT)} qualified appointments inside your first ${GUARANTEE_WINDOW}. If we do not, you get your first 3 months back, which is ${REFUND_AMOUNT}, and we keep working for the rest of the year at no charge.`) },
  { sectionKey: "guarantee_yearly", q: guard("faq2q6", "What counts as a qualified appointment?"), a: guard("faq2a6", "Section {s:guarantee_yearly} gives three tests and all three have to be true. They book with you, they tell you they found you through ChatGPT or an AI recommendation or AI search or a similar phrase, and they actually show up.") },
  { sectionKey: "guarantee_yearly", q: guard("faq3q6", "Who decides whether a booking qualifies?"), a: guard("faq3a6", "You do. Section {s:guarantee_yearly} says if we disagree, we default to your judgment.") },
  { sectionKey: "guarantee_yearly", q: guard("faq4q6", "How do we track them?"), a: guard("faq4a6", "Together, in your monthly AI Visibility Report. You confirm each one. Section {s:guarantee_yearly}.") },
  { sectionKey: "guarantee_yearly", q: guard("faq36q", "How do I claim the refund?"), a: guard("faq36a", `Section {s:guarantee_yearly}. You tell us, and we refund ${REFUND_AMOUNT}. There is nothing to fill in and you do not have to ask twice. You do not have to end the agreement to claim it: we carry on working for the remaining nine months at no further charge.`) },
  { sectionKey: "guarantee_yearly", q: guard("faq37q", "Can anything pause the 90 days?"), a: guard("faq37a", "Two things, and they are the two only you can do. Section {s:guarantee_yearly}: the 5 reviews a month, and new patient bookings running through the Concierge so an appointment can be counted at all. If either stops, the days it is stopped for do not count toward the 90.") },
  { sectionKey: "fee_monthly", q: guard("faq38q", "Is there a guarantee on this plan?"), a: guard("faq38a", "No. Section {s:fee_monthly} says this plan carries no performance guarantee and no refunds. Months already served are not returned. What you keep is everything we built. If you would rather we carried some of that risk, the annual plan does, and you can ask to move onto it at any time.") },

  // ── What we need from you. client_reviews is shared, so one entry covers both plans. ──
  { sectionKey: "client_reviews", q: guard("faq31q", "Why do I have to get 5 reviews a month?"), a: guard("faq31a", "Section {s:client_reviews}. Fresh reviews are what AI systems cite, and only your patients can leave them. We set up the automation, write the scripts, give your front desk a one tap request link and monitor your profiles weekly, but your team has to do the asking.") },
  { sectionKey: "client_reviews", q: guard("faq32q", "What if I miss the 5 reviews in a month?"), a: guard("faq32a", "Nothing is charged and nothing is clawed back. Section {s:client_reviews} gives you a 30 day catch up window and we help you close it. If you fall short two months in a row, we can pause the ongoing work until you are back at 5 a month.") },

  { sectionKey: "client_booking_yearly", q: guard("faq33qy", "Do I have to stop using my current booking system?"), a: guard("faq33ay", "No. Section {s:client_booking_yearly} says your existing system keeps running exactly as it does today for returning patients and phone bookings. The Concierge is the booking path for new patients arriving from your website and the new pages we write.") },
  { sectionKey: "client_booking_yearly", q: guard("faq34q", "Why does the booking have to go through the Concierge?"), a: guard("faq34a", "So it can be counted. The guarantee only counts an appointment where the patient tells you they found you through AI, and Section {s:client_booking_yearly} is what makes sure that question gets asked and the answer gets kept.") },
  { sectionKey: "client_booking_yearly", q: guard("faq35q", "Does the Concierge work with Vagaro or Boulevard?"), a: guard("faq35a", "Yes. Section {s:client_booking_yearly} names Vagaro, Boulevard, Mindbody and Zenoti. The Concierge carries the visitor into whichever one you run and the booking is completed there, so the appointment shows up in the same calendar your front desk already works from.") },
  { sectionKey: "client_booking_monthly", q: guard("faq33qm", "Do I have to change how I take bookings?"), a: guard("faq33am", "No. Section {s:client_booking_monthly} does not ask you to change your booking system. What it asks is that new patients are asked how they heard about you and that the answer is recorded, so your monthly report can tell a good month from a bad one.") },

  // ── NEW IN v6. The implementation clause, shared by both paid plans. ──
  { sectionKey: "client_implementation", q: guard("faq39q", "Do I have to do everything you tell me?"), a: guard("faq39a", "No. Section {s:client_implementation} says recommendations are ours to make and yours to decide on, and declining one costs you no fee and no penalty. One thing is not optional: your new patient forms have to ask how they heard about you, because everything else is counted from it.") },
  { sectionKey: "client_implementation", q: guard("faq40q", "Why does my form have to ask how they heard about me?"), a: guard("faq40a", "Because it is the only way either of us finds out that an AI answer sent them. Section {s:client_implementation}. Without it the work still happens and nobody can see whether it landed.") },
  { sectionKey: "client_implementation", q: guard("faq41q", "What happens if I say no to a recommendation?"), a: guard("faq41a", "Nothing is charged and nothing is held against you. Section {s:client_implementation}: what it does mean is that where a result depended on something you chose not to implement, that result is not something we can be held to.") },

  // ── Exclusivity, confidentiality, comms, termination, law. ──
  { sectionKey: "exclusivity_yearly", q: guard("faq23qy", "Do you work with my competitors?"), a: guard("faq23ay", "Section {s:exclusivity_yearly}: while you are an active client we will not take on another clinic offering the same primary service within 10 miles of your primary location. On this plan it locks in the day you sign and holds for the full twelve months.") },
  { sectionKey: "exclusivity_monthly", q: guard("faq23qm", "Do you work with my competitors?"), a: guard("faq23am", "Section {s:exclusivity_monthly}: while you are an active client we will not take on another clinic offering the same primary service within 10 miles of your primary location. Because this plan is month to month, the exclusivity is too.") },
  { sectionKey: "confidentiality", q: guard("faq42q", "Is what I tell you confidential?"), a: guard("faq42a", "Yes, and it runs both ways. Section {s:confidentiality}: anything you share that is not already public stays confidential, and our systems, prompts, scripts and methods stay confidential too.") },
  { sectionKey: "communication", q: guard("faq28q", "How do we communicate?"), a: guard("faq28a", "Section {s:communication}: email or WhatsApp, whichever you prefer, and we respond to any message within one business day.") },
  { sectionKey: "termination_yearly", q: guard("faq9qy", "How do I cancel?"), a: guard("faq9ay", "You can tell us in writing at any time and we will stop working. Section {s:termination_yearly}: the fee covers the twelve months and is not refundable on cancellation. The guarantee is the one circumstance where money comes back, and you do not have to cancel to claim it.") },
  { sectionKey: "termination_monthly", q: guard("faq9qm", "How do I cancel?"), a: guard("faq9am", "In writing, with 30 days notice, from either side. Section {s:termination_monthly}. You owe the 30 days and nothing beyond it. No cancellation fee and no clawback.") },
  { sectionKey: "termination_yearly", q: guard("faq43q", "Does it renew automatically?"), a: guard("faq43a", "No. Section {s:termination_yearly}: at the end of the twelve months it does not renew on its own. We ask you in writing before the term ends and nothing is charged unless you say yes.") },
  { sectionKey: "governing_law_yearly", q: guard("faq25qy", "What is your liability capped at?"), a: guard("faq25ay", `Section {s:governing_law_yearly} caps it at ${REFUND_AMOUNT}, being the value of three months of service at ${PRICE_YEAR_EQUIV}.`) },
  { sectionKey: "governing_law_monthly", q: guard("faq25qm", "What is your liability capped at?"), a: guard("faq25am", "Section {s:governing_law_monthly} caps it at the total you have paid us in the previous 3 months.") },
  { sectionKey: "governing_law_yearly", q: guard("faq29qy", "Which state law applies?"), a: guard("faq29ay", "North Carolina. Section {s:governing_law_yearly}. Any dispute goes to mediation in Guilford County before any lawsuit.") },
  { sectionKey: "governing_law_monthly", q: guard("faq29qm", "Which state law applies?"), a: guard("faq29am", "North Carolina. Section {s:governing_law_monthly}. Any dispute goes to mediation in Guilford County before any lawsuit.") },
  { sectionKey: "whole_deal", q: guard("faq30q", "Does anything said on a call override this?"), a: guard("faq30a", "No. Section {s:whole_deal} says this document is the entire agreement, and nothing said in a Loom, a call, an email or a text supersedes it. Changes have to be in writing and signed by both sides.") },
];
