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
  | "daypart"
  | "callDay"
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
    // ‼️ THE GREETING STEP IS GONE AND ITS SENTENCE IS THE FIRST QUESTION. Matthew,
    // 2026-10-06: the chat should open with "Lets get you started, what is your first name?"
    // rather than "Good to hear from you. A few quick things and your cards are on their way."
    // He is right about the order of business: they have just tapped a button that said claim
    // your cards, so a bubble telling them their cards are on the way is answering a question
    // nobody asked, and it costs the first screen of the conversation.
    kind: "ask",
    id: "q_first",
    key: "firstName",
    prompt: guard("cards first", "Let us get you started. What is your first name?"),
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
    // ‼️ IT NO LONGER SAYS "your choice", because one of the two is closed. Copy that offers a
    // choice beside a disabled button is the funnel contradicting its own screen.
    prompt: guard("cards fork", "Last step. Let us get you on the setup call."),
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
    available: true,
  },
  self: {
    key: "self",
    label: guard("cards fork self", "Set it up myself"),
    // ‼️ SHOWN, DISABLED, AND LABELLED "Not available". Matthew, 2026-10-05, wants the self-serve
    // route closed so every clinic lands on the call, and wants the option visible so the choice
    // feels like one.
    //
    // ‼️ THE HONEST VERSION OF THAT IS A GREYED-OUT BUTTON THAT SAYS SO, AND THAT IS WHAT THIS IS.
    // A live-looking button that silently fails, or a path that collects answers and then drops
    // them, would be a different thing entirely: it would waste a clinic's time and they would
    // find out afterwards. "Not available" is a roadmap item shown in the open; it costs nobody a
    // minute and it is true.
    note: guard("cards fork self note", "Not available yet. The call is the only way in for now."),
    available: false,
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

/**
 * When they would rather be called.
 *
 * ‼️ THE SAME SHAPE AS THE CONCIERGE'S REFERRAL WALK (src/lib/concierge/referral-script.ts), which
 * is what Matthew means by "the exact same flow". Two chips, stored as a VALUE and never as the
 * label, because the label is copy and may be edited while the stored value is read by code.
 *
 * ‼️ IT DOES NOT PROMISE A TIME. The chips record a preference that reaches the Slack card; the
 * calendar is still what books anybody. A funnel that says "great, Tuesday at 10" without
 * touching a calendar is the one lie this flow could tell that somebody turns up for.
 */
export const DAYPART_STEP: Extract<CardStep, { kind: "chips" }> = {
  kind: "chips",
  id: "q_daypart",
  key: "daypart",
  prompt: guard("cards daypart", "When suits you better for the call?"),
  options: [guard("cards daypart am", "Mornings"), guard("cards daypart pm", "Afternoons")],
};

/** What is said once there is nothing left to ask, per branch. */
export const CARDS_CLOSE = {
  call: guard(
    "cards close call",
    "Perfect. Pick a time that works and we will see you then. Your cards are on their way."
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

/**
 * The opening card, before the chat.
 *
 * ‼️ THE SAME SHAPE AS THE REVIEW WALK'S CARD, AND THAT IS THE POINT. Matthew, 2026-10-06,
 * comparing the two: "for #4 i say we make it the same as number 1 2 and 3 for the initial start
 * button... but we just change the copy to the cta we have". A clinic sees the review walk in the
 * sales conversation and this the week after, so two different front doors is two products.
 *
 * ‼️ AND THE BUTTON NAMES THE THING THEY GET, NOT THE THING WE WANT. "Claim your QR card now" is
 * his wording. The old page opened straight into a chat with no statement of what it was for,
 * which is the one thing a clinic arriving from an email a week later needs.
 */
export const CARDS_HERO = {
  // Who is talking, at the top of both states.
  //
  // ‼️ THE LOCKUP REPLACED THE CHAT PANEL'S HEADER (2026-10-07), which was a dot and the word
  // SRT inside a bordered box. Rendering the same two lines in both states is what makes the chat
  // the same section as the opening screen rather than a second screen that replaced it.
  brand: guard("cards hero brand", "SRT Agency"),
  product: guard("cards hero product", "AI Referral Engine"),

  // One block, said once.
  //
  // ‼️ topEyebrow, topTitle AND topSub ARE GONE, AND SO IS THE HAIRLINE BETWEEN THEM. The card
  // used to make a promise, draw a rule, and then start again with a second eyebrow and heading
  // saying what the thing was. Matthew, 2026-10-07: "this build my referral engine i dont like
  // it", and then five phone screens he had designed, every one of which is an eyebrow, a line, a
  // sentence and three facts. This is his fifth screen, the dark one, because this page is dark.
  //
  // ‼️ IT STILL SELLS NOTHING, which _probe-cards-funnel.ts holds. No price, no plan name and
  // no offer key. The clinic already said yes to a free batch of cards in an email, and the chat
  // behind this screen is unchanged: the questions were always about the business.
  eyebrow: guard("cards hero eyebrow", "Ready when you are"),
  title: guard("cards hero title", "Your patients already love you"),
  lede: guard(
    "cards hero lede",
    "Now let us make sure Google and ChatGPT know it too. Answer a few questions about your business and we build the rest."
  ),
  // Three, in the order the icons in cards-client.tsx draw them: the review, the referral, the
  // search. A fourth is where a list of wins becomes a brochure.
  facts: [
    guard("cards hero fact 1", "More reviews from every checkout"),
    guard("cards hero fact 2", "More referrals from every visit"),
    guard("cards hero fact 3", "More visibility in every search"),
  ],
  cta: guard("cards hero cta", "Build my referral engine"),
  // Under the button, in the smallest type on the page. It says what the tap costs and what comes
  // with it, which is what somebody still deciding wants and somebody decided skips.
  foot: guard("cards hero foot", "QR cards included · about two minutes"),
} as const;

/**
 * Which day the setup call lands on.
 *
 * ‼️ THE OPTIONS ARE COMPUTED AT RENDER TIME AND ARE NOT IN THIS FILE. They are three real dates
 * in the VISITOR's own timezone, so "Today" has to mean their today. A static list here would be
 * three labels that drift from the calendar behind them within a day.
 *
 * ‼️ AND IT ASKS FOR FIFTEEN MINUTES, WHICH IS WHAT THE CALL ACTUALLY IS. CARDS_FORK's note says
 * ten to fifteen; asking for "a few minutes" and then booking an hour is how a no-show happens.
 */
export const DAY_STEP = {
  id: "q_day",
  key: "callDay" as const,
  prompt: guard(
    "cards day",
    "When in the next 3 days do you have 15 minutes to get your referral engine fully set up?"
  ),
} as const;

/**
 * The two times offered before the calendar is.
 *
 * ‼️ TWO REAL OPENINGS, NOT A PROMISE. Every slot here comes back from Calendly's own availability
 * with its own booking URL, so tapping one books that exact time and cannot offer something that
 * has gone. DAYPART_STEP's header warns against a funnel that says "great, Tuesday at 10" without
 * touching a calendar; this touches the calendar, which is what makes the shortcut honest.
 *
 * ‼️ THE CALENDAR IS STILL THERE, BEHIND ONE TAP. Matthew: "there we can add a button that says
 * 'I want another time' only then we can give them the calendar." Two choices and an escape beats
 * a grid of thirty, and nobody is trapped by the two.
 */
export const CARDS_SLOTS = {
  prompt: guard("cards slots", "Here are the two closest openings. Which works?"),
  another: guard("cards slots another", "I want another time"),
  /** When availability cannot be read, or that half-day is full. The calendar is the fallback. */
  none: guard(
    "cards slots none",
    "Nothing is open in that window. Here is the full calendar instead."
  ),
  booking: guard("cards slots booking", "Good. Confirm it here and you are done."),
} as const;

/**
 * Which Calendly event type this funnel's setup call IS.
 *
 * ‼️ IT IS HERE, SHARED, BECAUSE THE PICKER AND THE FALLBACK EMBED MUST NAME THE SAME EVENT. Two
 * routes decide what /cards books: /api/cards/slots reads availability, and /api/cards mints the
 * whole-calendar URL for when there is none. Those naming different event types is a funnel that
 * offers two openings on one calendar and then books people onto another, and nothing would fail
 * loudly enough to notice.
 *
 * ‼️ IT WAS "install" UNTIL 2026-10-06 AND THAT MADE THE PICKER DEAD CODE. eventTypeUri("install")
 * resolves CALENDLY_INSTALL_UUID, which is set in no environment: not production, not preview, not
 * .env.local. So fetchSlots returned { slots: null, reason: "unconfigured" } on every call ever
 * made, every visitor got the "nothing is open in that window" fallback, and the two-slot shortcut
 * had never once rendered. scripts/_probe-calendly.ts says in capitals not to set that variable,
 * because install "belongs to the post-sale lane and is not wired here" -- so the event to name is
 * the one that exists. CALENDLY_15MIN_UUID and NEXT_PUBLIC_CALENDLY_15MIN_URL are both set.
 *
 * A plain string literal, deliberately, and not EventKind imported from @/lib/calendly: this module
 * is imported by the browser bundle and the type is structural anyway. TypeScript still checks it
 * at both call sites.
 */
export const CARDS_CALENDLY_KIND = "15min" as const;
