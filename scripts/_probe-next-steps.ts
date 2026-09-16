// Does every card actually offer a next step, and does it name the RIGHT one?
//
// Matthew asked for this by name and called it acceptance criteria: "every workflow card that
// completes ends by printing what can be done next. A card that completes and offers nothing is
// the bug." Before this, three of the twenty-nine instructionsFor arms printed one.
//
// ‼️ THE FAILURE THIS CATCHES IS A CONFIDENT WRONG ANSWER, not a missing one. "Then step 17"
// derived from the array index rather than from the dependency graph points somebody at work
// that is still blocked, and a card that sends you to a step which then refuses is worse than a
// card that said nothing.
//
//   bunx tsx --env-file=.env.local scripts/_probe-next-steps.ts [clientId]
import { DELIVERY_STEPS, stepNumber, type StepKey } from "@/config/delivery-steps";
import { nextStepLines, stepLabel } from "@/lib/clients/next-steps";
import { supabaseAdmin } from "@/lib/db";

let failures = 0;
function check(pass: boolean, label: string, detail?: string) {
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) {
    failures += 1;
    if (detail) console.log(`      ${detail}`);
  }
}

async function main() {
  // ── 1. The label never carries a typed number ─────────────────────────────
  const first = DELIVERY_STEPS[0].key as StepKey;
  check(
    stepLabel(first).startsWith(`${stepNumber(first)}. `),
    "stepLabel numbers from stepNumber(), so inserting a step moves it"
  );

  const clientId = process.argv[2];
  if (!clientId) {
    console.log("\nNo client id given, skipping the live half. Pass one to walk a real board.");
    if (failures) process.exit(1);
    console.log("\nAll checks passed.");
    return;
  }

  const { data: rows } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId);

  if (!rows?.length) {
    console.log(`\nNo board for ${clientId}.`);
    process.exit(1);
  }

  const done = new Set(
    rows.filter((r) => r.status === "complete" || r.status === "skipped").map((r) => r.step_key as string)
  );

  console.log(`\n${done.size} of ${rows.length} steps done. Walking every card:\n`);

  let bare = 0;
  for (const step of DELIVERY_STEPS) {
    const lines = await nextStepLines(clientId, step.key as StepKey);
    if (!lines.length) {
      bare += 1;
      console.log(`  BARE  ${stepLabel(step.key as StepKey)}`);
      continue;
    }

    // ‼️ THE ONE THAT MATTERS: a named follow-on must actually be unblocked by this step. The
    // regex reads the label back out of the rendered line, which is the same string a person
    // reads, so this checks what was PRINTED rather than what was computed.
    const named = /Then \*([0-9]+)\. /.exec(lines.join("\n"));
    if (named) {
      const n = Number(named[1]);
      const target = DELIVERY_STEPS[n - 1];
      const blockers = target?.blockedBy ?? [];
      const ok =
        !!target &&
        blockers.includes(step.key) &&
        blockers.every((b) => b === step.key || done.has(b));
      check(ok, `${stepLabel(step.key as StepKey)} points at ${n}`, ok ? undefined : `${target?.key} is blockedBy ${blockers.join(", ")}`);
    }
  }

  console.log(`\n${bare} of ${DELIVERY_STEPS.length} steps produced no footer at all.`);
  check(bare === 0, "every step produces a next-step block");

  if (failures) {
    console.log(`\n${failures} failing.`);
    process.exit(1);
  }
  console.log("\nAll checks passed. Every card offers its next step.");
}

main();

export {};
