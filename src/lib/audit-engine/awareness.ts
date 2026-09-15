// The five stages of awareness, as Matthew numbers them.
//
// Matthew, 2026-09-14: 5 is problem UNAWARE and 1 is MOST aware, and every page and post should move
// a reader from 5 toward 3 and 4. Before this file nothing in the repo modelled awareness at all: a
// grep for awareness, schwartz, unaware, problem_aware, TOFU, MOFU or BOFU found one prose sentence
// inside a pest control avatar summary, read by nothing.
//
// ‼️ THE NUMBERING RUNS BACKWARDS FROM THE USUAL FUNNEL AND THAT IS HIS CALL. Lower is closer to
// buying. Every consumer compares with that in mind: "moved a reader forward" means the number went
// DOWN. awarenessTarget() below is the one place that arithmetic lives.
//
// ‼️ TWO WAYS A LABEL GETS MADE, AND EVERY LABEL SAYS WHICH. The classifier labels its own twenty
// questions, reading the whole business; that is `classifier`. Everything that never passes through
// the classifier (a tracked question set, a Day 30 retest, an approved keyword) is labelled by
// awarenessOf() below from the question's block and wording; that is `rule`. A rule label is a floor,
// not a finding, and an analysis that wants only real judgements filters on awareness_by.
//
// Pure. No imports beyond a type, so the probes and the client can use it.

import type { AuditBlock } from "./classify";

export type AwarenessStage = 1 | 2 | 3 | 4 | 5;

export type AwarenessSource = "classifier" | "rule";

/** Matthew's definitions, in his order. Shown to the classifier verbatim, so there is one wording. */
export const AWARENESS_STAGES: ReadonlyArray<{ stage: AwarenessStage; name: string; means: string }> = [
  {
    stage: 5,
    name: "unaware",
    means: "does not know they have the problem yet; searches a symptom or a situation without naming it",
  },
  {
    stage: 4,
    name: "problem aware",
    means: "knows the problem but not the solution; asks what causes it or how to fix it",
  },
  {
    stage: 3,
    name: "solution aware",
    means: "knows the kind of solution but not who to buy it from; searches the category or how it works",
  },
  {
    stage: 2,
    name: "product aware",
    means: "knows the options; compares providers, prices or alternatives",
  },
  {
    stage: 1,
    name: "most aware",
    means: "knows this business; searches its name, its reviews, or how to book it",
  },
];

export function isAwarenessStage(v: unknown): v is AwarenessStage {
  return typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;
}

/** A question that describes the reader's own situation rather than a solution. */
const PROBLEM_SHAPED =
  /\b(why (do|does|am|is|are)|what causes|is it normal|how (do i|to) (get rid of|stop|fix|deal with)|signs? of|symptoms? of|why (my|am i))\b/;

/**
 * A stage for a question the classifier never saw. Deterministic, for the reason blockFor gives:
 * the same phrase must land on the same stage on every run, or a Day 30 comparison by stage measures
 * the relabelling as well as the change.
 *
 * ‼️ IT NEVER RETURNS 5. A person typing a question into a search box has at least noticed
 * something, and telling "noticed a symptom" apart from "does not know it is a problem" needs the
 * business context only the classifier has. A rule that claimed stage 5 would be inventing it.
 *
 *   MARCA        1  the business is named
 *   COMPARATIVO  2  weighing options
 *   INFO         4  when the question is about their own situation, else 3 (how it works)
 *   SERVICIO     3  shopping the category
 */
export function awarenessOf(prompt: string, block: AuditBlock): AwarenessStage {
  switch (block) {
    case "MARCA":
      return 1;
    case "COMPARATIVO":
      return 2;
    case "INFO":
      return PROBLEM_SHAPED.test(prompt.toLowerCase()) ? 4 : 3;
    default:
      return 3;
  }
}

/**
 * Where a page aimed at a reader at `entry` should leave them: one stage closer to buying.
 *
 * ‼️ A DEFAULT, STATED AS ONE. Matthew's aim is to move a reader from 5 toward 3 and 4, and one stage
 * is the smallest move that counts as moving them. A page for somebody who already knows the business
 * (1) has nowhere closer to take them and stays at 1.
 */
export function awarenessTarget(entry: AwarenessStage): AwarenessStage {
  return Math.max(1, entry - 1) as AwarenessStage;
}
