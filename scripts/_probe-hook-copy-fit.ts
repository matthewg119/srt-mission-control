// Probe for the #ai-content-clinic stall: does reslotCopyToStructure survive the pasted
// TRT block on Workflow 7, and do the per-scene image prompts come back?
//   bun run scripts/_probe-hook-copy-fit.ts
// Read-only: hits Supabase for the workflow/vertical and Claude for the two calls. Writes nothing.
import { loadWorkflow } from "../src/config/workflows";
import { loadVertical, dropOwnerVerticalId } from "../src/config/verticals";
import { reslotCopyToStructure } from "../src/lib/reel/creative-director";
import { zeroAdaptationCopy, shotCount } from "../src/lib/reel/drop-studio";

const WORKFLOW_ID = process.env.PROBE_WORKFLOW ?? "pest_control__broll__funding_3tips_w7";
const DROP_VERTICAL = process.env.PROBE_VERTICAL ?? "trt_clinic_ai";

const PASTED = `TRT Clinic Owners
The truth about showing up in ChatGPT.
Paid ads are banned for health advertising inside LLMs.
Which means local clinics that optimize have a real organic shot.
Only 1.2% of businesses are currently visible to AI (July 2026).
Early movers own this window.
Link in bio for a free audit`;

async function main() {
  const workflow = await loadWorkflow(WORKFLOW_ID);
  if (!workflow) throw new Error(`workflow ${WORKFLOW_ID} not found`);
  const drop = await loadVertical(DROP_VERTICAL);
  const owner = await loadVertical(dropOwnerVerticalId(drop));

  const lines = PASTED.split("\n").map((l) => l.trim()).filter(Boolean);
  const boxes = (workflow.copy_structure ?? []).length;
  console.log(`workflow: ${workflow.name} (${shotCount(workflow)} shots, ${boxes} boxes)`);
  console.log(`pasted:   ${lines.length} lines`);
  console.log(`zeroAdaptation: ${zeroAdaptationCopy(workflow, lines) ? "HIT (verbatim)" : "MISS -> reslot via Claude"}`);

  console.log("\n--- reslotCopyToStructure ---");
  const copy = await reslotCopyToStructure({ vertical: owner, workflow, pastedBlock: PASTED });
  copy.forEach((c) => console.log(`  ${c.label}: ${c.text}`));
  if (!copy.length) throw new Error("reslot returned zero lines");

  console.log("\n--- per-scene image prompts (copy-first: no hook image, 1 set) ---");
  const { generateStoryboardOptions } = await import("../src/lib/reel/hook-studio");
  const scenes = Array.from({ length: shotCount(workflow) }, (_, i) => i + 1);
  const [board] = await generateStoryboardOptions({
    owner,
    workflow,
    lookVertical: drop,
    copy,
    hookImage: null,
    scenes,
    optionCount: 1,
  });
  board?.prompts.forEach((p, i) => console.log(`\n  Scene ${i + 1}:\n  ${p}`));
  console.log(`\nOK: ${copy.length} copy lines, ${board?.prompts.length ?? 0} scene prompts`);
}

main().catch((e) => {
  console.error("PROBE FAILED:", e);
  process.exit(1);
});
