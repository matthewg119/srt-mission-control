/**
 * Probe: the rules behind a supplied audit run. Pure, no database, no network.
 *
 *   bunx tsx --env-file=.env.local scripts/_probe-measurement.ts
 *
 * Three things are asserted here and each one is a rule that has already been got wrong once, in
 * this repo or in its doctrine:
 *
 *   1. The gap term is a TRANSITION. `keywords check` added +15 on every run, so re-measuring an
 *      unchanged fact inflated the score forever.
 *   2. A one-engine run is never a photograph (A2 D-P16). The label is resolved from what actually
 *      ran, never from what the caller asked for.
 *   3. Every reader of "this client's newest report" excludes the runs we fire ourselves, or the
 *      first Day 0 measurement silently becomes the baseline it was measured against.
 */

import {
  BASELINE_ONLY,
  KEYED_ENGINES,
  PHOTOGRAPH_MIN_ENGINES,
  SUPPLIED_LABELS,
  excludedFromScorecard,
  isPhotographLabel,
  isSuppliedRun,
  resolveRunLabel,
} from "../src/lib/audit-engine/run-labels";
import { blockFor } from "../src/lib/audit-engine/supplied-run";
import { gapDelta } from "../src/lib/clients/keyword-expansion";

let failures = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. The gap term ──────────────────────────────────────────────────────────
console.log("\n1. The +15 gap term is a transition, not a measurement");

check("an unmeasured row that comes back NOT named gains it", gapDelta(null, false) === 15);
check("a row already not named, measured again, moves nothing", gapDelta(false, false) === 0);
check("a row that goes from not named to named LOSES it", gapDelta(false, true) === -15);
check("a row that goes from named to not named gains it", gapDelta(true, false) === 15);
check("an unmeasured row that comes back named moves nothing", gapDelta(null, true) === 0);

// Three re-tests of an unchanged fact, which is what day 30, 60 and 90 are.
{
  let score = 40;
  score += gapDelta(null, false);
  const afterFirst = score;
  score += gapDelta(false, false);
  score += gapDelta(false, false);
  check("three measurements of the same miss add it exactly once", score === afterFirst && score === 55, String(score));
}

// ── 2. The label is resolved from what ran ───────────────────────────────────
console.log("\n2. A one-engine run is never a photograph (A2 D-P16)");

const photograph = resolveRunLabel("photograph_2");
const oneEngine = KEYED_ENGINES.length < PHOTOGRAPH_MIN_ENGINES;

check(
  `${KEYED_ENGINES.length} engine(s) keyed, so a requested photograph is ${oneEngine ? "downgraded" : "allowed"}`,
  oneEngine ? photograph.label === "measurement" && photograph.downgraded : photograph.label === "photograph_2"
);
check(
  "a downgrade always says why, in a sentence somebody can act on",
  oneEngine ? (photograph.reason ?? "").includes("D-P16") : photograph.reason === null
);
check("a measurement is never downgraded to anything", resolveRunLabel("measurement").downgraded === false);
check("a re-test is photograph-class", isPhotographLabel("retest_30") && isPhotographLabel("photograph_2"));
check("a measurement is not", !isPhotographLabel("measurement"));
check("photographs and re-tests COUNT on the scorecard", !excludedFromScorecard("photograph_2") && !excludedFromScorecard("retest_90"));
check("a measurement is kept off it", excludedFromScorecard("measurement"));

// ── 3. Baseline readers exclude what we fire ourselves ───────────────────────
console.log("\n3. The baseline filter");

for (const label of SUPPLIED_LABELS) {
  check(`${label} is excluded by BASELINE_ONLY`, BASELINE_ONLY.includes(label));
  check(`${label} reads as a supplied run`, isSuppliedRun({ run_label: label }));
}
check("a row written before the column existed still counts as a baseline", BASELINE_ONLY.includes("run_label.is.null"));
check("a prospect audit is not a supplied run", !isSuppliedRun({ run_label: "prospect_audit" }));
check("nor is an unlabelled row", !isSuppliedRun({ run_label: null }));
check(
  "nor is test_run, which is the SRT tenant's own baseline (measurement.sql:31)",
  !isSuppliedRun({ run_label: "test_run" })
);

// ── 4. Every supplied prompt lands in a real block ───────────────────────────
//
// audit_runs.block is NOT NULL and report-view.ts only tallies the four in BLOCK_ORDER, so a
// prompt in no block is a question that is asked, paid for, and then dropped from the score.
console.log("\n4. Blocks");

check("a question about the client by name is MARCA", blockFor("is Acme Med Spa any good", "Acme Med Spa") === "MARCA");
check("a comparison is COMPARATIVO", blockFor("lip filler vs lip flip", "Acme Med Spa") === "COMPARATIVO");
check("a question shape is INFO", blockFor("how much does lip filler cost", "Acme Med Spa") === "INFO");
check("a plain service phrase is SERVICIO", blockFor("lip filler near me", "Acme Med Spa") === "SERVICIO");
check("a null client name never crashes the mapping", blockFor("lip filler near me", null) === "SERVICIO");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
