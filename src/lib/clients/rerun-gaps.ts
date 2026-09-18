// What a re-run says about the data it holds, and which earlier step would fill the rest.
//
// Matthew, 2026-09-18: "our onboarding brain can read the data it has and if we are missing anything post
// it directly in the rerun or even suggest to rerun a previous step to make sure we have all the data we
// need."
//
// Three pieces already existed and this composes them rather than repeating any:
//   step-gaps.ts     says what a step is missing and writes the bullets for it
//   dataset-spec.ts  declares, per field, the step and the command that WRITE it
//   delivery-steps.ts turns a step key into a number and a label
//
// ‼️ THE GAP BULLETS ARE gapLines' OWN, BYTE FOR BYTE. `gaps` in a thread, the onboarding map and this
// block are the same function, so a re-run and a `gaps` typed one second later cannot disagree. The only
// thing added here is the half gapLines cannot know: that the writer of a missing field is an EARLIER
// step, so re-running that one first is the move.
//
// ‼️ "WHICH STEP WRITES IT" IS NOT stepsNeeding / stepsBlockedBy. Both invert STEP_NEEDS.needs, so both
// answer "which steps are WAITING on this field" -- that is `gap.blocks`, and it is the opposite
// direction. The writer is declared on the field itself, `filledBy.kind === "step"`, which is also where
// dataset-spec gets the ", on offer_locked" it already prints.
//
// PURE. No database, no network, no model, so the probe runs the whole thing offline.

import { DELIVERY_STEPS, isStepKey, stepNumber, type StepKey } from "@/config/delivery-steps";
import type { SlackBlock } from "@/lib/slack-bot";
import { gapLines, type Gap, type StepGaps } from "./step-gaps";

/**
 * The button that re-runs the upstream step.
 *
 * ‼️ A CONSTANT, BECAUSE THREE FILES HAVE TO AGREE ON IT: this module mints it, the actions route
 * switches on it, and the probe asserts it. A literal in each is three places to typo one string.
 */
export const RERUN_UPSTREAM_ACTION = "step_rerun_upstream";

/** At most this many upstream proposals. Slack's button budget, and a fourth is noise. */
const MAX_UPSTREAM = 3;

/** A step that is declared to write something this step is missing. */
export interface UpstreamFill {
  step: StepKey;
  /** Always stepNumber(), never a literal: the numbers are array positions and they shift. */
  number: number;
  label: string;
  /** dataset-spec's own words for what writes it, commands and all. */
  how: string;
  /** The field labels this step would fill, for the line that says why. */
  fields: readonly string[];
}

/**
 * The earlier steps that write what this step is missing.
 *
 * Four filters, and each one is a card that would otherwise be wrong:
 *
 * ‼️ `built` ONLY. dataset-spec marks a step filler `built: false` when nothing writes it yet, and
 * step-gaps turns exactly that into `never_asked` and deliberately prints no arrow for it. A button
 * offering to re-run a step that does not write the field is the invented door step-gaps refuses.
 *
 * ‼️ EARLIER STEPS ONLY. "suggest to rerun a PREVIOUS step" is the ask, and the filler is not always
 * one: `offer.lead_magnet` is filled at `pre_call_pages` (21), so a re-run of step 13 would otherwise
 * propose re-running 21, which cannot run yet and is not what is holding 13 up.
 *
 * ‼️ NEVER THE STEP BEING RE-RUN. Step 10 needs fields step 10's own commands write. gapLines already
 * says to type them here; "re-run step 10 first" inside step 10's own thread is nonsense.
 *
 * ‼️ isStepKey BEFORE stepNumber. `filledBy.step` is typed `string`, and stepNumber on an unknown key
 * returns 0, which would sort a bogus row to the front rather than dropping it.
 */
export function upstreamFills(g: StepGaps): UpstreamFill[] {
  if (g.nothingWhy || g.unreadable.length || !g.gaps.length) return [];

  const byStep = new Map<StepKey, { number: number; label: string; how: string; fields: string[] }>();

  for (const gap of g.gaps as readonly Gap[]) {
    const f = gap.field.filledBy;
    if (f.kind !== "step" || !f.built) continue;
    if (!isStepKey(f.step)) continue;
    const key = f.step as StepKey;
    if (key === g.stepKey) continue;
    const number = stepNumber(key);
    if (number >= g.number) continue;

    const found = byStep.get(key);
    if (found) {
      if (!found.fields.includes(gap.field.label)) found.fields.push(gap.field.label);
      continue;
    }
    byStep.set(key, {
      number,
      label: DELIVERY_STEPS.find((s) => s.key === key)?.label ?? key,
      how: f.how,
      fields: [gap.field.label],
    });
  }

  return [...byStep.entries()]
    .map(([step, v]) => ({ step, number: v.number, label: v.label, how: v.how, fields: v.fields }))
    .sort((a, b) => a.number - b.number)
    .slice(0, MAX_UPSTREAM);
}

/**
 * The block a re-run posts into the step's own thread.
 *
 * ‼️ gapLines IS CALLED WITHOUT `max`. Its own doc says the card must never pass one, and this is a
 * card in every sense that matters: five bullets is the budget, and the tail line says how many were
 * not printed.
 *
 * ‼️ IT SPEAKS WHEN NOTHING IS MISSING TOO. gapLines' ":white_check_mark: has everything it needs on
 * file" line is the whole point of the feature being visible: silence would mean either "nothing is
 * missing" or "this block failed to render", and those are the two facts rule 1 exists to keep apart.
 */
export function rerunGapLines(g: StepGaps, ups: readonly UpstreamFill[]): string[] {
  const lines = [...gapLines(g)];

  if (ups.length) {
    lines.push("");
    lines.push("*Fill it upstream first:*");
    for (const u of ups) {
      lines.push(`• Step ${u.number}, ${u.label}`);
      // ‼️ ITS OWN COMMAND ONLY WHEN IT WRITES EXACTLY ONE OF THEM. `filledBy.how` belongs to a
      // FIELD, so a step writing three of them has three different commands and naming the first
      // would tell somebody that `offer:` fills the customer terms as well. The bullets above
      // already carry one command per ask, so the honest line points back at them.
      lines.push(
        u.fields.length === 1
          ? `    → \`rerun ${u.number}\`, then ${u.how} in its thread, for ${u.fields[0]}`
          : `    → \`rerun ${u.number}\`, then the ${u.fields.length} asks above that it writes, in its thread`
      );
    }
    // D7, said out loud on the card rather than only in a comment.
    lines.push("_Proposals only. Nothing above has been re-run._");
  }

  lines.push(`_Read from: ${basisFor(g, ups)}_`);
  return lines;
}

/**
 * The D9 citation.
 *
 * ‼️ IT NAMES STEP_NEEDS AND COUNTS NOTHING NEW. `have` and `need` were measured by gapsFrom over one
 * snapshot; recomputing them here would be a third arithmetic on the same fields, which is exactly
 * where the card's count and gapLines' count would start to disagree. _probe-gaps.ts already asserts
 * those two agree, and this adds no third opinion for it to have to police.
 */
function basisFor(g: StepGaps, ups: readonly UpstreamFill[]): string {
  if (g.nothingWhy) return "STEP_NEEDS, which declares this step asks for no dataset field";
  if (g.unreadable.length) {
    return `STEP_NEEDS, ${g.unreadable.length} field(s) declared and none readable, so nothing is known to be missing`;
  }
  // ‼️ A STEP CAN DECLARE ONLY `wants`, AND "0 of 0 needed" READS AS A BROKEN COUNT NEXT TO FOUR
  // BULLETS. Step 22 is the live case: it needs nothing and wants four things, so the citation has
  // to describe the wants it just printed rather than a needed-field ratio of nothing to nothing.
  const head =
    g.need === 0
      ? g.gaps.length
        ? `STEP_NEEDS, which requires no field of this step, and ${g.gaps.length} that would improve it`
        : "STEP_NEEDS, which requires no field of this step"
      : `STEP_NEEDS, ${g.have} of ${g.need} needed field(s) on file`;
  if (!g.gaps.length) return head;
  if (!ups.length) return `${head}; no earlier step is declared to write what is left`;
  return ups.length === 1
    ? `${head}; the writer of each is declared in dataset-spec, and one is an earlier step`
    : `${head}; the writer of each is declared in dataset-spec, and ${ups.length} are earlier steps`;
}

/**
 * The same thing as Slack blocks, with a button per upstream step.
 *
 * ‼️ ONE SECTION PER 2,900 CHARACTERS, SPLIT ON LINE BOUNDARIES. A body over 3,000 fails the WHOLE
 * message, and notifyStep posts text without chunking it. step-engine's bodySections is private, so
 * this repeats the split rather than reaching into it -- same rule: never mid-line, because a value
 * broken across two blocks is a value somebody pastes wrong.
 *
 * ‼️ THE action_id CARRIES A "#n" SUFFIX. Slack rejects an entire message when two buttons in one
 * block share an action_id, and the actions route strips the suffix before its switch.
 */
export function rerunGapBlocks(clientId: string, g: StepGaps, ups: readonly UpstreamFill[]): SlackBlock[] {
  const out: SlackBlock[] = sections(rerunGapLines(g, ups));

  if (ups.length) {
    out.push({
      type: "actions",
      elements: ups.map((u, i) => ({
        type: "button",
        text: { type: "plain_text", text: `Re-run step ${u.number}` },
        action_id: `${RERUN_UPSTREAM_ACTION}#${i + 1}`,
        value: `${clientId}:${u.step}`,
      })),
    } as SlackBlock);
  }

  return out;
}

/** Slack's real ceiling is 3,000; this splits under 2,900, the same budget bodySections uses. */
const SECTION_LIMIT = 2900;

function sections(body: string[]): SlackBlock[] {
  const out: SlackBlock[] = [];
  let buf: string[] = [];
  let size = 0;
  const flush = () => {
    if (!buf.length) return;
    out.push({ type: "section", text: { type: "mrkdwn", text: buf.join("\n") } });
    buf = [];
    size = 0;
  };
  for (const line of body) {
    if (buf.length && size + line.length + 1 > SECTION_LIMIT) flush();
    buf.push(line);
    size += line.length + 1;
  }
  flush();
  return out;
}
