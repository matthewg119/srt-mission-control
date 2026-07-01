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
  hooks?: string[]; // step A: 5 hook options
  chosen_hook?: string; // the picked hook
  bodies?: string[]; // step B: 3 body options for the chosen hook
  chosen_body?: string; // the picked body
  caption_storyboard?: { captions: Array<{ text: string; at_second: number }>; ig_caption: string };
  song_ref?: string; // SONGS key or pasted audio URL

  // --- #content-analyzer scrub-or-reference decision ---
  video_url?: string; // the staged public video URL a scrub-or-ref card refers to
  video_mimetype?: string;
  section?: string; // e.g. 'pov/modern_house' (reference sectioning)
  zip?: string;
  analysis?: unknown; // the analyzer VideoAnalysis snapshot (for the scrub path)

  // --- new-avatar creation (a kit drop is awaited for this new vertical) ---
  new_vertical_id?: string;
  new_vertical_name?: string;
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
  | "await_kit";

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
