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
  animation_preset?: string; // named motion preset key (src/config/animation-presets.ts); freeform animation_prompt wins
  animation_examples?: string[]; // up to 4 example motion descriptions collected for this scene
  duration_seconds?: number; // shot length (defaults from render_options.clip_seconds)
  image_url?: string | null; // set once the scene image is generated
  image_approved?: boolean; // set once the operator approves that scene image
}

// One on-screen caption/title and the SECOND it pops up (the beat-timed text layer).
export interface WorkflowCaption {
  text: string;
  at_second: number;
}

// A labeled copy "box" in a workflow's copy structure (avatar / callout / pain / cta ...). Each
// role also remembers WHERE and WHEN its line appears (shot + in/out seconds + on-screen
// position), so the structure is the single source for both the copy and its placement.
export interface CopyRole {
  key: string; // stable role key, e.g. "avatar", "pain_callout", "cta"
  label: string; // human label shown in Slack, e.g. "Pain callout"
  guidance: string; // what this line must do (fed to Claude when generating the copy)
  shot?: number; // which shot this line sits on (1-based)
  at_second?: number; // when the line pops up
  out_second?: number; // when it leaves
  position?: string; // on-screen placement, e.g. "upper_middle", "center", "lower"
}

// The shared vocabulary of copy roles new workflows reuse so labels stay consistent.
export const COPY_ROLE_LIBRARY: Record<string, { label: string; guidance: string }> = {
  avatar: { label: "Avatar", guidance: "Name who this is for (the owner/operator persona)." },
  callout: { label: "Hard truth / callout", guidance: "One-line pain that stops the scroll." },
  pain_callout: { label: "Pain callout", guidance: "One-line pain that stops the scroll." },
  increase_pain: { label: "Increase pain / category", guidance: "Twist the knife, make it personal." },
  logical_reason: { label: "Logical reason", guidance: "The because: why the pain is real." },
  pattern_callout: { label: "Pattern callout (industry-wide)", guidance: "Name the pattern everyone repeats." },
  dream_outcome: { label: "Dream outcome", guidance: "The desired result in one line." },
  solution: { label: "Dream outcome + logical solution", guidance: "How they get it, stated as the method." },
  pain_reminder: { label: "Pain reminder", guidance: "Re-anchor the pain right before the CTA." },
  cta: { label: "CTA", guidance: "Single clear call to action (link in bio)." },
};

// ---- Render spec: how a workflow's structure becomes a video ---------------------------
// A workflow's copy structure is render-mode-agnostic. `static_images` holds each still for
// its slot (timing always fits); `animated` uses a generated/posted clip per shot. Mode is
// chosen at render (Vektor always confirms first). The render_spec is what the emitted Claude
// Code prompt is built from, and what content-analyzer / the creative director read to iterate.
export type RenderMode = "static_images" | "animated";

export interface RenderShot {
  i: number; // 1-based shot index
  start: number; // slot start (seconds)
  end: number; // slot end (seconds)
}

export interface RenderTextEvent {
  n?: number; // 1-based display order
  text: string;
  at_second: number;
  out_second?: number;
  role?: string; // the CopyRole.key this text fills
  size?: string; // e.g. "small" | "medium" | "large"
  position?: string; // on-screen placement
  color?: string; // optional chip color lock (engine palette name, e.g. "pink")
}

export interface RenderSpec {
  mode: RenderMode;
  song_ref?: string | null;
  duration_seconds: number;
  shots: RenderShot[];
  texts: RenderTextEvent[]; // the timed on-screen text (default/example copy)
  description?: string; // AI/human-readable description of the finished video
  example_video_url?: string | null; // optional reference that was scanned
}

export interface WorkflowRenderOptions {
  min_shots?: number;
  max_shots?: number;
  clip_seconds?: number; // per-scene default duration
  aspect?: string; // e.g. "9:16"
  provider?: string; // image provider override (else POV_IMAGE_PROVIDER)
  quality?: string; // gpt image quality override ("low" | "medium" | "high")
  // ONE render build per workflow (render-dispatch.ts). "render_reel" = the legacy
  // Vargas 6s single-image build; "render_spec" (default) = the generic spec engine;
  // any other value = a custom render-service endpoint slug (api/<build>.py) that
  // accepts the same render-spec JSON payload (created via agent-channel Claude Code prompts).
  build?: string;
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

// A reference creative attached to a workflow (screenshot of a manual edit, an example video,
// or the audio). The production gate: 3 references uploaded -> produce a 4th -> in_production.
export interface WorkflowReference {
  kind: string; // "screenshot" | "video" | "audio"
  url: string;
  added_at?: string;
}

// One APPROVED render of this workflow (a distinct angle/variation of the same format).
// The onboarding gate: 4 approved variations flip production_status to "live". The array
// keeps growing after live — it doubles as the workflow's generated-examples gallery.
export interface ApprovedVariation {
  label: string; // remix angle or "base"
  structured_copy?: Array<{ key: string; text: string }>;
  song_ref?: string | null;
  thread_ts?: string; // the Slack session that produced it
  image_urls?: string[];
  approved_at?: string;
}

export interface Workflow {
  id: string;
  vertical_id: string;
  name: string;
  category: WorkflowCategory | string;
  subcategory?: string | null;
  status: WorkflowStatus | string;
  scenes: WorkflowScene[];
  captions: WorkflowCaption[];
  copy_structure?: CopyRole[]; // ordered labeled boxes for this workflow's on-screen copy
  render_spec?: RenderSpec | null; // baked shots + timed texts + mode (drives the render prompt)
  song_ref?: string | null;
  render_sequences: RenderSequence[]; // template variants (different song/beat/timing)
  render_options: WorkflowRenderOptions;
  example_video_url?: string | null;
  example_storyboard?: unknown | null;
  shot_screenshots: Array<{ role: string; url: string }>;
  source_kind: string; // authored | reference_video | seeded | productized
  source_example_id?: string | null;
  used_at?: string | null;
  // Production gate + consistency profile (columns from docs/2026-07-05-workflow-systemization.sql;
  // written via dedicated updates, NOT the generic upsert, so a missing column never breaks saves).
  reference_media?: WorkflowReference[];
  production_status?: string; // "building" (default) | "in_production" (3 refs) | "live" (4 approved variations)
  description?: string | null; // one-line human description shown in the menu/map/dashboard
  visual_rules?: string[]; // per-workflow image style guide, fed into every scene prompt
  approved_variations?: ApprovedVariation[];
  // Workflow Builder v2 columns (docs/2026-07-08-workflow-builder-v2.sql):
  style_dna?: string | null; // the visual invariants block PREPENDED to every scene prompt (scene prompts = action only)
  caption_template?: string | null; // optional fill-in template for the post caption
  beat_grid?: { bpm: number | null; beats: number[]; duration: number | null } | null; // analyzed song grid
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
  description: "4-shot 8s first-person Meta-glasses POV: find a wasp nest, climb, bag it, clean reveal.",
  visual_rules: [
    "Every frame is first-person POV through Ray-Ban Meta glasses; gloved hands may enter frame, never a face.",
    "Real suburban job-site settings, natural daylight, documentary look; no studio lighting.",
    "No text, captions, logos, or watermarks inside the image.",
  ],
};

// The first authored B-roll workflow: 3 shots, 6 timed on-screen headlines, static images by
// default (the song is added in Slack). copy_structure carries each line's shot + timing +
// on-screen position; render_spec is the baked timeline the emitted Claude Code prompt uses.
const PEST_6HL_PROPAGANDA: Workflow = {
  id: "pest_control__broll__6hl_propaganda",
  vertical_id: "pest_control",
  name: "B roll 6 headlines propaganda",
  category: "broll",
  subcategory: "6hl_propaganda",
  status: "active",
  scenes: [],
  captions: [
    { text: "Pest control Owners", at_second: 0.0 },
    { text: "Your slow season, is somebody elses high season", at_second: 0.3 },
    { text: "Homeowners already know who to call and is not you", at_second: 3.4 },
    { text: "Because Your zip code doesn't know you exist yet", at_second: 6.4 },
    { text: "imagine clients calling you first", at_second: 8.3 },
    { text: "Check out link in bio.", at_second: 10.2 },
  ],
  copy_structure: [
    { key: "avatar", label: "Avatar", guidance: "Name who this is for.", shot: 1, at_second: 0.0, out_second: 3.5, position: "upper_side" },
    { key: "pain_callout", label: "Pain callout", guidance: "One-line pain that stops the scroll.", shot: 1, at_second: 0.3, out_second: 3.5, position: "upper_middle" },
    { key: "increase_pain", label: "Increase pain / category", guidance: "Twist the knife, make it personal.", shot: 2, at_second: 3.4, out_second: 8.3, position: "center" },
    { key: "logical_reason", label: "Logical reason", guidance: "The because: why the pain is real.", shot: 2, at_second: 6.4, out_second: 8.3, position: "center" },
    { key: "dream_outcome", label: "Dream outcome", guidance: "The desired result in one line.", shot: 3, at_second: 8.3, out_second: 11.3, position: "center" },
    { key: "cta", label: "CTA", guidance: "Single clear call to action.", shot: 3, at_second: 10.2, out_second: 11.3, position: "lower" },
  ],
  render_spec: {
    mode: "static_images",
    song_ref: null,
    duration_seconds: 11.3,
    shots: [
      { i: 1, start: 0.0, end: 3.5 },
      { i: 2, start: 3.4, end: 8.3 },
      { i: 3, start: 8.3, end: 11.3 },
    ],
    texts: [
      { n: 1, text: "Pest control Owners", at_second: 0.0, out_second: 3.5, position: "upper_side", role: "avatar" },
      { n: 2, text: "Your slow season, is somebody elses high season", at_second: 0.3, out_second: 3.5, position: "upper_middle", role: "pain_callout" },
      { n: 3, text: "Homeowners already know who to call and is not you", at_second: 3.4, out_second: 8.3, position: "center", role: "increase_pain" },
      { n: 4, text: "Because Your zip code doesn't know you exist yet", at_second: 6.4, out_second: 8.3, position: "center", role: "logical_reason" },
      { n: 5, text: "imagine clients calling you first", at_second: 8.3, out_second: 11.3, position: "center", role: "dream_outcome" },
      { n: 6, text: "Check out link in bio.", at_second: 10.2, out_second: 11.3, position: "lower", role: "cta" },
    ],
  },
  song_ref: null,
  render_sequences: [],
  render_options: { min_shots: 3, max_shots: 3, aspect: "9:16" },
  example_video_url: null,
  example_storyboard: null,
  shot_screenshots: [],
  source_kind: "authored",
  source_example_id: null,
  description: "3-shot 11.3s static b-roll with 6 timed headlines: avatar callout, pain escalation, dream outcome + CTA.",
  visual_rules: [
    "Photorealistic b-roll of pest control business life (trucks, techs, homeowners), vertical portrait.",
    "Muted, cinematic color; shots must leave clear space for the timed headline overlays.",
    "No text, captions, logos, or watermarks inside the image.",
  ],
};

// "Shabang" — the original Vargas 6s single-image reel (label + hook + payoff + cta
// chips over one still, house song bed) registered as a first-class workflow so the
// drop-and-render fit matcher and the prompt-drop rotation can use it. Its render is
// the legacy render-reel build (render-dispatch.ts); copy keys mirror studio.ts
// parseBoxes exactly so a 4-line drop maps 1:1. Timings are nominal (the Python
// template owns layout); they exist for box-count matching + reslotCopyToStructure.
const PEST_SHABANG: Workflow = {
  id: "pest_control__reel__shabang",
  vertical_id: "pest_control",
  name: "Shabang",
  category: "reel",
  subcategory: null,
  status: "active",
  scenes: [], // the single image comes from the drop
  captions: [],
  copy_structure: [
    { key: "label", label: "Label", guidance: "Top strip: who this is for or the topic.", shot: 1, at_second: 0, out_second: 6, position: "upper_middle" },
    { key: "hook", label: "Hook", guidance: "The scroll-stopping line.", shot: 1, at_second: 0, out_second: 6, position: "center" },
    { key: "payoff", label: "Payoff", guidance: "The twist or consequence line.", shot: 1, at_second: 0, out_second: 6, position: "center" },
    { key: "cta", label: "CTA", guidance: "Single clear call to action.", shot: 1, at_second: 0, out_second: 6, position: "lower" },
  ],
  render_spec: null, // render_reel builds ignore the spec engine
  song_ref: DEFAULT_SONG_REF, // the fixed render-service bed
  render_sequences: [],
  render_options: { min_shots: 1, max_shots: 1, aspect: "9:16", build: "render_reel" },
  example_video_url: null,
  example_storyboard: null,
  shot_screenshots: [],
  source_kind: "seeded",
  source_example_id: null,
  production_status: "live",
  description: "1-image 6s branded reel: label, hook, payoff, cta over one still, house song bed.",
};

export const SEED_WORKFLOWS: Record<string, Workflow> = {
  [PEST_WASP_NEST.id]: PEST_WASP_NEST,
  [PEST_6HL_PROPAGANDA.id]: PEST_6HL_PROPAGANDA,
  [PEST_SHABANG.id]: PEST_SHABANG,
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
  copy_structure?: CopyRole[] | null;
  render_spec?: RenderSpec | null;
  song_ref?: string | null;
  render_sequences?: RenderSequence[] | null;
  render_options?: WorkflowRenderOptions | null;
  example_video_url?: string | null;
  example_storyboard?: unknown | null;
  shot_screenshots?: Array<{ role: string; url: string }> | null;
  source_kind?: string | null;
  source_example_id?: string | null;
  used_at?: string | null;
  reference_media?: WorkflowReference[] | null;
  production_status?: string | null;
  description?: string | null;
  visual_rules?: string[] | null;
  approved_variations?: ApprovedVariation[] | null;
  style_dna?: string | null;
  caption_template?: string | null;
  beat_grid?: { bpm: number | null; beats: number[]; duration: number | null } | null;
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
    copy_structure: Array.isArray(row.copy_structure) ? row.copy_structure : [],
    render_spec: row.render_spec ?? null,
    song_ref: row.song_ref ?? null,
    render_sequences: Array.isArray(row.render_sequences) ? row.render_sequences : [],
    render_options: row.render_options ?? {},
    example_video_url: row.example_video_url ?? null,
    example_storyboard: row.example_storyboard ?? null,
    shot_screenshots: Array.isArray(row.shot_screenshots) ? row.shot_screenshots : [],
    source_kind: row.source_kind || "authored",
    source_example_id: row.source_example_id ?? null,
    used_at: row.used_at ?? null,
    reference_media: Array.isArray(row.reference_media) ? row.reference_media : [],
    production_status: row.production_status || "building",
    description: row.description ?? null,
    visual_rules: Array.isArray(row.visual_rules) ? row.visual_rules : [],
    approved_variations: Array.isArray(row.approved_variations) ? row.approved_variations : [],
    style_dna: row.style_dna ?? null,
    caption_template: row.caption_template ?? null,
    beat_grid: row.beat_grid ?? null,
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
