// Collect EVERY POV image prompt this system has used into ONE reviewable markdown file:
//
//   bunx tsx scripts/dump-pov-prompts.ts   ->  docs/POV-PROMPT-LIBRARY.md
//
// Sources:
//   1. workflows.scenes[]        — each POV workflow's seed image/animation prompts + visual rules
//   2. content_jobs.data         — final_prompts + session_scenes actually approved in sessions
//   3. style_rules               — the per-vertical rules enrichment bakes into every prompt
//   4. seed pools                — POV_SCENES (pov-style.ts) + each vertical's scene pool
//
// The output is Matthew's curation surface for the prompt feedback loop: edit/annotate the file,
// keep what works, and feed the keepers back as workflow scene prompts + visual rules.

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { listWorkflows } from "../src/config/workflows";
import { listVerticals, loadVertical } from "../src/config/verticals";
import { POV_SCENES } from "../src/config/pov-style";
import { supabaseAdmin } from "../src/lib/db";

interface UniquePrompt {
  text: string;
  sources: string[];
}

const unique = new Map<string, UniquePrompt>();
function record(text: string | null | undefined, source: string): void {
  const t = (text ?? "").trim();
  if (!t) return;
  const key = t.toLowerCase().replace(/\s+/g, " ");
  const existing = unique.get(key);
  if (existing) {
    if (!existing.sources.includes(source)) existing.sources.push(source);
  } else {
    unique.set(key, { text: t, sources: [source] });
  }
}

async function main() {
  const lines: string[] = [];

  // ---- 1. POV workflows: seeds + rules ----------------------------------------------------
  const all = (await listWorkflows(undefined, { status: "all" })).filter((w) => w.status !== "archived");
  const povWorkflows = all.filter((w) => String(w.category) === "pov");

  lines.push("## 1. POV workflow seed prompts (the library's structure)");
  for (const wf of povWorkflows) {
    lines.push("", `### ${wf.name}  (\`${wf.id}\`, ${wf.status})`);
    if (wf.visual_rules?.length) {
      lines.push("", "Visual rules:");
      wf.visual_rules.forEach((r, i) => lines.push(`${i + 1}. ${r}`));
    }
    lines.push("");
    wf.scenes.forEach((s, i) => {
      lines.push(`**Shot ${i + 1} — ${s.role}**`, "```", s.image_prompt, "```", `motion: ${s.animation_prompt || "-"}`, "");
      record(s.image_prompt, `seed: ${wf.id} shot ${i + 1}`);
    });
  }

  // ---- 2. Session-approved finals (content_jobs) ------------------------------------------
  const povIds = new Set(povWorkflows.map((w) => w.id));
  const { data: jobs } = await supabaseAdmin
    .from("content_jobs")
    .select("id, created_at, vertical_id, data")
    .eq("format_id", "workflow")
    .order("created_at", { ascending: false })
    .limit(500);

  lines.push("", "## 2. Session-approved final prompts (newest first — what actually generated)");
  let sessionCount = 0;
  for (const row of (jobs ?? []) as Array<{ id: string; created_at: string; vertical_id: string; data: Record<string, unknown> }>) {
    const wfId = row.data?.workflow_id as string | undefined;
    if (!wfId || !povIds.has(wfId)) continue;
    const finals = (row.data?.final_prompts as string[] | undefined) ?? [];
    const sess = (row.data?.session_scenes as Array<{ role?: string; image_prompt?: string }> | undefined) ?? [];
    const prompts = finals.length ? finals : sess.map((s) => s.image_prompt ?? "");
    if (!prompts.some((p) => p && p.trim())) continue;
    sessionCount++;
    lines.push("", `### ${row.created_at.slice(0, 10)} — \`${wfId}\` (job ${row.id.slice(0, 8)})`);
    prompts.forEach((p, i) => {
      if (!p?.trim()) return;
      lines.push(`**${i + 1}.${sess[i]?.role ? ` ${sess[i].role}` : ""}**`, "```", p.trim(), "```");
      record(p, `session ${row.created_at.slice(0, 10)}: ${wfId}`);
    });
  }
  if (!sessionCount) lines.push("", "_No POV session prompts recorded yet._");

  // ---- 3. Style rules ----------------------------------------------------------------------
  const { data: rules } = await supabaseAdmin
    .from("style_rules")
    .select("rule, vertical_id, format_group, status, created_at")
    .order("created_at", { ascending: false })
    .limit(300);
  lines.push("", "## 3. Style rules (enrichment bakes ACTIVE ones into every prompt)");
  for (const r of (rules ?? []) as Array<{ rule: string; vertical_id: string; format_group: string | null; status: string }>) {
    lines.push(`- [${r.status}] (${r.vertical_id}${r.format_group ? `/${r.format_group}` : ""}) ${r.rule}`);
  }
  if (!rules?.length) lines.push("_No style rules yet._");

  // ---- 4. Seed pools -----------------------------------------------------------------------
  lines.push("", "## 4. Seed scene pools (the cron drop's rotation)");
  lines.push("", "### POV_SCENES (src/config/pov-style.ts)");
  POV_SCENES.forEach((s, i) => {
    lines.push(`${i + 1}. ${s}`);
    record(s, "POV_SCENES pool");
  });
  const verticals = await listVerticals();
  for (const vRef of verticals) {
    const v = await loadVertical(vRef.id).catch(() => null);
    if (!v?.scenes?.length) continue;
    lines.push("", `### ${v.id} scene pool`);
    v.scenes.forEach((s: string, i: number) => {
      lines.push(`${i + 1}. ${s}`);
      record(s, `${v.id} scene pool`);
    });
  }

  // ---- 5. Deduped master list ---------------------------------------------------------------
  const uniques = [...unique.values()];
  const master: string[] = ["", "## 5. All unique POV prompts (deduped, with every place each appears)"];
  uniques.forEach((u, i) => {
    master.push("", `**${i + 1}.** _(${u.sources.join(" · ")})_`, "```", u.text, "```");
  });

  const header = [
    "# POV Prompt Library",
    "",
    `${povWorkflows.length} POV workflows · ${sessionCount} sessions with approved prompts · ${uniques.length} unique prompts.`,
    "Regenerate anytime: `bunx tsx scripts/dump-pov-prompts.ts`.",
    "",
    "**How to curate (the feedback loop):** mark keepers, delete duds, and note WHY next to each.",
    "Feed the keepers back as (a) workflow scene prompts in the editor, (b) visual rules (bans and",
    "musts), and (c) reference images pasted into the workflow's Slack session. Every image you",
    "paste in a session is saved as a reference automatically, so the library grounds itself over time.",
    "",
  ];

  const out = [...header, ...lines, ...master, ""].join("\n");
  const dir = join(__dirname, "..", "docs");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "POV-PROMPT-LIBRARY.md");
  writeFileSync(file, out, "utf8");
  console.log(`wrote ${file} (${povWorkflows.length} workflows, ${sessionCount} sessions, ${uniques.length} unique prompts)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
