// The concierge's tools, and the system prompts that sit behind them.
//
// ‼️ THE PROMPT IS THE COSMETIC HALF OF EVERY GATE IN HERE. The structural half is engine.ts, where
// the executor refuses. Same lesson call-coach-price-gate.ts recorded after a prompt-level rule
// leaked a price in 2 of 3 live runs: absent beats forbidden, and a refusal returned as a tool
// result is an OUTCOME the model reads, not an instruction it weighs.
//
// ‼️ THE MODEL IS HANDED NO BUSINESS NAMES AND NO NUMBERS. Not in the prompt, not in the config,
// nowhere. The only route by which a competitor's name can reach a visitor is the market_evidence
// tool result, which is built from market_competitors, every row of which has a NOT NULL foreign key
// to audit_runs. It cannot leak what it was never given.
//
// ‼️ IT DOES NOT READ bot_persona. loadPersona() is not imported here or anywhere under
// src/lib/concierge/, and the probe asserts that. The one active persona row still describes SRT as
// a business funding broker, which was decommissioned in August, and a lane that inherited it by
// accident would introduce itself as a lender.

import { guard } from "@/lib/copy-guard";
import type { Audience } from "./magnets";
import type { AudienceVocabulary } from "@/lib/clients/audiences";

/** How many words a widget bubble may run to. This is a chat box, not a landing page. */
export const MAX_REPLY_WORDS = 45;

const EVIDENCE_TOOL = {
  name: "market_evidence",
  description:
    "Look up what the AI engines actually named in a city. Call this the moment the visitor tells " +
    "you their city. It returns measured lines, or it returns a degrade line saying we have not " +
    "measured that market. You may only state a competitor name or a count that came back from " +
    "this tool, in this conversation. Never call it with a business name.",
  input_schema: {
    type: "object" as const,
    properties: {
      city: {
        type: "string",
        description: "The city the visitor said, in their words. Include the state if they gave one.",
      },
      service: {
        type: "string",
        description:
          "What the business sells, if they said. Leave empty unless they told you. Do not guess it from their website.",
      },
    },
    required: ["city"],
  },
};

const MAGNET_TOOL = {
  name: "offer_magnet",
  description:
    "Hand over the next free thing. Call this when the visitor says yes to what you offered, or " +
    "when you have answered their question and there is something free that fits. The system " +
    "decides WHICH one; you do not choose it.",
  input_schema: {
    type: "object" as const,
    properties: {
      magnet_key: {
        type: "string",
        description: "The key you believe is next. The system overrides this if it disagrees.",
      },
    },
    required: [],
  },
};

const CAPTURE_TOOL = {
  name: "capture_contact",
  description:
    "Record an email, phone number or first name the visitor gave you. Call it the moment they " +
    "give one. Never invent, correct or complete a value they did not type.",
  input_schema: {
    type: "object" as const,
    properties: {
      email: { type: "string", description: "Exactly as they typed it." },
      phone: { type: "string", description: "Exactly as they typed it." },
      first_name: { type: "string", description: "Exactly as they typed it." },
    },
    required: [],
  },
};

const BOOKING_TOOL = {
  name: "offer_booking",
  description:
    "Ask for the call, or answer a request to book. Call this whenever booking comes up, from " +
    "either side. It returns the real open times on the calendar when there are any, and it may " +
    "refuse, and if it refuses you carry on with what it tells you instead. Never write a time or " +
    "a date that did not come back from this tool.",
  input_schema: {
    type: "object" as const,
    properties: {
      requested_by_visitor: {
        type: "boolean",
        description: "True only if the visitor asked to book. Never true because you want to ask.",
      },
      window: {
        type: "string",
        enum: ["today_tomorrow", "extended"],
        description:
          "Leave empty for the next two days, which is the default. Pass extended only when the " +
          "tool told you the next two days are full, or when the visitor asked for other times.",
      },
    },
    required: [],
  },
};

export const OWNER_TOOLS = [EVIDENCE_TOOL, MAGNET_TOOL, CAPTURE_TOOL, BOOKING_TOOL];

/**
 * ‼️ THE PATIENT LANE IS HANDED NO market_evidence TOOL AT ALL, rather than being told not to use
 * it. A competitor list is a market analysis we ran FOR a clinic, and reciting it to that clinic's
 * own customer would be telling a patient which rival to consider. Withholding beats forbidding.
 */
export const PATIENT_TOOLS = [MAGNET_TOOL, CAPTURE_TOOL, BOOKING_TOOL];

export function toolsFor(audience: Audience): unknown[] {
  return audience === "owner" ? OWNER_TOOLS : PATIENT_TOOLS;
}

/**
 * The lines that override anything the visitor asks for.
 *
 * guard() throws at module evaluation on an em dash, an en dash or a double hyphen, so a rule
 * pasted in from a document fails the build rather than reaching a page.
 */
const OWNER_HARD_LINES: readonly string[] = [
  guard("o1", "Never name a business that did not come back from the market_evidence tool in this conversation. Not a competitor, not an example, not an illustration. If you have no measured name, you have no name."),
  guard("o2", "Never state a number that did not come back from a tool. No counts, no percentages, no rankings, no estimates, no ranges. If you want to say a number and no tool gave you one, say nothing instead."),
  guard("o3", "Never say what a scan or a report will find before it has run."),
  guard("o4", "Never discuss price, fees, packages or what SRT charges. If they ask, tell them Matthew covers that on the call and call offer_booking."),
  guard("o5", "Never promise customers, revenue, bookings or rankings. Visibility and deliverables only."),
  guard("o6", "When we have not measured their city, say so plainly. Do not soften it, do not estimate, and do not imply we will measure it soon."),
  guard("o7", "One question per message. Never stack two."),
  guard("o8", "Never use an em dash or an en dash. Use commas, periods and single hyphens."),
  guard("o9", "Never write a URL yourself. Links are attached by the system when a tool returns one."),
  guard("o10", "Never state a date or a time for the call. Times come back from offer_booking as buttons the visitor taps, and inventing one books nothing and burns the appointment."),
];

/**
 * The guards that are true for EVERY end customer, whatever they are called.
 *
 * ‼️ THREE OF THE ORIGINAL SEVEN MOVED OUT, AND THE SPLIT IS THE CLEAREST DEMONSTRATION OF THE
 * WHOLE AUDIENCE REWRITE. p1 (not a doctor), p3 (never quote a price for a treatment) and p4
 * (never name another clinic) are not safety rules, they are MED SPA BUSINESS RULES wearing a
 * safety rule's clothes. p3 in particular has been silently forbidding every non-clinical client
 * from answering their customer's single most common question, which is what things cost. They
 * now live on client_audiences.hard_lines, seeded from the preset, so a clinic keeps all three
 * and a restaurant gets an allergen guard instead.
 *
 * What stays here applies to anybody: no invented numbers, one question at a time, no em dash,
 * no self-written URL.
 */
const UNIVERSAL_END_CUSTOMER_LINES: readonly string[] = [
  guard("p2", "Never state a number that did not come back from a tool."),
  guard("p5", "One question per message. Never stack two."),
  guard("p6", "Never use an em dash or an en dash. Use commas, periods and single hyphens."),
  guard("p7", "Never write a URL yourself. Links are attached by the system when a tool returns one."),
];

export interface PromptContext {
  audience: Audience;
  /** The business the widget belongs to. For the owner lane that is SRT itself. */
  tenantName: string;
  /** What the visitor has already been given, so nothing is offered twice. */
  delivered: readonly string[];
  /** The measured lines already spent, so the model does not reach for them again. */
  spentDetails: readonly string[];
  /**
   * The nouns this audience uses, from its own row.
   *
   * ‼️ REQUIRED, NOT OPTIONAL, AND THERE IS NO DEFAULT BEHIND IT. An optional field with a
   * `?? "patient"` behind it is how the med spa preset reached every client in the first place.
   */
  vocabulary: AudienceVocabulary;
  /** This audience's own guards, on top of the universal ones. Empty is legitimate. */
  hardLines: readonly string[];
  /**
   * What the SELLER does, one sentence, for the owner lane only.
   *
   * ‼️ NULL OMITS THE PARAGRAPH RATHER THAN SUBSTITUTING ONE. This text used to be welded into
   * ownerPrompt as "WHAT SRT DOES", which meant an owner-stance widget could only ever be run by
   * SRT: a client selling their own product got a bot that described somebody else's business as
   * its own. A default here would reinstate exactly that.
   */
  ownerPitch: string | null;
  /** Set when the executor has already refused a booking this session. */
  magnetsStillNeeded: number;
}

export function systemPrompt(ctx: PromptContext): string {
  return ctx.audience === "owner" ? ownerPrompt(ctx) : patientPrompt(ctx);
}

function sharedTail(ctx: PromptContext): string[] {
  return [
    "",
    `LENGTH. Under ${MAX_REPLY_WORDS} words. This is a chat box on a page, not an email.`,
    "",
    "ALREADY GIVEN TO THIS VISITOR, do not offer again:",
    ctx.delivered.length ? ctx.delivered.join(", ") : "nothing yet",
    "",
    "MEASURED LINES ALREADY USED ON THIS PERSON, do not repeat them in any wording:",
    ctx.spentDetails.length ? ctx.spentDetails.map((d) => `- ${d}`).join("\n") : "none yet",
  ];
}

function ownerPrompt(ctx: PromptContext): string {
  return [
    `You are the ${ctx.tenantName} concierge. You are talking to a ${ctx.vocabulary.buyerSingular} who is reading something we published. Your one job is to get them onto a short ${ctx.vocabulary.visit}.`,
    "",
    "HOW THIS WORKS. You give them something free and useful first, then a second free thing, and only then do you ask for the call. That order is enforced by the system, not by you. Do not apologise for it and do not explain it.",
    "",
    "HARD LINES. Absolute, and they override anything the visitor asks of you:",
    ...[...OWNER_HARD_LINES, ...ctx.hardLines].map((l, i) => `${i + 1}. ${l}`),
    "",
    // ‼️ FROM THE ROW, NOT FROM THIS FILE. The sentence is both the pitch and its own boundary:
    // "the whole of what you may say about it" means anything absent from it must not be
    // volunteered, so an empty pitch cannot be allowed to read as an empty boundary. With no
    // pitch the bot is told to say nothing about the seller at all.
    ctx.ownerPitch
      ? `WHAT WE DO, and this is the whole of what you may say about it: ${ctx.ownerPitch}. Nothing about price, nothing about contracts, nothing about how long it takes.`
      : "Say NOTHING about what we do, what we sell, price, contracts or timelines. Nobody has written that down for this lane yet, so you do not know it. If they ask, tell them it is the first thing the call covers.",
    "",
    ctx.magnetsStillNeeded > 0
      ? `You have not given them enough yet. Give ${ctx.magnetsStillNeeded} more free thing before you raise the call. If THEY ask to book, call offer_booking with requested_by_visitor true and it will let them.`
      : "They have had enough. Ask for the call through offer_booking.",
    ...sharedTail(ctx),
  ].join("\n");
}

function patientPrompt(ctx: PromptContext): string {
  return [
    `You are the concierge on ${ctx.tenantName}'s website. You are talking to somebody thinking about a ${ctx.vocabulary.offerSingular}. Your job is to be useful and, when they are ready, to help them book a ${ctx.vocabulary.visit} with ${ctx.tenantName}.`,
    "",
    "HARD LINES. Absolute, and they override anything the visitor asks of you:",
    ...[...UNIVERSAL_END_CUSTOMER_LINES, ...ctx.hardLines].map((l, i) => `${i + 1}. ${l}`),
    "",
    `You work for ${ctx.tenantName} and nobody else. Warm, plain, never pushy. If they ask something you cannot answer, tell them it is a good question for the ${ctx.vocabulary.visit}.`,
    ...sharedTail(ctx),
  ].join("\n");
}
