// #content-analyzer: read a dropped video shot-by-shot.
//
// Drop an MP4 in #content-analyzer and the bot samples frames across it, runs ONE
// Claude-vision call, and posts a shot-by-shot storyboard + "why it works" + a
// pest-control POV remake. This mirrors the Instagram-link flow in pov-studio.ts
// (handleInstagramLink -> requestRecreatePackage -> postRecreate), but the input is a
// Slack-uploaded video, so we re-upload it to the public `reels` bucket first (so the
// Python frame-sampler can fetch it without Slack auth) and hit the video-frames
// endpoint (direct URL, no yt-dlp). The Claude schema is extended with a per-shot
// storyboard.

import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { generatePovImage, uploadToReels } from "@/lib/reel/pov";
import { POV_GLASSES_TOKEN, POV_GOLD_EXAMPLES } from "@/config/pov-style";

interface AnalyzerFileLike {
  url_private_download?: string;
  mimetype?: string;
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// Fetch a frame URL to base64 for Claude vision. The frames are public Supabase URLs,
// so the Slack bearer header is harmless (ignored). Mirrors pov-studio.ts:downloadImage.
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

// ---- video-frames endpoint (render-service) ---------------------------------------

interface VideoFramesResult {
  ok: boolean;
  frames?: string[];
  duration?: number;
  error?: string;
}

/** POST the public video URL to the render-service video-frames endpoint. Mirrors
 * fetchIgFrames: derive the endpoint from REEL_RENDER_URL if VIDEO_FRAMES_URL isn't set. */
async function fetchVideoFrames(url: string, count: number): Promise<VideoFramesResult> {
  const endpoint =
    process.env.VIDEO_FRAMES_URL ||
    (process.env.REEL_RENDER_URL ? process.env.REEL_RENDER_URL.replace(/render-reel\/?$/, "video-frames") : "");
  if (!endpoint) return { ok: false, error: "VIDEO_FRAMES_URL not set" };

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
    const j = (await res.json()) as { frames?: string[]; duration?: number; error?: string };
    if (!Array.isArray(j.frames) || j.frames.length === 0) {
      return { ok: false, error: j.error || "no frames returned" };
    }
    return { ok: true, frames: j.frames, duration: j.duration };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

// ---- Claude vision: storyboard + why-it-works + pest remake ------------------------

interface VideoAnalysis {
  storyboard: Array<{ shot: number; what: string; why: string }>;
  why_it_works: string;
  our_version: {
    idea: string;
    image_prompt: string;
    animation_prompt: string;
    captions: { authority: string; relatable: string; curiosity: string };
    titles: string[];
  };
}

function isVideoAnalysis(v: unknown): v is VideoAnalysis {
  if (typeof v !== "object" || v === null) return false;
  const p = v as VideoAnalysis;
  if (typeof p.why_it_works !== "string") return false;
  if (
    !Array.isArray(p.storyboard) ||
    p.storyboard.length === 0 ||
    !p.storyboard.every(
      (s) => typeof s === "object" && s !== null && typeof s.what === "string" && typeof s.why === "string"
    )
  ) {
    return false;
  }
  const o = p.our_version;
  if (typeof o !== "object" || o === null) return false;
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

const ANALYZE_SYSTEM = [
  "You are the content engine for a pest control business. The operator dropped a video",
  "they want to learn from and recreate for our brand. The input is several frames sampled",
  "in order across that video. Read all frames together as one piece, in sequence.",
  "",
  "Our brand format is a first-person personal account of a pest control technician,",
  "styled to look like real footage captured on Ray-Ban Meta smart glasses:",
  POV_GLASSES_TOKEN,
  "",
  "Return:",
  "- storyboard: an ordered shot-by-shot read of the video. One entry per distinct shot you",
  "    can see across the frames, each with: shot (1-based number), what (what is happening",
  "    on screen, one line), why (why that shot lands / what job it does in the edit).",
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

async function requestVideoAnalysis(images: ClaudeImageInput[]): Promise<VideoAnalysis> {
  const { data } = await callClaudeJSON<VideoAnalysis>({
    model: model(),
    system: ANALYZE_SYSTEM,
    user: `Look at these ${images.length} frames sampled in order across the video and return the analysis as JSON.`,
    images,
    maxTokens: 2200,
    temperature: 0.7,
    schemaHint:
      '{ "storyboard": [ { "shot": number, "what": string, "why": string } ], "why_it_works": string, "our_version": { "idea": string, "image_prompt": string, "animation_prompt": string, "captions": { "authority": string, "relatable": string, "curiosity": string }, "titles": [string] } }',
    validate: isVideoAnalysis,
  });
  return data;
}

async function postAnalysis(channel: string, threadTs: string, data: VideoAnalysis): Promise<void> {
  // Shot-by-shot storyboard first.
  const shots = data.storyboard
    .map((s, i) => `*Shot ${s.shot ?? i + 1}.* ${stripEmDashes(s.what)}\n   _why:_ ${stripEmDashes(s.why)}`)
    .join("\n");
  await slack.postThreadReply(channel, threadTs, ["🎬 *Shot-by-shot storyboard*", "", shots].join("\n"));

  // Then the recreate package (matches the pov-studio postRecreate layout).
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
    console.error("[content-analyzer] recreate image gen failed:", (e as Error).message);
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

// ---- Entry -------------------------------------------------------------------------

/**
 * A video dropped in #content-analyzer: re-upload it to the public `reels` bucket, sample
 * frames via the render-service, and run the shot-by-shot analysis + pest remake on them.
 * Posts everything in-thread. Best-effort throughout.
 */
export async function analyzeVideo(args: {
  channel: string;
  threadTs: string;
  file: AnalyzerFileLike;
}): Promise<void> {
  const { channel, threadTs, file } = args;

  if (!file.url_private_download) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't read that video (no download URL).");
    return;
  }

  await slack.postThreadReply(channel, threadTs, "🔎 Reading your video shot-by-shot…");

  // Re-upload to the public reels bucket so the Python frame-sampler can fetch it.
  let publicUrl: string | null = null;
  try {
    const buffer = await slack.downloadFile(file.url_private_download);
    publicUrl = await uploadToReels(buffer, file.mimetype || "video/mp4");
  } catch (e) {
    console.error("[content-analyzer] video re-upload failed:", (e as Error).message);
  }
  if (!publicUrl) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't stage that video for frame sampling. Try re-dropping it.");
    return;
  }

  const res = await fetchVideoFrames(publicUrl, 8);
  if (!res.ok) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `⚠️ Couldn't sample frames from that video (${(res.error || "unknown").slice(0, 160)}).`
    );
    return;
  }

  const frames = (
    await Promise.all((res.frames ?? []).map((f) => downloadImage(f, "image/jpeg")))
  ).filter((f): f is ClaudeImageInput => f !== null);

  if (frames.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Sampled the video but couldn't read the frames.");
    return;
  }

  const data = await requestVideoAnalysis(frames);
  await postAnalysis(channel, threadTs, data);
}
