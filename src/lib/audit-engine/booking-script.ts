// The BOOKING CALL lane: the phone script for a lead who got the Email hook and went quiet.
//
// A third call, and it is genuinely a third one rather than a variant. The two that already exist
// in call-script.ts are:
//
//   buildFollowupScript  earn "yes, send it over", and get them to reply to the email while still
//                        on the phone. Nothing is sold. It ends on a reply.
//   buildCallScript      they have watched the video and this is a decision. It ends on paperwork.
//
// This one ends on a CALENDAR INVITE. The ask is fifteen minutes tomorrow morning or afternoon and
// their best email address, and that is the whole outcome. Matthew's own script, transcribed in
// BOOKING_EXAMPLE below, is the reference: it is what he actually says on these calls.
//
// ‼️ IT IS A SEPARATE FILE BECAUSE CallFacts IS AUDIT-SHAPED AND THIS LANE HAS NO AUDIT. Every
// field that makes CallFacts useful — score, organicAppeared, absentPrompts, competitors, icp,
// antiIcp, price, tier, guarantee — comes off a finished audit_reports row via buildCallFacts.
// This call follows the Email hook, which exists precisely so an audit is NOT spent before someone
// replies, so requiring one would make the button unreachable on the leads it is for. What it does
// instead is take the audit when there is one and stay honest when there is not.
//
// ‼️ IT IS NOT A SECOND SCRIPT PIPELINE. hardLines, lintSpoken, PUSHBACKS, isDirection, bullets and
// the agency identity are all IMPORTED from call-script.ts, never restated. Same rule the workflow
// route's own header states: a lane that assembles its own guards bypasses them silently, and the
// failure looks like slightly worse copy rather than like a bug.

import { callClaudeJSON } from "@/lib/claude-calls";
import {
  AGENCY_NAME,
  FROM_DOMAIN,
  MAX_SPOKEN_WORDS,
  PUSHBACKS,
  bullets,
  hardLines,
  isDirection,
  lintSpoken,
  type SpokenIdentity,
} from "./call-script";
import { noDashes } from "./email-assistant";

const PUSHBACK_COUNT = PUSHBACKS.length;

// ─────────────────────────────────────────────────────────────────────────────
// What the call may claim
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ WHAT WENT OUT BEFORE THIS CALL, AND IT IS DECIDED IN CODE, NEVER BY THE MODEL.
 *
 * Matthew's script says "my team emailed over a report with the whole 9 yards". That sentence is
 * true on exactly one of these three states and it is the strongest line in the call, so it cannot
 * be left to a model that will reach for it every time because it reads well.
 *
 * Same rule run-prompts.ts enforces with status:"no_data" and pickAngle enforces in the no-website
 * lane: offer to look, never claim to have looked. A prospect who is told a report was sent and
 * cannot find one is a prospect who now believes nothing else on the call either, and it is the
 * error they catch on the first line.
 */
export type PriorContact =
  | "report_sent"   // a finished audit exists AND something went to this address
  | "hook_sent"     // the four-question hook email went out. No report was ever produced
  | "nothing_sent"; // we have not written to them at all

function priorContactBlock(prior: PriorContact): string {
  switch (prior) {
    case "report_sent":
      return (
        "WHAT THEY HAVE ALREADY BEEN SENT: a real audit was run on this business and an email went " +
        "out to this address. He may say his team emailed over a report, because they did. He may " +
        "NOT describe anything in it that is not in FACTS below."
      );
    case "hook_sent":
      return (
        "WHAT THEY HAVE ALREADY BEEN SENT: one short email, off FOUR buyer questions put to " +
        "ChatGPT. ‼️ NO REPORT WAS EVER PRODUCED AND NONE WAS SENT. He may say they ran some " +
        "questions for another client in the area and emailed over what came back. He may NOT say " +
        "a report, an audit, a full analysis or a scorecard was sent, and must not offer to " +
        "resend one. The report is what the fifteen minutes is FOR, not something already owed."
      );
    case "nothing_sent":
      return (
        "‼️ NOTHING HAS BEEN SENT TO THIS PROSPECT. No email, no report, no video. He may say they " +
        "were running questions for another client in the area and this business came up, because " +
        "that is why he is calling. He may NOT say anything was emailed, sent, shared or " +
        "delivered, and must not refer to a report they are supposed to have. Everything is an " +
        "OFFER on this call, nothing is a follow-up."
      );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The reference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Matthew's own booking call, transcribed exactly (2026-08-22).
 *
 * ‼️ IT TEACHES SHAPE, NOT CONTENT. priorContactBlock decides what may be claimed; this decides how
 * it sounds. Same division of labour as NO_WEBSITE_EXAMPLE / miniCheckContext and HOOK_EXAMPLE /
 * hookCheckContext, and it exists for the reason those two do: rules constrain what a script may
 * CLAIM, and only an example constrains how it READS. Handed rules alone, the model writes a
 * competent telemarketing script, which is the one thing this call cannot sound like.
 *
 * Note what it does: it never says "following up", it puts the ChatGPT question early and casually,
 * it disqualifies before it qualifies ("usually we cant really help every business owner"), and the
 * booking ask arrives with a reason to be short. Note also the second line, which is the prospect
 * answering, not the rep talking.
 */
/**
 * ‼️ THE FIVE QUESTIONS ARE CODE, NOT PROMPT. They are Matthew's words and they ship verbatim.
 *
 * Same decision the no-website lane made about its three buyer questions and for the same two
 * reasons. A model asked to write intake questions invents ones about services this business does
 * not offer, and two prospects in the same trade end up answered on different questions, so
 * nothing is comparable across calls. These five are the onboarding, and the onboarding does not
 * vary by who is on the phone.
 *
 * ‼️ THE REVIEWS QUESTION ASKS, IT NEVER ADVISES. "Do you offer anything in exchange for a review"
 * is a diagnostic: it tells us what is already happening, and an incentivised-review programme is
 * something we need to KNOW about because it is a Google policy problem and an FTC 16 CFR Part 465
 * problem we may have to unwind. The rep may never suggest, endorse or help design one. That is
 * stated in the prompt as a hard line and it is the reason this block is not left to a model.
 */
const INTAKE_INTRO =
  "But before I let you go, let me just ask you 5 quick questions I need to have clear so I can " +
  "have everything ready for you on the call tomorrow. I want to make sure I don't waste your " +
  "time and have everything prepped beforehand.";

export const INTAKE_BLOCKS: Array<{ label: string; questions: string[]; note?: string }> = [
  {
    label: "1 · Website",
    questions: [
      "What's your website built on, WordPress, Wix, Squarespace, Webflow? Or was it a person or agency that built it?",
      "And does any previous employee or old developer still have access to it?",
    ],
  },
  {
    label: "2 · Google Business Profile",
    questions: [
      "Do you have a Google Business Profile set up? And who has the login for it, you or someone on your team?",
    ],
  },
  {
    label: "3 · What they want more of",
    questions: [
      "What type of customer are you actually looking to attract more of? Like, what's your highest-margin service, the one you want more of?",
      "[if they are a service business trying to hire] Or is it more on the talent side? What type of talent are you looking for?",
    ],
    note: "This is the one that decides the whole build. Write the answer down in their words.",
  },
  {
    label: "4 · Reviews",
    questions: [
      "Do you currently ask for reviews? Is it you or someone on your team handling that? And where, Google, Trustpilot, somewhere else?",
      "Do you offer anything in exchange for a review, discount, freebie, anything like that?",
    ],
    note: "Ask, never advise. If they already incentivise, note it and move on. Do not endorse it and do not help design one.",
  },
  {
    label: "5 · Tech stack",
    questions: [
      "What booking, scheduling, or customer messaging software are you using right now?",
      "And do you have Google Analytics or Search Console set up on the site?",
    ],
  },
];

export const BOOKING_EXAMPLE = `[gatekeeper] Yeah tell her its better if they just send it

[they pick up]

Hey brother this is matthew how are you

Good good I had some time here between meetings to give you guys a call

Random question, do you know if ChatGPT is currently sending clients to you guys?

We were helping another client in the area and my team emailed over a report with the whole 9 yards,

But I was calling you because usually we cant really help every business owner

But based on that report it seems your business is the type we can get quick results for

We basically would help you become the business AI recommends when someone asks for [Service/product] in [your city],

"How are people usually finding you guys right now?"

Are you happy with the amount of new bookings coming in, or is that something you're trying to grow?

Awesome, As I said, we are currently helping another client in the area

I have a meeting in about 10 minutes but I can go over it tomorrow in the morning or the afternoon,

Quick question, do you know where your website is hosted? Like godaddy or namecheap?

Ook I will look into it this afternoon and we'll call you tomorrow to get you started.

It takes like 15 minutes, is that fair enough?

Awesome and whats your best email so I can send over the invite.

[if they ask about cost] We'll go over everything tomorrow, we have a few different options`;

// ─────────────────────────────────────────────────────────────────────────────
// Facts
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingFacts extends SpokenIdentity {
  prospect: string | null;
  company: string;
  /** What they sell, in buyer words. Fills the {Service/product} slot. */
  trade: string | null;
  city: string | null;
  prior: PriorContact;
  /**
   * The numbers, when an audit exists. EMPTY IS THE COMMON CASE on this lane and it is not a gap
   * to fill: a booking call needs no figures, and the fifteen minutes is where they get shown.
   */
  numbers: string[];
  language: "en" | "es";
}

export function bookingFactsFrom(input: {
  prospect?: string | null;
  company: string;
  trade?: string | null;
  city?: string | null;
  prior: PriorContact;
  numbers?: string[];
  reportUrl?: string | null;
  language?: "en" | "es";
}): BookingFacts {
  return {
    prospect: input.prospect?.trim() || null,
    company: input.company,
    trade: input.trade?.trim() || null,
    city: input.city?.split(",")[0]?.trim() || null,
    prior: input.prior,
    numbers: input.numbers ?? [],
    language: input.language ?? "en",
    // SpokenIdentity. agencyName and fromDomain are what stop the rep introducing himself as a
    // company that does not exist and sending the prospect hunting for mail from a domain we do
    // not own — the live Grey Seal failure documented in call-script.ts.
    agencyName: AGENCY_NAME,
    fromDomain: FROM_DOMAIN,
    reportUrl: input.reportUrl ?? null,
    redesignUrl: null,
    loomUrl: null,
  };
}

function factsPrompt(f: BookingFacts): string {
  const lines = [
    `BUSINESS: ${f.company}`,
    `PERSON: ${f.prospect ?? "unknown, so write every line without a name in it"}`,
    `WHAT THEY DO: ${f.trade ?? "unknown"}`,
    `CITY: ${f.city ?? "unknown, so leave the city out of the positioning line rather than guessing one"}`,
    `WE ARE: ${f.agencyName}. Any email we sent came from ${f.fromDomain}. Never say any other company name or domain.`,
    "",
    priorContactBlock(f.prior),
  ];

  lines.push(
    "",
    f.numbers.length
      ? `NUMBERS HE MAY SPEAK. These are the only figures that exist. Never round them, never derive new ones:\n${f.numbers.map((n) => `- ${n}`).join("\n")}`
      : // The zohoOnlyNumbers() precedent: state the absence out loud rather than staying silent,
        // because absent beats forbidden and silence is what a model fills.
        "NUMBERS HE MAY SPEAK: NONE. No audit has been scored for this business, so there is no " +
          "percentage, no count, no competitor tally and no gap number. Any figure would be " +
          "invented. This call does not need one: it is booking the fifteen minutes where the " +
          "numbers get shown. If he is pushed for one, the honest answer is that it takes about " +
          "ten minutes to run properly and that is what the meeting is for."
  );

  return lines.join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The card
// ─────────────────────────────────────────────────────────────────────────────

export interface BookingScript {
  /** One line for whoever screens the call. */
  gatekeeper: string;
  /** 2 lines: who he is, then why he is calling right now. */
  open: string[];
  /** The ChatGPT question, asked casually. ONE line. */
  pivot: string;
  /** 3 lines: what was run and for whom, we cannot help everyone, why this business qualifies. */
  why: string[];
  /** The service-and-city line. ONE line. */
  positioning: string;
  /** 2 questions: how they get found today, then whether they want more. */
  discovery: string[];
  /** 3 lines: the reason he is short, the two windows, the fifteen-minute ask. */
  bookIt: string[];
  /**
   * 2 lines: where the site is hosted, then that he will look into it today and call tomorrow.
   *
   * ‼️ THIS IS THE LINE THAT MAKES IT AN ONBOARDING CALL. Asking where the DNS lives before the
   * meeting is booked is work, not qualification: it is the same question `resolveDnsProvider()`
   * answers off the nameservers and the same one the delivery checklist has to have answered
   * before the DNS step can be worked. Getting it on this call means the call sheet is right
   * before anyone dials again.
   */
  hosting: string[];
  /** The email ask. ONE line. */
  getEmail: string;
  /**
   * What he says if they ask what it costs. ONE line, and it defers rather than deflects twice.
   *
   * Separate from the `howmuch` pushback on purpose: that one is a stall being handled mid-call,
   * this one is the answer given AFTER the meeting is already booked, where the honest answer is
   * simply that it is tomorrow's conversation.
   */
  priceDeflect: string;
  /** 2 lines: everything is captured, he digs into it today, the plan comes tomorrow. */
  closeOut: string[];
  pushback: Array<{ key: string; responses: string[] }>;
  voicemail: string[];
  textMessage: string[];
  dontSay: string[];
}

function shapeOk(p: unknown): p is BookingScript {
  if (!p || typeof p !== "object") return false;
  const s = p as Record<string, unknown>;
  const strs = (v: unknown, n?: number) =>
    Array.isArray(v) && v.every((x) => typeof x === "string") && (n === undefined || v.length === n);

  return (
    typeof s.gatekeeper === "string" &&
    strs(s.open, 2) &&
    typeof s.pivot === "string" &&
    strs(s.why, 3) &&
    typeof s.positioning === "string" &&
    strs(s.discovery, 2) &&
    strs(s.bookIt, 3) &&
    strs(s.hosting, 2) &&
    typeof s.getEmail === "string" &&
    typeof s.priceDeflect === "string" &&
    strs(s.closeOut, 2) &&
    Array.isArray(s.pushback) &&
    s.pushback.length === PUSHBACK_COUNT &&
    s.pushback.every(
      (b) =>
        b && typeof b === "object" &&
        typeof (b as { key?: unknown }).key === "string" &&
        strs((b as { responses?: unknown }).responses, 2)
    ) &&
    strs(s.voicemail) &&
    strs(s.textMessage) &&
    strs(s.dontSay)
  );
}

/**
 * ‼️ IT HAS TO NAME THE LONG LINES, NOT JUST THE SHAPE, and getting that wrong cost two live runs.
 *
 * `validate` fails on TWO different things: the shape, and the 25-word cap on spoken lines. An
 * earlier version of this function only described the shape and returned "shape looked right"
 * whenever the cap was the thing that failed. The correction retry then received a rejection with
 * no reason in it and answered, verbatim and quite reasonably, "I cannot fix the error without
 * knowing what the rejection reason was" — which is not JSON, so the parse threw and the run fell
 * through to the keep-the-last-shape branch every time.
 *
 * Exactly the failure mode CLAUDE.md documents for callClaudeJSON: without describeInvalid the
 * model gets "failed validation" and the broken field is rarely in the first 500 characters. A
 * describeInvalid that covers only half its validator is the same bug with extra steps.
 */
function describeInvalid(p: unknown): string {
  if (!p || typeof p !== "object") return "not an object";
  const s = p as Record<string, unknown>;
  const bad: string[] = [];
  const n = (v: unknown) => (Array.isArray(v) ? v.length : "missing");
  if (typeof s.gatekeeper !== "string") bad.push("gatekeeper must be one string");
  if (!Array.isArray(s.open) || s.open.length !== 2) bad.push(`open must be EXACTLY 2 lines, got ${n(s.open)}`);
  if (typeof s.pivot !== "string") bad.push("pivot must be one string");
  if (!Array.isArray(s.why) || s.why.length !== 3) bad.push(`why must be EXACTLY 3 lines, got ${n(s.why)}`);
  if (typeof s.positioning !== "string") bad.push("positioning must be one string");
  if (!Array.isArray(s.discovery) || s.discovery.length !== 2) bad.push(`discovery must be EXACTLY 2 lines, got ${n(s.discovery)}`);
  if (!Array.isArray(s.bookIt) || s.bookIt.length !== 3) bad.push(`bookIt must be EXACTLY 3 lines, got ${n(s.bookIt)}`);
  if (!Array.isArray(s.hosting) || s.hosting.length !== 2) bad.push(`hosting must be EXACTLY 2 lines, got ${n(s.hosting)}`);
  if (typeof s.getEmail !== "string") bad.push("getEmail must be one string");
  if (typeof s.priceDeflect !== "string") bad.push("priceDeflect must be one string");
  if (!Array.isArray(s.closeOut) || s.closeOut.length !== 2) bad.push(`closeOut must be EXACTLY 2 lines, got ${n(s.closeOut)}`);
  if (!Array.isArray(s.pushback) || s.pushback.length !== PUSHBACK_COUNT) {
    bad.push(`pushback must have EXACTLY ${PUSHBACK_COUNT} entries in the given key order, got ${n(s.pushback)}`);
  }
  if (bad.length) return bad.join("; ");

  // Shape is fine, so the cap is what failed. Quote the offenders: "some lines are too long" sends
  // the model back over a card it thinks is already correct, and it shortens the wrong ones.
  const long = shapeOk(p) ? tooLong(p) : [];
  if (long.length) {
    return (
      `${long.length} spoken line(s) run past ${MAX_SPOKEN_WORDS} words. Rewrite ONLY these, ` +
      `keeping every other line and the whole shape exactly as it is: ` +
      long.map((l) => `"${l}"`).join(" · ")
    );
  }
  return "shape looked right";
}

/** The spoken lines that cannot be said in one breath. Shared by the validator and the describer
 *  so the two can never disagree about which lines are the problem. */
function tooLong(s: BookingScript): string[] {
  return spokenOf(s).filter((l) => l.trim().split(/\s+/).length > MAX_SPOKEN_WORDS);
}

/** The single-string slots a model returns as a one-element array often enough to be worth fixing
 *  rather than rejecting. Same intent as coerceFollowup: repair a near miss, never a guess. */
const SINGLE_LINE_SLOTS = ["gatekeeper", "pivot", "positioning", "getEmail", "priceDeflect"] as const;

function coerce(p: unknown): unknown {
  if (!p || typeof p !== "object") return p;
  const s = { ...(p as Record<string, unknown>) };
  for (const k of SINGLE_LINE_SLOTS) {
    const v = s[k];
    if (Array.isArray(v) && v.length && typeof v[0] === "string") s[k] = v.join(" ");
  }
  if (Array.isArray(s.pushback)) {
    s.pushback = (s.pushback as Array<Record<string, unknown>>).map((b) => ({
      ...b,
      responses: Array.isArray(b?.responses) ? b.responses.slice(0, 2) : b?.responses,
    }));
  }
  return s;
}

function spokenOf(s: BookingScript): string[] {
  return [
    s.gatekeeper, ...s.open, s.pivot, ...s.why, s.positioning, ...s.discovery,
    ...s.bookIt, ...s.hosting, s.getEmail, s.priceDeflect, ...s.closeOut,
    ...s.voicemail, ...s.textMessage,
    ...s.pushback.flatMap((p) => p.responses),
  ].filter((l) => typeof l === "string" && l.trim() !== "" && !isDirection(l));
}

// ─────────────────────────────────────────────────────────────────────────────
// Build
// ─────────────────────────────────────────────────────────────────────────────

export async function buildBookingScript(
  facts: BookingFacts,
  extraContext?: string | null
): Promise<{ script: BookingScript; warnings: string[] }> {
  // Same keep-the-last-good-shape trick buildFollowupScript uses: callClaudeJSON runs one
  // correction retry and then throws, and a card that is three words too long is still worth
  // reading with a warning above it. A card whose SHAPE was never right is not.
  const kept: { script: BookingScript | null } = { script: null };
  const validate = (p: unknown): p is BookingScript => {
    if (!shapeOk(p)) return false;
    kept.script = p;
    return tooLong(p).length === 0;
  };

  const { data } = await callClaudeJSON<BookingScript>({
    model: "claude-sonnet-4-6",
    system: [
      "You write the bullet card a rep reads off his phone while dialing a business owner who has " +
        "not replied. He is calling to BOOK A FIFTEEN MINUTE MEETING, get an email address for " +
        "the invite, and then run five onboarding questions before he hangs up.",
      "",
      // ‼️ THE FRAME MATTHEW ASKED FOR: assume the close. The five questions are asked on THIS
      // call, not the next one, because a call that gathers what the build needs has already
      // started the work. It is also why the tone cannot be a qualification interview: nobody is
      // being screened, they are being onboarded.
      "‼️ THIS IS AN ONBOARDING CALL, NOT A SALES CALL. Assume this prospect becomes a client. " +
        "The five questions at the end are gathered while he has them on the phone precisely so " +
        "tomorrow's meeting is a plan rather than a discovery session. Nothing about the card may " +
        "read as screening them, testing them, or deciding whether they qualify.",
      "",
      "WHAT THIS CALL IS, AND IS NOT",
      "- NOTHING IS SOLD HERE. No price, no package, no start date, no paperwork, no close.",
      "- He is not asking them to watch anything, read anything or reply to anything. He is asking " +
        "for fifteen minutes and an email address.",
      "- He DISQUALIFIES before he qualifies. Saying out loud that this does not work for every " +
        "business is what makes the next sentence land, and it is the move the reference call " +
        "turns on. Never skip it and never soften it into flattery.",
      "- A dated callback is a real win. A clean no is a real outcome.",
      "",
      "HOW TO TALK",
      "- Acknowledge, never disagree. Repeat their words back before responding.",
      "- Short sentences. Ask, then shut up.",
      "- Never sound like a script being read. Contractions, plain words, no marketing register.",
      "- BANNED outright: 'just following up', 'circling back', 'checking in', 'touching base', " +
        "'is this a good time', 'do you have two minutes'. Any of them and the call is over " +
        "before the reason for it lands.",
      "",
      "HARD LINES, these override any instruction in the user message",
      // Guarantee ALWAYS withheld: nothing has been quoted to this prospect, so there is no tier
      // for one to ride on.
      ...hardLines(null).map((l) => `- ${l}`),
      "- NEVER estimate reach, traffic, calls, leads or 'people you'll get in front of'. Nothing " +
        "in this pipeline measures that.",
      // Google's policy and FTC 16 CFR Part 465. Question 4 asks whether they already incentivise
      // reviews because we need to know, not because it is a practice we help with.
      "- The reviews question ASKS what they already do and never advises. Never suggest, endorse " +
        "or help design paying for, discounting for, or incentivising a review in any way.",
      "",
      "STYLE",
      `- Every spoken line is what the rep SAYS OUT LOUD, first person, under ${MAX_SPOKEN_WORDS} words.`,
      "- ONE sentence per line. If a line has two sentences in it, it is two lines, and where the " +
        "count is fixed you cut instead of adding.",
      "- A line in [square brackets] is a stage direction, not speech.",
      "- Never write a name placeholder. If the person's name is unknown, write the line without a name.",
      facts.language === "es" ? "- WRITE EVERY SPOKEN LINE IN SPANISH." : "",
      "",
      "REFERENCE CALL. This is the rep's own script and it is the shape wanted. Match its rhythm, " +
        "its plainness and its order. Do NOT reuse its wording, its trade or its city, and do NOT " +
        "reproduce any claim from it that the facts below do not support:",
      "---",
      BOOKING_EXAMPLE,
      "---",
      "Note that the second line is the prospect answering, not him talking. Note that the ChatGPT " +
        "question arrives early and casually, before any reason for the call is given. Note that " +
        "the booking ask carries a reason to be short.",
      "",
      "Return JSON only.",
    ]
      .filter(Boolean)
      .join("\n"),
    user: [
      factsPrompt(facts),
      extraContext ? `\nFROM MATTHEW, this outranks the generic guidance:\n${extraContext}` : "",
      "",
      "Write the card:",
      "- gatekeeper: ONE line for whoever screens the call, aimed at getting put through.",
      "- open: EXACTLY 2 lines. Who he is, said the way someone they might know would say it, then " +
        "why he is calling right now. No hook, no cleverness.",
      "- pivot: ONE line. The ChatGPT question, asked as an aside rather than as a pitch.",
      "- why: EXACTLY 3 lines, in this order. (1) what was actually run and who it was for, " +
        "worded to match WHAT THEY HAVE ALREADY BEEN SENT above and nothing beyond it. (2) that " +
        "we cannot help every business owner. (3) why THIS business looks like one that fits.",
      "- positioning: ONE line. Becoming the business AI recommends when someone asks for what " +
        "they do, in their city. Use the real trade and the real city from FACTS.",
      "- discovery: EXACTLY 2 questions. First how people are finding them today, then whether " +
        "they are happy with the volume or want more. Open questions, his words not ours.",
      "- bookIt: EXACTLY 3 lines. The reason he has to be short, the two windows (tomorrow morning " +
        "or the afternoon), then the fifteen-minute ask ending in a question he can answer with " +
        "one word.",
      "- hosting: EXACTLY 2 lines. First, do they know where their website is hosted, naming a " +
        "couple of registrars as examples so the question is easy to answer. Second, that he will " +
        "look into it today and they will speak tomorrow to get started. Asked as prep for the " +
        "meeting, never as a technical interrogation.",
      "- getEmail: ONE line. Their best email so the invite can go over. Asked as the next " +
        "logistical step, never as a new ask.",
      "- priceDeflect: ONE line, for when they ask what it costs AFTER the meeting is booked. " +
        "Everything gets covered tomorrow and there are a few different options. Do NOT name, " +
        "hint at, estimate or bracket a figure, and do not re-sell the meeting.",
      "- closeOut: EXACTLY 2 lines, said after the five questions. That is everything he needs, " +
        "he digs into it today, and the full plan comes tomorrow.",
      `- pushback: exactly ${PUSHBACK_COUNT} entries, one per key below, in this order. TWO short ` +
        "spoken responses each, and every one of them gets back to the same ask: fifteen minutes " +
        "and the email address. Not the video, not a reply, not a price.",
      ...PUSHBACKS.map((p) => `    key "${p.key}" = "${p.label}" -> ${p.angle}`),
      "- voicemail: 3 lines, under 20 seconds total, ends with a specific callback window. Never " +
        "'just checking in'.",
      "- textMessage: 3 lines max, one question, no pitch, no link.",
      "- dontSay: 3 lines. The three things most likely to lose THIS specific prospect on this call.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 3000,
    temperature: 0.6,
    schemaHint:
      '{ "gatekeeper": string, "open": [string, string], "pivot": string, "why": [string, string, string], ' +
      '"positioning": string, "discovery": [string, string], "bookIt": [string, string, string], ' +
      `"getEmail": string, "pushback": [{ "key": string, "responses": [string, string] }] (exactly ${PUSHBACK_COUNT}, keys in the given order), ` +
      '"voicemail": string[], "textMessage": string[], "dontSay": string[] }',
    coerce,
    describeInvalid,
    validate,
  }).catch((e: Error) => {
    if (!kept.script) throw e;
    console.warn(`[booking-script] card still broke the speech rules after the correction retry (${e.message}); posting it with warnings`);
    return { data: kept.script };
  });

  const spoken = spokenOf(data);
  return {
    script: data,
    // noPrice: nothing is quoted on a booking call. facts supplies the identity checks, which is
    // the half this lane could not reach before SpokenIdentity was split out of CallFacts.
    warnings: lintSpoken(spoken, spoken, { noPrice: true, facts }),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Rendering
// ─────────────────────────────────────────────────────────────────────────────

const PRIOR_LABEL: Record<PriorContact, string> = {
  report_sent: "an audit was run and an email went out",
  hook_sent: "the 4-question hook email went out, no report exists",
  nothing_sent: "nothing has been sent to them yet",
};

/**
 * The card, for the lead timeline and for Slack.
 *
 * ‼️ IT PRINTS WHAT THE CALL IS ALLOWED TO CLAIM, above the script. The `why` beat states as fact
 * something that is only true in one of three states, and the only way to see whether it is right
 * is to see which state the code decided on. Same reasoning as formatHookCard printing the
 * questions and the verdicts above the draft.
 */
export function formatBookingScript(facts: BookingFacts, script: BookingScript, warnings: string[]): string {
  const lines = [
    `*Booking call · ${facts.company}*`,
    `_${PRIOR_LABEL[facts.prior]}_${facts.numbers.length ? "" : " · no scored audit, so no figures may be spoken"}`,
  ];

  if (warnings.length) lines.push("", ...warnings);

  lines.push(
    "",
    "*1 · IF SOMEONE SCREENS IT*",
    bullets([script.gatekeeper]),
    "",
    "*2 · OPEN* _they pick up_",
    bullets(script.open),
    "",
    "*3 · THE PIVOT* _ask it like an aside_",
    bullets([script.pivot]),
    "",
    "*4 · WHY YOU CALLED* _disqualify before you qualify_",
    bullets(script.why),
    "",
    "*5 · WHAT WE DO*",
    bullets([script.positioning]),
    "",
    "*6 · TWO QUESTIONS* _then shut up_",
    bullets(script.discovery),
    "",
    "*⭐ 7 · BOOK IT* _the whole reason you dialled_",
    bullets(script.bookIt),
    "",
    "*8 · WHERE THE SITE LIVES* _this is prep, not a tech quiz_",
    bullets(script.hosting),
    "",
    "*9 · GET THE EMAIL*",
    bullets([script.getEmail]),
    "",
    "*10 · IF THEY ASK WHAT IT COSTS*",
    bullets([script.priceDeflect]),
    "",
    // The five are printed in full rather than summarised. He reads them off the phone, and a
    // card that says "run the intake questions" is a card that gets them asked from memory,
    // differently every time, which is the whole thing this block exists to stop.
    "*⭐ 11 · THE FIVE QUESTIONS* _ask all five before you hang up_",
    `> ${INTAKE_INTRO}`
  );

  for (const b of INTAKE_BLOCKS) {
    lines.push("", `*${b.label}*`, bullets(b.questions));
    if (b.note) lines.push(`_${b.note}_`);
  }

  lines.push(
    "",
    "*12 · CLOSE IT OUT*",
    bullets(script.closeOut),
    "",
    "*13 · IF THEY PUSH BACK*"
  );

  for (const b of script.pushback) {
    const label = PUSHBACKS.find((p) => p.key === b.key)?.label ?? b.key;
    lines.push(`_${label}_`, bullets(b.responses));
  }

  lines.push(
    "",
    "*14 · NO ANSWER*",
    bullets(script.voicemail),
    "_or text_",
    bullets(script.textMessage),
    "",
    "*15 · DON'T SAY*",
    bullets(script.dontSay)
  );

  // The em-dash ban applies to a card that gets read out loud as much as to an email: a dash is a
  // pause a person does not make, and this one is spoken.
  return noDashes(lines.join("\n"));
}

/** The same card as plain text for the CRM timeline, which renders no mrkdwn. */
export function formatBookingNote(facts: BookingFacts, script: BookingScript, warnings: string[]): string {
  return formatBookingScript(facts, script, warnings)
    .replace(/\*/g, "")
    .replace(/_/g, "")
    .replace(/⭐ /g, "");
}
