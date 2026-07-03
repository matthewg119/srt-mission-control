// One-shot backfill: give every workflow missing a consistency profile a one-line
// description + 3-5 visual rules, in ONE Claude call. Run AFTER applying
// docs/2026-07-05-workflow-systemization.sql.
//
// Usage:  bun run scripts/backfill-workflow-descriptions.ts
// Needs:  NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + ANTHROPIC_API_KEY (.env.local)
//
// Descriptions are one plain sentence, no em dashes (house rule). Unconfigured drafts
// with no structure get a mechanical fallback instead of burning AI tokens on nothing.

import { supabaseAdmin } from "../src/lib/db";
import { callClaudeJSON, type ClaudeModel } from "../src/lib/claude-calls";
import { setWorkflowProfile, describeWorkflowMechanically } from "../src/lib/reel/workflow-author";
import { listWorkflows, type Workflow } from "../src/config/workflows";

interface ProfileResult {
  profiles: Array<{ id: string; description: string; visual_rules: string[] }>;
}
function isProfileResult(v: unknown): v is ProfileResult {
  const p = v as ProfileResult;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(p.profiles) &&
    p.profiles.every(
      (x) => x && typeof x.id === "string" && typeof x.description === "string" && Array.isArray(x.visual_rules)
    )
  );
}

function summarize(w: Workflow) {
  return {
    id: w.id,
    name: w.name,
    category: w.category,
    subcategory: w.subcategory,
    copy_structure: (w.copy_structure ?? []).map((r) => ({ label: r.label, guidance: r.guidance, position: r.position })),
    scenes: w.scenes.map((s) => ({ role: s.role, image_prompt: s.image_prompt.slice(0, 200) })),
    duration_seconds: w.render_spec?.duration_seconds,
    shots: w.render_spec?.shots?.length ?? w.scenes.length,
    mode: w.render_spec?.mode,
    aspect: w.render_options?.aspect,
  };
}

async function main() {
  const all = await listWorkflows(undefined, { status: "all" });
  const missing = all.filter((w) => !w.description);
  if (!missing.length) {
    console.log("All workflows already have descriptions. Nothing to do.");
    return;
  }

  const configured = missing.filter((w) => (w.copy_structure?.length ?? 0) > 0 || w.scenes.length > 0);
  const bare = missing.filter((w) => !configured.includes(w));

  // Bare drafts: mechanical fallback, no AI.
  for (const w of bare) {
    const desc = `${w.category} format, not configured yet.`;
    await setWorkflowProfile(w.id, { description: desc, visual_rules: [] });
    console.log(`  (mechanical) ${w.id}: ${desc}`);
  }

  if (!configured.length) {
    console.log(`Done. ${bare.length} bare drafts stamped.`);
    return;
  }

  console.log(`Asking Claude for ${configured.length} profiles in one call...`);
  const model = (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
  const { data } = await callClaudeJSON<ProfileResult>({
    model,
    system: [
      "You are the creative director of a short-form content studio for local-business avatars.",
      "For EACH workflow below, write its consistency profile:",
      "- description: ONE plain sentence saying what the finished video is (shots, length, style,",
      "  narrative arc). A teammate should recognize the format from it instantly.",
      "- visual_rules: 3 to 5 short imperative rules every generated image in this workflow must",
      "  follow to stay consistent (camera POV, setting, lighting, what must never appear).",
      "Always include a rule banning text/captions/logos/watermarks inside the image.",
      "HARD RULES: plain language, no hype, never use em dashes.",
    ].join("\n"),
    user: [
      "The workflows (JSON):",
      JSON.stringify(configured.map(summarize), null, 1),
      "",
      "Return JSON: { profiles: [{ id, description, visual_rules: [string] }] } with one entry per workflow, same ids.",
    ].join("\n"),
    maxTokens: 4000,
    temperature: 0.4,
    schemaHint: '{ "profiles": [{ "id": string, "description": string, "visual_rules": [string] }] }',
    validate: isProfileResult,
  });

  for (const w of configured) {
    const p = data.profiles.find((x) => x.id === w.id);
    if (p) {
      await setWorkflowProfile(w.id, { description: p.description, visual_rules: p.visual_rules.slice(0, 5) });
      console.log(`  ${w.id}: ${p.description}`);
    } else {
      const desc = describeWorkflowMechanically(w);
      await setWorkflowProfile(w.id, { description: desc });
      console.log(`  (fallback) ${w.id}: ${desc}`);
    }
  }

  // Sanity check: confirm the writes landed (also catches a missing migration).
  const { data: check, error } = await supabaseAdmin.from("workflows").select("id, description").is("description", null);
  if (error) console.error("Post-check failed (is the 2026-07-05 migration applied?):", error.message);
  else console.log(`Done. ${check?.length ?? 0} workflows still without a description (seed-only rows are expected).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
