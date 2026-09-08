// The one thing this client sells that we are aiming everything at.
//
// ‼️ THERE WAS NO OFFER, AND THE FIELD THAT WAS SUPPOSED TO BE ONE HAD ALMOST NO READER.
//
// `clients` has no offer column, no primary_offer, no target_keywords. The closest thing is
// `services.primary_treatment`, whose own config comment (src/config/client-intake.ts:124-131)
// says:
//
//   "THIS IS THE ONE FIELD THE WHOLE BUILD IS AIMED AT, AND IT DID NOT EXIST UNTIL NOW ... It is
//    deliberately NOT the same question as step 3's highest margin: the most profitable service
//    and the one an owner wants more of are often different, and the pages, the posts and the
//    lead magnet all follow this one."
//
// And the substitution chain did not read it. `treatmentPrimary` in question-sets.ts resolved
// `ideal_patient.highest_margin || firstLine(services.services_list) || services.primary_service`,
// and `primary_treatment` appears at no position in that list. Only deep-research-run.ts read it.
// So the one required intake field the whole build is aimed at reached the research prompt and
// reached nothing else: not step 12's question set, not step 13's page candidates, not the
// `[treatment]` substitution, not the magnet ladder.
//
// That is the same reader-with-no-writer class this repo keeps finding, inverted. It is why step
// 12's PDF reads as padding: the corpus is a whole-vertical phrase harvest with nothing tying it
// to what this client actually sells, so filling sixty slots pads it with junk.
//
// ─────────────────────────────────────────────────────────────────────────────
// TWO STEPS, AND THEY ARE DIFFERENT KINDS OF ACT
//
// Matthew: "I want to pick it live with my customer in the call but select one simple offer from
// one of our options, and if not I need to create one and upload it in Slack to have the first
// sample, but always need to have one preselected, and in the live call we can get the inputs to
// put together the keyword and positioning strategy."
//
//   offer_proposed  the system PROPOSES one, from what intake already said. Automatic, so there
//                   is always one preselected and it never blocks the board.
//   offer_locked    a person LOCKS one, on the call, having heard the answer. Manual.
//
// Same split as every proposed_* slot in this repo, and the same reason: a proposal is a
// reading of the record and a lock is a decision somebody made out loud.
//
// ‼️ THE PROPOSAL MAKES NO MODEL CALL. It does not need one. `primary_treatment` is REQUIRED at
// intake and it is literally the answer to "which one service do you most want more appointments
// for". A model asked to infer the same thing from an audit would produce a guess with no
// provenance, next to a field that already carries the client's own words. Every proposal
// therefore carries WHERE it came from, and "nothing on file" is a legitimate outcome that says
// so rather than inventing an answer.
// ─────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/lib/db";

/** Where a proposed treatment came from. Never absent: a value with no provenance is a guess. */
export type OfferSource =
  /** services.primary_treatment, the intake question aimed at exactly this. */
  | "primary_treatment"
  /** ideal_patient.highest_margin. A different question, and often a different answer. */
  | "highest_margin"
  /** The first line of services_list, which is a menu we are taking the top of. */
  | "services_list"
  /** A person typed it on the call. Only ever on the locked half. */
  | "call";

export interface StoredOffer {
  // ── The proposal. Written by the runner, overwritten freely, never shown as decided. ──
  proposedTreatment: string | null;
  proposedSource: OfferSource | null;
  proposedAt: string | null;

  // ── The lock. Written by a person, on the call. ──
  /** What they sell that everything is aimed at. Feeds [treatment] and client_pages.treatment. */
  treatment: string | null;
  /** The free thing given away for it: a lead_magnets.magnet_key. Optional; a treatment alone
   *  is a usable lock, and the magnet can be drafted afterwards in the page studio. */
  magnetKey: string | null;
  /** How they want it positioned, in their words, captured on the call. */
  positioning: string | null;
  lockedAt: string | null;
  lockedBy: string | null;
}

export const EMPTY_OFFER: StoredOffer = {
  proposedTreatment: null,
  proposedSource: null,
  proposedAt: null,
  treatment: null,
  magnetKey: null,
  positioning: null,
  lockedAt: null,
  lockedBy: null,
};

const SOURCES: readonly OfferSource[] = [
  "primary_treatment",
  "highest_margin",
  "services_list",
  "call",
];

function text(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

/**
 * The stored bag, validated.
 *
 * Drop-never-repair, the same discipline readTheme() and readSkin() follow: a field that is not
 * the shape it should be becomes null rather than being coerced into something plausible.
 */
export function readOffer(raw: unknown): StoredOffer {
  if (!raw || typeof raw !== "object") return { ...EMPTY_OFFER };
  const bag = raw as Record<string, unknown>;
  const source = text(bag.proposedSource);

  return {
    proposedTreatment: text(bag.proposedTreatment),
    proposedSource: source && SOURCES.includes(source as OfferSource) ? (source as OfferSource) : null,
    proposedAt: text(bag.proposedAt),
    treatment: text(bag.treatment),
    magnetKey: text(bag.magnetKey),
    positioning: text(bag.positioning),
    lockedAt: text(bag.lockedAt),
    lockedBy: text(bag.lockedBy),
  };
}

/** Locked, in the only sense anything downstream cares about: a person named the thing. */
export function isLocked(offer: StoredOffer): boolean {
  return offer.treatment !== null && offer.lockedAt !== null;
}

/**
 * What the client is actually aimed at right now, and how sure we are.
 *
 * ‼️ THE LOCKED VALUE OUTRANKS THE PROPOSAL AND THE PROPOSAL OUTRANKS NOTHING. A proposal is a
 * reading of the intake form; it is offered so that the call has a starting point, and it must
 * never be interpolated into a client-facing sentence as though somebody had agreed to it.
 * Callers that need certainty check isLocked(); callers that just need a word for a card can
 * read `effective` and print `certain` beside it.
 */
export function effectiveTreatment(offer: StoredOffer): {
  value: string | null;
  certain: boolean;
  source: OfferSource | null;
} {
  if (isLocked(offer)) {
    return { value: offer.treatment, certain: true, source: "call" };
  }
  return { value: offer.proposedTreatment, certain: false, source: offer.proposedSource };
}

/** One sentence for a card or a panel. Says what IS, including when that is nothing. */
export function offerLine(offer: StoredOffer): string {
  if (isLocked(offer)) {
    const magnet = offer.magnetKey ? `, offered with \`${offer.magnetKey}\`` : "";
    return `Locked on *${offer.treatment}*${magnet}, by ${offer.lockedBy ?? "somebody"}.`;
  }
  if (offer.proposedTreatment) {
    return (
      `Proposed: *${offer.proposedTreatment}* (${describeSource(offer.proposedSource)}). ` +
      `Nobody has confirmed it, so nothing downstream treats it as decided.`
    );
  }
  return "No offer proposed and none locked. Everything downstream is aimed at the whole menu.";
}

function describeSource(source: OfferSource | null): string {
  switch (source) {
    case "primary_treatment":
      return "their own answer to which service they want more appointments for";
    case "highest_margin":
      return "their highest margin service, which is a different question";
    case "services_list":
      return "the first line of their services list, which is a menu we took the top of";
    case "call":
      return "the call";
    default:
      return "no recorded source";
  }
}

/** The first line of a free-text block. Same shape question-sets.ts uses on services_list. */
function firstLine(raw: unknown): string | null {
  const value = text(raw);
  if (!value) return null;
  return text(value.split(/[\n;]/)[0]);
}

export async function loadOffer(clientId: string): Promise<StoredOffer> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("offer")
    .eq("id", clientId)
    .maybeSingle();
  return readOffer((data as { offer?: unknown } | null)?.offer);
}

/**
 * Propose one, from what intake already said. No model, no guess, always a provenance.
 *
 * ‼️ THE ORDER IS THE ARGUMENT AND IT IS NOT THE SAME ORDER treatmentPrimary USED.
 *
 * `primary_treatment` is FIRST here because it is the question that asks this exact thing:
 * "which one service do you most want more appointments for?", required, single line, with help
 * text saying it is what the pages, the posts and the free offer are aimed at.
 * `highest_margin` is second: the most profitable service and the one they want more of are
 * often different, and when they disagree the one they ASKED for wins. `services_list` is last
 * and is the weakest, because taking the top line of a menu is a guess about ordering.
 *
 * ‼️ IT NEVER OVERWRITES A LOCK. Re-running the proposal on a client whose offer was agreed on a
 * call would replace a decision with a reading of a form. Only the proposal half is written.
 */
export async function proposeOffer(
  clientId: string
): Promise<{ ok: true; offer: StoredOffer; changed: boolean } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select("services, ideal_patient, offer")
    .eq("id", clientId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "no client row" };

  const services = (data.services ?? {}) as Record<string, unknown>;
  const ideal = (data.ideal_patient ?? {}) as Record<string, unknown>;
  const current = readOffer((data as { offer?: unknown }).offer);

  const candidates: Array<{ value: string | null; source: OfferSource }> = [
    { value: text(services.primary_treatment), source: "primary_treatment" },
    { value: text(ideal.highest_margin), source: "highest_margin" },
    { value: firstLine(services.services_list), source: "services_list" },
  ];

  const found = candidates.find((c) => c.value !== null) ?? null;

  const next: StoredOffer = {
    ...current,
    proposedTreatment: found?.value ?? null,
    proposedSource: found?.source ?? null,
    proposedAt: new Date().toISOString(),
  };

  const changed =
    current.proposedTreatment !== next.proposedTreatment ||
    current.proposedSource !== next.proposedSource;

  const { error: writeError } = await supabaseAdmin
    .from("clients")
    .update({ offer: next })
    .eq("id", clientId);

  if (writeError) return { ok: false, error: writeError.message };
  return { ok: true, offer: next, changed };
}

/**
 * Lock one. A person, on the call, having heard the answer.
 *
 * ‼️ A LOCK IS THE ONLY THING ANYTHING DOWNSTREAM READS AS DECIDED, so it records who and when,
 * the same shape confirmAvatar() and the theme's confirmedAt use. A treatment alone is a
 * complete lock: the magnet can be drafted afterwards in the page studio, and refusing a lock
 * for want of a magnet would hold the whole build over a thing that is written later.
 */
export async function lockOffer(args: {
  clientId: string;
  treatment: string;
  magnetKey?: string | null;
  positioning?: string | null;
  by: string;
}): Promise<{ ok: true; offer: StoredOffer } | { ok: false; error: string }> {
  const treatment = text(args.treatment);
  if (!treatment) return { ok: false, error: "an offer needs a name" };

  const current = await loadOffer(args.clientId);
  const next: StoredOffer = {
    ...current,
    treatment,
    magnetKey: args.magnetKey === undefined ? current.magnetKey : text(args.magnetKey),
    positioning: args.positioning === undefined ? current.positioning : text(args.positioning),
    lockedAt: new Date().toISOString(),
    lockedBy: args.by,
  };

  const { error } = await supabaseAdmin
    .from("clients")
    .update({ offer: next })
    .eq("id", args.clientId);

  if (error) return { ok: false, error: error.message };
  return { ok: true, offer: next };
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread reply
//
// ‼️ THE PREFIX IS EXACT AND THE HANDLER RETURNS null ON A MISS, the same contract
// handleAvatarThreadReply and handleSkinThreadReply keep. Free text in a step thread is answered
// by a model, so a sentence that merely contains the word "offer" is a sentence and must fall
// through. `offer:` with a colon is somebody addressing the machine.
//
// The route gets a call, not an implementation.
// ─────────────────────────────────────────────────────────────────────────────

/** Only in this step's thread. Anywhere else the words are conversation. */
const OFFER_STEPS = new Set(["offer_locked"]);

const OFFER_PREFIX = /^\s*offer\s*:/i;

/** Is this somebody answering the offer question? Explicit, never sniffed. */
export function isOfferReply(text: string): boolean {
  return OFFER_PREFIX.test(text);
}

export async function handleOfferThreadReply(input: {
  clientId: string;
  stepKey: string | null;
  text: string;
  by: string;
}): Promise<{ message: string } | null> {
  if (!input.stepKey || !OFFER_STEPS.has(input.stepKey)) return null;
  if (!isOfferReply(input.text)) return null;

  const body = input.text.replace(OFFER_PREFIX, "").trim();
  const current = await loadOffer(input.clientId);

  // ‼️ `offer: yes` TAKES THE PROPOSAL, AND IT IS STILL A LOCK. The value written is the
  // proposed one, but lockedAt and lockedBy record that a person said so, which is the whole
  // distinction this pair of steps exists to draw. Accepting a proposal is a decision.
  const accepting = /^(yes|y|ok|okay|confirm|confirmed|that one|keep it)$/i.test(body);

  if (accepting && !current.proposedTreatment) {
    return {
      message:
        ":warning: There is nothing proposed to accept. Reply `offer: <what they sell>` with " +
        "their own words instead.",
    };
  }

  // "what they sell | how they want it positioned". A pipe because a comma is punctuation
  // somebody uses inside an answer and a pipe is not.
  const [rawTreatment, ...rest] = accepting ? [current.proposedTreatment ?? ""] : body.split("|");
  const treatment = (rawTreatment ?? "").trim();
  const positioning = rest.join("|").trim();

  if (!treatment) {
    return {
      message:
        ":warning: I did not get a name out of that. `offer: lip filler`, or " +
        "`offer: lip filler | the one they book again` to capture the positioning too.",
    };
  }

  const res = await lockOffer({
    clientId: input.clientId,
    treatment,
    positioning: positioning || undefined,
    by: input.by,
  });

  if (!res.ok) return { message: `:warning: Could not lock that: ${res.error}` };

  const { stepNumber } = await import("@/config/delivery-steps");

  return {
    message: [
      `:white_check_mark: *Locked on ${res.offer.treatment}.*`,
      ...(res.offer.positioning ? [`_Positioning: ${res.offer.positioning}_`] : []),
      accepting ? "_Took the proposal, and it is a decision now rather than a reading._" : "",
      "",
      "*Next:*",
      `  • Press [Done] on this step.`,
      `  • Step ${stepNumber("custom_question_set")}'s tracked question set and step ` +
        `${stepNumber("page_candidates")}'s page candidates rebuild against this offer, so they ` +
        `stop being about the whole vertical.`,
      "  • Every page drafted in the page studio from now on carries it, which is what makes a " +
        "library magnet naming that treatment reachable at all.",
      ...(res.offer.positioning
        ? []
        : ["  • No positioning captured. `offer: " + res.offer.treatment + " | <how they want it " +
           "positioned>` adds it without changing the lock."]),
    ]
      .filter((line) => line !== "")
      .join("\n"),
  };
}
