// The card-led onboarding: the chatbox a clinic lands on after the QR cards arrive.
//
// Matthew, 2026-10-05: "create a variation of onboarding2 but without the selling cards, make it
// more like a chatbox where we ask them name, last name, email, website, if no website yes offer
// the free upsell and make sure i get notified when we get the hot lead, ask for yearly rev."
//
// ‼️ A SIBLING OF /onboarding2, NOT AN EDIT OF IT, AND THAT IS THE WHOLE DESIGN DECISION.
// onboarding2 sells: it shows the three-offer picker, quotes value, and its own header explains
// why the price is absent from the cards and present on the call. This funnel sells NOTHING. The
// clinic already said yes to a free batch of cards in an email; the job here is to find out who
// they are, hand them the two ways to finish, and get Matthew a notification. Bolting a
// "no cards" mode onto that file would have meant a conditional through its picker, its offer
// sheets, its reactivation add-on and its agreement copy, and the next person reading any of
// those would have to hold two funnels in their head.
//
// What IS shared, deliberately, is everything that is not presentation: guard() for the copy
// rule, ingestLead() for the lead and the Slack card, and REVIEW_PLATFORMS for the destination
// question, so a seventh platform added once shows up here too.
//
// ‼️ THE FORK AT THE END IS EXCLUSIVE, AND THAT IS HIS CALL. "if this happen then its better if
// we dont give them the option to finish the offer and setup which provider he wants the reviews
// sent to." Booking the call means the platform and the offers are decided live, with somebody
// who can explain the trade. Offering both would mean a clinic half-configuring itself and then
// arriving at a call that has to undo it.
//
// ‼️ AND NOTHING HERE MENTIONS HIPAA. His own read, which is right: the real artifact is a
// Business Associate Agreement and it belongs on the call. Labelling an offer-setup step "for
// HIPAA compliance" is a pressure tactic an owner works out later. The compliance step below says
// what it actually gates, which is the automated texting, and the card itself needs none of it.

import { guard } from "@/lib/copy-guard";
import { REVIEW_PLATFORMS } from "@/lib/hub/review-destinations";

/** Where the lead lands, and the value `contacts.source` carries. */
export const CARDS_SOURCE = "cards";

/**
 * One step of the walk.
 *
 * `say`      the agent talking. No input, advances on its own.
 * `ask`      one free-text answer, stored against `key` and validated by `validate`.
 * `chips`    a choice between fixed labels, stored against `key`.
 * `consent`  the one step that gates nothing and promises nothing. Read and acknowledged.
 * `fork`     the last step. Two ways to finish, and taking one closes the other.
 */
export type CardStep =
  | { kind: "say"; id: string; text: string }
  | {
      kind: "ask";
      id: string;
      key: CardKey;
      prompt: string;
      placeholder: string;
      validate: "name" | "email" | "website";
      /** The escape hatch, when not answering is itself an answer. */
      skip?: { label: string; value: string };
    }
  | { kind: "chips"; id: string; key: CardKey; prompt: string; options: readonly string[] }
  | { kind: "consent"; id: string; prompt: string; cta: string }
  | { kind: "fork"; id: string; prompt: string };

export type CardKey =
  | "firstName"
  | "lastName"
  | "email"
  | "website"
  | "revenue"
  | "platform";

/** The revenue bands, in Matthew's words and his order. */
export const REVENUE_BANDS = [
  guard("cards rev 1", "Under $100k a year"),
  guard("cards rev 2", "$100k to $250k"),
  guard("cards rev 3", "$250k to $500k"),
  guard("cards rev 4", "More than $500k"),
] as const;

/**
 * The marker a website answer carries when they have none.
 *
 * ‼️ A SENTINEL RATHER THAN AN EMPTY STRING, so "they told us they have no website" and "we never
 * asked" stay different things. The first earns the free-website offer and a line on the Slack
 * card; the second is a gap.
 */
export const NO_WEBSITE = "__none__";

export const CARDS_SCRIPT: readonly CardStep[] = [
  {
    kind: "say",
    id: "open",
    text: guard(
      "cards open",
      "Good to hear from you. A few quick things and your cards are on their way."
    ),
  },
  {
    kind: "ask",
    id: "q_first",
    key: "firstName",
    prompt: guard("cards first", "What is your first name?"),
    placeholder: guard("cards first hint", "First name"),
    validate: "name",
  },
  {
    kind: "ask",
    id: "q_last",
    key: "lastName",
    prompt: guard("cards last", "And your last name?"),
    placeholder: guard("cards last hint", "Last name"),
    validate: "name",
  },
  {
    kind: "ask",
    id: "q_email",
    key: "email",
    prompt: guard("cards email", "What is the best email for you?"),
    placeholder: guard("cards email hint", "you@yourclinic.com"),
    validate: "email",
  },
  {
    kind: "ask",
    id: "q_website",
    key: "website",
    prompt: guard("cards website", "What is your clinic's website?"),
    placeholder: guard("cards website hint", "yourclinic.com"),
    validate: "website",
    skip: {
      label: guard("cards website none", "We do not have one"),
      value: NO_WEBSITE,
    },
  },
  {
    kind: "chips",
    id: "q_revenue",
    key: "revenue",
    prompt: guard("cards revenue", "Roughly what is the clinic doing a year?"),
    options: REVENUE_BANDS,
  },
  {
    kind: "say",
    id: "ack_revenue",
    text: guard("cards ack revenue", "Ok, sounds good. That is everything we needed."),
  },
  {
    // ‼️ IT GATES NOTHING AND SAYS SO. Read once and acknowledged. The card the clinic is about
    // to hand out needs no agreement from anybody: the patient uses her own phone and her answers
    // are not tied to her name. What needs a BAA is the automated texting, later, and only once
    // they hand us patient numbers. Saying that here is the difference between a reason and a
    // pressure tactic.
    kind: "consent",
    id: "compliance",
    prompt: guard(
      "cards compliance",
      "One thing worth knowing before the call. The cards need no paperwork: your patients use " +
        "their own phones and their answers are not tied to their names. If you later want us " +
        "to send review requests for you, that is the point where we will need a signed Business " +
        "Associate Agreement and confirmation that your intake forms already cover texting. We " +
        "will walk through it together."
    ),
    cta: guard("cards compliance cta", "Understood"),
  },
  {
    kind: "fork",
    id: "finish",
    prompt: guard(
      "cards fork",
      "Last step, and it is your choice which one."
    ),
  },
];

/**
 * The two ways to finish.
 *
 * ‼️ THE CALL IS THE RECOMMENDED ONE AND IS LISTED FIRST, because it is the one where the offers
 * get set properly. "10 to 15 mins in front of the pc to review all that we've done on how the
 * system works and to setup which platform" is Matthew's description of it, and the copy below
 * is that, in his order: what it takes, where they need to be, what gets decided.
 */
export const CARDS_FORK = {
  call: {
    key: "call",
    label: guard("cards fork call", "Book the setup call"),
    note: guard(
      "cards fork call note",
      "Ten to fifteen minutes, in front of a computer. We walk you through what is already " +
        "built, set which platform your reviews go to, and write your referral offers together."
    ),
  },
  self: {
    key: "self",
    label: guard("cards fork self", "Set it up myself now"),
    note: guard(
      "cards fork self note",
      "One question, and we will email you the rest. You can always book the call later."
    ),
  },
} as const;

export type CardsFinish = keyof typeof CARDS_FORK;

/**
 * The self-serve tail: one question, which is the one Matthew named.
 *
 * ‼️ IT ASKS FOR A PLATFORM AND NEVER A URL, the same rule onboarding2's q7 carries and for the
 * same reason: a review URL typed into a chat box, or worse constructed by us from a business
 * name, is a link that can send a real patient to somebody else's profile. We pull the actual
 * link off their Maps listing ourselves.
 *
 * ‼️ AND IT IS NOT SHOWN TO ANYBODY WHO BOOKED. That is the exclusivity in CARDS_FORK's header.
 */
export const CARDS_PLATFORM_STEP: Extract<CardStep, { kind: "chips" }> = {
  kind: "chips",
  id: "q_platform",
  key: "platform",
  prompt: guard("cards platform", "Where do you want your patient reviews to go?"),
  // The shared table, not a copy of it. A seventh platform is one entry there.
  options: REVIEW_PLATFORMS.map((p) => guard(`cards platform ${p.key}`, p.name)),
};

/** What is said once there is nothing left to ask, per branch. */
export const CARDS_CLOSE = {
  call: guard(
    "cards close call",
    "Booked. You will get a confirmation email, and your cards are on their way."
  ),
  self: guard(
    "cards close self",
    "All set. We will email you the setup sheet, and your cards are on their way."
  ),
} as const;

/** The free website offer, when they said they have none. Matthew's upsell, his words. */
export const CARDS_FREE_SITE = {
  prompt: guard(
    "cards free site",
    "No website is not a problem, and it is worth fixing. We will build you one free. Do not pay " +
      "unless you love it, and we will email you a few options within 4 hours."
  ),
  yes: guard("cards free site yes", "Yes, send me the options"),
  no: guard("cards free site no", "No thanks"),
  ackYes: guard(
    "cards free site ack yes",
    "Done. A few options will be in your inbox within 4 hours. Nothing is charged."
  ),
  ackNo: guard("cards free site ack no", "No problem."),
} as const;

/** The step ids, for the probe. A walk whose ids drift is a walk whose analytics drift. */
export const CARDS_IDS: readonly string[] = CARDS_SCRIPT.map((s) => s.id);
