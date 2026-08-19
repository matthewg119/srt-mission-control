// The /onboardingfree constraint quiz. ONE definition, read by both sides.
//
// The client component renders from this and the submit route validates against it, the
// same contract src/config/client-intake.ts uses: a question cannot exist on screen
// without a place to land, and a stored key cannot drift from what was asked.
//
// WHY THIS EXISTS, AND WHY THE ORDER MATTERS. The free-build email closes by promising a
// quiz "to make sure we help the business where it needs the most help". This is it, and
// it is not the same job as /onboarding. That form asks a client who has already signed
// for their NAP, their review workflow and their access. This one asks a PROSPECT the one
// thing that decides whether we should sell them anything at all.
//
//   `need` and `breakdown` are the owner's OPINION of his constraint.
//   `inquiries`, `conversion`, `capacity` and `response_speed` are the numbers that
//   contradict it.
//
// They usually disagree, and the disagreement is the entire product of this form. See
// src/lib/onboarding-free/verdict.ts, which is where that comparison is made in code.
//
// `capacity` is the guardrail. An owner who is booked out or needs to hire is constrained
// by CAPACITY, and selling customer-side visibility to a saturated business is how a free
// pilot fails to produce the testimonial it was traded for.
//
// COPY NOTE. src/lib/copy-guard.ts throws at module evaluation on em dashes, en dashes and
// "--", so ranges are written "0 to 5" rather than a dashed range, and the negative
// capacity answers are "No, we are booked out" rather than the dashed form. Every guard()
// call below is what proves none crept back in during an edit.
//
// NOTHING PRICED. This form is sent to someone who was offered a free build. There is no
// amount, tier or upgrade anywhere in this file and it imports no price constant, the same
// rule client-intake.ts holds itself to.

import { guard } from "@/lib/copy-guard";

export type QuestionKind = "choice" | "multichoice" | "text";

export interface QuestionDef {
  key: string;
  /** The question. One per screen. */
  title: string;
  help?: string;
  kind: QuestionKind;
  options?: string[];
  placeholder?: string;
  required?: boolean;
  /**
   * Render this question only when an earlier answer is one of several values.
   *
   * client-intake.ts's FieldDef.showWhen is a single {field, equals} equality, which
   * cannot express "need is customers OR both". Widening the shared type would touch
   * every existing intake step, so this file carries its own narrower version instead.
   */
  showWhenIn?: { field: string; oneOf: string[] };
}

export interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "email" | "tel" | "textarea";
  required?: boolean;
  help?: string;
  placeholder?: string;
}

// ---------------------------------------------------------------------------
// Answer values, exported as constants.
//
// The verdict engine and the Slack card both branch on these strings. A label edited
// here and compared against a copy of itself there is a verdict that silently stops
// firing, so nothing downstream may hardcode one.
// ---------------------------------------------------------------------------

export const NEED = {
  customers: guard("need customers", "More customers"),
  talent: guard("need talent", "More people to do the work"),
  both: guard("need both", "Both"),
  unsure: guard("need unsure", "Not sure"),
} as const;

export const BREAKDOWN = {
  unknown: guard("breakdown unknown", "Not enough people know we exist"),
  noContact: guard("breakdown no contact", "People find us but do not reach out"),
  noBooking: guard("breakdown no booking", "They reach out but do not book"),
  noCapacity: guard("breakdown no capacity", "They book but we cannot keep up"),
  noRepeat: guard("breakdown no repeat", "They buy once and never come back"),
} as const;

export const HIRING = {
  boards: guard("hiring boards", "Indeed or job boards"),
  word: guard("hiring word", "Word of mouth"),
  recruiter: guard("hiring recruiter", "Recruiter"),
  nothing: guard("hiring nothing", "Nothing consistent"),
} as const;

export const INQUIRIES = {
  none: guard("inquiries none", "0 to 5"),
  few: guard("inquiries few", "6 to 20"),
  many: guard("inquiries many", "21 to 50"),
  flood: guard("inquiries flood", "50 or more"),
} as const;

export const CONVERSION = {
  almostAll: guard("conversion almost all", "Almost all"),
  half: guard("conversion half", "About half"),
  few: guard("conversion few", "Just a few"),
  untracked: guard("conversion untracked", "We do not track it"),
} as const;

export const CAPACITY = {
  easily: guard("capacity easily", "Yes, easily"),
  tight: guard("capacity tight", "Yes, but tight"),
  bookedOut: guard("capacity booked out", "No, we are booked out"),
  mustHire: guard("capacity must hire", "No, we would have to hire first"),
} as const;

export const FOUND_YOU = {
  google: guard("found google", "Google"),
  referral: guard("found referral", "Referral"),
  social: guard("found social", "Facebook or Instagram"),
  repeat: guard("found repeat", "Repeat customer"),
  signage: guard("found signage", "Truck or signage"),
  noIdea: guard("found no idea", "No idea"),
} as const;

export const ASKS_ATTRIBUTION = {
  yes: guard("asks yes", "Yes"),
  no: guard("asks no", "No"),
  sometimes: guard("asks sometimes", "Sometimes"),
} as const;

export const RESPONSE_SPEED = {
  hour: guard("speed hour", "Same hour"),
  day: guard("speed day", "Same day"),
  nextDay: guard("speed next day", "Next day"),
  slips: guard("speed slips", "Honestly, it slips"),
} as const;

// ---------------------------------------------------------------------------
// The questions. One per screen, in order.
// ---------------------------------------------------------------------------

const WANTS_CUSTOMERS: string[] = [NEED.customers, NEED.both];
const WANTS_TALENT: string[] = [NEED.talent, NEED.both];

export const QUESTIONS: QuestionDef[] = [
  // --- Block 1: the constraint -------------------------------------------
  {
    key: "need",
    title: guard("q need", "Right now, what does the business need more of?"),
    kind: "choice",
    required: true,
    options: [NEED.customers, NEED.talent, NEED.both, NEED.unsure],
  },
  {
    key: "breakdown",
    title: guard("q breakdown", "Where does it break down?"),
    kind: "choice",
    required: true,
    showWhenIn: { field: "need", oneOf: WANTS_CUSTOMERS },
    options: [
      BREAKDOWN.unknown,
      BREAKDOWN.noContact,
      BREAKDOWN.noBooking,
      BREAKDOWN.noCapacity,
      BREAKDOWN.noRepeat,
    ],
  },
  {
    key: "role",
    title: guard("q role", "What role do you need, and how many?"),
    kind: "text",
    required: true,
    showWhenIn: { field: "need", oneOf: WANTS_TALENT },
    placeholder: guard("q role ph", "Two technicians and a dispatcher"),
  },
  {
    key: "hiring",
    title: guard("q hiring", "How do you hire today?"),
    kind: "choice",
    required: true,
    showWhenIn: { field: "need", oneOf: WANTS_TALENT },
    options: [HIRING.boards, HIRING.word, HIRING.recruiter, HIRING.nothing],
  },
  {
    key: "inquiries",
    title: guard("q inquiries", "In a typical week, how many new inquiries come in?"),
    kind: "choice",
    required: true,
    options: [INQUIRIES.none, INQUIRIES.few, INQUIRIES.many, INQUIRIES.flood],
  },
  {
    key: "conversion",
    title: guard("q conversion", "Of those, how many turn into paying jobs?"),
    kind: "choice",
    required: true,
    options: [CONVERSION.almostAll, CONVERSION.half, CONVERSION.few, CONVERSION.untracked],
  },
  {
    key: "capacity",
    title: guard(
      "q capacity",
      "If 10 more customers showed up next week, could you serve them?"
    ),
    kind: "choice",
    required: true,
    options: [CAPACITY.easily, CAPACITY.tight, CAPACITY.bookedOut, CAPACITY.mustHire],
  },

  // --- Block 2: the money map --------------------------------------------
  {
    key: "money_maker",
    title: guard("q money maker", "Which service or job makes you the most money?"),
    kind: "text",
    required: true,
    help: guard(
      "q money maker help",
      "Not the one you do most often. Those are usually different."
    ),
  },
  {
    key: "fewer_of",
    title: guard("q fewer of", "Which one do you wish you got fewer of?"),
    kind: "text",
    required: true,
  },
  {
    key: "best_customer",
    title: guard("q best customer", "Describe your best customer in one line."),
    kind: "text",
    required: true,
    help: guard("q best customer help", "Like a person, not a demographic."),
  },
  {
    key: "lose_to",
    title: guard("q lose to", "Who do you lose deals to?"),
    kind: "text",
    required: true,
    help: guard("q lose to help", "Two or three names is plenty."),
  },

  // --- Block 3: how they get found today ---------------------------------
  {
    key: "found_you",
    title: guard("q found you", "Where do most customers say they found you?"),
    kind: "multichoice",
    required: true,
    help: guard("q found you help", "Pick every one that happens."),
    options: [
      FOUND_YOU.google,
      FOUND_YOU.referral,
      FOUND_YOU.social,
      FOUND_YOU.repeat,
      FOUND_YOU.signage,
      FOUND_YOU.noIdea,
    ],
  },
  {
    key: "asks_attribution",
    title: guard(
      "q asks attribution",
      "Do you ask how they heard about you on your intake form?"
    ),
    kind: "choice",
    required: true,
    options: [ASKS_ATTRIBUTION.yes, ASKS_ATTRIBUTION.no, ASKS_ATTRIBUTION.sometimes],
  },
  {
    key: "response_speed",
    title: guard(
      "q response speed",
      "When a new inquiry comes in, how fast does someone respond?"
    ),
    kind: "choice",
    required: true,
    options: [
      RESPONSE_SPEED.hour,
      RESPONSE_SPEED.day,
      RESPONSE_SPEED.nextDay,
      RESPONSE_SPEED.slips,
    ],
  },
];

/**
 * Who is answering. Asked LAST, on one screen, because the answers above are what earn
 * the ask. There is no token on this link, so this is the only identity we get.
 */
export const IDENTITY_FIELDS: FieldDef[] = [
  { key: "business", label: guard("id business", "Business name"), kind: "text", required: true },
  { key: "name", label: guard("id name", "Your name"), kind: "text", required: true },
  { key: "email", label: guard("id email", "Email"), kind: "email", required: true },
  {
    key: "phone",
    label: guard("id phone", "Mobile"),
    kind: "tel",
    required: true,
    // ONE number, asked once. It is the number we call, the number we message and the
    // NAP number. There is deliberately no separate WhatsApp question.
    help: guard("id phone help", "The number you actually answer."),
  },
];

/**
 * The access screen, shown AFTER the first submit and never before.
 *
 * The split is the point. The constraint answers commit on their own, so somebody who
 * closes the tab on this screen has still told us everything that decides whether to
 * take them on. Access is the housekeeping that follows a yes, not a toll gate in
 * front of the intel.
 */
export const ACCESS_FIELDS: FieldDef[] = [
  {
    key: "website",
    label: guard("acc website", "Website address, and who has access to it"),
    kind: "text",
    required: true,
    help: guard("acc website help", "The person or agency who can log in and change it."),
  },
  {
    key: "gbp",
    label: guard("acc gbp", "Google Business Profile, and who holds the login"),
    kind: "text",
    required: true,
    help: guard(
      "acc gbp help",
      "The listing with your hours and reviews on it. We ask to be added as a manager. We never need your password."
    ),
  },
  {
    key: "review_platforms",
    label: guard("acc reviews", "Which review sites do you use?"),
    kind: "text",
    help: guard("acc reviews help", "Google, Yelp, an industry directory, anything else."),
  },
  {
    key: "nap",
    label: guard(
      "acc nap",
      "Your name, address and phone, written exactly as you publish them"
    ),
    kind: "textarea",
    required: true,
    help: guard(
      "acc nap help",
      "We make every directory match these, character for character."
    ),
  },
  {
    key: "point_of_contact",
    label: guard("acc contact", "Who should we deal with day to day, and on what number?"),
    kind: "text",
    required: true,
  },
];

export const INTRO_COPY = {
  heading: guard("intro heading", "A few questions before we start"),
  body: guard(
    "intro body",
    "This takes about three minutes. It tells us where the business is actually stuck, so the work we do is pointed at that instead of at something we guessed."
  ),
  cta: guard("intro cta", "Start"),
};

/**
 * The ending. It promises nothing and commits to no timeline.
 *
 * Same discipline as client-intake.ts's COMPLETION_COPY: this screen is read by someone
 * who has not been sold anything, and a date invented here is one we get measured against
 * before anybody has spoken.
 */
export const SUBMITTED_COPY = {
  heading: guard("submitted heading", "Got it. That is the part that matters."),
  body: guard(
    "submitted body",
    "One last screen, and it is the boring half: where things live and who has the keys."
  ),
  skip: guard("submitted skip", "I will send these later"),
};

export const DONE_COPY = {
  heading: guard("done heading", "That is everything. Thank you."),
  body: guard(
    "done body",
    "We will read this properly and come back to you on the same email thread."
  ),
};

export const ACCESS_COPY = {
  heading: guard("access heading", "Where things live"),
  body: guard(
    "access body",
    "Just what exists and who holds it. We do not need a single password, now or ever."
  ),
};

/**
 * Is this question asked, given what has been answered so far?
 *
 * Exported because the SERVER has to compute this too. On /api/onboarding/save the
 * equivalent gate is client-side only, so a hidden required field 400s and the client
 * cannot get past it. Both sides call this one function so they cannot disagree.
 */
export function isVisible(q: QuestionDef, answers: Record<string, unknown>): boolean {
  if (!q.showWhenIn) return true;
  const value = answers[q.showWhenIn.field];
  return typeof value === "string" && q.showWhenIn.oneOf.includes(value);
}

/** The questions actually asked for a given set of answers, in order. */
export function visibleQuestions(answers: Record<string, unknown>): QuestionDef[] {
  return QUESTIONS.filter((q) => isVisible(q, answers));
}
