// What a step is still missing, as bullets somebody can act on.
//
// Matthew, 2026-09-17: "Scan all of the data this lead currently has and it asks bulletpoint questions
// with the things we are missing in order to complete X onboarding step in the process."
//
// Three pieces already existed and this composes them rather than repeating any:
//   dataset-spec.ts   declares 71 fields and evaluates which are missing, with card-ready English
//   step-needs.ts     says which of those each of the 41 steps needs
//   lead-context.ts   holds the evaluation, alongside everything else known about the lead
//
// ‼️ "IF WE ALREADY HOLD IT, DO NOT ASK FOR IT" IS THE WHOLE CONTRACT, AND IT IS STRUCTURAL. A field
// that is not in the gap set is present, so it is not asked for. There is exactly one source of truth
// about what is held (evaluateDatasets, over one snapshot) and no second list to fall out of step with
// it. A scanner that re-asked for a document pasted thirty seconds ago is one people stop reading.
//
// ‼️ AN UNREADABLE FIELD IS NEVER RENDERED AS A QUESTION. It goes in `unreadable` and says so. A broken
// select turning into an ask for work somebody already did is the failure this design exists to avoid,
// and it is the reason lead-context.ts carries `unreadable` as a state rather than degrading to empty.

import { stepNumber, type StepKey } from "@/config/delivery-steps";
import type { FieldSpec } from "./dataset-spec";
import { fieldsForStep, STEP_NEEDS, type FieldRef } from "./step-needs";
import { leadContext, isHeld, type LeadContext, type MissingBecause } from "./lead-context";

/** How a gap gets filled: the exact thing to type, and where. */
export interface FillInstruction {
  /** The card-ready sentence dataset-spec already writes, commands and all. */
  text: string;
  /**
   * The backticked commands inside it.
   *
   * ‼️ EXTRACTED IN ONE PLACE, AND THE PROBE FAILS IF EXTRACTION MISSES ONE. Every command named on a
   * card is grepped back out of src/ by _probe-gaps.ts, the same rule _probe-do-this-now.ts already
   * enforces: a card that invents a command is worse than a card that says nothing, because somebody
   * types it, nothing happens, and they stop reading the block.
   */
  commands: readonly string[];
}

export interface Gap {
  ref: FieldRef;
  field: FieldSpec;
  /** True when THIS step cannot be completed without it. False for a want. */
  blocking: boolean;
  /** Every step that needs it, so a card can say what else is waiting on the same answer. */
  blocks: readonly StepKey[];
  because: MissingBecause;
  fill: FillInstruction;
}

export interface StepGaps {
  stepKey: StepKey;
  number: number;
  label: string;
  /** Of the fields this step needs, how many are on file. */
  have: number;
  need: number;
  gaps: readonly Gap[];
  /**
   * Fields whose source could not be READ. Reported, never asked for.
   *
   * A non-empty list means the answer below is incomplete and says so, rather than presenting an
   * unknown as an absence.
   */
  unreadable: readonly string[];
  /** Set when the step declares it asks for no dataset field, carrying step-needs' sentence. */
  nothingWhy: string | null;
}

/** Backticked `thing:` runs, the same shape _probe-do-this-now.ts already greps for. */
const COMMAND = /`([^`]+)`/g;

function commandsIn(text: string): string[] {
  return [...new Set([...text.matchAll(COMMAND)].map((m) => m[1].trim()).filter(Boolean))];
}

/**
 * Which kind of null this is.
 *
 * ‼️ `never_asked` IS NOT A FAILING OF THE CLIENT. dataset-spec marks five fields `asked: false`: they
 * have a home and no question. Rendering them as something somebody forgot to answer would be a lie,
 * and rendering them with an arrow would name a command that does not exist.
 */
function becauseOf(field: FieldSpec): MissingBecause {
  const f = field.filledBy;
  if (f.kind === "research" && !f.asked) return "never_asked";
  if (f.kind === "step" && !f.built) return "never_asked";
  if (f.kind === "derived") return "blocked";
  return "asked_unanswered";
}

/**
 * What this step still needs, and how to fill each one.
 *
 * `ctx` is optional so a card that already loaded the lead reads nothing more, and so a probe can run
 * the whole thing offline against a context it built by hand.
 */
export async function gapsFor(clientId: string, stepKey: StepKey, ctx?: LeadContext): Promise<StepGaps> {
  const context = ctx ?? (await leadContext(clientId));
  return gapsFrom(context, stepKey);
}

/** The pure half: everything above, against a context already in hand. */
export function gapsFrom(context: LeadContext, stepKey: StepKey): StepGaps {
  const number = stepNumber(stepKey);
  const label = context.board.steps.find((s) => s.key === stepKey)?.label ?? stepKey;
  const declared = STEP_NEEDS[stepKey];
  const { needs, wants } = fieldsForStep(stepKey);

  const base = {
    stepKey,
    number,
    label,
    nothingWhy: declared.kind === "nothing" ? declared.why : null,
  };

  if (declared.kind === "nothing") {
    return { ...base, have: 0, need: 0, gaps: [], unreadable: [] };
  }

  // ‼️ THE DATASETS COULD NOT BE EVALUATED, SO NOTHING IS KNOWN TO BE MISSING. Reporting every field
  // as a question here would ask for the whole framework on the strength of one failed select.
  if (!isHeld(context.gaps)) {
    return {
      ...base,
      have: 0,
      need: needs.length,
      gaps: [],
      unreadable: [...needs, ...wants].map((f) => `${f.dataset}.${f.key}`),
    };
  }

  // One index of what is MISSING. A ref absent from it is on file, which is the entire mechanism
  // behind "if we already hold it, do not ask for it".
  //
  // ‼️ FIRST WINS ACROSS AUDIENCES. lead-context flattens every audience's reports, and audiencesFor
  // returns the primary one first, so the primary audience's answer is the one a step card means.
  const missingByRef = new Map<string, { reason: string }>();
  for (const report of context.gaps.value) {
    for (const gap of report.gaps) {
      const ref = `${gap.field.dataset}.${gap.field.key}`;
      if (!missingByRef.has(ref)) missingByRef.set(ref, { reason: gap.reason });
    }
  }

  const gaps: Gap[] = [];
  const consider = (field: FieldSpec, blocking: boolean) => {
    const ref = `${field.dataset}.${field.key}` as FieldRef;
    const found = missingByRef.get(ref);
    if (!found) return; // On file. Not asked for. This line is the contract.
    const because = becauseOf(field);
    gaps.push({
      ref,
      field,
      blocking,
      blocks: stepsNeeding(ref),
      because,
      fill: {
        text: found.reason,
        // A field nothing asks for has no command to name, and inventing an arrow for it would send
        // somebody to type a thing that does not exist.
        commands: because === "never_asked" ? [] : commandsIn(found.reason),
      },
    });
  };

  for (const f of needs) consider(f, true);
  for (const f of wants) consider(f, false);

  const missingNeeds = gaps.filter((g) => g.blocking).length;
  return {
    ...base,
    have: needs.length - missingNeeds,
    need: needs.length,
    gaps,
    unreadable: [],
  };
}

/** Cached inversion of STEP_NEEDS, so a card with forty gaps does not walk 41 steps forty times. */
let NEEDED_BY: Map<string, StepKey[]> | null = null;
function stepsNeeding(ref: FieldRef): StepKey[] {
  if (!NEEDED_BY) {
    NEEDED_BY = new Map();
    for (const [key, need] of Object.entries(STEP_NEEDS) as Array<[StepKey, (typeof STEP_NEEDS)[StepKey]]>) {
      if (need.kind !== "fields") continue;
      for (const r of need.needs) {
        const list = NEEDED_BY.get(r) ?? [];
        list.push(key);
        NEEDED_BY.set(r, list);
      }
    }
  }
  return NEEDED_BY.get(ref) ?? [];
}

// ─────────────────────────────────────────────────────────────────────────────
// The card
// ─────────────────────────────────────────────────────────────────────────────

/** At most this many bullets. The rest are counted, never dropped silently. */
const MAX_BULLETS = 5;

/**
 * The bullets, and this is the deliverable Matthew judges.
 *
 * ‼️ GROUPED BY HOW THEY ARE FILLED, NOT ONE BULLET PER FIELD. Step 11 needs 46 fields and twenty of
 * them are headings of one document: twenty bullets all saying "paste the avatar sheet" is a wall
 * nobody reads. dataset-spec's card already groups by reason for the same reason.
 *
 * PURE, so the probe can assert the copy without touching a database.
 *
 * `max` exists for the onboarding map, which has to print EVERY question a step would ask and has
 * no card to overflow. ‼️ IT IS DEFAULTED, AND THE CARD MUST NEVER PASS IT: a card that prints
 * twenty bullets is the wall this function was written to stop being. The tail line is still
 * emitted, so a truncated list always says how much it truncated.
 */
export function gapLines(g: StepGaps, max: number = MAX_BULLETS): string[] {
  if (g.nothingWhy) {
    return [`*Step ${g.number}* asks for nothing from the datasets: ${g.nothingWhy}.`];
  }

  const lines: string[] = [];

  if (g.unreadable.length) {
    // Said first, because everything after it is an incomplete answer.
    lines.push(
      `:warning: *Step ${g.number}:* the datasets could not be read, so what is missing is unknown ` +
        `rather than empty. ${g.unreadable.length} field(s) were not checked.`
    );
    return lines;
  }

  if (!g.gaps.length) {
    return [`:white_check_mark: *Step ${g.number}* has everything it needs on file.`];
  }

  // Group by the sentence that fills them: one ask per thing to do.
  const groups = new Map<string, Gap[]>();
  for (const gap of g.gaps) {
    const list = groups.get(gap.fill.text) ?? [];
    list.push(gap);
    groups.set(gap.fill.text, list);
  }

  // Blocking asks first: they are the ones that stop the tick meaning something.
  const ordered = [...groups.entries()].sort((a, b) => {
    const aBlocks = a[1].some((x) => x.blocking) ? 0 : 1;
    const bBlocks = b[1].some((x) => x.blocking) ? 0 : 1;
    return aBlocks - bBlocks;
  });

  const blockingCount = ordered.filter(([, list]) => list.some((x) => x.blocking)).length;
  lines.push(
    blockingCount
      ? `Step ${g.number} needs ${blockingCount} more thing${blockingCount === 1 ? "" : "s"} before it can complete.`
      : `Step ${g.number} can complete. ${ordered.length} thing${ordered.length === 1 ? "" : "s"} would make it better.`
  );

  for (const [text, list] of ordered.slice(0, max)) {
    const blocking = list.some((x) => x.blocking);
    const names = list.map((x) => x.field.label);
    const what = names.length === 1 ? names[0] : `${names.length} fields: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ", and more" : ""}`;
    lines.push(`${blocking ? ":no_entry:" : ":warning:"} ${what}`);
    // ‼️ THE ARROW MEANS "TYPE THIS", SO IT ONLY APPEARS WHEN THERE IS SOMETHING TO TYPE. Two of the
    // reasons dataset-spec writes are explanations rather than instructions ("nothing asks for this
    // yet", "only step 11's framework script asks for this"), and an arrow in front of either one
    // sends somebody looking for a command that does not exist.
    const fill = list[0].fill;
    lines.push(fill.commands.length ? `    → ${text}` : `    ${text}`);
  }

  if (ordered.length > max) {
    lines.push(`_and ${ordered.length - max} more._`);
  }

  return lines;
}
