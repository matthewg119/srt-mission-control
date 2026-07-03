// Prompt enrichment — the payoff step where the reference library + learned style rules
// actually change what gets generated.
//
// buildPovImagePrompt (pov.ts) is the single choke point every "before"/"after" image prompt
// flows through, but on its own it only knows the vertical's style_token + the scene. enrichScene
// runs ONE Claude-vision pass that looks at real reference frames (from content_examples) and the
// operator's approved style rules (from style_rules), then rewrites the scene into a realism-
// grounded description (older, lived-in homes; plates on the shelf; aged fixtures) that the image
// generator can render. The image models stay prompt-only; references land here, in words.
//
// Graceful: when there are NO reference frames AND NO active rules, enrichScene returns the scene
// unchanged, so the generated prompt is byte-identical to today until the library/rules exist.

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { loadReferenceFrames } from "@/lib/reel/content-examples";
import { loadActiveStyleRules } from "@/lib/reel/style-rules";
import { DEFAULT_VERTICAL_ID, type Vertical } from "@/config/verticals";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

interface EnrichResult {
  scene: string;
}

function isEnrichResult(v: unknown): v is EnrichResult {
  return typeof v === "object" && v !== null && typeof (v as EnrichResult).scene === "string";
}

/**
 * Rewrite a scene into a realism-grounded version using reference frames + active style rules.
 * Returns the original scene unchanged when there is nothing to apply (or on any error), so the
 * downstream prompt is byte-identical to today until the library/rules are populated.
 */
export async function enrichScene(
  scene: string,
  opts: {
    vertical: Vertical;
    formatGroup?: string;
    referenceLimit?: number;
    extraRules?: string[];
    /** The workflow whose look this frame belongs to: its OWN reference library grounds the
     *  frame, and the subject wording follows its category (POV wording only for pov). */
    workflow?: { id: string; category?: string; description?: string | null } | null;
  }
): Promise<string> {
  const verticalId = opts.vertical.id || DEFAULT_VERTICAL_ID;

  // Pull rules + reference frames in parallel; bail to the original scene if there is nothing to
  // apply. `extraRules` are not-yet-saved candidate rules used for a live preview before the
  // operator approves them, so their presence alone is enough to enrich.
  const [rules, frames] = await Promise.all([
    loadActiveStyleRules(verticalId, opts.formatGroup),
    loadReferenceFrames(verticalId, { limit: opts.referenceLimit ?? 4, workflowId: opts.workflow?.id }),
  ]);
  const extra = (opts.extraRules ?? []).map((r) => stripEmDashes(r)).filter(Boolean);
  if (rules.length === 0 && frames.length === 0 && extra.length === 0) return scene;

  // Subject line follows the workflow's category: glasses-POV wording ONLY for pov workflows
  // (a storytime/broll frame must never inherit gloved-hands POV framing). No workflow (the
  // daily-drop crons) keeps the original POV wording unchanged.
  const wf = opts.workflow;
  const isPov = !wf || String(wf.category ?? "pov") === "pov";
  const subjectLines = isPov
    ? [
        "You refine the scene description for a single AI-generated first frame. The frame is a",
        "first-person Ray-Ban Meta smart-glasses POV shot for a pest control brand. Keep the SAME",
        "action, subject, framing, gloved hands, and any equipment described in the base scene. You are",
        "only allowed to make the setting more realistic and specific, and to honor the operator's rules.",
        "NON-NEGOTIABLE: the rewritten scene MUST read as a true first-person eye-height POV, never a",
        "third-person or stock-photo close-up. START the scene with 'First-person Meta-glasses POV'.",
        "Gaze-centered framing; when hands appear they enter from the BOTTOM of the frame.",
      ]
    : [
        `You refine the scene description for a single AI-generated first frame of a ${String(wf?.category)} shot`,
        `for a ${opts.vertical.business_descriptor}. This is documentary b-roll, NOT a glasses POV: no gloved`,
        "hands, no first-person framing unless the base scene says so. Keep the SAME action, subject, and",
        "framing described in the base scene. You are only allowed to make the setting more realistic and",
        "specific, and to honor the operator's rules.",
      ];
  if (wf?.description) subjectLines.push(`This workflow: ${stripEmDashes(wf.description)}`);

  const ruleLines = [...rules.map((r) => r.rule), ...extra].map((r) => `- ${stripEmDashes(r)}`);
  const system = [
    ...subjectLines,
    "",
    frames.length > 0
      ? `You are shown ${frames.length} reference photo(s) of the real look we want (real, lived-in homes). Use them to ground materials, wear, age, clutter, and lighting, so the result never looks like clean new construction or a showroom.`
      : "No reference photos are available this time; rely on the rules below.",
    "",
    ruleLines.length > 0
      ? ["Operator style rules (apply every one that fits this scene):", ...ruleLines].join("\n")
      : "No explicit style rules; just make the setting realistic and lived-in.",
    "",
    "Return JSON: { \"scene\": string } where scene is ONE vivid sentence or two, the rewritten scene",
    isPov
      ? "description ONLY (no on-screen text; keep the 'First-person Meta-glasses POV' opener). Do not"
      : "description ONLY (no camera/style boilerplate, no on-screen text, no camera brand names). Do not",
    "add bugs or anything the base scene did not have beyond realism details. Never use em dashes.",
  ].join("\n");

  try {
    const { data } = await callClaudeJSON<EnrichResult>({
      model: model(),
      system,
      user: [`Base scene:`, scene.trim(), "", "Return the enriched scene as JSON."].join("\n"),
      images: frames.length > 0 ? frames : undefined,
      maxTokens: 500,
      temperature: 0.5,
      schemaHint: '{ "scene": string }',
      validate: isEnrichResult,
    });
    const enriched = stripEmDashes(data.scene).trim();
    return enriched.length > 0 ? enriched : scene;
  } catch (e) {
    console.error("[prompt-enrich] enrichScene fell back to base scene:", (e as Error).message);
    return scene;
  }
}
