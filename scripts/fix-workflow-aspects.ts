// One-shot: aspect by category — Meta-glasses POV renders 3:4 (the Ray-Ban native capture
// ratio), EVERYTHING ELSE stays standard 9:16 vertical. Provider is gpt-image-2
// (higgsfield-gpt) across the board. NOTE: the hazel endpoint physically renders 2:3 (its
// only portrait), so POV rows also get a composition rule so the framing READS 3:4.
//
// Usage:  bun run scripts/fix-workflow-aspects.ts   (idempotent, safe to re-run)

import { listWorkflows } from "../src/config/workflows";
import { upsertWorkflow, setWorkflowProfile } from "../src/lib/reel/workflow-author";

const RAYBAN_FRAMING_RULE =
  "Frame like the native Ray-Ban Meta 3:4 portrait capture: eye-height, gaze-centered, subject filling a tall frame.";

async function main() {
  const all = (await listWorkflows(undefined, { status: "all" })).filter((w) => w.status !== "archived");
  for (const wf of all) {
    const isPov = String(wf.category) === "pov";
    const aspect = isPov ? "3:4" : "9:16";
    const before = `${wf.render_options?.aspect ?? "unset"}/${wf.render_options?.provider ?? "unset"}`;
    const ok = await upsertWorkflow({
      ...wf,
      render_options: { ...wf.render_options, aspect, provider: "higgsfield-gpt" },
    });
    let ruleNote = "";
    if (ok && isPov) {
      const rules = wf.visual_rules ?? [];
      if (!rules.includes(RAYBAN_FRAMING_RULE)) {
        await setWorkflowProfile(wf.id, { visual_rules: [...rules, RAYBAN_FRAMING_RULE] });
        ruleNote = " +framing rule";
      }
    }
    console.log(`${ok ? "set" : "FAILED"} ${wf.id} (was ${before} -> ${aspect}/higgsfield-gpt)${ruleNote}`);
  }
  console.log(`\n${all.length} workflows set: POV @ 3:4, everything else @ 9:16, all on higgsfield-gpt.`);
  console.log("Note: hazel's only portrait output is 2:3; POV framing rule is the composition lever.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
