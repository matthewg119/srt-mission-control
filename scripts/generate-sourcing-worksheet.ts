// Regenerate docs/WORKSHEET-content-sourcing.md from the LIVE workflow library.
// Run after any workflow change (new workflow, renamed, rules/scenes edited):
//
//   bun run scripts/generate-sourcing-worksheet.ts
//
// The worksheet + the Slack `worksheet` command both read src/lib/reel/sourcing-worksheet.ts,
// so the doc and the cards can never drift.

import { writeFileSync } from "fs";
import { join } from "path";
import { listWorkflows } from "../src/config/workflows";
import { buildWorksheetMarkdown } from "../src/lib/reel/sourcing-worksheet";

async function main() {
  const all = (await listWorkflows(undefined, { status: "all" })).filter((w) => w.status !== "archived");
  const md = buildWorksheetMarkdown(all, new Date().toISOString().slice(0, 10));
  const out = join(__dirname, "..", "docs", "WORKSHEET-content-sourcing.md");
  writeFileSync(out, md, "utf8");
  console.log(`wrote ${out} (${all.length} workflows, ${md.length} chars)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
