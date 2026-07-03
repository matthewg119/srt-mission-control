// Regenerate docs/workflows/<id>.md — ONE markdown spec file per live workflow (identity,
// visual rules, copy structure, scenes/prompts, image settings, sourcing, tuning notes).
// Run after any workflow change:
//
//   bun run scripts/generate-workflow-docs.ts
//
// Files for workflows that were deleted/archived since the last run are pruned.

import { writeFileSync, mkdirSync, readdirSync, unlinkSync } from "fs";
import { join } from "path";
import { listWorkflows } from "../src/config/workflows";
import { buildWorkflowMarkdown } from "../src/lib/reel/workflow-doc";

async function main() {
  const all = (await listWorkflows(undefined, { status: "all" })).filter((w) => w.status !== "archived");
  const dir = join(__dirname, "..", "docs", "workflows");
  mkdirSync(dir, { recursive: true });
  const wanted = new Set(all.map((w) => `${w.id}.md`));
  for (const f of readdirSync(dir)) {
    if (f.endsWith(".md") && !wanted.has(f)) {
      unlinkSync(join(dir, f));
      console.log(`pruned ${f}`);
    }
  }
  for (const wf of all) {
    writeFileSync(join(dir, `${wf.id}.md`), buildWorkflowMarkdown(wf), "utf8");
    console.log(`wrote docs/workflows/${wf.id}.md`);
  }
  console.log(`\n${all.length} workflow docs.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
