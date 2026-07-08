// content_jobs — the ONE job store behind the unified content pipeline.
//
// Replaces the per-format state tables (bug_reveal_jobs, pov_studio_jobs, reel_studio_jobs,
// reel_drops). A job carries the format id (-> src/config/format-registry.ts), the Slack
// thread it lives in, the message the operator reacts on (picker_msg_ts, the self-routing
// key), the current pipeline stage, and a flexible `data` blob for scenes/shots/copy.
//
// See docs/2026-07-02-content-jobs.sql.

import { supabaseAdmin } from "@/lib/db";

// A single scene idea or generated shot option. `url`/`mimetype` are set once the image exists.
export interface ShotOption {
  index: number;
  scene: string;
  url?: string;
  mimetype?: string;
}

export interface JobCopy {
  options: string[]; // 5 on-screen title options, #1 = POV default
  caption: string;
  animation_prompt: string;
  after_image_prompt?: string;
}

export interface JobData {
  scenes?: ShotOption[]; // ideate ideas, then the generated shot options (with url/mimetype)
  chosen?: ShotOption; // the picked shot
  after_image_url?: string | null; // before_after_edit only
  copy?: JobCopy;

  // --- Content Engine v3: avatar-first, song-based workflow flow ---
  avatar_ids?: string[]; // the `go` avatar-picker list (ordering for the number reply)
  workflow_ids?: string[]; // the avatar-session workflow list (ordering for `workflow N`)
  workflow_id?: string; // the chosen workflow (real id lives here; format_id column = "workflow")
  hooks?: string[]; // (legacy) step A hook options
  chosen_hook?: string; // the picked/typed final hook
  bodies?: string[]; // (legacy) body options
  chosen_body?: string; // the picked body
  caption_storyboard?: { captions: Array<{ text: string; at_second: number }>; ig_caption: string };
  song_ref?: string; // SONGS key or pasted audio URL

  // --- rich copy engine (headlines -> hookset -> captions/storyboards) ---
  headlines?: string[]; // ~30 direct-response headline options
  chosen_headline?: string; // the picked/typed headline the story builds on
  hookset?: { verbal: string[]; title: string[]; pov?: string[] };
  captions3?: string[]; // 3 caption options
  storyboards3?: string[]; // 3 storyboard idea options
  chosen_caption?: string;
  chosen_storyboard?: string;
  pasted_copy?: string; // Matthew's own copy block pasted at the hooks step (seeds the labeled copy)

  // --- workflow selection + labeled copy structure (Part 1) ---
  workflow_menu?: Array<{ id: string; name: string; category: string; subcategory?: string | null; status: string; configured: boolean; cross_avatar?: boolean }>; // ordering for `workflow N` / `template N`
  structured_copy?: Array<{ key: string; label: string; text: string }>; // the labeled copy boxes, filled

  // --- picture ideas gate (pick a visual direction BEFORE any image generates) ---
  picture_ideas?: Array<{ title: string; shots: string[] }>; // ordering for `idea N`
  chosen_idea?: string; // the locked visual direction (title + per-shot gists, flattened)
  chosen_idea_shots?: string[]; // the locked idea's per-shot gists (each shot's non-negotiable subject)

  // --- prompt review gate (the EXACT enriched prompts, approved before any credit is spent) ---
  final_prompts?: string[]; // one per scene; `prompt N <text>` edits, ✅ generates with these verbatim

  // --- SESSION-SCOPED scenes (the wasp-leak fix): the picture plan lives on the JOB, not the
  // shared workflow row, until the animation gate approves it (the one sanctioned write-back).
  session_scenes?: Array<{
    role: string;
    image_prompt: string;
    animation_prompt: string;
    image_url?: string | null;
    image_approved?: boolean;
  }>;

  // --- manual-image mode + animation gate + final video ---
  final_animation_prompts?: string[]; // one per scene; `motion N <text>` edits, ✅ approves
  final_video_url?: string; // the rendered MP4 Matthew dropped back into the thread

  // --- render-spec authoring (Part 2) ---
  candidate_spec?: unknown; // a parsed RenderSpec awaiting the mismatch/validation gate
  save_as_from?: string; // the workflow id whose settings a `save as` new draft carried
  render_mode?: "static_images" | "animated"; // the mode confirmed for this render

  // --- remixes: 16 narrative variations of the same workflow + audio + render combo ---
  remixes?: Array<{ key: string; label: string; lines: Array<{ key: string; label: string; text: string }> }>; // drafted variations (ordering for `remix N`)
  remix_angle?: string; // the angle key currently being built

  // --- #content-analyzer scrub-or-reference decision ---
  video_url?: string; // the staged public video URL a scrub-or-ref card refers to
  video_mimetype?: string;
  section?: string; // e.g. 'pov/modern_house' (reference sectioning)
  zip?: string;
  analysis?: unknown; // the analyzer VideoAnalysis snapshot (for the scrub path)

  // --- new-avatar creation (a kit drop is awaited for this new vertical) ---
  new_vertical_id?: string;
  new_vertical_name?: string;

  // --- Workflow Builder v2 (gov2, format_id "workflow_build") ---
  beat_grid?: { bpm: number | null; beats: number[]; duration: number | null }; // the analyzed song
  style_dna?: string; // the approved visual-invariants block for this new workflow
  timing_spec?: unknown; // the parsed RenderSpec built from Matthew's pasted timings
  scene_defs?: Array<{
    role: string; // the action line from the timing paste
    animation_prompt?: string; // freeform motion override
    animation_preset?: string; // named preset key (animation-presets.ts)
    animation_examples?: string[]; // up to 4 collected motion examples
    ref_count?: number; // reference images saved for this scene so far (cap 9)
    image_url?: string | null; // the final pasted scene image
  }>;
  wf_name?: string; // display name typed at the save card
  caption_draft?: string; // the caption awaiting ✅
}

export type JobStage =
  | "ideate"
  | "shot"
  | "build"
  | "done"
  | "skipped"
  | "error"
  // v3 avatar-first workflow + analyzer stages:
  | "scrub_or_ref"
  | "avatar"
  | "hooks"
  | "bodies"
  | "storyboard"
  | "await_song"
  | "render"
  | "await_kit"
  // rich copy engine stages:
  | "headlines"
  | "hookset"
  | "captions"
  | "picture"
  // workflow selection + copy structure + render-spec authoring stages:
  | "workflow_pick"
  | "structured_copy"
  | "picture_ideas"
  | "prompt_review"
  // staged approval chain (2026-07-03): paste/generate images -> approve -> animation prompts:
  | "awaiting_images"
  | "image_review"
  | "animation_review"
  | "authoring"
  | "await_example"
  // remix upsell stages (after the render prompt is emitted):
  | "remix_offer"
  | "remix_copy"
  // Workflow Builder v2 (gov2) stages — distinct b2_ prefix, no collision with the v1 machine:
  | "b2_await_song"
  | "b2_style_dna"
  | "b2_timings"
  | "b2_scenes"
  | "b2_prompts"
  | "b2_images"
  | "b2_save"
  | "b2_render"
  | "b2_caption";

export interface ContentJob {
  id: string;
  format_id: string;
  vertical_id: string;
  slack_channel: string;
  slack_thread_ts: string;
  picker_msg_ts: string | null;
  stage: JobStage;
  source_kind: string | null;
  data: JobData;
  status: string;
}

const COLS =
  "id,format_id,vertical_id,slack_channel,slack_thread_ts,picker_msg_ts,stage,source_kind,data,status";

function normalize(row: Record<string, unknown> | null): ContentJob | null {
  if (!row) return null;
  return {
    ...(row as unknown as ContentJob),
    data: (row.data as JobData) ?? {},
  };
}

export interface InsertJobArgs {
  formatId: string;
  verticalId: string;
  channel: string;
  threadTs: string;
  pickerTs: string | null;
  stage: JobStage;
  sourceKind?: string;
  data: JobData;
}

/** Create a job; returns the new id (or null on failure, logged). */
export async function insertJob(args: InsertJobArgs): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("content_jobs")
    .insert({
      format_id: args.formatId,
      vertical_id: args.verticalId,
      slack_channel: args.channel,
      slack_thread_ts: args.threadTs,
      picker_msg_ts: args.pickerTs,
      stage: args.stage,
      source_kind: args.sourceKind ?? "scratch",
      data: args.data,
      status: "active",
    })
    .select("id")
    .single();
  if (error) {
    console.error("[content_jobs] insert failed:", error.message);
    return null;
  }
  return (data as { id: string }).id;
}

/** The job whose picker message the operator reacted on. */
export async function getJobByPickerTs(pickerTs: string): Promise<ContentJob | null> {
  const { data } = await supabaseAdmin
    .from("content_jobs")
    .select(COLS)
    .eq("picker_msg_ts", pickerTs)
    .limit(1)
    .maybeSingle();
  return normalize(data as Record<string, unknown> | null);
}

/** The most-recent ACTIVE avatar-first session in a channel (avatar_pick or workflow). Lets
 *  the operator drive the session from the channel (top-level) instead of only in-thread. */
export async function getLatestSessionByChannel(channel: string): Promise<ContentJob | null> {
  const { data } = await supabaseAdmin
    .from("content_jobs")
    .select(COLS)
    .eq("slack_channel", channel)
    .eq("status", "active")
    .in("format_id", ["avatar_pick", "workflow"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalize(data as Record<string, unknown> | null);
}

/** The most-recent ACTIVE job of one format in a channel (gov2 builder sessions; the v1
 *  whitelist in getLatestSessionByChannel stays untouched). */
export async function getLatestJobByChannelFormat(
  channel: string,
  formatId: string
): Promise<ContentJob | null> {
  const { data } = await supabaseAdmin
    .from("content_jobs")
    .select(COLS)
    .eq("slack_channel", channel)
    .eq("status", "active")
    .eq("format_id", formatId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalize(data as Record<string, unknown> | null);
}

/** The most-recent job in a thread (for thread-reply remix / tuning feedback). */
export async function getLatestJobByThread(threadTs: string): Promise<ContentJob | null> {
  const { data } = await supabaseAdmin
    .from("content_jobs")
    .select(COLS)
    .eq("slack_thread_ts", threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return normalize(data as Record<string, unknown> | null);
}

export interface JobPatch {
  stage?: JobStage;
  status?: string;
  pickerTs?: string | null;
  data?: JobData; // merged over existing data (shallow)
}

/** Advance a job: patch stage/status/picker and shallow-merge `data`. */
export async function updateJob(job: ContentJob, patch: JobPatch): Promise<void> {
  const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.stage !== undefined) row.stage = patch.stage;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.pickerTs !== undefined) row.picker_msg_ts = patch.pickerTs;
  if (patch.data !== undefined) row.data = { ...job.data, ...patch.data };
  const { error } = await supabaseAdmin.from("content_jobs").update(row).eq("id", job.id);
  if (error) console.error("[content_jobs] update failed:", error.message);
  // Keep the in-memory job consistent for callers that continue using it.
  if (patch.stage !== undefined) job.stage = patch.stage;
  if (patch.status !== undefined) job.status = patch.status;
  if (patch.pickerTs !== undefined) job.picker_msg_ts = patch.pickerTs;
  if (patch.data !== undefined) job.data = { ...job.data, ...patch.data };
}
