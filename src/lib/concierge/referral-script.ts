// The AI Referral Engine walk: what the widget says, in order, and what it asks for.
//
// ‼️ THIS FILE IS DATA, NOT A MODEL, AND THE WHOLE POINT IS THAT IT COULD NOT BE ONE. It imports the
// copy guard and nothing else. There is no fetch per turn, no generation, no branching on what the
// visitor wrote. Same rule review-script.ts is built around: the Virtual Agent's walk is a step array
// in the bundle, and the model is not in it.
//
// ‼️ IT IS NOT review-script.ts AND IT DOES NOT WIDEN IT. That file has three step kinds (say, ask,
// gate) and a type comment explaining why a gate's answer can never be stored: it is the FTC boundary
// for the review tool, where a tool that reformats what a customer typed is legal and a tool that
// generates review content is not. Nothing in this walk is a review, so borrowing that type would put
// this lane's steps inside a type whose whole purpose is a rule that does not apply to it, and the
// next person to widen it for us would be widening the review tool's safety type. Two small arrays.
//
// ‼️ THE COPY IS MATTHEW'S, VERBATIM WHERE HE WROTE IT. The only lines that are not fixed are the two
// times, which come from resolveBooking() and are REAL or are not offered. See the SLOTS step.
//
// ‼️ EVERY STRING GOES THROUGH guard(). This is read out on a med spa's own website, so it is copy,
// and copy-guard throws at module evaluation on an em dash, an en dash or a "--".

// ‼️ THE TWO EMAILS THIS WALK PROMISES ARE SENT AS OF feat/referral-emails. Step four says "we will
// send your download link promptly" and the closing line says "plus the email we already sent you". Both
// were false on the lane branch alone, which is why that branch carried a do-not-merge note; the email
// lands in src/lib/concierge/referral-email.ts and is sent from the contact action. If this file and that
// one are ever separated again, the promise goes back to being false.
//
// ‼️ AND "DOWNLOAD" IS NOT WHAT THE PRODUCT IS, WHICH IS A COPY QUESTION FOR MATTHEW. The AI
// Referral Engine is a hosted tool: src/config/pitch.ts sells it as "set up on your site", step 17 is
// `referral_engine_preview`, and this very script ends with a technician installing it. There is no file
// anywhere in this repo to download and no env var naming one, unlike MEDSPA_QUESTIONS_PDF_URL for the
// question magnet. So the email can carry a real link only if somebody makes an asset, and until then
// the honest email describes the install rather than linking to nothing. Two words in step four would
// fix it ("your setup link"), and changing his copy is not mine to do.

import { guard } from "@/lib/copy-guard";

/**
 * One step of the walk.
 *
 * `say`   the agent talking. Fixed copy, no input, advances on its own.
 * `ask`   one free-text answer, stored against `key`.
 * `form`  the four contact fields, all at once, because they are one act of typing.
 * `chips` a choice between fixed labels, stored against `key`.
 * `slots` the two real appointment times. The only step whose text is not fully fixed.
 * `end`   the last thing said. Nothing follows it.
 */
export type ReferralStep =
  | { kind: "say"; id: string; text: string }
  | { kind: "ask"; id: string; key: ReferralKey; prompt: string; placeholder: string }
  | { kind: "form"; id: string; prompt: string; cta: string }
  | { kind: "chips"; id: string; key: ReferralKey; prompt: string; options: ReferralChip[] }
  | { kind: "slots"; id: string; prompt: string }
  | { kind: "end"; id: string; text: string };

/** What an answer is filed under. Contact details are NOT here: they go through captureLead. */
export type ReferralKey = "reviews" | "website" | "daypart";

export interface ReferralChip {
  /** What the visitor sees. */
  label: string;
  /** What is recorded and sent to the server. Never the label: the label is copy and may be edited. */
  value: "morning" | "afternoon";
}

/** The label on the door that starts this walk. Matthew's words, 2026-09-25. */
export const REFERRAL_DOOR_LABEL = guard("referral door", "Download Free AI Referral Engine");

/**
 * The two times step, phrased as Matthew wrote it: one offered, one alternative.
 *
 * ‼️ TEMPLATES WITH SLOTS, NOT FUNCTIONS, BECAUSE THE FRAME IS THE ONE THAT FILLS THEM. The walk
 * runs in a hand-written script inside /w/[slug], which has no bundle and cannot call into this module.
 * Exporting a function would mean the copy lived here and a SECOND copy lived in the frame, which is
 * how the two sentences drift. The route inlines these strings and the frame substitutes.
 *
 * ‼️ AND THE TIMES ARE REAL OR THE STEP IS NOT SHOWN. {a} and {b} are labels resolveBooking()
 * returned for appointments that are actually open. A day or a time written into this copy would make
 * the one step in the lane that must never invent a fact the only one that does.
 */
export const REFERRAL_TIMES_COPY = {
  /** Two open times: the one we are proposing, and the alternative. */
  two: guard("referral slots", "We can do {a}, or would {b} suit you better?"),
  /** Only one came back for the half of the day they asked for. Offered alone, never padded. */
  one: guard("referral one slot", "The next one I have is {a}. Does that work?"),
  /** Their half of the day had none, and the other half did. Said before the times, not instead. */
  otherHalf: guard("referral other half", "The closest I have to that is below."),
} as const;

/** Fill a template. One place, so the frame and any server caller cannot differ. */
export function fillTimes(template: string, a: string, b?: string): string {
  return template.replace("{a}", a).replace("{b}", b ?? a);
}

export const REFERRAL_SCRIPT: ReferralStep[] = [
  {
    kind: "say",
    id: "open",
    text: guard("referral open", "Sounds good, let me work on that for you."),
  },
  {
    kind: "ask",
    id: "q_reviews",
    key: "reviews",
    prompt: guard("referral reviews", "How many reviews does your clinic have?"),
    placeholder: guard("referral reviews hint", "A rough number is fine"),
  },
  {
    kind: "ask",
    id: "q_website",
    key: "website",
    prompt: guard("referral website", "Ok, and what is your clinic's website?"),
    placeholder: guard("referral website hint", "yourclinic.com"),
  },
  {
    kind: "form",
    id: "contact",
    prompt: guard(
      "referral form",
      "Please complete the following information and we will send your download link promptly."
    ),
    cta: guard("referral form cta", "Send my download link"),
  },
  {
    kind: "chips",
    id: "q_daypart",
    key: "daypart",
    prompt: guard(
      "referral daypart",
      "Our last step is installing your AI Referral Engine so it works 24/7 for you. One of our " +
        "technicians will be on the call with you. Would you rather do mornings or afternoons?"
    ),
    options: [
      { label: guard("referral morning", "Mornings"), value: "morning" },
      { label: guard("referral afternoon", "Afternoons"), value: "afternoon" },
    ],
  },
  {
    // The text for this one is built by slotsPrompt() from what the calendar returned.
    kind: "slots",
    id: "q_slot",
    prompt: "",
  },
  {
    kind: "end",
    id: "close",
    text: guard(
      "referral close",
      "You will get a confirmation email, plus the email we already sent you."
    ),
  },
];

/**
 * What the frame is told when the calendar has no times to offer for their daypart.
 *
 * ‼️ FIVE MODES, NOT FOUR, AND NONE OF THEM INVENTS A TIME. resolveBooking distinguishes an empty
 * diary (`no_slots`) from a broken integration on purpose, and this lane must not collapse them: a
 * rotated Calendly token has to read as "we will come back to you", never as "there are no
 * appointments", which is a claim about the business.
 */
export const REFERRAL_NO_TIMES = {
  link: guard("referral link", "Here is the calendar. Pick whichever time suits you."),
  phone: guard("referral phone", "The fastest way to book the install is to call us."),
  callback: guard(
    "referral callback",
    "I do not have times to offer this minute. We will come back to you with some, and your download " +
      "link is on its way either way."
  ),
} as const;

/** The step ids, for the probe. A walk whose ids drift is a walk whose resume points drift. */
export const REFERRAL_IDS = REFERRAL_SCRIPT.map((s) => s.id);
