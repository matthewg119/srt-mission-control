// Workflow Builder v2 (gov2) — the audio-first Slack builder for NEW workflows.
//
// `gov2` in #content-full starts a session that turns a song + Matthew's handwritten
// phone-edit timings + pasted images into a saved `workflows` row with a baked render_spec,
// renders a test MP4 through the render-service `render-spec` endpoint (the workflow's OWN
// song, texts at HIS timestamps), and ends with the post caption.
//
//   gov2            -> drop the song -> beat grid card
//   style DNA       -> the visual invariants prepended to EVERY scene prompt (action-only scenes)
//   timings paste   -> shots + text cues (timing-parse.ts grammar), `sync auto` beat-snaps
//   scene boards    -> paste up to 9 reference images per scene (STRICTLY scene-scoped)
//   final prompts   -> style DNA + enriched action, posted as copy blocks (PROMPT-FIRST:
//                      Matthew generates the images himself and pastes them back)
//   save + render   -> workflows row upserted, test MP4 in the thread, caption card
//
// The v1 `go` machine (workflow-pipeline.ts) is untouched: this module has its own format_id
// ("workflow_build"), its own b2_* stages, and self-routes by content_jobs, so every handler
// returns false for messages that are not part of a gov2 session.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import {
  insertJob,
  getLatestJobByThread,
  getLatestJobByChannelFormat,
  getJobByPickerTs,
  updateJob,
  type ContentJob,
  type JobData,
} from "@/lib/reel/jobs";
import { uploadToReels } from "@/lib/reel/pov";
import { enrichScene } from "@/lib/reel/prompt-enrich";
import {
  saveContentExample,
  loadSceneReferenceFrames,
  countSceneRefs,
} from "@/lib/reel/content-examples";
import { analyzeSong, snapSpecToBeats } from "@/lib/reel/beat-sync";
import { validateRenderSpec } from "@/lib/reel/render-spec";
import { buildRenderPayload, renderSpecVideo } from "@/lib/reel/render-client";
import {
  parseTimingPaste,
  timingToSpec,
  renderTimelineEcho,
  TIMING_CHEAT_SHEET,
  type ParsedTiming,
} from "@/lib/reel/timing-parse";
import {
  ANIMATION_PRESETS,
  animationPresetMenu,
  resolveAnimationPrompt,
} from "@/config/animation-presets";
import { upsertWorkflow, setWorkflowStatus } from "@/lib/reel/workflow-author";
import { generateHookCopy, buildHookCopySystem } from "@/lib/reel/captions";
import { stripEmDashes } from "@/lib/reel/text";
import { supabaseAdmin } from "@/lib/db";
import { loadVertical, listVerticals } from "@/config/verticals";
import type { RenderSpec, Workflow, WorkflowScene } from "@/config/workflows";

export const BUILDER_FORMAT_ID = "workflow_build";

const APPROVE = ["white_check_mark", "heavy_check_mark", "+1"];
const CANCEL = ["no_entry_sign", "x", "-1"];

const MAX_SCENE_REFS = 9;
const MAX_ANIM_EXAMPLES = 4;

interface DroppedFile {
  name?: string;
  mimetype?: string;
  url_private_download?: string;
}

function isAudio(f: DroppedFile): boolean {
  return (f.mimetype ?? "").startsWith("audio/") || /\.(m4a|mp3|wav|aac|ogg)$/i.test(f.name ?? "");
}

function isImage(f: DroppedFile): boolean {
  return (f.mimetype ?? "").startsWith("image/");
}

// Stage guard: while a gov2 session is active, an unrecognized IN-THREAD reply gets a "here's
// what I expected" nudge; channel-scoped text that matches nothing falls through instead (so an
// active v1 `go` session in the same channel is never hijacked). `cancel` always escapes.
const B2_NUDGES: Partial<Record<ContentJob["stage"], string>> = {
  b2_await_song: "Waiting on the song. Attach the audio file here, or reply `song <url>`. (`cancel` ends this session.)",
  b2_style_dna: "Waiting on the style DNA. Type the look in one block (character, location, lighting, lens, wardrobe), `draft dna <rough description>` for a draft, or `skip`.",
  b2_timings: "Waiting on your timings. Paste them (see the format above), then `sync auto` or `sync manual`, and react with the checkmark when the timeline is right.",
  b2_scenes: "Building the scene boards. Paste reference images (comment `scene N` to target one), `scene N: <action>` edits an action, `anim N <preset or text>` sets motion, `animex N <text>` adds a motion example, `refs` shows the boards, `next` or the checkmark moves on.",
  b2_prompts: "Prompts are up. `prompt N <new text>` rewrites one, `redo N` re-enriches it, the checkmark locks them so you can generate the images.",
  b2_images: "Waiting on the scene images. Paste them in scene order, or comment `scene N` on an upload to target a slot.",
  b2_save: "Ready to save. `name <text>` names the workflow; react with the checkmark on the save card to save it and run the test render.",
  b2_render: "Rendering the test MP4 now. Reply `render` to retry if it fails.",
  b2_caption: "Caption is up. `caption <your caption>` replaces it; react with the checkmark to finish and set the workflow ACTIVE.",
};

// ---- session lookup ----------------------------------------------------------------------

async function getBuilderJob(
  channel: string,
  threadTs?: string | null
): Promise<{ job: ContentJob; via: "thread" | "channel" } | null> {
  if (threadTs) {
    const byThread = await getLatestJobByThread(threadTs);
    if (byThread && byThread.format_id === BUILDER_FORMAT_ID && byThread.status === "active")
      return { job: byThread, via: "thread" };
    if (byThread) return null; // the thread belongs to another flow
  }
  const byChannel = await getLatestJobByChannelFormat(channel, BUILDER_FORMAT_ID);
  return byChannel ? { job: byChannel, via: "channel" } : null;
}

function builderWorkflowId(verticalId: string, threadTs: string): string {
  return `${verticalId}__b2__${threadTs.replace(/\./g, "")}`;
}

async function post(channel: string, threadTs: string, text: string): Promise<string | null> {
  const res = await slack.postThreadReply(channel, threadTs, text).catch(() => null);
  return ((res as { ts?: string } | null)?.ts as string) ?? null;
}

async function postCard(job: ContentJob, channel: string, text: string): Promise<void> {
  const ts = await post(channel, job.slack_thread_ts, text);
  if (ts) {
    await slack.addReaction(channel, ts, "white_check_mark").catch(() => {});
    await updateJob(job, { pickerTs: ts });
  }
}

async function consumeWithNudge(job: ContentJob, channel: string): Promise<boolean> {
  if (job.status !== "active") return false;
  const nudge = B2_NUDGES[job.stage];
  if (!nudge) return false;
  await post(channel, job.slack_thread_ts, nudge);
  return true;
}

// ---- gov2: session start -----------------------------------------------------------------

/** Start a gov2 builder session: post the song ask, insert the workflow_build job. */
export async function startGoV2(args: { channel: string; verticalId?: string }): Promise<boolean> {
  let verticalId = args.verticalId ?? null;
  let avatarIds: string[] = [];
  if (!verticalId) {
    const avatars = (await listVerticals()).filter((a) => a.status !== "archived");
    if (avatars.length === 1) verticalId = avatars[0].id;
    else avatarIds = avatars.map((a) => a.id);
  }

  const intro = verticalId
    ? [
        `*Workflow Builder v2* for \`${verticalId}\`.`,
        "Step 1: drop the song for this workflow (attach the audio file, or reply `song <url>`).",
      ].join("\n")
    : [
        "*Workflow Builder v2.* Which avatar is this workflow for?",
        avatarIds.map((id, i) => `${i + 1}. \`${id}\``).join("\n"),
        "",
        "Reply with the number, then drop the song.",
      ].join("\n");

  const res = await slack.postMessage(args.channel, intro).catch(() => null);
  const ts = ((res as { ts?: string } | null)?.ts as string) ?? null;
  if (!ts) return false;

  await insertJob({
    formatId: BUILDER_FORMAT_ID,
    verticalId: verticalId ?? "_",
    channel: args.channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "b2_await_song",
    sourceKind: "gov2",
    data: avatarIds.length ? { avatar_ids: avatarIds } : {},
  });
  return true;
}

/** Insert a gov2 session pinned to an EXISTING message (the daily audio-of-the-day cron card). */
export async function insertBuilderSessionAtThread(args: {
  channel: string;
  threadTs: string;
  verticalId: string;
  sourceKind?: string;
}): Promise<void> {
  await insertJob({
    formatId: BUILDER_FORMAT_ID,
    verticalId: args.verticalId,
    channel: args.channel,
    threadTs: args.threadTs,
    pickerTs: args.threadTs,
    stage: "b2_await_song",
    sourceKind: args.sourceKind ?? "cron",
    data: {},
  });
}

// ---- song intake + beat card ---------------------------------------------------------------

async function attachSong(job: ContentJob, channel: string, songUrl: string): Promise<void> {
  const threadTs = job.slack_thread_ts;
  const grid = await analyzeSong(songUrl);
  const gridNote = grid
    ? `BPM ${grid.bpm ? Math.round(grid.bpm) : "?"} | ${grid.duration ? grid.duration.toFixed(1) : "?"}s | ${grid.beats.length} beats (first: ${grid.beats.slice(0, 4).map((b) => b.toFixed(2)).join(" ")})`
    : "Could not read a beat grid from that audio; `sync auto` will not be available, manual timings still work.";
  await updateJob(job, {
    stage: "b2_style_dna",
    data: {
      ...job.data,
      song_ref: songUrl,
      ...(grid ? { beat_grid: grid } : {}),
    },
  });
  await post(
    channel,
    threadTs,
    [
      `Song attached. ${gridNote}`,
      "",
      "Step 2: the workflow's *style DNA*. One block with the visual invariants: character or wearer, location type, lighting, lens or camera feel, wardrobe details.",
      "It gets prepended to EVERY scene prompt; scene prompts then describe only the action.",
      "Type it, or `draft dna <rough description>` and I will write it, or `skip` to use the avatar's default style.",
    ].join("\n")
  );
}

// ---- style DNA ------------------------------------------------------------------------------

async function draftStyleDna(job: ContentJob, channel: string, rough: string): Promise<void> {
  const vertical = await loadVertical(job.vertical_id);
  try {
    const { data } = await callClaudeJSON<{ dna: string }>({
      model: (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6",
      system: [
        "You write the STYLE DNA for a short-form video workflow: one dense block (2 to 4 sentences)",
        "of visual invariants that will be prepended to every AI image prompt of this workflow.",
        "Cover: character or wearer, location type, lighting, lens or camera feel, wardrobe details.",
        "No actions, no on-screen text, no story. Never use em dashes.",
        `Brand context: ${vertical.style_token}`,
      ].join("\n"),
      user: `Rough description from the operator:\n${rough}\n\nReturn JSON.`,
      maxTokens: 400,
      temperature: 0.4,
      schemaHint: '{ "dna": string }',
      validate: (v: unknown): v is { dna: string } =>
        typeof v === "object" && v !== null && typeof (v as { dna?: unknown }).dna === "string",
    });
    const dna = stripEmDashes(data.dna).trim();
    await updateJob(job, { data: { ...job.data, style_dna: dna } });
    await postCard(job, channel, ["*Style DNA (draft):*", dna, "", "React with the checkmark to lock it, type a replacement, or `draft dna <rough>` again."].join("\n"));
  } catch (e) {
    console.error("[workflow-builder] draft dna failed:", (e as Error).message);
    await post(channel, job.slack_thread_ts, "Could not draft the DNA. Type it yourself or try `draft dna` again.");
  }
}

async function advanceToTimings(job: ContentJob, channel: string): Promise<void> {
  await updateJob(job, { stage: "b2_timings" });
  await post(
    channel,
    job.slack_thread_ts,
    ["Step 3: your timings (from your phone edit).", "", TIMING_CHEAT_SHEET].join("\n")
  );
}

// ---- timings --------------------------------------------------------------------------------

function specFromJob(job: ContentJob): RenderSpec | null {
  return (job.data.timing_spec as RenderSpec | undefined) ?? null;
}

async function applyTimingPaste(job: ContentJob, channel: string, text: string): Promise<void> {
  const parsed = parseTimingPaste(text);
  if (parsed.shots.length === 0) {
    await post(channel, job.slack_thread_ts, renderTimelineEcho(parsed));
    return;
  }
  const spec = timingToSpec(parsed, job.data.song_ref ?? null);
  const sceneDefs: NonNullable<JobData["scene_defs"]> = parsed.shots.map((s, i) => ({
    role: s.action || `scene ${i + 1}`,
    ...(job.data.scene_defs?.[i]?.animation_preset ? { animation_preset: job.data.scene_defs[i].animation_preset } : {}),
  }));
  await updateJob(job, { data: { ...job.data, timing_spec: spec, scene_defs: sceneDefs } });
  const problems = validateRenderSpec(spec);
  await postCard(job, channel, [
    renderTimelineEcho(parsed),
    "",
    problems.length
      ? `Fix before continuing:\n${problems.map((p) => `- ${p}`).join("\n")}`
      : job.data.beat_grid
        ? "`sync auto` snaps everything to the song's beats, `sync manual` keeps these numbers. React with the checkmark when the timeline is right."
        : "React with the checkmark when the timeline is right (no beat grid on this song, timings stay as typed).",
  ].join("\n"));
}

async function applySync(job: ContentJob, channel: string, auto: boolean): Promise<void> {
  const spec = specFromJob(job);
  if (!spec) {
    await post(channel, job.slack_thread_ts, "Paste the timings first, then `sync auto`.");
    return;
  }
  if (!auto) {
    await post(channel, job.slack_thread_ts, "Keeping your timings exactly as typed. React with the checkmark on the timeline card to continue.");
    return;
  }
  const grid = job.data.beat_grid;
  if (!grid?.beats?.length) {
    await post(channel, job.slack_thread_ts, "No beat grid for this song, so nothing to snap to. Your timings stay as typed.");
    return;
  }
  const { spec: snapped, moved } = snapSpecToBeats(spec, grid.beats, 0.45);
  await updateJob(job, { data: { ...job.data, timing_spec: snapped } });
  const echo: ParsedTiming = {
    shots: snapped.shots.map((s, i) => ({ ...s, action: job.data.scene_defs?.[i]?.role ?? `scene ${s.i}` })),
    texts: snapped.texts,
    duration: snapped.duration_seconds,
    errors: [],
    warnings: [],
  };
  await postCard(job, channel, [
    `Snapped ${moved} timing(s) to the beat grid.`,
    "",
    renderTimelineEcho(echo),
    "",
    "React with the checkmark when the timeline is right.",
  ].join("\n"));
}

async function advanceToScenes(job: ContentJob, channel: string): Promise<void> {
  const spec = specFromJob(job);
  if (!spec) {
    await post(channel, job.slack_thread_ts, "Paste the timings first.");
    return;
  }
  const problems = validateRenderSpec(spec);
  if (problems.length) {
    await post(channel, job.slack_thread_ts, `The timeline still has problems:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    return;
  }
  const wfId = builderWorkflowId(job.vertical_id, job.slack_thread_ts);
  await updateJob(job, { stage: "b2_scenes", data: { ...job.data, workflow_id: wfId } });
  const defs = job.data.scene_defs ?? [];
  await post(
    channel,
    job.slack_thread_ts,
    [
      "Step 4: *scene boards*. Each scene can hold up to 9 reference images (they ground THAT scene's prompt and nothing else) and a motion preset.",
      "",
      ...defs.map((d, i) => `Scene ${i + 1}: ${d.role}  (0/${MAX_SCENE_REFS} refs)`),
      "",
      "Paste reference images here. Comment `scene N` on an upload to target a scene; without it they fill the first scene that has room.",
      `\`scene N: <action>\` edits an action. \`anim N <preset or your own motion sentence>\` sets motion (presets: ${animationPresetMenu()}).`,
      "`animex N <text>` adds a motion example (up to 4). `refs` shows the boards. `next` or the checkmark builds the final prompts (empty boards are fine, the style DNA still grounds them).",
    ].join("\n")
  );
}

// ---- scene boards ---------------------------------------------------------------------------

async function postBoardStatus(job: ContentJob, channel: string): Promise<void> {
  const defs = job.data.scene_defs ?? [];
  const wfId = job.data.workflow_id!;
  const counts = await Promise.all(defs.map((_, i) => countSceneRefs(wfId, i + 1)));
  await post(
    channel,
    job.slack_thread_ts,
    defs
      .map((d, i) => {
        const anim = d.animation_prompt
          ? `motion: ${d.animation_prompt}`
          : d.animation_preset
            ? `motion: ${d.animation_preset}`
            : "motion: not set";
        const ex = d.animation_examples?.length ? ` | ${d.animation_examples.length}/${MAX_ANIM_EXAMPLES} motion examples` : "";
        return `Scene ${i + 1}: ${d.role}\n    ${counts[i]}/${MAX_SCENE_REFS} refs | ${anim}${ex}`;
      })
      .join("\n")
  );
}

async function saveSceneRefs(
  job: ContentJob,
  channel: string,
  files: DroppedFile[],
  text: string
): Promise<void> {
  const defs = job.data.scene_defs ?? [];
  const wfId = job.data.workflow_id!;
  const images = files.filter(isImage);
  if (!images.length) {
    await post(channel, job.slack_thread_ts, "Only images land on the scene boards (audio is already attached).");
    return;
  }
  const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(text);
  const target = targetMatch ? parseInt(targetMatch[1], 10) : null;
  if (target !== null && (target < 1 || target > defs.length)) {
    await post(channel, job.slack_thread_ts, `There is no scene ${target} (this workflow has ${defs.length}).`);
    return;
  }
  const counts = await Promise.all(defs.map((_, i) => countSceneRefs(wfId, i + 1)));
  let saved = 0;
  for (const f of images) {
    let slot = target;
    if (slot === null) {
      const open = counts.findIndex((c) => c < MAX_SCENE_REFS);
      if (open < 0) {
        await post(channel, job.slack_thread_ts, `All scene boards are full (${MAX_SCENE_REFS} each). Comment \`scene N\` to target a specific board.`);
        break;
      }
      slot = open + 1;
    }
    if (counts[slot - 1] >= MAX_SCENE_REFS) {
      await post(channel, job.slack_thread_ts, `Scene ${slot}'s board already holds ${MAX_SCENE_REFS} references. Skipping this image.`);
      continue;
    }
    try {
      const buf = await slack.downloadFile(f.url_private_download!);
      const url = await uploadToReels(buf, f.mimetype || "image/png");
      if (!url) continue;
      await saveContentExample({
        verticalId: job.vertical_id,
        workflowId: wfId,
        sceneIndex: slot,
        sourcePath: url,
        storyboard: { hook: defs[slot - 1]?.role ?? `scene ${slot}`, shots: [] },
        labels: ["scene_reference"],
        difficulty: "medium",
        frameUrls: [url],
      });
      counts[slot - 1]++;
      saved++;
    } catch (e) {
      console.error("[workflow-builder] scene ref save failed:", (e as Error).message);
    }
  }
  if (saved > 0) {
    await post(
      channel,
      job.slack_thread_ts,
      defs.map((_, i) => `Scene ${i + 1}: ${counts[i]}/${MAX_SCENE_REFS} refs`).join(" | ")
    );
  }
}

// ---- final prompts ----------------------------------------------------------------------------

function assemblePrompt(dna: string, action: string): string {
  return `${dna.replace(/[.\s]+$/, "")}. ${stripEmDashes(action).replace(/[.\s]+$/, "")}. No text, captions, logos, or watermarks in the image. 9:16 vertical.`;
}

async function buildFinalPrompts(job: ContentJob, channel: string): Promise<void> {
  const defs = job.data.scene_defs ?? [];
  const wfId = job.data.workflow_id!;
  if (!defs.length) {
    await post(channel, job.slack_thread_ts, "No scenes yet. Paste the timings first.");
    return;
  }
  await post(channel, job.slack_thread_ts, `Building the final prompts for ${defs.length} scene(s)...`);
  const vertical = await loadVertical(job.vertical_id);
  const dna = (job.data.style_dna ?? "").trim() || vertical.style_token;

  const prompts: string[] = [];
  for (let i = 0; i < defs.length; i++) {
    // The continuity guarantee: ONLY this scene's own reference frames ground the enrichment.
    const frames = await loadSceneReferenceFrames(wfId, i + 1, MAX_SCENE_REFS);
    const enriched = await enrichScene(defs[i].role, {
      vertical,
      formatGroup: "builder_v2",
      frames,
      styleDna: dna,
      workflow: { id: wfId, category: "broll" },
    });
    prompts.push(assemblePrompt(dna, enriched));
  }
  const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
  await updateJob(fresh, { stage: "b2_prompts", data: { ...fresh.data, final_prompts: prompts } });
  const blocks = prompts.map((p, i) => `*Scene ${i + 1}* (${defs[i].role}):\n\`\`\`\n${p}\n\`\`\``);
  await postCard(fresh, channel, [
    "Step 5: *final prompts*, one per scene. Copy each block into your image tool.",
    "",
    ...blocks,
    "`prompt N <new text>` rewrites one. `redo N` re-enriches one from its board. React with the checkmark to lock them, then paste the finished scene images here.",
  ].join("\n"));
}

async function advanceToImages(job: ContentJob, channel: string): Promise<void> {
  await updateJob(job, { stage: "b2_images" });
  const defs = job.data.scene_defs ?? [];
  await post(
    channel,
    job.slack_thread_ts,
    [
      `Prompts locked. Paste the ${defs.length} scene image(s) here in scene order, or comment \`scene N\` on an upload to target a slot.`,
      "Each pasted image is saved to that scene's reference board too, so the workflow keeps learning your taste.",
    ].join("\n")
  );
}

// ---- final scene images ------------------------------------------------------------------------

async function saveSceneImages(
  job: ContentJob,
  channel: string,
  files: DroppedFile[],
  text: string
): Promise<void> {
  const defs = (job.data.scene_defs ?? []).map((d) => ({ ...d }));
  const wfId = job.data.workflow_id!;
  const images = files.filter(isImage);
  if (!images.length) return;
  const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(text);
  let target = targetMatch ? parseInt(targetMatch[1], 10) - 1 : null;
  for (const f of images.slice(0, defs.length)) {
    let slot = target ?? defs.findIndex((d) => !d.image_url);
    if (slot === null || slot < 0 || slot >= defs.length) {
      if (target === null) {
        await post(channel, job.slack_thread_ts, `All ${defs.length} scenes have images. Comment \`scene N\` on an upload to replace one.`);
        break;
      }
      slot = Math.min(Math.max(target, 0), defs.length - 1);
    }
    try {
      const buf = await slack.downloadFile(f.url_private_download!);
      const url = await uploadToReels(buf, f.mimetype || "image/png");
      if (!url) continue;
      defs[slot] = { ...defs[slot], image_url: url };
      await saveContentExample({
        verticalId: job.vertical_id,
        workflowId: wfId,
        sceneIndex: slot + 1,
        sourcePath: url,
        storyboard: { hook: defs[slot].role, shots: [] },
        labels: ["approved_manual", "scene_image"],
        difficulty: "medium",
        frameUrls: [url],
      }).catch(() => {});
      const filled = defs.filter((d) => d.image_url).length;
      await post(channel, job.slack_thread_ts, `Scene ${slot + 1} (*${defs[slot].role}*) received. ${filled} of ${defs.length}.`);
    } catch (e) {
      console.error("[workflow-builder] scene image save failed:", (e as Error).message);
    }
    if (target !== null) target++;
  }
  await updateJob(job, { data: { ...job.data, scene_defs: defs } });
  if (defs.length && defs.every((d) => d.image_url)) {
    await postSaveCard(job, channel);
  }
}

// ---- save + render -------------------------------------------------------------------------------

async function postSaveCard(job: ContentJob, channel: string): Promise<void> {
  const spec = specFromJob(job);
  const defs = job.data.scene_defs ?? [];
  await updateJob(job, { stage: "b2_save" });
  await postCard(job, channel, [
    "*Save card*",
    `Name: ${job.data.wf_name ?? "(none yet, `name <text>` to set one)"}`,
    `Avatar: \`${job.vertical_id}\`  |  ${defs.length} scenes  |  ${spec?.duration_seconds.toFixed(1) ?? "?"}s  |  song attached${job.data.beat_grid?.bpm ? ` (${Math.round(job.data.beat_grid.bpm)} BPM)` : ""}`,
    `Style DNA: ${(job.data.style_dna ?? "avatar default").slice(0, 160)}`,
    "",
    "React with the checkmark to save the workflow and run the test render.",
  ].join("\n"));
}

function buildWorkflowRow(job: ContentJob): Workflow {
  const spec = specFromJob(job)!;
  const defs = job.data.scene_defs ?? [];
  const prompts = job.data.final_prompts ?? [];
  const scenes: WorkflowScene[] = defs.map((d, i) => {
    const slotSeconds = spec.shots[i] ? spec.shots[i].end - spec.shots[i].start : undefined;
    return {
      role: d.role,
      image_prompt: prompts[i] ?? d.role,
      animation_prompt: resolveAnimationPrompt(d.animation_preset, d.animation_prompt),
      ...(d.animation_preset ? { animation_preset: d.animation_preset } : {}),
      ...(d.animation_examples?.length ? { animation_examples: d.animation_examples } : {}),
      ...(slotSeconds ? { duration_seconds: Math.round(slotSeconds * 10) / 10 } : {}),
      image_url: d.image_url ?? null,
      image_approved: Boolean(d.image_url),
    };
  });
  const wfId = job.data.workflow_id!;
  return {
    id: wfId,
    vertical_id: job.vertical_id,
    name: job.data.wf_name ?? `Builder v2 ${wfId.slice(-6)}`,
    category: "broll",
    subcategory: "builder_v2",
    status: "draft",
    scenes,
    captions: spec.texts.map((t) => ({ text: t.text, at_second: t.at_second })),
    copy_structure: spec.texts.map((t, i) => ({
      key: t.role ?? `line_${i + 1}`,
      label: `Line ${i + 1}`,
      guidance: "On-screen line from the builder timing paste.",
      shot: spec.shots.find((s) => t.at_second >= s.start - 0.05 && t.at_second < s.end)?.i ?? 1,
      at_second: t.at_second,
      out_second: t.out_second,
      position: t.position,
    })),
    render_spec: { ...spec, song_ref: job.data.song_ref ?? null },
    song_ref: job.data.song_ref ?? null,
    render_sequences: [],
    render_options: { aspect: "9:16" },
    example_video_url: null,
    example_storyboard: null,
    shot_screenshots: [],
    source_kind: "builder_v2",
    source_example_id: null,
    production_status: "building",
    description: `Builder v2: ${scenes.length} scenes, ${spec.duration_seconds.toFixed(1)}s, own song, beat-timed text.`,
  };
}

/** Dedicated update for the v2 columns (style_dna / beat_grid), tolerant of a missing
 *  migration so the main upsert never breaks. */
async function saveBuilderV2Fields(job: ContentJob): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("workflows")
      .update({
        style_dna: job.data.style_dna ?? null,
        beat_grid: job.data.beat_grid ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.data.workflow_id!);
    if (error) console.error("[workflow-builder] v2 fields update failed (migration applied?):", error.message);
  } catch (e) {
    console.error("[workflow-builder] v2 fields update threw:", (e as Error).message);
  }
}

async function saveAndRender(job: ContentJob, channel: string): Promise<void> {
  const spec = specFromJob(job);
  const defs = job.data.scene_defs ?? [];
  if (!spec || !defs.length) {
    await post(channel, job.slack_thread_ts, "Nothing to save yet. Paste the timings first.");
    return;
  }
  const missing = defs.map((d, i) => (d.image_url ? null : i + 1)).filter(Boolean);
  if (missing.length) {
    await post(channel, job.slack_thread_ts, `Scenes ${missing.join(", ")} still need images before the render.`);
    return;
  }
  const workflow = buildWorkflowRow(job);
  const ok = await upsertWorkflow(workflow);
  if (!ok) {
    await post(channel, job.slack_thread_ts, "Could not save the workflow row (check the workflows table). Fix and react again.");
    return;
  }
  await saveBuilderV2Fields(job);
  await updateJob(job, { stage: "b2_render" });
  await post(channel, job.slack_thread_ts, `Workflow saved as \`${workflow.id}\`. Rendering the test MP4 with its own song...`);

  waitUntil(
    (async () => {
      try {
        const payload = buildRenderPayload(workflow, workflow.render_spec!);
        const result = await renderSpecVideo(payload);
        const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
        await updateJob(fresh, { data: { ...fresh.data, final_video_url: result.url } });
        await post(channel, job.slack_thread_ts, [`*Test render done* (${result.duration.toFixed(1)}s):`, result.url].join("\n"));
        await postCaptionCard(fresh, channel);
      } catch (e) {
        console.error("[workflow-builder] render failed:", (e as Error).message);
        await post(channel, job.slack_thread_ts, `Render failed: ${(e as Error).message}\nReply \`render\` to retry.`);
      }
    })()
  );
}

// ---- caption --------------------------------------------------------------------------------------

async function postCaptionCard(job: ContentJob, channel: string): Promise<void> {
  const vertical = await loadVertical(job.vertical_id);
  const spec = specFromJob(job);
  let caption = job.data.caption_draft ?? "";
  if (!caption) {
    try {
      const sceneSummary = [
        job.data.style_dna ? `Look: ${job.data.style_dna}` : "",
        `Video: ${(job.data.scene_defs ?? []).map((d) => d.role).join(" -> ")}`,
        spec?.texts.length ? `On-screen lines: ${spec.texts.map((t) => t.text).join(" | ")}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const copy = await generateHookCopy({
        scene: sceneSummary,
        system: buildHookCopySystem("pov_hook", vertical),
        withAfterFrame: false,
      });
      caption = copy.caption;
    } catch (e) {
      console.error("[workflow-builder] caption gen failed:", (e as Error).message);
      caption = "";
    }
  }
  await updateJob(job, { stage: "b2_caption", data: { ...job.data, caption_draft: caption } });
  await postCard(job, channel, [
    "*Caption:*",
    caption ? `\`\`\`\n${caption}\n\`\`\`` : "(could not draft one; reply `caption <your caption>`)",
    "",
    "`caption <text>` replaces it. React with the checkmark to finish: the workflow goes ACTIVE and is ready for daily runs.",
  ].join("\n"));
}

async function finishSession(job: ContentJob, channel: string): Promise<void> {
  const wfId = job.data.workflow_id!;
  await setWorkflowStatus(wfId, "active");
  await updateJob(job, { stage: "done", status: "done" });
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  await post(
    channel,
    job.slack_thread_ts,
    [
      `*Done.* \`${wfId}\` is ACTIVE.`,
      appUrl ? `Tune it any time: ${appUrl}/dashboard/content-workflows/${wfId}` : "Tune it any time on /dashboard/content-workflows.",
      "Run it in daily sessions like any other workflow. `gov2` starts the next build.",
    ].join("\n")
  );
}

// ---- message router -------------------------------------------------------------------------------

/**
 * Handle a text message for a gov2 session (thread reply or channel-scoped). Returns true when
 * the message belonged to a builder session.
 */
export async function handleBuilderMessage(args: {
  channel: string;
  threadTs?: string;
  text: string;
}): Promise<boolean> {
  const found = await getBuilderJob(args.channel, args.threadTs);
  if (!found) return false;
  const job = found.job;
  // Channel-scoped (no thread): only claim text that MATCHES builder grammar; everything else
  // falls through so an active v1 `go` session in the same channel is never hijacked.
  const nudgeOrFallthrough = async (): Promise<boolean> =>
    found.via === "thread" ? consumeWithNudge(job, args.channel) : false;
  const text = args.text.trim();
  const channel = args.channel;

  if (/^\s*cancel\s*$/i.test(text) && found.via === "thread") {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(channel, job.slack_thread_ts, "Session cancelled. `gov2` starts a fresh one.");
    return true;
  }

  switch (job.stage) {
    case "b2_await_song": {
      // Avatar pick first when the session started without one.
      if (job.vertical_id === "_" && /^\d{1,2}$/.test(text)) {
        const ids = job.data.avatar_ids ?? [];
        const pick = ids[parseInt(text, 10) - 1];
        if (!pick) {
          await post(channel, job.slack_thread_ts, `Pick a number between 1 and ${ids.length}.`);
          return true;
        }
        await supabaseAdmin.from("content_jobs").update({ vertical_id: pick }).eq("id", job.id);
        await post(channel, job.slack_thread_ts, `Avatar \`${pick}\`. Now drop the song (audio file or \`song <url>\`).`);
        return true;
      }
      const songUrl = /^\s*song\s+(https?:\/\/\S+)\s*$/i.exec(text)?.[1];
      if (songUrl) {
        if (job.vertical_id === "_") {
          await post(channel, job.slack_thread_ts, "Pick the avatar number first.");
          return true;
        }
        await attachSong(job, channel, songUrl);
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_style_dna": {
      const draft = /^\s*draft\s+dna\s+([\s\S]+)$/i.exec(text)?.[1];
      if (draft) {
        await post(channel, job.slack_thread_ts, "Drafting the style DNA...");
        waitUntil(draftStyleDna(job, channel, draft));
        return true;
      }
      if (/^\s*skip\s*$/i.test(text)) {
        await advanceToTimings(job, channel);
        return true;
      }
      if (found.via === "thread" && text.length >= 20) {
        await updateJob(job, { data: { ...job.data, style_dna: stripEmDashes(text) } });
        await postCard(job, channel, ["*Style DNA:*", stripEmDashes(text), "", "React with the checkmark to lock it, or type a replacement."].join("\n"));
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_timings": {
      if (/^\s*sync\s+auto\s*$/i.test(text)) {
        await applySync(job, channel, true);
        return true;
      }
      if (/^\s*sync\s+manual\s*$/i.test(text)) {
        await applySync(job, channel, false);
        return true;
      }
      // A paste containing at least one time range = (re)paste of the timings.
      if (/\d(?:[.,:]\d+)?\s*-\s*\d/.test(text)) {
        await applyTimingPaste(job, channel, text);
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_scenes": {
      const defs = (job.data.scene_defs ?? []).map((d) => ({ ...d }));
      const action = /^\s*scene\s+(\d{1,2})\s*[:.]\s*([\s\S]+)$/i.exec(text);
      if (action) {
        const n = parseInt(action[1], 10);
        if (n >= 1 && n <= defs.length) {
          defs[n - 1].role = stripEmDashes(action[2].trim());
          await updateJob(job, { data: { ...job.data, scene_defs: defs } });
          await post(channel, job.slack_thread_ts, `Scene ${n}: ${defs[n - 1].role}`);
        } else {
          await post(channel, job.slack_thread_ts, `There is no scene ${n}.`);
        }
        return true;
      }
      const anim = /^\s*anim\s+(\d{1,2})\s+([\s\S]+)$/i.exec(text);
      if (anim) {
        const n = parseInt(anim[1], 10);
        const value = anim[2].trim();
        if (n < 1 || n > defs.length) {
          await post(channel, job.slack_thread_ts, `There is no scene ${n}.`);
          return true;
        }
        const key = value.toLowerCase().replace(/\s+/g, "_");
        if (ANIMATION_PRESETS[key]) {
          defs[n - 1].animation_preset = key;
          defs[n - 1].animation_prompt = undefined;
          await post(channel, job.slack_thread_ts, `Scene ${n} motion preset: ${key} (${ANIMATION_PRESETS[key].prompt})`);
        } else {
          defs[n - 1].animation_prompt = stripEmDashes(value);
          await post(channel, job.slack_thread_ts, `Scene ${n} motion: ${defs[n - 1].animation_prompt}`);
        }
        await updateJob(job, { data: { ...job.data, scene_defs: defs } });
        return true;
      }
      const animex = /^\s*animex\s+(\d{1,2})\s+([\s\S]+)$/i.exec(text);
      if (animex) {
        const n = parseInt(animex[1], 10);
        if (n < 1 || n > defs.length) {
          await post(channel, job.slack_thread_ts, `There is no scene ${n}.`);
          return true;
        }
        const list = defs[n - 1].animation_examples ?? [];
        if (list.length >= MAX_ANIM_EXAMPLES) {
          await post(channel, job.slack_thread_ts, `Scene ${n} already has ${MAX_ANIM_EXAMPLES} motion examples.`);
          return true;
        }
        defs[n - 1].animation_examples = [...list, stripEmDashes(animex[2].trim())];
        await updateJob(job, { data: { ...job.data, scene_defs: defs } });
        await post(channel, job.slack_thread_ts, `Scene ${n} motion example ${defs[n - 1].animation_examples!.length}/${MAX_ANIM_EXAMPLES} saved.`);
        return true;
      }
      if (/^\s*refs?\s*$/i.test(text)) {
        await postBoardStatus(job, channel);
        return true;
      }
      if (/^\s*next\s*$/i.test(text)) {
        waitUntil(buildFinalPrompts(job, channel));
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_prompts": {
      const edit = /^\s*prompt\s+(\d{1,2})\s+([\s\S]+)$/i.exec(text);
      const prompts = [...(job.data.final_prompts ?? [])];
      if (edit) {
        const n = parseInt(edit[1], 10);
        if (n < 1 || n > prompts.length) {
          await post(channel, job.slack_thread_ts, `There is no prompt ${n}.`);
          return true;
        }
        prompts[n - 1] = stripEmDashes(edit[2].trim());
        await updateJob(job, { data: { ...job.data, final_prompts: prompts } });
        await post(channel, job.slack_thread_ts, `Prompt ${n} updated:\n\`\`\`\n${prompts[n - 1]}\n\`\`\``);
        return true;
      }
      const redo = /^\s*redo\s+(\d{1,2})\s*$/i.exec(text);
      if (redo) {
        const n = parseInt(redo[1], 10);
        const defs = job.data.scene_defs ?? [];
        if (n < 1 || n > defs.length) {
          await post(channel, job.slack_thread_ts, `There is no scene ${n}.`);
          return true;
        }
        waitUntil(
          (async () => {
            const vertical = await loadVertical(job.vertical_id);
            const dna = (job.data.style_dna ?? "").trim() || vertical.style_token;
            const frames = await loadSceneReferenceFrames(job.data.workflow_id!, n, MAX_SCENE_REFS);
            const enriched = await enrichScene(defs[n - 1].role, {
              vertical,
              formatGroup: "builder_v2",
              frames,
              styleDna: dna,
              workflow: { id: job.data.workflow_id!, category: "broll" },
            });
            prompts[n - 1] = assemblePrompt(dna, enriched);
            const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
            await updateJob(fresh, { data: { ...fresh.data, final_prompts: prompts } });
            await post(channel, job.slack_thread_ts, `Prompt ${n} re-enriched:\n\`\`\`\n${prompts[n - 1]}\n\`\`\``);
          })()
        );
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_images":
      return nudgeOrFallthrough();

    case "b2_save": {
      const name = /^\s*name\s+(.+)$/i.exec(text)?.[1];
      if (name) {
        await updateJob(job, { data: { ...job.data, wf_name: stripEmDashes(name.trim()) } });
        await postSaveCard(job, channel);
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_render": {
      if (/^\s*render\s*$/i.test(text)) {
        await saveAndRender(job, channel);
        return true;
      }
      return nudgeOrFallthrough();
    }

    case "b2_caption": {
      const cap = /^\s*caption\s+([\s\S]+)$/i.exec(text)?.[1];
      if (cap) {
        await updateJob(job, { data: { ...job.data, caption_draft: stripEmDashes(cap.trim()) } });
        await postCard(job, channel, ["*Caption:*", `\`\`\`\n${stripEmDashes(cap.trim())}\n\`\`\``, "", "React with the checkmark to finish."].join("\n"));
        return true;
      }
      return nudgeOrFallthrough();
    }

    default:
      return false;
  }
}

// ---- reactions ------------------------------------------------------------------------------------

/** The checkmark advances the current card; the no-entry sign cancels. Self-routes by picker ts. */
export async function handleBuilderReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const approve = APPROVE.includes(args.reaction);
  const cancel = CANCEL.includes(args.reaction);
  if (!approve && !cancel) return false;
  const job = await getJobByPickerTs(args.slackTs);
  if (!job || job.format_id !== BUILDER_FORMAT_ID || job.status !== "active") return false;
  const channel = args.channel;

  if (cancel) {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(channel, job.slack_thread_ts, "Session cancelled. `gov2` starts a fresh one.");
    return true;
  }

  switch (job.stage) {
    case "b2_style_dna":
      await advanceToTimings(job, channel);
      return true;
    case "b2_timings":
      await advanceToScenes(job, channel);
      return true;
    case "b2_scenes":
      waitUntil(buildFinalPrompts(job, channel));
      return true;
    case "b2_prompts":
      await advanceToImages(job, channel);
      return true;
    case "b2_save":
      await saveAndRender(job, channel);
      return true;
    case "b2_caption":
      await finishSession(job, channel);
      return true;
    default:
      return true; // it is our card; swallow the reaction rather than leak to other handlers
  }
}

// ---- file drops -----------------------------------------------------------------------------------

/**
 * A file dropped in #content-full that belongs to a gov2 session: audio at the song step,
 * images onto scene boards / final scene slots. Returns false when no builder session claims it.
 */
export async function handleBuilderFileDrop(args: {
  channel: string;
  threadTs?: string;
  files: DroppedFile[];
  text?: string;
}): Promise<boolean> {
  const found = await getBuilderJob(args.channel, args.threadTs);
  if (!found) return false;
  const job = found.job;
  const channel = args.channel;

  if (job.stage === "b2_await_song") {
    const audio = args.files.find(isAudio);
    if (!audio?.url_private_download) return false;
    if (job.vertical_id === "_") {
      await post(channel, job.slack_thread_ts, "Pick the avatar number first, then re-attach the song.");
      return true;
    }
    try {
      const buf = await slack.downloadFile(audio.url_private_download);
      const url = await uploadToReels(buf, audio.mimetype || "audio/mp4");
      if (!url) {
        await post(channel, job.slack_thread_ts, "Could not store that audio. Try attaching it again.");
        return true;
      }
      await attachSong(job, channel, url);
    } catch (e) {
      console.error("[workflow-builder] song intake failed:", (e as Error).message);
      await post(channel, job.slack_thread_ts, "Could not attach that audio. Try again.");
    }
    return true;
  }

  // Image intake stages only claim drops in their own thread (so v1 sessions and the
  // decoder keep their own drops).
  if (job.stage === "b2_scenes" && found.via === "thread") {
    await saveSceneRefs(job, channel, args.files, args.text ?? "");
    return true;
  }

  if (job.stage === "b2_images" && found.via === "thread") {
    await saveSceneImages(job, channel, args.files, args.text ?? "");
    return true;
  }

  // Other stages: swallow image/audio drops IN THREAD with a pointer; channel drops fall through.
  if (found.via === "thread" && args.files.some((f) => isImage(f) || isAudio(f))) {
    return consumeWithNudge(job, channel);
  }
  return false;
}
