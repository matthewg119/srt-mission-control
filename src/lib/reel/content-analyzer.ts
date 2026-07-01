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
import { saveContentExample, pruneReferencesToCap } from "@/lib/reel/content-examples";
import { POV_GLASSES_TOKEN, POV_GOLD_EXAMPLES } from "@/config/pov-style";
import { insertJob, getJobByPickerTs, updateJob } from "@/lib/reel/jobs";
import { proposeWorkflowFromAnalysis } from "@/lib/reel/workflow-author";

// The avatar all #content-analyzer drops attach to for now (pest_control is the only avatar
// with a real Soul/look). Overridable via env once other avatars have looks.
const ANALYZER_VERTICAL = process.env.CONTENT_VERTICAL || "pest_control";
const REFERENCE_SECTION_CAP = 30;

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
}): Promise<{ publicUrl: string; analysis: VideoAnalysis } | null> {
  const { channel, threadTs, file } = args;

  if (!file.url_private_download) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't read that video (no download URL).");
    return null;
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
    return null;
  }

  const res = await fetchVideoFrames(publicUrl, 8);
  if (!res.ok) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `⚠️ Couldn't sample frames from that video (${(res.error || "unknown").slice(0, 160)}).`
    );
    return null;
  }

  const frames = (
    await Promise.all((res.frames ?? []).map((f) => downloadImage(f, "image/jpeg")))
  ).filter((f): f is ClaudeImageInput => f !== null);

  if (frames.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Sampled the video but couldn't read the frames.");
    return null;
  }

  const data = await requestVideoAnalysis(frames);
  await postAnalysis(channel, threadTs, data);

  // Feed the reference library: every analyzed video becomes a content_examples row so the
  // generators can read it back (loadReferenceFrames / loadExampleFewShot). The sampled frames
  // are already public reels URLs. Best-effort — a failure here never affects the Slack post.
  try {
    const storyboard = {
      hook: data.storyboard[0]?.what || data.our_version.idea,
      why_it_works: stripEmDashes(data.why_it_works),
      shots: data.storyboard.map((s, i) => ({
        t: `shot ${s.shot ?? i + 1}`,
        what: stripEmDashes(s.what),
        why: stripEmDashes(s.why),
      })),
      labels: ["reference_video"],
      difficulty: "medium",
      our_version: {
        idea: stripEmDashes(data.our_version.idea),
        image_prompt: stripEmDashes(data.our_version.image_prompt),
        animation_prompt: stripEmDashes(data.our_version.animation_prompt),
      },
    };
    await saveContentExample({
      sourcePath: publicUrl,
      storyboard,
      labels: ["reference_video"],
      difficulty: "medium",
      frameUrls: res.frames ?? [],
    });
  } catch (e) {
    console.error("[content-analyzer] saveContentExample failed:", (e as Error).message);
  }

  return { publicUrl, analysis: data };
}

// ---- Scrub-or-reference decision (asked on EVERY video drop) -----------------------
//
// Decision (2026-07-03): a dropped video is either a REFERENCE (image data for the library)
// or a WORKFLOW source (scrub into a shot-by-shot storyboard + a draft recipe). We ASK first
// via a 📚/🧪 card and route the reaction, instead of always analyzing.

/** Post the "save as reference or scrub into a workflow?" card and seed a routing job. */
export async function postVideoDecisionCard(args: {
  channel: string;
  threadTs: string;
  file: AnalyzerFileLike;
}): Promise<void> {
  const { channel, threadTs, file } = args;
  if (!file.url_private_download) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't read that video (no download URL).");
    return;
  }
  const res = await slack.postThreadReply(
    channel,
    threadTs,
    [
      "What should I do with this video?",
      "📚 = save as a *reference* for the library (image data / realistic scenarios only).",
      "🧪 = *scrub into a workflow* (shot-by-shot storyboard + a draft recipe to review).",
      "",
      "Optional: reply with a section like `pov/modern_house` or a 5-digit zip before you react.",
    ].join("\n")
  );
  const cardTs = (res as { ts?: string }).ts;
  if (!cardTs) return;
  await insertJob({
    formatId: "analyzer",
    verticalId: ANALYZER_VERTICAL,
    channel,
    threadTs,
    pickerTs: cardTs,
    stage: "scrub_or_ref",
    sourceKind: "analyzer",
    data: { video_url: file.url_private_download, video_mimetype: file.mimetype },
  });
  await slack.addReaction(channel, cardTs, "books").catch(() => {});
  await slack.addReaction(channel, cardTs, "test_tube").catch(() => {});
}

/** A thread reply on a scrub-or-ref card that sets the section (`pov/modern_house`) or zip. */
export async function handleAnalyzerThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  // The card is a thread reply, so replies to it share the same parent thread. Find the most
  // recent scrub-or-ref job in this thread by scanning the card via getJobByPickerTs is not
  // possible here (we only have the parent ts), so we match on the analyzer job for the thread.
  const t = args.text.trim();
  const sectionMatch = /^[a-z0-9_]+\/[a-z0-9_]+$/i.test(t);
  const zipMatch = /^\d{5}$/.test(t);
  if (!sectionMatch && !zipMatch) return false;
  // Best-effort: attach to the newest analyzer job in this thread.
  const { supabaseAdmin } = await import("@/lib/db");
  const { data } = await supabaseAdmin
    .from("content_jobs")
    .select("id,data")
    .eq("slack_thread_ts", args.threadTs)
    .eq("format_id", "analyzer")
    .eq("stage", "scrub_or_ref")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return false;
  const row = data as { id: string; data: Record<string, unknown> };
  const patch = sectionMatch ? { section: t } : { zip: t };
  await supabaseAdmin
    .from("content_jobs")
    .update({ data: { ...row.data, ...patch }, updated_at: new Date().toISOString() })
    .eq("id", row.id);
  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    sectionMatch ? `Section set: \`${t}\`. Now react 📚 or 🧪.` : `Zip set: ${t}. Now react 📚 or 🧪.`
  );
  return true;
}

/** Route the 📚 / 🧪 reaction on a scrub-or-ref card. Returns true when handled. */
export async function handleAnalyzerReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const job = await getJobByPickerTs(args.slackTs);
  if (!job || job.format_id !== "analyzer" || job.stage !== "scrub_or_ref") return false;

  const isRef = ["books", "open_book", "bookmark_tabs", "blue_book"].includes(args.reaction);
  const isScrub = ["test_tube", "alembic", "microscope"].includes(args.reaction);
  if (!isRef && !isScrub) return false;

  const file: AnalyzerFileLike = {
    url_private_download: job.data.video_url,
    mimetype: job.data.video_mimetype,
  };
  const threadTs = job.slack_thread_ts;
  const section = job.data.section ?? null;
  const zip = job.data.zip ?? null;

  if (!file.url_private_download) {
    await updateJob(job, { stage: "error" });
    await slack.postThreadReply(args.channel, threadTs, "⚠️ Lost the video reference. Re-drop it.");
    return true;
  }

  if (isRef) {
    await updateJob(job, { stage: "done" });
    await saveVideoReference({ channel: args.channel, threadTs, file, verticalId: job.vertical_id, section, zip });
    return true;
  }

  // Scrub -> full analysis (posts storyboard + remake + feeds library) -> draft workflow.
  await updateJob(job, { stage: "done" });
  const result = await analyzeVideo({ channel: args.channel, threadTs, file });
  if (!result) return true;
  try {
    const wf = await proposeWorkflowFromAnalysis({
      verticalId: job.vertical_id,
      name: (result.analysis.our_version.idea || "New workflow").slice(0, 60),
      category: "pov",
      subcategory: section ? section.split("/")[1] ?? null : null,
      analysis: {
        storyboard: result.analysis.storyboard,
        our_version: result.analysis.our_version,
        example_video_url: result.publicUrl,
        example_storyboard: result.analysis.storyboard,
        source_example_id: null,
      },
    });
    if (wf) {
      await slack.postThreadReply(
        args.channel,
        threadTs,
        [
          `🧪 Draft workflow created: *${wf.name}* (${wf.scenes.length} scenes, status draft).`,
          "Review it, approve the scene images, add a song, then it can render.",
          "Type `map` in #content-full to see the inventory.",
        ].join("\n")
      );
    }
  } catch (e) {
    console.error("[content-analyzer] proposeWorkflowFromAnalysis failed:", (e as Error).message);
  }
  return true;
}

/**
 * The 📚 reference path: stage the video, sample frames, and save them to the library scoped to
 * the avatar + section (enforcing the per-section cap). No remake post; this is image data only.
 */
async function saveVideoReference(args: {
  channel: string;
  threadTs: string;
  file: AnalyzerFileLike;
  verticalId: string;
  section: string | null;
  zip: string | null;
}): Promise<void> {
  const { channel, threadTs, file, verticalId, section, zip } = args;
  await slack.postThreadReply(channel, threadTs, "📚 Saving this to the reference library…");

  let publicUrl: string | null = null;
  try {
    if (!file.url_private_download) throw new Error("no download url");
    const buffer = await slack.downloadFile(file.url_private_download);
    publicUrl = await uploadToReels(buffer, file.mimetype || "video/mp4");
  } catch (e) {
    console.error("[content-analyzer] reference video staging failed:", (e as Error).message);
  }
  if (!publicUrl) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't stage that video. Try re-dropping it.");
    return;
  }

  const res = await fetchVideoFrames(publicUrl, 8);
  const frameUrls = res.ok ? res.frames ?? [] : [];
  const labels = ["reference_video", "realism_reference"];

  await saveContentExample({
    verticalId,
    sourcePath: publicUrl,
    storyboard: { hook: "reference video", labels, difficulty: "easy", shots: [] },
    labels,
    difficulty: "easy",
    frameUrls,
    section,
    zip,
  });

  let capNote = "";
  if (section) {
    const pruned = await pruneReferencesToCap(verticalId, section, REFERENCE_SECTION_CAP);
    if (pruned > 0) capNote = ` (section capped at ${REFERENCE_SECTION_CAP}, ${pruned} older moved to general)`;
  }

  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `✅ Saved to the reference library${section ? ` under \`${section}\`` : ""}${zip ? ` (zip ${zip})` : ""}.`,
      frameUrls.length ? `${frameUrls.length} frames captured for grounding.` : "Saved the clip; frame sampling was unavailable.",
      capNote,
    ]
      .filter(Boolean)
      .join("\n")
  );
}

// ---- Reference IMAGE drop (real-house photos etc.) --------------------------------

interface ImageLabel {
  what: string;
  labels: string[];
  difficulty: string;
}

function isImageLabel(v: unknown): v is ImageLabel {
  if (typeof v !== "object" || v === null) return false;
  const p = v as ImageLabel;
  return (
    typeof p.what === "string" &&
    Array.isArray(p.labels) &&
    p.labels.every((l) => typeof l === "string") &&
    typeof p.difficulty === "string"
  );
}

const IMAGE_LABEL_SYSTEM = [
  "You label a single reference photo an operator saved for a pest control content brand. The",
  "photo is a real-world reference (often a real home interior/exterior) used to keep our AI",
  "generations looking authentic and lived-in, not like clean new construction.",
  "",
  "Return JSON:",
  "- what: one line describing what the photo shows and the realism cues worth copying (age, wear,",
  "    clutter, materials, lighting).",
  "- labels: 2-5 short snake_case tags. ALWAYS include 'reference_house' when it is a real home or",
  "    room; add others like 'realism_reference', 'kitchen', 'exterior', 'clutter', 'aged' as they fit.",
  "- difficulty: always 'easy' for a still reference photo.",
  "",
  "Never use em dashes or en dashes.",
].join("\n");

/**
 * A still image dropped in #content-analyzer: stage it to the public reels bucket, label it with
 * one Claude-vision call, and save it as a single-frame content_examples row (a realism
 * reference). Posts a short confirmation in-thread. Best-effort throughout.
 */
export async function analyzeReferenceImage(args: {
  channel: string;
  threadTs: string;
  file: AnalyzerFileLike;
}): Promise<void> {
  const { channel, threadTs, file } = args;
  if (!file.url_private_download) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't read that image (no download URL).");
    return;
  }

  await slack.postThreadReply(channel, threadTs, "📎 Saving this to the reference library…");

  let publicUrl: string | null = null;
  let claudeImg: ClaudeImageInput | null = null;
  try {
    const buffer = await slack.downloadFile(file.url_private_download);
    publicUrl = await uploadToReels(buffer, file.mimetype || "image/jpeg");
    claudeImg = { media_type: (file.mimetype || "image/jpeg").split(";")[0], data: buffer.toString("base64") };
  } catch (e) {
    console.error("[content-analyzer] reference image staging failed:", (e as Error).message);
  }
  if (!publicUrl || !claudeImg) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't stage that image. Try re-dropping it.");
    return;
  }

  let label: ImageLabel = { what: "Reference photo", labels: ["reference_house"], difficulty: "easy" };
  try {
    const { data } = await callClaudeJSON<ImageLabel>({
      model: model(),
      system: IMAGE_LABEL_SYSTEM,
      user: "Label this reference photo as JSON.",
      images: [claudeImg],
      maxTokens: 400,
      temperature: 0.3,
      schemaHint: '{ "what": string, "labels": [string], "difficulty": string }',
      validate: isImageLabel,
    });
    const labels = Array.from(new Set(["reference_house", ...data.labels.map((l) => l.trim()).filter(Boolean)]));
    label = { what: stripEmDashes(data.what), labels, difficulty: "easy" };
  } catch (e) {
    console.error("[content-analyzer] reference image labeling failed, using defaults:", (e as Error).message);
  }

  await saveContentExample({
    sourcePath: publicUrl,
    storyboard: { hook: label.what, labels: label.labels, difficulty: label.difficulty, shots: [] },
    labels: label.labels,
    difficulty: label.difficulty,
    frameUrls: [publicUrl],
  });

  await slack.postThreadReply(
    channel,
    threadTs,
    [`✅ Saved to the reference library.`, `_${label.what}_`, `Tags: ${label.labels.join(", ")}`].join("\n")
  );
}
