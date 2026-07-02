// Workflow authoring — turn a #content-analyzer storyboard into a draft `workflows` row, and
// the small CRUD the pipeline/library use to persist and promote workflows.
//
// Decision (2026-07-03): a reference video is NOT a story source; the "scrub" path uses the
// analyzer's shot-by-shot storyboard only to seed the repeatable SCENE SKELETON (roles +
// per-avatar image/animation prompts). The operator reviews the draft, approves scene images,
// adds a song + caption timing, then it can render. Everything here is best-effort + additive.

import { supabaseAdmin } from "@/lib/db";
import { stripEmDashes } from "@/lib/reel/text";
import {
  COPY_ROLE_LIBRARY,
  loadWorkflow,
  type Workflow,
  type WorkflowScene,
  type WorkflowCategory,
  type RenderSequence,
  type CopyRole,
  type RenderSpec,
} from "@/config/workflows";
import { validateRenderSpec } from "@/lib/reel/render-spec";
import type { ProductizedWorkflow } from "@/lib/reel/creative-director";

// The subset of the analyzer's VideoAnalysis this authoring path needs (kept local to avoid a
// circular import with content-analyzer.ts).
export interface AnalysisForWorkflow {
  storyboard: Array<{ shot?: number; what: string; why?: string }>;
  our_version: { idea: string; image_prompt: string; animation_prompt: string };
  example_video_url?: string | null;
  example_storyboard?: unknown | null;
  source_example_id?: string | null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48) || "workflow";
}

export function workflowId(verticalId: string, category: string, name: string): string {
  return `${verticalId}__${category}__${slug(name)}`;
}

/**
 * Map an analyzer storyboard into a DRAFT workflow (one scene per storyboard shot, roles from
 * `what`, prompts seeded from `our_version` in the avatar's look). Inserts it as status=draft
 * and returns the Workflow (or null on failure). The operator reviews + activates it later.
 */
export async function proposeWorkflowFromAnalysis(args: {
  verticalId: string;
  name: string;
  category?: WorkflowCategory | string;
  subcategory?: string | null;
  analysis: AnalysisForWorkflow;
  clipSeconds?: number;
}): Promise<Workflow | null> {
  const category = args.category || "pov";
  const clip = args.clipSeconds ?? 2;
  const baseImage = stripEmDashes(args.analysis.our_version.image_prompt);
  const baseAnim = stripEmDashes(args.analysis.our_version.animation_prompt);

  const scenes: WorkflowScene[] = args.analysis.storyboard.map((s) => ({
    role: stripEmDashes(s.what).slice(0, 120),
    // Seed each scene image prompt from the avatar's remake look + this shot's action. The
    // operator refines/regenerates per scene before approving; the renderer adds style_token.
    image_prompt: `${baseImage} | this shot: ${stripEmDashes(s.what)}`,
    animation_prompt: baseAnim,
    duration_seconds: clip,
    image_url: null,
    image_approved: false,
  }));

  const workflow: Workflow = {
    id: workflowId(args.verticalId, String(category), args.name),
    vertical_id: args.verticalId,
    name: args.name,
    category,
    subcategory: args.subcategory ?? null,
    status: "draft",
    scenes,
    captions: [],
    song_ref: null,
    render_sequences: [],
    render_options: { min_shots: scenes.length, max_shots: scenes.length, clip_seconds: clip, aspect: "9:16" },
    example_video_url: args.analysis.example_video_url ?? null,
    example_storyboard: args.analysis.example_storyboard ?? null,
    shot_screenshots: [],
    source_kind: "reference_video",
    source_example_id: args.analysis.source_example_id ?? null,
  };

  const ok = await upsertWorkflow(workflow);
  return ok ? workflow : null;
}

/**
 * Turn a productized copy block (from productizeCopyToWorkflow) into a saved ACTIVE workflow:
 * copy_structure carries each role's shot/timing/position, render_spec is the baked timeline.
 * Active because it is genuinely configured (the menu's "configured" flag keys off active).
 * Aspect: POV (Meta-glasses) records 3:4; everything else renders 9:16.
 */
export async function createWorkflowFromProductized(args: {
  verticalId: string;
  p: ProductizedWorkflow;
  songRef?: string | null;
}): Promise<{ workflow: Workflow; specErrors: string[] } | null> {
  const { p } = args;
  const copy_structure: CopyRole[] = p.lines.map((l) => ({
    key: l.key,
    label: l.label || COPY_ROLE_LIBRARY[l.key]?.label || l.key,
    guidance: COPY_ROLE_LIBRARY[l.key]?.guidance ?? (l.label || l.key),
    shot: l.shot,
    at_second: l.at_second,
    out_second: l.out_second,
    position: l.position,
  }));
  const render_spec: RenderSpec = {
    mode: "static_images",
    song_ref: args.songRef ?? null,
    duration_seconds: p.duration_seconds,
    shots: p.shots.map((s) => ({ i: s.i, start: s.start, end: s.end })),
    texts: p.lines.map((l, i) => ({
      n: i + 1,
      text: l.text,
      at_second: l.at_second,
      out_second: l.out_second,
      position: l.position,
      role: l.key,
    })),
  };
  const specErrors = validateRenderSpec(render_spec);
  const workflow: Workflow = {
    id: workflowId(args.verticalId, p.category, p.name),
    vertical_id: args.verticalId,
    name: p.name,
    category: p.category,
    subcategory: p.subcategory,
    status: "active",
    scenes: [],
    captions: p.lines.map((l) => ({ text: l.text, at_second: l.at_second })),
    copy_structure,
    render_spec,
    song_ref: args.songRef ?? null,
    render_sequences: [],
    render_options: {
      min_shots: p.shots.length,
      max_shots: p.shots.length,
      aspect: p.category === "pov" ? "3:4" : "9:16",
    },
    example_video_url: null,
    example_storyboard: null,
    shot_screenshots: [],
    source_kind: "productized",
    source_example_id: null,
  };
  const ok = await upsertWorkflow(workflow);
  return ok ? { workflow, specErrors } : null;
}

/** Clone a workflow into ANOTHER avatar's library (cross-avatar template use). The clone keeps
 *  the structure (copy_structure/render_spec/song) but drops the source's scenes/screenshots so
 *  the new avatar generates its own visuals. Never mutates the source. */
export async function cloneWorkflowForVertical(wf: Workflow, verticalId: string): Promise<Workflow | null> {
  if (wf.vertical_id === verticalId) return wf;
  const clone: Workflow = {
    ...wf,
    id: workflowId(verticalId, String(wf.category), wf.name),
    vertical_id: verticalId,
    status: "active",
    scenes: [],
    shot_screenshots: [],
    example_video_url: null,
    example_storyboard: null,
    source_kind: "authored",
    source_example_id: null,
    used_at: null,
  };
  const ok = await upsertWorkflow(clone);
  return ok ? clone : null;
}

/** Insert or update a workflow row (keyed on id). Best-effort. */
export async function upsertWorkflow(w: Workflow): Promise<boolean> {
  try {
    const { error } = await supabaseAdmin.from("workflows").upsert(
      {
        id: w.id,
        vertical_id: w.vertical_id,
        name: w.name,
        category: w.category,
        subcategory: w.subcategory ?? null,
        status: w.status,
        scenes: w.scenes,
        captions: w.captions,
        copy_structure: w.copy_structure ?? [],
        render_spec: w.render_spec ?? null,
        song_ref: w.song_ref ?? null,
        render_sequences: w.render_sequences,
        render_options: w.render_options,
        example_video_url: w.example_video_url ?? null,
        example_storyboard: w.example_storyboard ?? null,
        shot_screenshots: w.shot_screenshots,
        source_kind: w.source_kind,
        source_example_id: w.source_example_id ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (error) {
      console.error("[workflows] upsert failed:", error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[workflows] upsert threw:", (e as Error).message);
    return false;
  }
}

/** Promote/demote a workflow (draft -> active -> archived). Best-effort. */
export async function setWorkflowStatus(id: string, status: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("workflows")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("[workflows] setStatus failed:", error.message);
  } catch (e) {
    console.error("[workflows] setStatus threw:", (e as Error).message);
  }
}

/** Attach a reference creative (screenshot/video/audio) to a workflow's reference_media.
 *  Returns the new reference count, or null on failure (e.g. the column is not applied yet). */
export async function addWorkflowReference(
  id: string,
  ref: { kind: string; url: string }
): Promise<number | null> {
  try {
    const wf = await loadWorkflow(id);
    if (!wf) return null;
    const next = [...(wf.reference_media ?? []), { ...ref, added_at: new Date().toISOString() }];
    const { error } = await supabaseAdmin
      .from("workflows")
      .update({ reference_media: next, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error("[workflows] addReference failed:", error.message);
      return null;
    }
    return next.length;
  } catch (e) {
    console.error("[workflows] addReference threw:", (e as Error).message);
    return null;
  }
}

/** Flip a workflow's production gate ("building" -> "in_production"). Best-effort. */
export async function setProductionStatus(id: string, productionStatus: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("workflows")
      .update({ production_status: productionStatus, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("[workflows] setProductionStatus failed:", error.message);
  } catch (e) {
    console.error("[workflows] setProductionStatus threw:", (e as Error).message);
  }
}

/** Set the song on a workflow (a SONGS key or a pasted audio URL). Best-effort. */
export async function setWorkflowSong(id: string, songRef: string): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("workflows")
      .update({ song_ref: songRef, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) console.error("[workflows] setSong failed:", error.message);
  } catch (e) {
    console.error("[workflows] setSong threw:", (e as Error).message);
  }
}

/**
 * Add a RENDER SEQUENCE (a template variant: same scenes, different song/beat/timing) to a
 * workflow. One blueprint -> many audio-driven variants. Returns the new sequence or null.
 */
export async function addRenderSequence(
  workflowId: string,
  seq: Omit<RenderSequence, "id">
): Promise<RenderSequence | null> {
  const workflow = await loadWorkflow(workflowId);
  if (!workflow) return null;
  const existing = workflow.render_sequences ?? [];
  const id = `seq_${existing.length + 1}`;
  const full: RenderSequence = { id, ...seq };
  const next = [...existing, full];
  try {
    const { error } = await supabaseAdmin
      .from("workflows")
      .update({ render_sequences: next, updated_at: new Date().toISOString() })
      .eq("id", workflowId);
    if (error) {
      console.error("[workflows] addRenderSequence failed:", error.message);
      return null;
    }
    return full;
  } catch (e) {
    console.error("[workflows] addRenderSequence threw:", (e as Error).message);
    return null;
  }
}
