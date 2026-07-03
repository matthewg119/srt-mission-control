// One-shot: every workflow renders 3:4 on gpt-image-2 (higgsfield-gpt), no exceptions.
// 3:4 is the Ray-Ban Meta native capture ratio and the house standard; the 9:16 rows
// (storytime/broll) came from the earlier configure script treating them as regular
// vertical reels. NOTE: the hazel endpoint physically renders 2:3 (its closest supported
// portrait to 3:4), so POV rows also get a composition rule so the framing READS 3:4.
//
// Usage:  bun run scripts/fix-workflow-aspects.ts   (idempotent, safe to re-run)

import { listWorkflows } from "../src/config/workflows";
import { upsertWorkflow, setWorkflowProfile } from "../src/lib/reel/workflow-author";

const RAYBAN_FRAMING_RULE =
  "Frame like the native Ray-Ban Meta 3:4 portrait capture: eye-height, gaze-centered, subject filling a tall frame.";

async function main() {
  const all = (await listWorkflows(undefined, { status: "all" })).filter((w) => w.status !== "archived");
  for (const wf of all) {
    const before = `${wf.render_options?.aspect ?? "unset"}/${wf.render_options?.provider ?? "unset"}`;
    const ok = await upsertWorkflow({
      ...wf,
      render_options: { ...wf.render_options, aspect: "3:4", provider: "higgsfield-gpt" },
    });
    let ruleNote = "";
    if (ok && String(wf.category) === "pov") {
      const rules = wf.visual_rules ?? [];
      if (!rules.includes(RAYBAN_FRAMING_RULE)) {
        await setWorkflowProfile(wf.id, { visual_rules: [...rules, RAYBAN_FRAMING_RULE] });
        ruleNote = " +framing rule";
      }
    }
    console.log(`${ok ? "fixed" : "FAILED"} ${wf.id} (was ${before} -> 3:4/higgsfield-gpt)${ruleNote}`);
  }
  console.log(`\n${all.length} workflows @ 3:4 on higgsfield-gpt.`);
  console.log("Note: hazel renders 2:3 (its closest portrait to 3:4); the framing rule is the composition lever.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
