// Workflow -> Markdown spec, and analyzer scrub -> Markdown storyboard.
//
// Every workflow gets its own MD file (docs/workflows/<id>.md via
// scripts/generate-workflow-docs.ts) so the whole spec — identity, visual rules, copy
// boxes, scene prompts, image settings, sourcing — lives in ONE reviewable document.
// The #content-analyzer 🧪 scrub uploads buildAnalysisMarkdown as a .md file into the
// Slack thread: the storyboard + everything needed to create the workflow from it.

import type { Workflow } from "@/config/workflows";
import { buildSearchQueries, buildResearchPrompt } from "@/lib/reel/sourcing-worksheet";

const EDITOR_BASE = "https://mission.srtagency.com/dashboard/content-workflows";

function fmtSeconds(n: number | undefined): string {
  return typeof n === "number" ? `${n}s` : "—";
}

/** The full per-workflow spec, mirroring the dashboard editor sections. */
export function buildWorkflowMarkdown(wf: Workflow): string {
  const refs = wf.reference_media?.length ?? 0;
  const approved = wf.approved_variations?.length ?? 0;
  const opts = wf.render_options ?? {};
  const spec = wf.render_spec;
  const lines: string[] = [
    `# ${wf.name}`,
    "",
    `| | |`,
    `|---|---|`,
    `| id | \`${wf.id}\` |`,
    `| avatar | ${wf.vertical_id} |`,
    `| category | ${wf.category}${String(wf.subcategory ?? "") ? ` / ${wf.subcategory}` : ""} |`,
    `| status | ${wf.status} · ${wf.production_status ?? "building"} · refs ${refs}/3 · approved ${approved}/4 |`,
    `| image model | ${opts.provider ?? "openai"} (gpt-image-2 direct) @ ${opts.aspect ?? "3:4"}${opts.quality ? ` · ${opts.quality}` : ""} — portrait renders 1024x1536 (2:3) |`,
    `| song | ${wf.song_ref ?? "(none — session asks)"} |`,
    `| editor | ${EDITOR_BASE}/${wf.id} |`,
    "",
    "## What this is",
    "",
    wf.description ?? "(no description yet — set it; it grounds every generation)",
    "",
    "## Visual rules (the law — every hook, idea, and image prompt must comply)",
    "",
    ...(wf.visual_rules?.length ? wf.visual_rules.map((r, i) => `${i + 1}. ${r}`) : ["(none yet — add them in the editor; this is the workflow's memory)"]),
  ];

  if (wf.copy_structure?.length) {
    lines.push(
      "",
      "## Copy structure (the labeled boxes each session fills)",
      "",
      "| # | slot | label | shot | in→out | position | guidance |",
      "|---|------|-------|------|--------|----------|----------|",
      ...wf.copy_structure.map(
        (r, i) =>
          `| ${i + 1} | \`${r.key}\` | ${r.label} | ${r.shot ?? "—"} | ${fmtSeconds(r.at_second)}→${fmtSeconds(r.out_second)} | ${r.position ?? "—"} | ${r.guidance ?? ""} |`
      )
    );
  }

  if (spec) {
    lines.push(
      "",
      "## Render spec",
      "",
      `- mode: ${spec.mode ?? "static_images"} · duration: ${spec.duration_seconds}s · shots: ${(spec.shots ?? []).map((s) => `#${s.i} ${s.start}-${s.end}s`).join(", ")}`
    );
  }

  if (wf.scenes?.length) {
    lines.push("", "## Scenes (seed image prompts — sessions regenerate, these define the LOOK)");
    wf.scenes.forEach((s, i) => {
      lines.push(
        "",
        `### Shot ${i + 1} — ${s.role}`,
        `- image_prompt: ${s.image_prompt}`,
        `- animation: ${s.animation_prompt || "—"}`,
        `- duration: ${fmtSeconds(s.duration_seconds)}${s.image_url ? ` · [last render](${s.image_url})` : ""}`
      );
    });
  }

  lines.push(
    "",
    "## Sourcing (fill this workflow's reference library)",
    "",
    "Where to look:",
    ...buildSearchQueries(wf).map((q) => `- ${q}`),
    "",
    "Drop screenshots/clips in this workflow's #content-full session thread — each counts toward refs N/3 AND grounds every future image. Min 3, target 6-10.",
    "",
    "Research prompt (paste into Claude/ChatGPT):",
    "",
    "```",
    buildResearchPrompt(wf),
    "```",
    "",
    "## Tuning",
    "",
    `Edit name / description / visual rules / scene prompts / image settings at ${EDITOR_BASE}/${wf.id}.`,
    "When an image drifts, fix the RULE (add a ban), not just the one image — the next session inherits it.",
    "After edits, regenerate the docs: `bun run scripts/generate-workflow-docs.ts` (and the worksheet: `bun run scripts/generate-sourcing-worksheet.ts`).",
    ""
  );
  return lines.join("\n");
}

// ---- Analyzer scrub -> storyboard markdown -------------------------------------------------

export interface AnalysisForDoc {
  storyboard: Array<{ shot: number; what: string; why: string }>;
  why_it_works: string;
  our_version: {
    idea: string;
    image_prompt: string;
    animation_prompt: string;
    captions: { authority: string; relatable: string; curiosity: string };
    titles: string[];
  };
}

/** The scrubbed video as a ready-to-build document: storyboard + remake + the exact
 *  Claude Code prompt to finish the (already drafted) workflow. */
export function buildAnalysisMarkdown(
  analysis: AnalysisForDoc,
  opts: { videoUrl?: string; section?: string; draftWorkflow?: { id: string; name: string; verticalId: string } | null }
): string {
  const wf = opts.draftWorkflow;
  const lines: string[] = [
    `# Storyboard — ${analysis.our_version.idea || "analyzed video"}`,
    "",
    ...(opts.videoUrl ? [`Source: ${opts.videoUrl}`] : []),
    ...(opts.section ? [`Section: ${opts.section}`] : []),
    "",
    "## Why it works",
    "",
    analysis.why_it_works,
    "",
    "## Shot-by-shot",
    "",
    "| shot | what happens | why it works |",
    "|------|--------------|--------------|",
    ...analysis.storyboard.map((s) => `| ${s.shot} | ${s.what} | ${s.why} |`),
    "",
    "## Our version",
    "",
    `- **Idea:** ${analysis.our_version.idea}`,
    `- **Image prompt:** ${analysis.our_version.image_prompt}`,
    `- **Animation:** ${analysis.our_version.animation_prompt}`,
    "",
    "Captions:",
    `- authority: ${analysis.our_version.captions.authority}`,
    `- relatable: ${analysis.our_version.captions.relatable}`,
    `- curiosity: ${analysis.our_version.captions.curiosity}`,
    "",
    "Title options:",
    ...analysis.our_version.titles.map((t, i) => `${i + 1}. ${t}`),
    "",
    "## Create the workflow",
    "",
  ];
  if (wf) {
    lines.push(
      `Draft workflow already created: **${wf.name}** (\`${wf.id}\`, status draft).`,
      "",
      "To finish it, give Claude Code this:",
      "",
      "```",
      `Configure the workflow "${wf.name}" (id: ${wf.id}, avatar: ${wf.verticalId}) in srt-mission-control:`,
      "define its copy_structure (labeled boxes), song, shot count, and the per-second render_spec",
      "(shots + on-screen text timings + positions), plus visual_rules distilled from the storyboard",
      "above. Then set status=active and regenerate the workflow docs.",
      "```",
      "",
      `Or tune it in the editor: ${EDITOR_BASE}/${wf.id}`
    );
  } else {
    lines.push(
      "No draft workflow was created from this scrub. To productize it, give Claude Code the",
      "storyboard above and ask for a new workflow (scenes + copy_structure + visual_rules + render_spec)."
    );
  }
  lines.push("");
  return lines.join("\n");
}
