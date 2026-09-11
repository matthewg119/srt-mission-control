// Which KIND of audit run a report is, and the one rule that keeps the kinds apart.
//
// docs/2026-08-18-measurement.sql created `audit_reports.run_label` and
// `excluded_from_scorecard` on 2026-08-18 and NOTHING in src has read or written either since.
// Every report in production is therefore the default, `prospect_audit`. This file is where that
// column starts being used, because the supplied-prompt runs added on 2026-09-12 (the keyword
// measurement, Photograph II, the day 30/60/90 re-tests) put rows in `audit_reports` that are NOT
// the client's baseline, and every reader of "this client's newest report" would otherwise pick
// one up.
//
// ‼️ THE READERS FILTER BY EXCLUSION, NEVER BY `run_label = 'prospect_audit'`.
// measurement.sql:31-32 says the SRT test tenant's own step-2 run is relabelled `test_run`, so an
// equality test would drop the baseline of the one client this repo is developed against. The
// question a reader is really asking is "is this the client's own baseline photograph", and the
// honest way to ask it is "it is not one of the runs we fire ourselves".
//
// ‼️ A2 D-P16: A ONE-ENGINE RUN IS NEVER A PHOTOGRAPH FOR A PAYING OR PILOT CLIENT.
// measurement.sql:138-140 states it and the Day 0 wall in day-zero.ts repeats it: `photograph_2`
// means a real archived run wrote it. One engine is keyed today, so `resolveRunLabel` DOWNGRADES a
// requested photograph to a `measurement`: the questions are still asked, the keywords are still
// measured, and the Day 0 stamp is simply not earned. Matthew's call, 2026-09-12, with both
// options in front of him: keep the rule, and let the runner upgrade itself the day a second
// engine is keyed. Nothing here asserts a photograph happened; it reports what ran.

/** Run labels this system fires for itself. None of them is a client's baseline. */
export const SUPPLIED_LABELS = [
  "measurement",
  "photograph_2",
  "retest_30",
  "retest_60",
  "retest_90",
] as const;

export type SuppliedLabel = (typeof SUPPLIED_LABELS)[number];

/** The labels that mean "a real archived measurement", as opposed to a run we simply took. */
export const PHOTOGRAPH_LABELS: readonly SuppliedLabel[] = [
  "photograph_2",
  "retest_30",
  "retest_60",
  "retest_90",
];

/**
 * What actually runs today.
 *
 * ‼️ ONE ENTRY, AND THAT IS THE WHOLE OF D-P16's TEETH. `AuditEngine` in types.ts is the single
 * source for which engines a new run may use: Perplexity was dropped on 2026-08-05 because its key
 * had never once returned data. Adding a second keyed engine here is what turns Photograph II on,
 * and it must be done by adding the engine, never by editing the threshold below.
 */
export const KEYED_ENGINES: readonly string[] = ["chatgpt_web"];

/** A photograph needs more than one engine. A2 D-P16, and A2 §3 on undisclosed confounds. */
export const PHOTOGRAPH_MIN_ENGINES = 2;

export function isPhotographLabel(label: string): boolean {
  return (PHOTOGRAPH_LABELS as readonly string[]).includes(label);
}

/**
 * The label a run may actually carry, and why.
 *
 * A caller asks for `photograph_2`; with one engine keyed it gets `measurement` back plus the
 * reason, which belongs on the card. The caller never decides this for itself: a label is a claim
 * about fidelity, and the only honest source for that claim is how many engines ran.
 */
export function resolveRunLabel(requested: SuppliedLabel): {
  label: SuppliedLabel;
  downgraded: boolean;
  reason: string | null;
} {
  if (!isPhotographLabel(requested)) return { label: requested, downgraded: false, reason: null };
  if (KEYED_ENGINES.length >= PHOTOGRAPH_MIN_ENGINES) {
    return { label: requested, downgraded: false, reason: null };
  }
  return {
    label: "measurement",
    downgraded: true,
    reason:
      `${KEYED_ENGINES.length} engine is keyed (${KEYED_ENGINES.join(", ")}), and A2 D-P16 says a ` +
      `one-engine run is never a photograph for a pilot client. The questions were still asked and ` +
      `the keywords still measured; this run is filed as a measurement and Day 0 is not stamped ` +
      `from it. Key a second engine and the same command writes ${requested}.`,
  };
}

/**
 * TRUE for the scorecard-excluded kinds (measurement.sql:64-65 sets the same thing at the
 * database). A photograph and a re-test ARE the numbers, so they count; a measurement we fired to
 * fill in `currently_named` is not a scorecard and must never be averaged into one.
 */
export function excludedFromScorecard(label: SuppliedLabel): boolean {
  return !isPhotographLabel(label);
}

export function isSuppliedRun(row: { run_label?: string | null }): boolean {
  return (SUPPLIED_LABELS as readonly string[]).includes(row.run_label ?? "");
}

/**
 * Restrict a PostgREST query on `audit_reports` to the client's own baseline runs.
 *
 * ‼️ EVERY READER OF "THIS CLIENT'S NEWEST REPORT" NEEDS THIS. Without it, the first Photograph II
 * becomes the row that `universalSetFor` freezes the tracked question set from, that the baseline
 * verifier reports a score off, that `adoptAuditClassification` reads a vertical out of, and that
 * the presence PDF and the findings print their fidelity footer from. The newest report stops
 * meaning the baseline the day this ships, for every one of them at once.
 *
 * `run_label.is.null` is in the OR because rows written before measurement.sql have no label at
 * all, and the column's default only applies to new inserts.
 */
export const BASELINE_ONLY = `run_label.is.null,run_label.not.in.(${SUPPLIED_LABELS.join(",")})`;

export function baselineReportsOnly<T extends { or(filter: string): T }>(query: T): T {
  return query.or(BASELINE_ONLY);
}
