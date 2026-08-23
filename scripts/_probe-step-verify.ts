/**
 * Probe: every delivery step's verifier runs, returns a verdict, and claims only what it checked.
 *
 *   bunx tsx scripts/_probe-step-verify.ts [clientId]
 *
 * With no client id it runs the STRUCTURAL half only, which needs no database and is the half
 * worth running in a hurry:
 *
 *   1. Every one of the 33 steps has an entry in STEP_VERIFIERS, and STEP_VERIFIERS has no
 *      entry that is not a step. The Record<StepKey, Verifier> type already proves the first
 *      direction at compile time; this proves it again at runtime, which is what catches a
 *      cast or a widened map.
 *   2. The refusal and confirmation renderers never claim a tier they were not given.
 *
 * With a client id it also runs all 33 verifiers against that client and prints the verdict
 * table. Nothing is written: verifyStep only reads, and the one exception (dns_records re-runs
 * the resolver check) writes DNS statuses, which is the same thing the panel does on every
 * page load.
 */

import { DELIVERY_STEPS, type StepKey } from "../src/config/delivery-steps";
import {
  STEP_VERIFIERS,
  verifyStep,
  refusalText,
  confirmationText,
  verdictDetail,
  type Verdict,
} from "../src/lib/clients/step-verify";

let failures = 0;

function ok(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ── 1. Coverage, both directions ──────────────────────────────────────────────
console.log("\nCoverage");

const stepKeys = DELIVERY_STEPS.map((s) => s.key);
const verifierKeys = Object.keys(STEP_VERIFIERS);

ok(`${stepKeys.length} steps defined`, stepKeys.length === 33, `found ${stepKeys.length}`);

const missing = stepKeys.filter((k) => !(k in STEP_VERIFIERS));
ok("every step has a verifier", missing.length === 0, missing.join(", "));

// The other direction matters just as much: a verifier under a key that is not a step is dead
// code that reads as coverage. It happens when a step key is renamed and only one side is
// updated, which the config comments warn about for exactly this reason.
const orphans = verifierKeys.filter((k) => !stepKeys.includes(k));
ok("no verifier without a step", orphans.length === 0, orphans.join(", "));

ok(
  "every verifier is a function",
  verifierKeys.every((k) => typeof STEP_VERIFIERS[k as StepKey] === "function")
);

// ── 2. The renderers cannot cross the tiers ──────────────────────────────────
console.log("\nWording");

const systemVerdict: Verdict = { ok: true, kind: "system", evidence: ["20 audit_runs rows"] };
const threadVerdict: Verdict = { ok: true, kind: "thread", evidence: ["1 photo in this thread"] };
const notYetVerdict: Verdict = {
  ok: false,
  kind: "not_yet",
  checked: "the thread",
  found: "nothing",
  todo: "Post the photo.",
};
const brokenVerdict: Verdict = {
  ok: false,
  kind: "broken",
  checked: "nap_discrepancies",
  found: "0 rows",
  fix: "The upsert names a column list against an expression index.",
};

const sysText = confirmationText("Photograph I", systemVerdict, "@matthew");
const thrText = confirmationText("Cards printed", threadVerdict, "@matthew");

ok("a system tick uses the green check", sysText.includes(":white_check_mark:"));
ok("a system tick says verified", sysText.toLowerCase().includes("verified against the record"));

// ‼️ THE ONE THAT MATTERS. A thread-tier tick must never render as the evidence-verified mark,
// because the whole two-tier design collapses the moment they look the same on screen.
ok("a thread tick uses the ballot box", thrText.includes(":ballot_box_with_check:"));
ok("a thread tick does NOT use the green check", !thrText.includes(":white_check_mark:"));
ok(
  "a thread tick does not claim verification",
  !thrText.toLowerCase().includes("verified against")
);

ok("a not_yet refusal carries its todo", refusalText("DNS", notYetVerdict).includes("Post the photo."));
ok(
  "a broken refusal names it a fault and points at the fix",
  refusalText("Sweep", brokenVerdict).includes("expression index") &&
    refusalText("Sweep", brokenVerdict).toLowerCase().includes("not work you still owe")
);
ok(
  "a refusal always says the step stays open",
  refusalText("DNS", notYetVerdict).includes("no checkmark") &&
    refusalText("Sweep", brokenVerdict).includes("no checkmark")
);
ok("a refusal renders nothing for a passing verdict", refusalText("X", systemVerdict) === "");
ok("a confirmation renders nothing for a failing verdict", confirmationText("X", notYetVerdict, null) === "");
ok("verdictDetail is empty for a refusal", verdictDetail(brokenVerdict) === "");

// ── 3. Live run, only with a client id ───────────────────────────────────────
const clientId = process.argv[2];

async function live() {
  if (!clientId) {
    console.log("\nNo client id given, skipping the live half. Pass one to run all 33.");
    return;
  }

  console.log(`\nLive verdicts for ${clientId}\n`);
  const counts: Record<string, number> = {};

  for (const step of DELIVERY_STEPS) {
    let verdict: Verdict;
    try {
      verdict = await verifyStep(clientId, step.key);
    } catch (e) {
      failures += 1;
      console.log(`  THREW  ${step.key}: ${(e as Error).message}`);
      continue;
    }

    counts[verdict.kind] = (counts[verdict.kind] ?? 0) + 1;
    const detail = verdict.ok
      ? verdict.evidence.join(" · ")
      : `${verdict.found}`;
    const mark = verdict.ok ? (verdict.kind === "system" ? "OK  ✅" : "OK  ☑️") : "--     ";
    console.log(`  ${mark} ${step.key.padEnd(26)} ${verdict.kind.padEnd(8)} ${detail.slice(0, 90)}`);
  }

  console.log(`\n  ${JSON.stringify(counts)}`);

  // A step that returns `system` while its evidence lives only in a Slack thread would be the
  // most expensive possible bug here: a green tick over an unchecked human assertion. The
  // thread-tier steps are listed rather than inferred, so this fails loudly if one is
  // rewritten to claim system evidence.
  const THREAD_TIER: StepKey[] = [
    "presence_sweep_manual",
    "call_booked",
    "call_held",
    "access_granted",
    "day_zero_archive",
    "gbp_buildout",
    "cards_printed",
    "review_tool_handed",
    "day_30_date",
  ];
  for (const key of THREAD_TIER) {
    const verdict = await verifyStep(clientId, key);
    ok(
      `${key} never claims system evidence`,
      !(verdict.ok && verdict.kind === "system"),
      verdict.ok ? verdict.evidence.join(" · ") : undefined
    );
  }
}

live()
  .catch((e) => {
    failures += 1;
    console.error("\nprobe threw:", (e as Error).message);
  })
  .finally(() => {
    console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
    process.exit(failures === 0 ? 0 : 1);
  });
