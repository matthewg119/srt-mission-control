// Workflow picker for #content-full media posts (images AND videos).
//
// When the operator drops a BARE image/video (no copy) in #content-full, the bot replies
// with a breakdown of the workflows so the operator decides what to do, instead of
// auto-running the Reel Studio flow. State is scoped by the pov_studio_jobs table (one
// row per post), and the reaction handler self-routes by the picker message ts.
//
// Every input is resolved to a STILL FRAME first (a real image's url, or a video's
// thumbnail via files.info) so all three workflows operate uniformly.
//
// Workflows:
//   1️⃣ Render Reel   -> the classic Studio flow: write 4 on-screen text lines (label,
//                        hook, payoff, cta); operator picks/edits, then the frame is
//                        rendered with the text + our 6-sec audio into a finished MP4.
//   2️⃣ Animate       -> Claude vision returns an animation prompt + headline options +
//                        captions to turn this still into a moving clip.
//   3️⃣ Recreate      -> treat it as "fire" inspiration; Claude breaks down why it works
//                        and rebuilds it as our pest-control POV (with a fresh first frame).
//
// Future (not built): full storyboard — needs the hook/title up front to assemble scenes.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { generatePovImage, generatePovImagesForJob } from "@/lib/reel/pov";
import { ImageGenPausedError, IMAGE_GEN_PAUSED_NOTE } from "@/lib/providers/image-gen";
import { handleStudioImage, parseBoxes } from "@/lib/reel/studio";
import { loadExampleFewShot } from "@/lib/reel/content-examples";
import { suggestFormatsForFrame } from "@/lib/reel/format-suggest";
import { getActiveVertical, type Vertical } from "@/config/verticals";
import {
  CONTENT_WORKFLOWS,
  REACTION_TO_WORKFLOW,
  getWorkflow,
  classifyByKeywords,
  type ContentWorkflowId,
} from "@/config/content-workflows";

interface SlackFileLike {
  id?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

type PovWorkflow = ContentWorkflowId;

interface PovImageOption {
  index: number;
  scene?: string;
  url: string;
  mimetype: string;
}

interface PovStudioJobRow {
  id: string;
  slack_channel: string;
  slack_thread_ts: string;
  picker_msg_ts: string | null;
  image_url: string | null;
  image_mimetype: string | null;
  source_kind: "image" | "video" | null;
  images: PovImageOption[] | null;
  workflow: PovWorkflow | null;
  status:
    | "awaiting_ideas_approval"
    | "generating"
    | "skipped"
    | "awaiting_pick"
    | "awaiting_workflow"
    | "running"
    | "done"
    | "error";
}

// ✅ approve / 🚫 skip reactions for the ideas-first gate.
const APPROVE_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check"]);
const SKIP_REACTIONS = new Set(["no_entry", "no_entry_sign", "x"]);

const JOB_COLS =
  "id,slack_channel,slack_thread_ts,picker_msg_ts,image_url,image_mimetype,source_kind,images,workflow,status";

// Picker reactions -> workflow + the daily-drop "pick the best of 3" mapping. The
// reaction->workflow map is derived from the registry (config/content-workflows.ts).
// Image-pick reactions (daily drop "pick the best of 3") -> 1-based option number.
const REACTION_TO_OPTION: Record<string, number> = { one: 1, two: 2, three: 3 };

/** Post the workflow breakdown (from the registry) and return its message ts. */
async function postWorkflowBreakdown(channel: string, threadTs: string, fromVideo: boolean): Promise<string | null> {
  const videoNote = fromVideo ? " _(read from a frame of your video)_" : "";
  const lines = [
    `🧠 *What should I do with this?*${videoNote} React to pick a workflow:`,
    "",
    ...CONTENT_WORKFLOWS.map((w) => `${w.emoji}  *${w.name}* — ${w.blurb}`),
  ];
  const res = (await slack.postThreadReply(channel, threadTs, lines.join("\n"))) as { ts?: string };
  return res?.ts ?? null;
}

/** "What this workflow needs" line, posted right when a workflow is selected. */
function requirementsLine(id: ContentWorkflowId): string {
  const w = getWorkflow(id);
  return `*${w.name}* needs: ${w.requirements.join(" ")}`;
}

// Resolve any posted file to a still-image URL Claude/render can use: a real image's
// url_private, or a video's poster thumbnail (via files.info). Returns null if neither.
// Exported: drop-studio.ts (the #ai-content-pest-control lane) reuses it for video drops.
export async function resolveStillFrame(
  file: SlackFileLike
): Promise<{ url: string; mimetype: string; kind: "image" | "video" } | null> {
  const mime = file.mimetype ?? "";
  if (mime.startsWith("image/")) {
    const url = file.url_private ?? file.url_private_download ?? null;
    return url ? { url, mimetype: mime, kind: "image" } : null;
  }
  if (mime.startsWith("video/") && file.id) {
    try {
      const info = (await slack.filesInfo(file.id)) as { ok?: boolean; file?: Record<string, unknown> };
      const f = info.file ?? {};
      // Slack video files expose a poster image under thumb_video / sized thumbs.
      for (const key of ["thumb_video", "thumb_1024", "thumb_960", "thumb_720", "thumb_480", "thumb_360"]) {
        const u = f[key];
        if (typeof u === "string" && u.startsWith("http")) {
          return { url: u, mimetype: "image/jpeg", kind: "video" };
        }
      }
    } catch (e) {
      console.error("[pov-studio] files.info for video failed:", (e as Error).message);
    }
  }
  return null;
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

async function downloadImage(url: string, mimetypeHint?: string): Promise<ClaudeImageInput | null> {
  try {
    const botToken = process.env.SLACK_BOT_TOKEN || "";
    const res = await fetch(url, { headers: { Authorization: `Bearer ${botToken}` } });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const media_type = (mimetypeHint || res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { media_type, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

// ---- Entry: a bare image post in #content-full ------------------------------------

/**
 * Post the workflow breakdown for a fresh bare image/video and record the job. Returns
 * true if handled (so the events route stops before the Studio default). The caller
 * should only invoke this for a top-level media post with NO copy.
 */
export async function handlePovImagePost(args: {
  channel: string;
  threadTs: string;
  files: SlackFileLike[];
}): Promise<boolean> {
  const mediaFile = args.files.find(
    (f) => (f.mimetype ?? "").startsWith("image/") || (f.mimetype ?? "").startsWith("video/")
  );
  if (!mediaFile) return false;

  const frame = await resolveStillFrame(mediaFile);
  if (!frame) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "⚠️ I couldn't pull a still frame from that file. Send an image (or a video with a thumbnail) and I'll show you the workflows."
    );
    return true;
  }

  const pickerTs = await postWorkflowBreakdown(args.channel, args.threadTs, frame.kind === "video");

  await supabaseAdmin.from("pov_studio_jobs").insert({
    slack_channel: args.channel,
    slack_thread_ts: args.threadTs,
    picker_msg_ts: pickerTs,
    image_url: frame.url,
    image_mimetype: frame.mimetype,
    source_kind: frame.kind,
    workflow: null,
    status: "awaiting_workflow",
  });

  // Proactively suggest 2-3 matching formats from the calendar based on what's in the frame
  // (in addition to the workflow picker). Silent no-op until the format calendar is seeded.
  waitUntil(
    suggestFormatsForFrame({
      channel: args.channel,
      threadTs: args.threadTs,
      frameUrl: frame.url,
      mimetype: frame.mimetype,
    }).catch(() => {})
  );

  return true;
}

// ---- Entry: media posted WITH a caption -------------------------------------------

/**
 * Classify a caption into a workflow. A complete 4-box script always means Render and
 * runs immediately; otherwise fall back to the registry keyword router. null = the
 * caption doesn't clearly name a workflow, so the caller should ask via the picker.
 */
export function classifyCaptionIntent(brief: string): ContentWorkflowId | null {
  const script = parseBoxes(brief);
  if (script && script.label && script.line1 && script.line2 && script.cta) return "render";
  return classifyByKeywords(brief);
}

/**
 * A media post (image OR video) WITH a caption in #content-full. If the caption names a
 * workflow, run it straight away (stating its requirements first); if it's ambiguous,
 * fall back to the picker so the operator is always asked before we do anything.
 * Returns true if handled.
 */
export async function handlePovMediaWithBrief(args: {
  channel: string;
  threadTs: string;
  files: SlackFileLike[];
  brief: string;
}): Promise<boolean> {
  const intent = classifyCaptionIntent(args.brief);

  // Ambiguous caption -> ask (the picker). Echo the caption so it isn't lost.
  if (!intent) {
    const handled = await handlePovImagePost({ channel: args.channel, threadTs: args.threadTs, files: args.files });
    if (handled && args.brief.trim()) {
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        `_Caption noted: "${args.brief.trim().slice(0, 280)}". React above to pick a workflow._`
      );
    }
    return handled;
  }

  const mediaFile = args.files.find(
    (f) => (f.mimetype ?? "").startsWith("image/") || (f.mimetype ?? "").startsWith("video/")
  );
  if (!mediaFile) return false;

  const frame = await resolveStillFrame(mediaFile);
  if (!frame) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      "⚠️ I couldn't pull a still frame from that file. Send an image (or a video with a thumbnail) and I'll run the workflow."
    );
    return true;
  }

  await slack.postThreadReply(args.channel, args.threadTs, requirementsLine(intent));

  // Render hands to the classic Studio flow (it renders immediately on a complete
  // script, else posts the 4 variation options). Build a still-image file-like so a
  // video's thumbnail works the same as an image.
  if (intent === "render") {
    const handled = await handleStudioImage({
      channel: args.channel,
      threadTs: args.threadTs,
      files: [{ mimetype: frame.mimetype, url_private: frame.url }],
      brief: args.brief,
    });
    if (!handled) {
      await slack.postThreadReply(
        args.channel,
        args.threadTs,
        "⚠️ Couldn't start the render flow for this frame. Try posting the still image directly."
      );
    }
    return true;
  }

  const img = await downloadImage(frame.url, frame.mimetype);
  if (!img) {
    await slack.postThreadReply(args.channel, args.threadTs, "⚠️ Couldn't read the image to run that workflow.");
    return true;
  }
  if (intent === "animate") await runAnimate(args.channel, args.threadTs, img);
  else if (intent === "caption") await runCaption(args.channel, args.threadTs, img);
  else await runRecreate(args.channel, args.threadTs, img);
  return true;
}

// ---- Reaction: ideas-first gate (✅ generate / 🚫 skip) ----------------------------

/**
 * The daily POV drop posts 3 scene IDEAS as text and waits. On ✅ we generate the images
 * (generatePovImagesForJob, which flips the job to awaiting_pick); on 🚫 we skip the drop.
 * Self-routes by the gate message ts; returns true only when it owns the reaction.
 */
export async function handlePovIdeasApproval(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const approve = APPROVE_REACTIONS.has(args.reaction);
  const skip = SKIP_REACTIONS.has(args.reaction);
  if (!approve && !skip) return false;

  const { data } = await supabaseAdmin
    .from("pov_studio_jobs")
    .select(JOB_COLS)
    .eq("picker_msg_ts", args.slackTs)
    .limit(1)
    .maybeSingle();
  const job = data as PovStudioJobRow | null;
  if (!job || job.status !== "awaiting_ideas_approval") return false;

  if (skip) {
    await supabaseAdmin
      .from("pov_studio_jobs")
      .update({ status: "skipped", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, "🚫 Skipped this drop. No images generated.");
    return true;
  }

  // Approve: guard against a double-tap by claiming the job first, then generate async.
  await supabaseAdmin
    .from("pov_studio_jobs")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  waitUntil(
    generatePovImagesForJob({
      id: job.id,
      slack_channel: job.slack_channel,
      slack_thread_ts: job.slack_thread_ts,
      images: job.images,
    }).catch(async (e) => {
      console.error("[pov-studio] ideas-approval generate error:", (e as Error).message);
      await supabaseAdmin
        .from("pov_studio_jobs")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      await slack.postThreadReply(
        job.slack_channel,
        job.slack_thread_ts,
        `🚫 Image generation failed (${(e as Error).message.slice(0, 160)}).`
      );
    })
  );
  return true;
}

// ---- Reaction: pick the best of the daily drop's 3 image options ------------------

/**
 * The daily POV drop posts 3 image options + a "react 1/2/3 to pick the best" message.
 * On that reaction, set the chosen image on the job and open the workflow breakdown.
 */
export async function handlePovDropPick(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const optNum = REACTION_TO_OPTION[args.reaction];
  if (!optNum) return false;

  const { data } = await supabaseAdmin
    .from("pov_studio_jobs")
    .select(JOB_COLS)
    .eq("picker_msg_ts", args.slackTs)
    .limit(1)
    .maybeSingle();
  const job = data as PovStudioJobRow | null;
  if (!job || job.status !== "awaiting_pick") return false;

  const chosen = (job.images ?? []).find((o) => o.index === optNum);
  if (!chosen) return false;

  const pickerTs = await postWorkflowBreakdown(job.slack_channel, job.slack_thread_ts, false);

  await supabaseAdmin
    .from("pov_studio_jobs")
    .update({
      image_url: chosen.url,
      image_mimetype: chosen.mimetype,
      picker_msg_ts: pickerTs,
      status: "awaiting_workflow",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, `✅ Option ${optNum} chosen.`);
  return true;
}

// ---- Reaction: run the chosen workflow --------------------------------------------

export async function handlePovWorkflowReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const workflow = REACTION_TO_WORKFLOW[args.reaction];
  if (!workflow) return false;

  const { data } = await supabaseAdmin
    .from("pov_studio_jobs")
    .select(JOB_COLS)
    .eq("picker_msg_ts", args.slackTs)
    .limit(1)
    .maybeSingle();
  const job = data as PovStudioJobRow | null;
  if (!job || job.status !== "awaiting_workflow") return false;

  await supabaseAdmin
    .from("pov_studio_jobs")
    .update({ workflow, status: "running", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  waitUntil(
    runWorkflow(job, workflow).catch(async (e) => {
      console.error("[pov-studio] workflow error:", (e as Error).message);
      await supabaseAdmin
        .from("pov_studio_jobs")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      await slack.postThreadReply(
        job.slack_channel,
        job.slack_thread_ts,
        `🚫 Workflow failed (${(e as Error).message.slice(0, 160)}).`
      );
    })
  );
  return true;
}

async function runWorkflow(job: PovStudioJobRow, workflow: PovWorkflow): Promise<void> {
  // State what this workflow needs the moment it's selected.
  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, requirementsLine(workflow));

  // Render hands off to the classic Studio flow (4 text lines -> render the frame with
  // the text + 6-sec audio). It downloads the image itself and runs its own state
  // machine (reel_studio_jobs), so we don't need the base64 here.
  if (workflow === "render") {
    await runRender(job);
    await supabaseAdmin
      .from("pov_studio_jobs")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    return;
  }

  const img = job.image_url ? await downloadImage(job.image_url, job.image_mimetype ?? undefined) : null;
  if (!img) throw new Error("could not read the source image");

  if (workflow === "animate") await runAnimate(job.slack_channel, job.slack_thread_ts, img);
  else if (workflow === "caption") await runCaption(job.slack_channel, job.slack_thread_ts, img);
  else await runRecreate(job.slack_channel, job.slack_thread_ts, img);

  await supabaseAdmin
    .from("pov_studio_jobs")
    .update({ status: "done", updated_at: new Date().toISOString() })
    .eq("id", job.id);
}

// ---- Workflow 1: render reel (classic Studio 4-line -> MP4 with 6-sec audio) -------

async function runRender(job: PovStudioJobRow): Promise<void> {
  // Reconstruct a Studio file-like from the resolved still frame (image, or a video's
  // thumbnail) and hand off. handleStudioImage posts the 4 text-line variations and
  // creates the reel_studio_jobs row; the existing handleStudioReaction (react 1-4) and
  // handleStudioReply (reply with the 4 boxes) then render the MP4 with the 6-sec audio.
  if (!job.image_url) throw new Error("no still frame to render");
  const handled = await handleStudioImage({
    channel: job.slack_channel,
    threadTs: job.slack_thread_ts,
    files: [{ mimetype: job.image_mimetype ?? "image/jpeg", url_private: job.image_url }],
    brief: "",
  });
  if (!handled) {
    await slack.postThreadReply(
      job.slack_channel,
      job.slack_thread_ts,
      "⚠️ Couldn't start the render flow for this frame. Try posting the still image directly."
    );
  }
}

// ---- Workflow 1: animate this image -----------------------------------------------

interface AnimatePackage {
  scene_read: string;
  animation_prompt: string;
  captions: { authority: string; relatable: string; curiosity: string };
  titles: string[];
}

function isAnimatePackage(v: unknown): v is AnimatePackage {
  if (typeof v !== "object" || v === null) return false;
  const p = v as AnimatePackage;
  const c = p.captions;
  return (
    typeof p.scene_read === "string" &&
    typeof p.animation_prompt === "string" &&
    typeof c === "object" && c !== null &&
    typeof c.authority === "string" && typeof c.relatable === "string" && typeof c.curiosity === "string" &&
    Array.isArray(p.titles) && p.titles.length > 0 && p.titles.every((t) => typeof t === "string")
  );
}

function buildAnimateSystem(v: Vertical): string {
  return [
    `You are the content engine for a ${v.business_descriptor}. You are shown ONE real photo`,
    "the operator wants to animate into a short reel that looks like real footage captured",
    "on Ray-Ban Meta smart glasses (a first-person personal account of the technician).",
    "",
    "GLOBAL VISUAL STYLE the clip should read as:",
    v.style_token,
    "",
    "From the photo, return:",
    "- scene_read: one line describing what is happening in the photo.",
    "- animation_prompt: motion only (head/camera movement + the hands' action), ONE sentence, that animates THIS exact photo from first frame to last frame with no cuts.",
    "- captions: exactly three — authority (calm, expert), relatable (homeowner POV, light humor), curiosity (scroll-stopping tease).",
    "- titles: exactly six on-screen headline options, lead with 'POV:' style, each 7 words or fewer; title #1 is the default.",
    "",
    "HARD RULES: never invent funding numbers/rates/terms; never use em dashes or en dashes.",
    "",
    "Match the quality and voice of these gold examples:",
    JSON.stringify(v.gold_examples, null, 2),
  ].join("\n");
}

async function runAnimate(channel: string, threadTs: string, img: ClaudeImageInput): Promise<void> {
  await slack.postThreadReply(channel, threadTs, "🎬 Reading your photo and building the animate package…");

  const vertical = await getActiveVertical();
  const { data } = await callClaudeJSON<AnimatePackage>({
    model: model(),
    system: buildAnimateSystem(vertical),
    user: "Look at the attached photo and return the animate package as JSON.",
    images: [img],
    maxTokens: 1200,
    temperature: 0.7,
    schemaHint:
      '{ "scene_read": string, "animation_prompt": string, "captions": { "authority": string, "relatable": string, "curiosity": string }, "titles": [string] }',
    validate: isAnimatePackage,
  });

  const titles = data.titles.slice(0, 6).map((t, i) => `${i + 1}. ${stripEmDashes(t)}`).join("\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `*What I see:* ${stripEmDashes(data.scene_read)}`,
      "",
      `*Animation prompt (motion only):* ${stripEmDashes(data.animation_prompt)}`,
      "",
      "*Headline options* (pick one):",
      titles,
      "",
      "*Captions*",
      `• *Authority:* ${stripEmDashes(data.captions.authority)}`,
      `• *Relatable:* ${stripEmDashes(data.captions.relatable)}`,
      `• *Curiosity:* ${stripEmDashes(data.captions.curiosity)}`,
    ].join("\n")
  );
}

// ---- Workflow: caption only (copy, no motion, no render) --------------------------

interface CaptionPackage {
  scene_read: string;
  captions: { authority: string; relatable: string; curiosity: string };
  titles: string[];
}

function isCaptionPackage(v: unknown): v is CaptionPackage {
  if (typeof v !== "object" || v === null) return false;
  const p = v as CaptionPackage;
  const c = p.captions;
  return (
    typeof p.scene_read === "string" &&
    typeof c === "object" && c !== null &&
    typeof c.authority === "string" && typeof c.relatable === "string" && typeof c.curiosity === "string" &&
    Array.isArray(p.titles) && p.titles.length > 0 && p.titles.every((t) => typeof t === "string")
  );
}

function buildCaptionSystem(v: Vertical): string {
  return [
    `You are the content engine for a ${v.business_descriptor}. You are shown ONE real photo`,
    "the operator wants copy for: on-screen headlines + captions only. No animation, no render.",
    "",
    "GLOBAL VOICE the copy should read as (first-person Ray-Ban Meta glasses POV of the technician):",
    v.style_token,
    "",
    "From the photo, return:",
    "- scene_read: one line describing what is happening in the photo.",
    "- captions: exactly three — authority (calm, expert), relatable (homeowner POV, light humor), curiosity (scroll-stopping tease).",
    "- titles: exactly six on-screen headline options, lead with 'POV:' style, each 7 words or fewer; title #1 is the default.",
    "",
    "HARD RULES: never invent funding numbers/rates/terms; never use em dashes or en dashes.",
    "",
    "Match the quality and voice of these gold examples:",
    JSON.stringify(v.gold_examples, null, 2),
  ].join("\n");
}

async function runCaption(channel: string, threadTs: string, img: ClaudeImageInput): Promise<void> {
  await slack.postThreadReply(channel, threadTs, "✍️ Writing headline options and captions…");

  const vertical = await getActiveVertical();
  const { data } = await callClaudeJSON<CaptionPackage>({
    model: model(),
    system: buildCaptionSystem(vertical),
    user: "Look at the attached photo and return the caption package as JSON.",
    images: [img],
    maxTokens: 700,
    temperature: 0.7,
    schemaHint:
      '{ "scene_read": string, "captions": { "authority": string, "relatable": string, "curiosity": string }, "titles": [string] }',
    validate: isCaptionPackage,
  });

  const titles = data.titles.slice(0, 6).map((t, i) => `${i + 1}. ${stripEmDashes(t)}`).join("\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `*What I see:* ${stripEmDashes(data.scene_read)}`,
      "",
      "*Headline options* (pick one):",
      titles,
      "",
      "*Captions*",
      `• *Authority:* ${stripEmDashes(data.captions.authority)}`,
      `• *Relatable:* ${stripEmDashes(data.captions.relatable)}`,
      `• *Curiosity:* ${stripEmDashes(data.captions.curiosity)}`,
    ].join("\n")
  );
}

// ---- Workflow 2: learn / recreate -------------------------------------------------

interface RecreatePackage {
  why_it_works: string;
  our_version: {
    idea: string;
    image_prompt: string;
    animation_prompt: string;
    captions: { authority: string; relatable: string; curiosity: string };
    titles: string[];
  };
}

function isRecreatePackage(v: unknown): v is RecreatePackage {
  if (typeof v !== "object" || v === null) return false;
  const p = v as RecreatePackage;
  const o = p.our_version;
  if (typeof p.why_it_works !== "string" || typeof o !== "object" || o === null) return false;
  const c = o.captions;
  return (
    typeof o.idea === "string" &&
    typeof o.image_prompt === "string" &&
    typeof o.animation_prompt === "string" &&
    typeof c === "object" && c !== null &&
    typeof c.authority === "string" && typeof c.relatable === "string" && typeof c.curiosity === "string" &&
    Array.isArray(o.titles) && o.titles.length > 0 && o.titles.every((t) => typeof t === "string")
  );
}

function buildRecreateSystem(v: Vertical): string {
  return [
    `You are the content engine for a ${v.business_descriptor}. The operator is showing you`,
    "OTHER creators' content they think is 'fire' and want to learn from and recreate for",
    "our brand. The input is either a single screenshot/thumbnail, OR several frames sampled",
    "across a video plus its original caption. Read all frames together as one piece.",
    "",
    `Our brand format is a first-person personal account of a ${v.wearer_role},`,
    "styled to look like real footage captured on Ray-Ban Meta smart glasses:",
    v.style_token,
    "",
    "Return:",
    "- why_it_works: 2-3 sentences breaking down the hook, format, and why it grabs attention.",
    "- our_version: a pest-control POV remake of the SAME idea, with:",
    "    idea (one line), image_prompt (a first-frame prompt in our Meta-glasses POV style, NO on-screen text),",
    "    animation_prompt (motion only, one sentence), captions (authority/relatable/curiosity),",
    "    titles (exactly six 'POV:' style on-screen options, each 7 words or fewer).",
    "",
    "HARD RULES: never invent funding numbers/rates/terms; never use em dashes or en dashes;",
    "image_prompt must contain no text overlay (text is added in post).",
    "",
    "Match the quality and voice of these gold examples:",
    JSON.stringify(v.gold_examples, null, 2),
  ].join("\n");
}

/** One Claude vision call over 1+ frames (+ optional caption) -> the recreate package. */
async function requestRecreatePackage(
  images: ClaudeImageInput[],
  captionText?: string
): Promise<RecreatePackage> {
  const userParts = [
    images.length > 1
      ? `Look at these ${images.length} frames sampled across the video and return the recreate package as JSON.`
      : "Look at the attached inspiration frame and return the recreate package as JSON.",
  ];
  if (captionText && captionText.trim()) {
    userParts.push("", "The original caption was:", captionText.trim().slice(0, 1200));
  }

  const vertical = await getActiveVertical();
  // Inject the labeled example library as extra few-shot context (empty -> behavior-neutral).
  const examples = await loadExampleFewShot(vertical.id);
  const system = examples
    ? `${buildRecreateSystem(vertical)}\n\nLABELED EXAMPLES FROM OUR LIBRARY (study their hooks, format, and difficulty):\n${examples}`
    : buildRecreateSystem(vertical);
  const { data } = await callClaudeJSON<RecreatePackage>({
    model: model(),
    system,
    user: userParts.join("\n"),
    images,
    maxTokens: 1600,
    temperature: 0.7,
    schemaHint:
      '{ "why_it_works": string, "our_version": { "idea": string, "image_prompt": string, "animation_prompt": string, "captions": { "authority": string, "relatable": string, "curiosity": string }, "titles": [string] } }',
    validate: isRecreatePackage,
  });
  return data;
}

/** Generate our recreated first frame (best-effort) and post the recreate package. */
async function postRecreate(channel: string, threadTs: string, data: RecreatePackage): Promise<void> {
  const ov = data.our_version;
  const titles = ov.titles.slice(0, 6).map((t, i) => `${i + 1}. ${stripEmDashes(t)}`).join("\n");

  let imageOk = false;
  try {
    const remake = await generatePovImage(stripEmDashes(ov.image_prompt));
    if (remake) {
      await slack.uploadFile(channel, "recreate.png", remake.buffer, remake.mimetype, threadTs);
      imageOk = true;
    }
  } catch (e) {
    if (e instanceof ImageGenPausedError) {
      await slack.postThreadReply(channel, threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}`).catch(() => {});
    } else {
      console.error("[pov-studio] recreate image gen failed:", (e as Error).message);
    }
  }

  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `*Why it works:* ${stripEmDashes(data.why_it_works)}`,
      "",
      `*Our version:* ${stripEmDashes(ov.idea)}`,
      "",
      `*Animation prompt (motion only):* ${stripEmDashes(ov.animation_prompt)}`,
      "",
      "*Headline options* (pick one):",
      titles,
      "",
      "*Captions*",
      `• *Authority:* ${stripEmDashes(ov.captions.authority)}`,
      `• *Relatable:* ${stripEmDashes(ov.captions.relatable)}`,
      `• *Curiosity:* ${stripEmDashes(ov.captions.curiosity)}`,
      "",
      imageOk ? "_Recreated first frame attached above._" : "_Image prompt to render the first frame:_",
      ...(imageOk ? [] : ["```", stripEmDashes(ov.image_prompt), "```"]),
    ].join("\n")
  );
}

async function runRecreate(channel: string, threadTs: string, img: ClaudeImageInput): Promise<void> {
  await slack.postThreadReply(channel, threadTs, "🔥 Breaking down what makes this work and building our remake…");
  const data = await requestRecreatePackage([img]);
  await postRecreate(channel, threadTs, data);
}

// ---- Instagram link -> download reel -> sample frames -> recreate -----------------

interface IgFramesResult {
  ok: boolean;
  frames?: string[];
  caption?: string;
  error?: string;
}

/** Match a public Instagram reel/post/tv URL. */
export const INSTAGRAM_URL_RE =
  /https?:\/\/(?:www\.)?instagram\.com\/(?:reel|reels|p|tv)\/[A-Za-z0-9_\-]+/i;

async function fetchIgFrames(url: string, count: number): Promise<IgFramesResult> {
  // The Python render-service extracts frames (yt-dlp + ffmpeg). Derive the endpoint
  // from REEL_RENDER_URL if IG_FRAMES_URL isn't set (same project, sibling function).
  const endpoint =
    process.env.IG_FRAMES_URL ||
    (process.env.REEL_RENDER_URL ? process.env.REEL_RENDER_URL.replace(/render-reel\/?$/, "ig-frames") : "");
  if (!endpoint) return { ok: false, error: "IG_FRAMES_URL not set" };

  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-reel-secret": process.env.REEL_RENDER_SECRET || "" },
      body: JSON.stringify({ url, count }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, error: `frames ${res.status} ${t.slice(0, 200)}` };
    }
    const j = (await res.json()) as { frames?: string[]; caption?: string; error?: string };
    if (!Array.isArray(j.frames) || j.frames.length === 0) {
      return { ok: false, error: j.error || "no frames returned" };
    }
    return { ok: true, frames: j.frames, caption: j.caption || "" };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * An Instagram link posted in #content-full: download the reel, sample frames, and run
 * the Recreate workflow (multi-frame vision + caption) on it. Posts everything in-thread.
 */
export async function handleInstagramLink(args: {
  channel: string;
  threadTs: string;
  url: string;
}): Promise<void> {
  await slack.postThreadReply(args.channel, args.threadTs, "🔎 Pulling frames from that reel and breaking it down…");

  const res = await fetchIgFrames(args.url, 5);
  if (!res.ok) {
    await slack.postThreadReply(
      args.channel,
      args.threadTs,
      [
        `⚠️ Couldn't pull that reel (${(res.error || "unknown").slice(0, 160)}).`,
        "Instagram often blocks anonymous downloads. You can screenshot a frame and drop it here, then pick *Recreate*.",
      ].join("\n")
    );
    return;
  }

  const frames = (
    await Promise.all((res.frames ?? []).map((f) => downloadImage(f, "image/jpeg")))
  ).filter((f): f is ClaudeImageInput => f !== null);

  if (frames.length === 0) {
    await slack.postThreadReply(args.channel, args.threadTs, "⚠️ Pulled the reel but couldn't read the frames. Try a screenshot + *Recreate*.");
    return;
  }

  const data = await requestRecreatePackage(frames, res.caption);
  await postRecreate(args.channel, args.threadTs, data);
}
