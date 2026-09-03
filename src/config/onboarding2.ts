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
];

/** The popup behind the "Other" chip. Client-side, so it costs no model turn. */
export const OTHER_PROMPT = {
  heading: guard("other heading", "Please be specific"),
  body: guard("other body", "Type the name of the system you use."),
  cta: guard("other cta", "Send"),
  cancel: guard("other cancel", "Back"),
};

export const QUALIFYING_INTRO = guard(
  "qual intro",
  "Six questions, about a minute. They shape what we build first, and you never have to repeat anything you already put in the agreement."
);

// ─────────────────────────────────────────────────────────────────────────────
// The close. NO CALENDAR LINK, ANYWHERE IN THIS FLOW.
//
// ‼️ THESE LINES ARE SENT VERBATIM BY THE ROUTE, NOT WRITTEN BY THE MODEL, AND THAT IS HOW "no
// calendar link anywhere" BECOMES A GUARANTEE RATHER THAN AN INSTRUCTION. A prompt telling a
// model not to offer a calendar is a prompt a model can talk itself past, and it only has to
// happen once. The scheduling turns are a deterministic state machine in
// src/app/api/onboarding2/chat/route.ts keyed off the lead row, so there is no turn in which a
// link could be produced at all.
//
// Three messages, sent one after another like somebody actually texting.
// ─────────────────────────────────────────────────────────────────────────────

export const CLOSING_MESSAGES: string[] = [
  guard("close 1", "Congratulations, we are all set."),
  guard(
    "close 2",
    "To get you live we just need to schedule our onboarding call so I can show you everything."
  ),
  guard("close 3", "What works better for you, mornings or afternoons?"),
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
  q: string;
  a: string;
  /** The section this is drawn from. Printed so the assistant can cite it. */
  section: number | null;
}

/**
 * The grounded FAQ set.
 *
 * ‼️ EVERY ANSWER RESTATES THE AGREEMENT AND ADDS NOTHING. Where an answer would need a fact the
 * document does not contain, it says so instead. These are a convenience so common questions get
 * a consistent answer, NOT a second source of terms: the assistant is told that where an FAQ and
 * a section disagree, the section wins.
 *
 * ‼️ THIRTY BECAME TWENTY WHEN THE AGREEMENT WENT FROM FOURTEEN CLAUSES TO NINE (v4).
 * Fourteen of the thirty cited a clause that no longer exists, and an assistant quoting a
 * deleted section number confidently is worse than one that says it does not know.
 *
 *   DELETED, ten, because nothing in the document supports them any more:
 *     faq13, faq14   old 4, the access list and the pause on the timeline
 *     faq15          patient records, old 6
 *     faq19, faq20, faq21  old 5, HIPAA scope, transcript ownership, software ownership
 *     faq22          old 7, what you keep if you leave
 *     faq24          old 11, the 3-month walk-away remedy
 *     faq26, faq27   old 6, fake reviews and changing the site without asking
 *
 *   REWRITTEN, four, because the text they draw on survived in a shorter form:
 *     faq16, faq17, faq18  now answer from the section 1 Concierge disclosure bullet
 *     faq25                now answers from the section 8 liability cap
 *
 * ‼️ THE `section` NUMBER AND THE "Section N" STRING INSIDE EACH ANSWER MUST AGREE, and both
 * must be 1 to 9. _probe-onboarding2-chat.ts asserts exactly that, because the two drifting
 * apart is how the assistant ends up citing a real section under the wrong number.
 */
export const CHAT_FAQS: Faq[] = [
  { section: 5, q: guard("faq1q", "When do I start paying?"), a: guard("faq1a", "You owe nothing until ChatGPT has sent you 5 new qualified appointments. Section 5. Your fee starts the month after the 5th one lands.") },
  { section: 5, q: guard("faq2q", "What counts as a qualified appointment?"), a: guard("faq2a", "Section 5 gives three tests, and all three have to be true. They book with you, they tell you they found you through ChatGPT or an AI recommendation or AI search or a similar phrase, and they actually show up.") },
  { section: 5, q: guard("faq3q", "Who decides whether a booking qualifies?"), a: guard("faq3a", "You do. Section 5 says if we disagree, we default to your judgment.") },
  { section: 5, q: guard("faq4q", "How do we track the 5?"), a: guard("faq4a", "Together, in your monthly AI Visibility Report. You confirm each one. Section 5.") },
  { section: 4, q: guard("faq5q", "What is the monthly fee?"), a: guard("faq5a", "$499 per month, starting the month after the 5th qualified appointment. Section 4.") },
  { section: 4, q: guard("faq6q", "What does the $499 cover?"), a: guard("faq6a", "Ongoing page updates, reviews, NAP maintenance, AI Skin Concierge hosting and improvements, and the monthly report. Section 4.") },
  { section: 5, q: guard("faq7q", "Is there a setup fee?"), a: guard("faq7a", "No. Section 5 says no setup fee, no monthly fee and no hidden costs until the 5th qualified appointment lands.") },
  { section: 4, q: guard("faq8q", "Am I locked into a year?"), a: guard("faq8a", "No. Section 4 says no annual contract, and you can cancel with 30 days written notice at any time.") },
  { section: 9, q: guard("faq9q", "How do I cancel?"), a: guard("faq9a", "In writing, with 30 days notice, from either side. Section 9. Before the 5-appointment threshold you owe nothing. After it, you owe your final month prorated.") },
  { section: 4, q: guard("faq10q", "Is there a cancellation fee?"), a: guard("faq10a", "No. Section 4 says no cancellation fee and no clawback of the free work.") },
  { section: 1, q: guard("faq11q", "What exactly do you do for me?"), a: guard("faq11a", "Section 1 lists five things: rewrite key pages so ChatGPT can quote them, turn happy patients into review evidence, fix NAP mismatches across directories, install the AI Skin Concierge on your site, and send a monthly AI Visibility Report.") },
  { section: 1, q: guard("faq12q", "What is NAP?"), a: guard("faq12a", "Name, Address and Phone. Section 1 says we fix every mismatch across every directory we can find you on.") },
  // ‼️ FIVE NEW IN v5, FOR THE TWO NEW CLAUSES. Reviews and the booking path are the two things
  // in this agreement that ask the CLIENT to do something, so they are the two a signer pushes
  // back on. Without these the assistant has nothing grounded to answer with and falls through
  // to flag_for_human on the most predictable questions in the document.
  //
  // ‼️ THE SHORTFALL ANSWERS SAY "PAUSE THE ONGOING WORK", NEVER "PAUSE THE GUARANTEE CLOCK".
  // There is no clock in this agreement. See point 1 of the v5 note in config/onboarding2-agreement.ts.
  { section: 2, q: guard("faq31q", "Why do I have to get 5 reviews a month?"), a: guard("faq31a", "Section 2. Fresh reviews are what AI systems cite, and only your patients can leave them. We set up the automation, write the scripts, give your front desk a one tap request link and monitor your profiles weekly, but your team has to do the asking.") },
  { section: 2, q: guard("faq32q", "What if I miss the 5 reviews in a month?"), a: guard("faq32a", "Nothing is charged and nothing is clawed back. Section 2 gives you a 30 day catch up window and we help you close it. If you fall short two months in a row, we can pause the ongoing work until you are back at 5 a month.") },
  { section: 3, q: guard("faq33q", "Do I have to stop using my current booking system?"), a: guard("faq33a", "No. Section 3 says your existing system keeps running exactly as it does today for returning patients and phone bookings. The Concierge is the booking path for new patients arriving from your website and the new pages we write.") },
  { section: 3, q: guard("faq34q", "Why does the booking have to go through the Concierge?"), a: guard("faq34a", "So it can be counted. Section 5 only counts an appointment where the patient tells you they found you through AI. The Concierge asks that question and records the answer, which is why Section 3 makes it the primary booking path on your website.") },
  { section: 3, q: guard("faq35q", "Does the Concierge work with Vagaro or Boulevard?"), a: guard("faq35a", "Yes. Section 3 names Vagaro, Boulevard, Mindbody and Zenoti. The Concierge carries the visitor into whichever one you run and the booking is completed there, so the appointment shows up in the same calendar your front desk already works from.") },
  // ‼️ THESE THREE WERE REWRITTEN, NOT DELETED, WHEN v4's SECTION 5 WENT. They now answer ONLY what
  // the section 1 disclosure bullet says, which is less than old section 5 said. Anything beyond
  // it (HIPAA posture, transcript ownership, who owns the software) is no longer in the document
  // and the assistant must fall through to flag_for_human rather than answer from memory.
  { section: 1, q: guard("faq16q", "What is the AI Skin Concierge?"), a: guard("faq16a", "Section 1. A skin analysis widget we install on your site. It captures high-intent visitors, gives them a personalized skin assessment, and books qualified consultations into your calendar.") },
  { section: 1, q: guard("faq17q", "Is the Concierge a medical device?"), a: guard("faq17a", "No. Section 1 states it is not a medical device and it does not diagnose or treat.") },
  { section: 1, q: guard("faq18q", "What happens to the photos?"), a: guard("faq18a", "Section 1: any facial photo a visitor submits is used only for that analysis and deleted within 24 hours.") },
  { section: 6, q: guard("faq23q", "Do you work with my competitors?"), a: guard("faq23a", "Section 6: while you are an active client we will not take on another clinic offering the same primary service within a 10-mile radius of your primary location. If you cancel, that ends.") },
  // Re-pointed at section 10, where the cap now lives. The 3-month walk-away remedy that used to
  // sit beside it in old section 11 is gone, so this answer no longer mentions one.
  { section: 10, q: guard("faq25q", "What is your liability capped at?"), a: guard("faq25a", "Section 10 caps it at the total you have paid us in the previous 3 months, which starts at $0 until the 5-appointment mark. It excludes lost revenue, lost patients, third-party downtime and indirect damages.") },
  { section: 8, q: guard("faq28q", "How do we communicate?"), a: guard("faq28a", "Section 8: email or WhatsApp, whichever you prefer, and we respond to any message within one business day.") },
  { section: 10, q: guard("faq29q", "Which state's law applies?"), a: guard("faq29a", "North Carolina. Section 10. Any dispute goes to mediation in Guilford County before any lawsuit.") },
  { section: 11, q: guard("faq30q", "Does anything said on a call override this?"), a: guard("faq30a", "No. Section 11 says this document is the entire agreement, nothing said in a Loom, a call, an email or a text supersedes it, and changes have to be in writing signed by both sides.") },
];
