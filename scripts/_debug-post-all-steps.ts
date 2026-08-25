/**
 * ONE-OFF DEBUG SCRIPT. Deliberately overrides the normal post-on-unblock behaviour.
 *
 * Matthew wants every one of the 33 steps visible at once so he can open each thread and find
 * the bugs in one pass rather than a step at a time over a week.
 *
 *   1. Posts a top-level anchor for every step that lacks one, in DELIVERY_STEPS order,
 *      IGNORING blockedBy.
 *   2. Posts the instruction card into the thread of every step that has NO auto runner.
 *
 * WHY NOT EVERY CARD: postStep() parks a row at `awaiting_me`, and runReadyAutoSteps only
 * claims rows in pending/blocked/ready. Posting a card for a step that HAS a runner makes that
 * runner unclaimable forever, which is the starvation bug fixed in ac0b733. Auto steps get an
 * anchor only; their threads fill when they run.
 *
 * It never ticks anything and writes no verdicts.
 */
import { DELIVERY_STEPS } from "../src/config/delivery-steps";

const CLIENT_ID = process.argv[2];
if (!CLIENT_ID) {
  console.error("usage: bun scripts/_debug-post-all-steps.ts <clientId>");
  process.exit(1);
}

async function main() {
  const { postStepAnchor, refreshStepAnchor, refreshHeader } = await import(
    "../src/lib/clients/step-board"
  );
  const { postStep } = await import("../src/lib/clients/step-engine");
  const { AUTO_RUNNERS } = await import("../src/lib/clients/artifacts/registry");

  let anchored = 0;
  let carded = 0;
  const failures: string[] = [];

  for (const [i, step] of DELIVERY_STEPS.entries()) {
    const n = String(i + 1).padStart(2);

    const res = await postStepAnchor(CLIENT_ID, step.key);
    if (!res.ok) {
      failures.push(`${n}. ${step.key} anchor: ${res.error}`);
      console.log(`  ${n}. ${step.key.padEnd(26)} ANCHOR FAILED  ${res.error}`);
      continue;
    }
    anchored += 1;
    await refreshStepAnchor(CLIENT_ID, step.key);

    if (AUTO_RUNNERS[step.key]) {
      console.log(`  ${n}. ${step.key.padEnd(26)} anchor only (has a runner)`);
      await new Promise((r) => setTimeout(r, 350));
      continue;
    }

    try {
      await postStep(CLIENT_ID, step.key);
      carded += 1;
      console.log(`  ${n}. ${step.key.padEnd(26)} anchor + card`);
    } catch (e) {
      failures.push(`${n}. ${step.key} card: ${(e as Error).message}`);
      console.log(`  ${n}. ${step.key.padEnd(26)} CARD THREW  ${(e as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 400));
  }

  await refreshHeader(CLIENT_ID);
  console.log(`\nanchors ok: ${anchored}/${DELIVERY_STEPS.length}   cards posted: ${carded}`);
  if (failures.length) {
    console.log("\nfailures:");
    for (const f of failures) console.log("  " + f);
  }
}

main().catch((e) => {
  console.error("threw:", e);
  process.exit(1);
});
