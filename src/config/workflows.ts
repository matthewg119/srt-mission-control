// Workflow registry (Content Engine v3) — avatar-first, song-based, multi-shot recipes.
//
// A `workflow` is a curated recipe scoped to ONE avatar (vertical): an ordered set of
// image-scenes, a song, and captions timed to the second. It is the thing the creative
// director proposes and the operator approves, and the thing the library shows. It is
// richer than a single-image format-registry row and richer than a vertical_formats
// rotation row, so it lives in its own `workflows` table (docs/2026-07-03-workflows.sql).
//
// This module mirrors verticals.ts: a Workflow type, loaders that merge a DB row OVER an
// in-code seed (so a couple of hand-authored pest_control workflows exist before the
// analyzer populates the table), and mapWorkflowToVerticalFormat() — the adapter that lets
// the EXISTING multi-shot renderer (runAutoReel in src/lib/reel/auto-reel.ts) consume a
// workflow without any change to the render engine.
//
// Workflows are SONG-BASED for now (decision, 2026-07-03): the only things that vary
// between workflows are the image prompts + scenarios; each workflow remembers its song and
// the beat its scenes sync to.

import { supabaseAdmin } from "@/lib/db";
import type { VerticalFormat } from "@/lib/reel/auto-reel";

// One scene in the ordered recipe. image_url/image_approved are filled during the Phase-2
// build (per-scene image approval) and reused by the library grid (shot_screenshots).
export interface WorkflowScene {
  role: string; // the semantic step, e.g. "walk up the ladder", "reveal the nest", "spray"
  image_prompt: string; // first-frame prompt in the avatar's look, NO on-screen text
  animation_prompt: string; // motion only, one sentence
  duration_seconds?: number; // shot length (defaults from render_options.clip_seconds)
  image_url?: string | null; // set once the scene image is generated
  image_approved?: boolean; // set once the operator approves that scene image
}

// One on-screen caption/title and the SECOND it pops up (the beat-timed text layer).
export interface WorkflowCaption {
  text: string;
  at_second: number;
}

export interface WorkflowRenderOptions {
  min_shots?: number;
  max_shots?: number;
  clip_seconds?: number; // per-scene default duration
  aspect?: string; // e.g. "9:16"
  provider?: string; // image provider override (else POV_IMAGE_PROVIDER)
}

// A RENDER SEQUENCE is a reusable rendering variant of the SAME workflow scenes: a different
// song / beat, and (optionally) different caption timing or reward moment. One blueprint ->
// many audio-driven variants. (Decision 2026-07-03: audios/timing only for now.)
export interface RenderSequence {
  id: string;
  label: string;
  song_ref: string; // SONGS key or a pasted audio URL
  reward_at_second?: number; // when the payoff/reward lands (for beat sync)
  captions?: WorkflowCaption[]; // optional override of the base caption timing
}

export type WorkflowStatus = "draft" | "active" | "archived";
export type WorkflowCategory = "pov" | "broll" | "reveal" | "before_after";

export interface Workflow {
  id: string;
  vertical_id: string;
  name: string;
  category: WorkflowCategory | string;
  subcategory?: string | null;
  status: WorkflowStatus | string;
  scenes: WorkflowScene[];
  captions: WorkflowCaption[];
  song_ref?: string | null;
  render_sequences: RenderSequence[]; // template variants (different song/beat/timing)
  render_options: WorkflowRenderOptions;
  example_video_url?: string | null;
  example_storyboard?: unknown | null;
  shot_screenshots: Array<{ role: string; url: string }>;
  source_kind: string; // authored | reference_video | seeded
  source_example_id?: string | null;
  used_at?: string | null;
}

// ---------------------------------------------------------------------------------------
// Song library. Workflows are song-based; the operator picks a key here or pastes an audio
// URL when the creative director asks "what song?". The default is the locked render-service
// bed (song_master), which is what today's Vargas reels already use.
// ---------------------------------------------------------------------------------------

export interface Song {
  key: string;
  label: string;
  bpm?: number;
  url?: string | null; // null = the render-service default bed (song_master.m4a)
}

export const SONGS: Record<string, Song> = {
  song_master: { key: "song_master", label: "SRT house bed (default)", bpm: 117, url: null },
};

export const DEFAULT_SONG_REF = "song_master";

/** Resolve a song_ref to a Song. Unknown/absent refs that look like URLs become a pasted
 *  song; otherwise fall back to the default bed. */
export function resolveSong(songRef?: string | null): Song {
  if (!songRef) return SONGS[DEFAULT_SONG_REF];
  if (SONGS[songRef]) return SONGS[songRef];
  if (/^https?:\/\//i.test(songRef)) {
    return { key: "pasted", label: "Pasted audio", url: songRef };
  }
  return SONGS[DEFAULT_SONG_REF];
}

// ---------------------------------------------------------------------------------------
// SEED — the offline fallback + at least one real pest_control POV workflow so the mermaid
// map and the avatar card show something on day one. The look/scene prompts are written in
// the Vargas Meta-glasses POV voice; the renderer applies the avatar's style_token on top.
// ---------------------------------------------------------------------------------------

const PEST_WASP_NEST: Workflow = {
  id: "pest_control__pov__wasp_nest",
  vertical_id: "pest_control",
  name: "Wasp / Hornet Nest Removal (POV)",
  category: "pov",
  subcategory: "roof",
  status: "active",
  scenes: [
    {
      role: "reveal the nest (open loop)",
      image_prompt:
        "First-person POV through Ray-Ban Meta glasses looking up at a large grey paper wasp nest tucked under a home's roof eave, wasps crawling over it in the afternoon sun, gloved hand entering frame from below",
      animation_prompt: "Slow tilt up the eave to settle on the nest as a few wasps lift off.",
      duration_seconds: 2,
    },
    {
      role: "climb the ladder",
      image_prompt:
        "First-person POV climbing an aluminium extension ladder toward the roofline of an older suburban home, gloved hands on the rails, nest visible ahead near the gutter",
      animation_prompt: "Hands pull up rung by rung, the nest growing closer in frame.",
      duration_seconds: 2,
    },
    {
      role: "bag and remove the nest",
      image_prompt:
        "First-person POV sliding a thick contractor bag up and over the wasp nest at the eave, gloved hands sealing it off, wasps scattering",
      animation_prompt: "The bag sweeps up over the nest and cinches closed in one motion.",
      duration_seconds: 2,
    },
    {
      role: "clean result",
      image_prompt:
        "First-person POV of the now-bare eave where the nest was, clean stucco, sealed bag held up in a gloved hand against a blue sky",
      animation_prompt: "Camera settles on the clean eave, then the bagged nest lifts into frame.",
      duration_seconds: 2,
    },
  ],
  captions: [
    { text: "POV: you found this under your roof", at_second: 0 },
    { text: "do NOT knock it down yourself", at_second: 2 },
    { text: "one bag, gone for good", at_second: 4 },
  ],
  song_ref: DEFAULT_SONG_REF,
  render_sequences: [],
  render_options: { min_shots: 4, max_shots: 4, clip_seconds: 2, aspect: "9:16" },
  example_video_url: null,
  example_storyboard: null,
  shot_screenshots: [],
  source_kind: "seeded",
  source_example_id: null,
};

export const SEED_WORKFLOWS: Record<string, Workflow> = {
  [PEST_WASP_NEST.id]: PEST_WASP_NEST,
};

// ---------------------------------------------------------------------------------------
// Loaders (DB row over seed, fall back to seed offline — same pattern as verticals.ts).
// ---------------------------------------------------------------------------------------

interface WorkflowRow {
  id: string;
  vertical_id: string;
  name: string;
  category?: string | null;
  subcategory?: string | null;
  status?: string | null;
  scenes?: WorkflowScene[] | null;
  captions?: WorkflowCaption[] | null;
  song_ref?: string | null;
  render_sequences?: RenderSequence[] | null;
  render_options?: WorkflowRenderOptions | null;
  example_video_url?: string | null;
  example_storyboard?: unknown | null;
  shot_screenshots?: Array<{ role: string; url: string }> | null;
  source_kind?: string | null;
  source_example_id?: string | null;
  used_at?: string | null;
}

function normalizeRow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    vertical_id: row.vertical_id,
    name: row.name,
    category: row.category || "pov",
    subcategory: row.subcategory ?? null,
    status: row.status || "draft",
    scenes: Array.isArray(row.scenes) ? row.scenes : [],
    captions: Array.isArray(row.captions) ? row.captions : [],
    song_ref: row.song_ref ?? null,
    render_sequences: Array.isArray(row.render_sequences) ? row.render_sequences : [],
    render_options: row.render_options ?? {},
    example_video_url: row.example_video_url ?? null,
    example_storyboard: row.example_storyboard ?? null,
    shot_screenshots: Array.isArray(row.shot_screenshots) ? row.shot_screenshots : [],
    source_kind: row.source_kind || "authored",
    source_example_id: row.source_example_id ?? null,
    used_at: row.used_at ?? null,
  };
}

/** Load one workflow by id: DB row wins; falls back to the in-code seed when absent. */
export async function loadWorkflow(id: string): Promise<Workflow | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("workflows")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (!error && data) return normalizeRow(data as WorkflowRow);
  } catch (e) {
    console.error("[workflows] loadWorkflow fell back to seed:", (e as Error).message);
  }
  return SEED_WORKFLOWS[id] ?? null;
}

/** List workflows for an avatar (or all), merging the seed so seeded rows always appear even
 *  before the table is populated. Best-effort: returns the seed on error. */
export async function listWorkflows(
  verticalId?: string,
  opts: { status?: WorkflowStatus | "all" } = {}
): Promise<Workflow[]> {
  const wantStatus = opts.status ?? "active";
  const seed = Object.values(SEED_WORKFLOWS);
  let rows: Workflow[] = [];
  try {
    let q = supabaseAdmin.from("workflows").select("*");
    if (verticalId) q = q.eq("vertical_id", verticalId);
    const { data, error } = await q.order("created_at", { ascending: false });
    if (!error && Array.isArray(data)) rows = (data as WorkflowRow[]).map(normalizeRow);
  } catch (e) {
    console.error("[workflows] listWorkflows fell back to seed:", (e as Error).message);
  }

  // Merge: DB rows win over a seed of the same id; add seeds the DB doesn't have yet.
  const byId = new Map<string, Workflow>();
  for (const s of seed) byId.set(s.id, s);
  for (const r of rows) byId.set(r.id, r);
  let all = Array.from(byId.values());

  if (verticalId) all = all.filter((w) => w.vertical_id === verticalId);
  if (wantStatus !== "all") all = all.filter((w) => w.status === wantStatus);
  return all;
}

// ---------------------------------------------------------------------------------------
// Adapter — reuse the existing multi-shot renderer without changing it. runAutoReel expects
// a VerticalFormat (id, vertical_id, format_group, scene, hook, shot_count). We fold the
// workflow's ordered scene roles/prompts into `scene` and clamp the shot_count.
// ---------------------------------------------------------------------------------------

export function mapWorkflowToVerticalFormat(
  workflow: Workflow,
  opts: { hook?: string } = {}
): VerticalFormat {
  const sceneText = workflow.scenes
    .map((s, i) => `${i + 1}. ${s.role}: ${s.image_prompt}`)
    .join("\n");
  const shotCount = workflow.scenes.length || workflow.render_options.min_shots || 4;
  return {
    id: workflow.id,
    vertical_id: workflow.vertical_id,
    format_group: String(workflow.category),
    scene: sceneText,
    hook: opts.hook || workflow.captions[0]?.text || workflow.name,
    difficulty: "medium",
    shot_count: shotCount,
  };
}
