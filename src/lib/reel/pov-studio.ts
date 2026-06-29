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
import { generatePovImage } from "@/lib/reel/pov";
import { handleStudioImage } from "@/lib/reel/studio";
import { POV_GLASSES_TOKEN, POV_GOLD_EXAMPLES } from "@/config/pov-style";

interface SlackFileLike {
  id?: string;
  mimetype?: string;
  url_private?: string;
  url_private_download?: string;
}

type PovWorkflow = "render" | "animate" | "recreate";

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
  status: "awaiting_pick" | "awaiting_workflow" | "running" | "done" | "error";
}

const JOB_COLS =
  "id,slack_channel,slack_thread_ts,picker_msg_ts,image_url,image_mimetype,source_kind,images,workflow,status";

// Picker reactions -> workflow (Render is #1).
const REACTION_TO_WORKFLOW: Record<string, PovWorkflow> = {
  one: "render",
  two: "animate",
  three: "recreate",
};

// Image-pick reactions (daily drop "pick the best of 3") -> 1-based option number.
const REACTION_TO_OPTION: Record<string, number> = { one: 1, two: 2, three: 3 };

/** Post the 3-workflow breakdown and return its message ts (the reaction target). */
async function postWorkflowBreakdown(channel: string, threadTs: string, fromVideo: boolean): Promise<string | null> {
  const videoNote = fromVideo ? " _(read from a frame of your video)_" : "";
  const res = (await slack.postThreadReply(
    channel,
    threadTs,
    [
      `🧠 *What should I do with this?*${videoNote} React to pick a workflow:`,
      "",
      "1️⃣  *Render Reel* — I'll write 4 on-screen text lines (label, hook, payoff, cta). Pick or edit them and I render this frame with the text + our 6-second audio into a finished reel.",
      "2️⃣  *Animate* — I'll give you an animation prompt, a few headline options, and captions to turn this still into a moving clip.",
      "3️⃣  *Recreate* — treat this as fire inspiration; I'll break down why it works and rebuild it as our pest-control POV with a fresh first frame.",
    ].join("\n")
  )) as { ts?: string };
  return res?.ts ?? null;
}

// Resolve any posted file to a still-image URL Claude/render can use: a real image's
// url_private, or a video's poster thumbnail (via files.info). Returns null if neither.
async function resolveStillFrame(
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

  if (workflow === "animate") await runAnimate(job, img);
  else await runRecreate(job, img);

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

const ANIMATE_SYSTEM = [
  "You are the content engine for a pest control business. You are shown ONE real photo",
  "the operator wants to animate into a short reel that looks like real footage captured",
  "on Ray-Ban Meta smart glasses (a first-person personal account of the technician).",
  "",
  "GLOBAL VISUAL STYLE the clip should read as:",
  POV_GLASSES_TOKEN,
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
  JSON.stringify(POV_GOLD_EXAMPLES, null, 2),
].join("\n");

async function runAnimate(job: PovStudioJobRow, img: ClaudeImageInput): Promise<void> {
  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, "🎬 Reading your photo and building the animate package…");

  const { data } = await callClaudeJSON<AnimatePackage>({
    model: model(),
    system: ANIMATE_SYSTEM,
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
    job.slack_channel,
    job.slack_thread_ts,
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

const RECREATE_SYSTEM = [
  "You are the content engine for a pest control business. The operator is showing you",
  "OTHER creators' content they think is 'fire' and want to learn from and recreate for",
  "our brand. The input is either a single screenshot/thumbnail, OR several frames sampled",
  "across a video plus its original caption. Read all frames together as one piece.",
  "",
  "Our brand format is a first-person personal account of a pest control technician,",
  "styled to look like real footage captured on Ray-Ban Meta smart glasses:",
  POV_GLASSES_TOKEN,
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
  JSON.stringify(POV_GOLD_EXAMPLES, null, 2),
].join("\n");

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

  const { data } = await callClaudeJSON<RecreatePackage>({
    model: model(),
    system: RECREATE_SYSTEM,
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
    console.error("[pov-studio] recreate image gen failed:", (e as Error).message);
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

async function runRecreate(job: PovStudioJobRow, img: ClaudeImageInput): Promise<void> {
  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, "🔥 Breaking down what makes this work and building our remake…");
  const data = await requestRecreatePackage([img]);
  await postRecreate(job.slack_channel, job.slack_thread_ts, data);
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
