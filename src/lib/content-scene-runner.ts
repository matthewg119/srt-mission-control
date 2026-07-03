import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { generateImage } from "@/lib/elevenlabs-media";
import { generatePovImage, uploadToReels } from "@/lib/reel/pov";
import { ImageGenPausedError, IMAGE_GEN_PAUSED_NOTE } from "@/lib/providers/image-gen";
import { getMotionAdapter } from "@/lib/reel/motion-adapter";
import { stitchClipsRemote } from "@/lib/reel/auto-reel";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import type { HookOption } from "@/lib/content-types";

interface Slide {
  n: number;
  duration_seconds?: number;
  role?: string;
  image_prompt: string;
  animation_prompt?: string;
  cut_style?: string;
}

interface PackageJson {
  concept_summary?: string;
  target_persona?: string;
  slides: Slide[];
  voiceover_script?: Array<{ t: string; emotion: string; line: string }>;
  assembly_timeline_markdown?: string;
  music?: { mood?: string; elevenlabs_prompt?: string; sfx?: string[] | string };
  // Multi-shot POV reel fields (additive; live in jsonb, no migration):
  shot_count?: number;        // how many shots to assemble (overrides slides.length)
  format_scene?: string;      // a single POV task to decompose into shot_count sub-shots
  scene?: string;             // alias for format_scene
  format_hook?: string;       // shot 1's open-loop hook, persisted after decomposition
}

// Entry point after hook selection. Applies the chosen hook to slides 1+2,
// seeds all content_scenes rows, then generates slides 1-3 in parallel.
export async function startSlideGenerationWithHook(
  pkgId: string,
  packageJson: PackageJson,
  selectedHook: HookOption | null,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] startSlideGenerationWithHook pkg=${pkgId} hook=${selectedHook?.name ?? "none"}`);

  const slides = packageJson.slides ?? [];

  // Apply selected hook overrides to slides 1 and 2 before seeding
  const overrides: Record<number, { image_prompt?: string }> = {};
  if (selectedHook) {
    overrides[1] = { image_prompt: selectedHook.slide1_image_prompt };
    overrides[2] = { image_prompt: selectedHook.slide2_image_prompt };
  }

  const rows = slides.map((slide) => ({
    content_package_id: pkgId,
    slide_number: slide.n,
    image_prompt: overrides[slide.n]?.image_prompt ?? slide.image_prompt,
    animation_prompt: slide.animation_prompt ?? "",
    duration_seconds: slide.duration_seconds ?? 2,
  }));

  const { error } = await supabaseAdmin
    .from("content_scenes")
    .upsert(rows, { onConflict: "content_package_id,slide_number" });

  if (error) {
    console.error("[scene-runner] seed scenes error:", error.message);
    await slack.postThreadReply(channel, threadTs, `⚠️ Failed to seed scenes: ${error.message}`);
    return;
  }

  // Generate slides 1, 2, 3 simultaneously
  await Promise.all([
    generateAndPostImage(pkgId, 1, channel, threadTs),
    generateAndPostImage(pkgId, 2, channel, threadTs),
    generateAndPostImage(pkgId, 3, channel, threadTs),
  ]);
}

// Legacy entry point (no hook) — kept for backward compatibility with any non-full-channel flow.
export async function startSlideGeneration(
  pkgId: string,
  packageJson: PackageJson,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] startSlideGeneration pkg=${pkgId} slides=${packageJson.slides.length}`);

  const rows = packageJson.slides.map((slide) => ({
    content_package_id: pkgId,
    slide_number: slide.n,
    image_prompt: slide.image_prompt,
    animation_prompt: slide.animation_prompt ?? "",
    duration_seconds: slide.duration_seconds ?? 2,
  }));

  const { error } = await supabaseAdmin
    .from("content_scenes")
    .upsert(rows, { onConflict: "content_package_id,slide_number" });

  if (error) {
    console.error("[scene-runner] seed scenes error:", error.message);
    await slack.postThreadReply(channel, threadTs, `⚠️ Failed to seed scenes: ${error.message}`);
    return;
  }

  await generateAndPostImage(pkgId, 1, channel, threadTs);
}

// Generate Slide N image via ElevenLabs, post to Slack with approval prompt,
// and save the message ts to content_scenes.slack_image_ts for reaction mapping.
export async function generateAndPostImage(
  pkgId: string,
  slideNumber: number,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] generateAndPostImage pkg=${pkgId} slide=${slideNumber}`);

  const { data: scene } = await supabaseAdmin
    .from("content_scenes")
    .select("id, image_prompt, role")
    .eq("content_package_id", pkgId)
    .eq("slide_number", slideNumber)
    .maybeSingle();

  if (!scene) {
    await slack.postThreadReply(channel, threadTs, `⚠️ Scene ${slideNumber} not found.`);
    return;
  }

  const total = await getSlideCount(pkgId);
  let imageUrl: string;

  try {
    imageUrl = await generateImage(scene.image_prompt as string);
    console.log(`[scene-runner] slide ${slideNumber} image generated`);
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[scene-runner] slide ${slideNumber} image error:`, errMsg);
    await supabaseAdmin
      .from("content_scenes")
      .update({ image_error: errMsg })
      .eq("id", scene.id);
    await slack.postThreadReply(
      channel,
      threadTs,
      `⚠️ Slide ${slideNumber} image generation failed. React 🔄 to retry.\n_${errMsg.slice(0, 200)}_`
    );
    return;
  }

  // Build blocks: image inline (if proper URL) + approval prompt
  const isDataUrl = imageUrl.startsWith("data:");
  const blocks = isDataUrl
    ? [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🖼️ *Slide ${slideNumber}/${total}* — image ready (base64)\nReact ✅ to approve and generate the clip, or 🔄 to regenerate.`,
          },
        },
      ]
    : [
        {
          type: "image",
          image_url: imageUrl,
          alt_text: `Slide ${slideNumber} — ${(scene.role as string) ?? "scene"}`,
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `🖼️ *Slide ${slideNumber}/${total} image ready.* React ✅ to approve and generate the clip, or 🔄 to regenerate.`,
          },
        },
      ];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const res = await slack.postThreadReply(channel, threadTs, `Slide ${slideNumber} image`, blocks as any);
  const messageTs = res.ts as string | undefined;

  if (!messageTs) {
    console.error("[scene-runner] Slack postThreadReply returned no ts for image");
  }

  await supabaseAdmin
    .from("content_scenes")
    .update({ image_url: imageUrl, slack_image_ts: messageTs ?? null, image_error: null })
    .eq("id", scene.id);

  console.log(`[scene-runner] slide ${slideNumber} image posted ts=${messageTs}`);
}

// Mark image approved and kick off video generation via the video-poller route.
export async function approveImageAndStartVideo(
  sceneId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  const { data: scene } = await supabaseAdmin
    .from("content_scenes")
    .select("id, content_package_id, slide_number, image_url, animation_prompt")
    .eq("id", sceneId)
    .maybeSingle();

  if (!scene?.image_url) {
    await slack.postThreadReply(channel, threadTs, `⚠️ Scene not found or image missing.`);
    return;
  }

  console.log(`[scene-runner] approveImage scene=${sceneId} slide=${scene.slide_number}`);

  await supabaseAdmin
    .from("content_scenes")
    .update({ image_approved: true })
    .eq("id", sceneId);

  await slack.postThreadReply(channel, threadTs, `✅ Slide ${scene.slide_number} image approved — generating clip…`);

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  void fetch(`${siteUrl}/api/agent/video-poller`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene_id: sceneId,
      package_id: scene.content_package_id,
      slide_number: scene.slide_number,
      animation_prompt: scene.animation_prompt,
      image_url: scene.image_url,
      channel,
      thread_ts: threadTs,
    }),
  }).catch((e) => console.error("[scene-runner] video-poller kickoff failed:", (e as Error).message));
}

// Mark video approved. If more slides remain, generate next image; otherwise post guide + captions.
export async function approveVideoAndAdvance(
  sceneId: string,
  pkgId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  const { data: scene } = await supabaseAdmin
    .from("content_scenes")
    .select("id, slide_number")
    .eq("id", sceneId)
    .maybeSingle();

  if (!scene) {
    await slack.postThreadReply(channel, threadTs, `⚠️ Scene not found.`);
    return;
  }

  console.log(`[scene-runner] approveVideo scene=${sceneId} slide=${scene.slide_number}`);

  await supabaseAdmin
    .from("content_scenes")
    .update({ video_approved: true })
    .eq("id", sceneId);

  const total = await getSlideCount(pkgId);

  if ((scene.slide_number as number) < total) {
    const next = (scene.slide_number as number) + 1;

    // Check if next slide already has an image (pre-generated in the first-3 batch)
    const { data: nextScene } = await supabaseAdmin
      .from("content_scenes")
      .select("id, image_url, slack_image_ts")
      .eq("content_package_id", pkgId)
      .eq("slide_number", next)
      .maybeSingle();

    if (nextScene?.slack_image_ts) {
      // Image already posted — just confirm to the user
      await slack.postThreadReply(
        channel,
        threadTs,
        `✅ Slide ${scene.slide_number} clip approved — Slide ${next} image already ready above, react ✅ to approve it.`
      );
    } else {
      await slack.postThreadReply(
        channel,
        threadTs,
        `✅ Slide ${scene.slide_number} clip approved — generating Slide ${next} image…`
      );
      await generateAndPostImage(pkgId, next, channel, threadTs);
    }
  } else {
    await postAssemblyGuideAndCaptions(pkgId, channel, threadTs);
  }
}

// Regenerate the image for a scene (resets the whole image+video chain for that slide).
export async function regenerateImage(
  sceneId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  const { data: scene } = await supabaseAdmin
    .from("content_scenes")
    .select("id, content_package_id, slide_number")
    .eq("id", sceneId)
    .maybeSingle();

  if (!scene) return;

  console.log(`[scene-runner] regenerateImage scene=${sceneId} slide=${scene.slide_number}`);

  await supabaseAdmin
    .from("content_scenes")
    .update({
      image_url: null, slack_image_ts: null, image_approved: false, image_error: null,
      video_job_id: null, video_url: null, slack_video_ts: null, video_approved: false, video_error: null,
    })
    .eq("id", sceneId);

  await slack.postThreadReply(channel, threadTs, `🔄 Regenerating Slide ${scene.slide_number} image…`);
  await generateAndPostImage(scene.content_package_id as string, scene.slide_number as number, channel, threadTs);
}

// Regenerate only the video clip for a scene (keeps the approved image).
export async function regenerateVideo(
  sceneId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  const { data: scene } = await supabaseAdmin
    .from("content_scenes")
    .select("id, content_package_id, slide_number, image_url, animation_prompt")
    .eq("id", sceneId)
    .maybeSingle();

  if (!scene?.image_url) {
    await slack.postThreadReply(channel, threadTs, `⚠️ Cannot regenerate clip — image not found.`);
    return;
  }

  console.log(`[scene-runner] regenerateVideo scene=${sceneId} slide=${scene.slide_number}`);

  await supabaseAdmin
    .from("content_scenes")
    .update({ video_job_id: null, video_url: null, slack_video_ts: null, video_approved: false, video_error: null })
    .eq("id", sceneId);

  await slack.postThreadReply(channel, threadTs, `🔄 Regenerating Slide ${scene.slide_number} clip…`);

  const siteUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  void fetch(`${siteUrl}/api/agent/video-poller`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scene_id: sceneId,
      package_id: scene.content_package_id,
      slide_number: scene.slide_number,
      animation_prompt: scene.animation_prompt,
      image_url: scene.image_url,
      channel,
      thread_ts: threadTs,
    }),
  }).catch((e) => console.error("[scene-runner] video-poller regen failed:", (e as Error).message));
}

async function postAssemblyGuideAndCaptions(
  pkgId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, package_json")
    .eq("id", pkgId)
    .maybeSingle();

  if (!pkg) return;

  const pj = pkg.package_json as PackageJson;
  const slides = pj.slides ?? [];
  const music = pj.music ?? {};
  const sfxList = Array.isArray(music.sfx) ? music.sfx.join(", ") : (music.sfx ?? "none");

  const importOrder = slides
    .map((s) => `${s.n}. ${s.role ?? `Slide ${s.n}`} (${s.duration_seconds ?? 2}s) — cut: ${s.cut_style ?? "hard cut"}`)
    .join("\n");

  const guide = [
    `🎞️ *CapCut Assembly Guide*`,
    ``,
    `*Import clips in order:*`,
    importOrder,
    ``,
    `*Voiceover:*`,
    `Drop your voice note in this thread — Sofia's voice will be applied automatically. Or paste the VO script into ElevenLabs directly.`,
    ``,
    `*Captions:*`,
    `Auto-caption ON · Bold white · Black stroke · Size XL`,
    ``,
    `*Music / SFX:*`,
    `Mood: ${music.mood ?? "not specified"}`,
    `SFX: ${sfxList}`,
    ``,
    `*Watermark:*`,
    `SRT Agency logo · Bottom left · 60% opacity`,
    ``,
    `*Export:*`,
    `1080×1920 · 30fps · H.264`,
    ``,
    `React ✅ when exported and ready to post.`,
  ].join("\n");

  await slack.postThreadReply(channel, threadTs, guide);
  await slack.postThreadReply(channel, threadTs, await buildCaptions(pj));

  await supabaseAdmin
    .from("content_packages")
    .update({ assembly_guide_posted: true, status: "rendered" })
    .eq("id", pkgId);

  console.log(`[scene-runner] assembly guide + captions posted pkg=${pkgId}`);
}

async function buildCaptions(pj: PackageJson): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const voScript = Array.isArray(pj.voiceover_script)
    ? pj.voiceover_script.map((l) => `${l.t} [${l.emotion}]: ${l.line}`).join("\n")
    : "";

  const msg = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: `You are a social media copywriter for SRT Agency, a business funding broker.

Generate 3 Instagram Reels captions for this video.

Concept: ${pj.concept_summary ?? "MCA funding success story"}
Target: ${pj.target_persona ?? "small business owners"}
Voiceover:
${voScript}

Write EXACTLY these 3 captions labeled as shown. Plain text only, no markdown:

1️⃣ STORY (150-200 words) — emotional merchant POV, first-person, shows the problem then SRT solution then outcome
2️⃣ AUTHORITY (100-150 words) — broker expertise + specific stats/numbers, positions SRT as the expert
3️⃣ CURIOSITY (under 100 words) — open loop, teaser, ends exactly with: Comment FUND below`,
      },
    ],
  });

  const text = ((msg.content[0] as { type: string; text: string }).text ?? "").trim();
  return `📝 *Pick your caption:*\n\n${text}`;
}

// Lookup helpers used by the Slack events handler to map reaction ts → scene record.
export async function getSceneByImageTs(imageTs: string) {
  const { data } = await supabaseAdmin
    .from("content_scenes")
    .select("id, content_package_id, slide_number, image_url, animation_prompt, image_approved")
    .eq("slack_image_ts", imageTs)
    .maybeSingle();
  return data;
}

export async function getSceneByVideoTs(videoTs: string) {
  const { data } = await supabaseAdmin
    .from("content_scenes")
    .select("id, content_package_id, slide_number, video_approved")
    .eq("slack_video_ts", videoTs)
    .maybeSingle();
  return data;
}

async function getSlideCount(pkgId: string): Promise<number> {
  const { count } = await supabaseAdmin
    .from("content_scenes")
    .select("id", { count: "exact", head: true })
    .eq("content_package_id", pkgId);
  return count ?? 0;
}

// ─── 2-Stage Pipeline ─────────────────────────────────────────────────────────

// Shot 1 is always the open-loop "wtf" pattern-interrupt hook; the rest are
// numbered angles/b-roll of the same task.
function getShotLabel(slideNumber: number): string {
  return slideNumber === 1 ? "Shot 1, Hook" : `Shot ${slideNumber}`;
}

// ─── POV shot decomposition ───────────────────────────────────────────────────
// One Claude call turns a single POV task ("spray a wasp nest") into shot_count
// distinct shots of that SAME task (varied angle / framing / b-roll) so the reel
// looks like real footage. Shot 1 is ALWAYS an open-loop pattern-interrupt hook.

interface ShotPlan {
  image_prompt: string;
  animation_prompt: string;
  role?: string;
}

interface DecomposeResult {
  hook: string;
  shots: ShotPlan[];
}

function isDecomposeResult(v: unknown): v is DecomposeResult {
  if (typeof v !== "object" || v === null) return false;
  const d = v as DecomposeResult;
  return (
    typeof d.hook === "string" &&
    Array.isArray(d.shots) &&
    d.shots.length > 0 &&
    d.shots.every(
      (s) =>
        s &&
        typeof s.image_prompt === "string" &&
        typeof s.animation_prompt === "string"
    )
  );
}

function decomposeModel(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

const DECOMPOSE_SYSTEM = [
  "You are the shot planner for a pest control business's short-form POV reels.",
  "Each reel is first-person footage styled like real Ray-Ban Meta smart glasses:",
  "the wearer is the pest control technician, so we only ever see their own gloved",
  "hands and forearms in the lower frame performing the task. No faces.",
  "",
  "You receive ONE task and break it into a sequence of distinct shots of the SAME",
  "task, each from a different angle / framing / piece of b-roll, so the final",
  "stitched reel looks like real, varied footage of one continuous job.",
  "",
  "HARD RULES:",
  "- Shot 1 MUST be an open-loop pattern-interrupt: a 'wtf' first frame that stops the",
  "  scroll and makes the viewer need to watch to understand what is happening.",
  "- 'hook' = one short sentence describing that open-loop first shot.",
  "- Every shot is ONE continuous first-person POV shot; image_prompt contains NO",
  "  on-screen text (text is added later in post).",
  "- animation_prompt = motion only (head/camera movement + the hands' action), ONE sentence.",
  "- 'role' = a 2 to 4 word label for the shot (e.g. 'extreme close-up', 'wide reveal').",
  "- Keep the same technician, same location, same task across every shot.",
  "- Never invent funding numbers, rates, terms, or guarantees.",
  "- Never use em dashes or en dashes. Use commas, periods, or hyphens.",
].join("\n");

/**
 * Decompose one POV task into exactly `shotCount` sub-shots. Returns the open-loop
 * hook (shot 1) plus the shot list. Pads by repeating the last shot if Claude
 * returns fewer than requested.
 */
async function decomposePovScene(scene: string, shotCount: number): Promise<DecomposeResult> {
  const schemaHint =
    '{ "hook": string, "shots": [{ "image_prompt": string, "animation_prompt": string, "role": string }] }';

  const user = [
    `POV task: ${scene || "a pest control technician performing a routine job"}`,
    "",
    `Return EXACTLY ${shotCount} shots of this one task. Shot 1 is the open-loop hook.`,
  ].join("\n");

  const { data } = await callClaudeJSON<DecomposeResult>({
    model: decomposeModel(),
    system: DECOMPOSE_SYSTEM,
    user,
    maxTokens: 4000,
    temperature: 0.7,
    schemaHint,
    validate: isDecomposeResult,
  });

  const clean = (s: string) => stripEmDashes(s);
  const shots: ShotPlan[] = data.shots.slice(0, shotCount).map((s) => ({
    image_prompt: clean(s.image_prompt),
    animation_prompt: clean(s.animation_prompt),
    role: s.role ? clean(s.role) : undefined,
  }));

  // Pad to the requested count by repeating the last valid shot (defensive).
  while (shots.length < shotCount && shots.length > 0) {
    shots.push({ ...shots[shots.length - 1] });
  }

  return { hook: clean(data.hook), shots };
}

// Stage 1: Generate `shot_count` POV still images, upload as Slack files, post a
// single approval gate message. Set package status to 'stills_pending'.
// Does NOT kick off video. Triggered by "generate this [N]" in the thread.
//
// Shot list source (in priority order):
//   1. An already-seeded content_scenes set (idempotent re-runs reuse it).
//   2. package_json.slides[] when it already has >= shot_count entries (decoder flow).
//   3. Otherwise a Claude decomposition of a single POV task into shot_count sub-shots,
//      where shot 1 is the open-loop hook (stored back as package_json.format_hook).
export async function startStillsGeneration(
  pkgId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] startStillsGeneration pkg=${pkgId}`);

  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, brief, package_json")
    .eq("id", pkgId)
    .maybeSingle();

  if (!pkg) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Package not found.");
    return;
  }

  const pj = (pkg.package_json ?? {}) as PackageJson;
  const slides = pj.slides ?? [];

  const shotCount =
    Number.isInteger(pj.shot_count) && (pj.shot_count as number) > 0
      ? (pj.shot_count as number)
      : slides.length > 0
        ? slides.length
        : 11;

  // Seed content_scenes rows if not already seeded.
  const { count: existing } = await supabaseAdmin
    .from("content_scenes")
    .select("id", { count: "exact", head: true })
    .eq("content_package_id", pkgId);

  if (!existing || existing === 0) {
    let rows: Array<{
      content_package_id: string;
      slide_number: number;
      image_prompt: string;
      animation_prompt: string;
      duration_seconds: number;
    }>;

    if (slides.length >= shotCount) {
      // Decoder / manual flow: the package already carries enough shots.
      rows = slides.slice(0, shotCount).map((slide) => ({
        content_package_id: pkgId,
        slide_number: slide.n,
        image_prompt: slide.image_prompt,
        animation_prompt: slide.animation_prompt ?? "",
        duration_seconds: slide.duration_seconds ?? 2,
      }));
    } else {
      // POV flow: decompose one task into shot_count varied sub-shots.
      const sceneText =
        pj.format_scene ?? pj.scene ?? pj.concept_summary ?? (pkg.brief as string | null) ?? "";
      await slack.postThreadReply(
        channel,
        threadTs,
        `🧠 Planning ${shotCount} POV shots (shot 1 = open-loop hook)…`
      );
      let decomposed: DecomposeResult;
      try {
        decomposed = await decomposePovScene(sceneText, shotCount);
      } catch (err) {
        await slack.postThreadReply(
          channel,
          threadTs,
          `⚠️ Shot planning failed: ${(err as Error).message.slice(0, 200)}`
        );
        return;
      }

      rows = decomposed.shots.map((shot, i) => ({
        content_package_id: pkgId,
        slide_number: i + 1,
        image_prompt: shot.image_prompt,
        animation_prompt: shot.animation_prompt,
        duration_seconds: 2,
      }));

      // Persist the open-loop hook on the package (additive jsonb update).
      await supabaseAdmin
        .from("content_packages")
        .update({ package_json: { ...pj, format_hook: decomposed.hook } })
        .eq("id", pkgId);
    }

    await supabaseAdmin
      .from("content_scenes")
      .upsert(rows, { onConflict: "content_package_id,slide_number" });
  }

  // Load the seeded shot numbers so generation count is driven by the scenes.
  const { data: scenes } = await supabaseAdmin
    .from("content_scenes")
    .select("slide_number")
    .eq("content_package_id", pkgId)
    .order("slide_number");

  const shotNumbers = (scenes ?? []).map((s) => s.slide_number as number);
  if (shotNumbers.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ No shots to generate.");
    return;
  }

  await slack.postThreadReply(
    channel,
    threadTs,
    `🎨 Generating ${shotNumbers.length} POV stills (same task, varied angles)…`
  );

  const results = await Promise.allSettled(
    shotNumbers.map((n) => generateAndPostStill(pkgId, n, channel, threadTs))
  );

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed === shotNumbers.length) {
    await slack.postThreadReply(channel, threadTs, "⚠️ All stills failed — check image provider config.");
    return;
  }

  // Post the approval gate message and save its ts to hooks_message_ts so
  // a ✅ reaction on it can be detected by handleContentReaction.
  const gateText = [
    `🖼️ *${shotNumbers.length} stills generated${failed ? ` (${failed} failed)` : ""}.* Shot 1 is the open-loop hook. Review above.`,
    `React ✅ on this message *or* reply \`animate\` to animate all shots + stitch the final video.`,
    `React 🔄 on this message to regenerate all stills.`,
  ].join("\n");

  const gateRes = await slack.postThreadReply(channel, threadTs, gateText);
  const gateTs = (gateRes as Record<string, unknown>).ts as string | undefined;

  await supabaseAdmin
    .from("content_packages")
    .update({ status: "stills_pending", hooks_message_ts: gateTs ?? null })
    .eq("id", pkgId);

  console.log(`[scene-runner] stills gate posted pkg=${pkgId} ts=${gateTs} shots=${shotNumbers.length}`);
}

// Generates one POV still via the POV image path (generatePovImage — Soul only if
// POV_IMAGE_PROVIDER=higgsfield, otherwise gpt-image-2/Seedream; no character
// consistency is required for first-person POV). Uploads it to the Slack thread as
// a file AND to the `reels` bucket so Stage 2 has a fetchable image_url.
async function generateAndPostStill(
  pkgId: string,
  slideNumber: number,
  channel: string,
  threadTs: string
): Promise<void> {
  const { data: scene } = await supabaseAdmin
    .from("content_scenes")
    .select("id, image_prompt")
    .eq("content_package_id", pkgId)
    .eq("slide_number", slideNumber)
    .maybeSingle();

  if (!scene) {
    await slack.postThreadReply(channel, threadTs, `⚠️ Scene ${slideNumber} not found.`);
    return;
  }

  const label = getShotLabel(slideNumber);

  let img: { buffer: Buffer; mimetype: string; sourceUrl?: string } | null;
  try {
    img = await generatePovImage(scene.image_prompt as string);
  } catch (err) {
    if (err instanceof ImageGenPausedError) {
      await slack.postThreadReply(channel, threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}`).catch(() => {});
      return;
    }
    img = null;
    console.error(`[scene-runner] still ${slideNumber} threw:`, (err as Error).message);
  }

  if (!img) {
    const errMsg = "image generation returned no image";
    await supabaseAdmin.from("content_scenes").update({ image_error: errMsg }).eq("id", scene.id);
    await slack.postThreadReply(channel, threadTs, `⚠️ *${label}* failed.\n_${errMsg}_`);
    return;
  }

  console.log(`[scene-runner] still ${slideNumber} generated (POV provider)`);

  // Stable public URL for the motion step (gpt-image-2 returns no URL of its own).
  const reelsUrl = await uploadToReels(img.buffer, img.mimetype);
  const imageUrl = reelsUrl ?? img.sourceUrl ?? null;

  // Upload as a Slack file so the operator can review each shot.
  try {
    await slack.uploadFile(channel, `${label}.png`, img.buffer, img.mimetype, threadTs);
  } catch (err) {
    console.error(`[scene-runner] still ${slideNumber} Slack upload failed:`, (err as Error).message);
    if (imageUrl) {
      await slack.postThreadReply(channel, threadTs, `🖼️ *${label}*`, [
        { type: "image", image_url: imageUrl, alt_text: label },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any);
    }
  }

  await supabaseAdmin
    .from("content_scenes")
    .update({ image_url: imageUrl, image_error: null })
    .eq("id", scene.id);

  console.log(`[scene-runner] still ${slideNumber} posted to Slack (image_url=${imageUrl ? "set" : "none"})`);
}

// Regenerate the stills (used when 🔄 is reacted to the stills gate).
// Resets ALL stills and restarts Stage 1.
export async function regenerateAllStills(
  pkgId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] regenerateAllStills pkg=${pkgId}`);

  // Clear image data for all scenes in this package
  await supabaseAdmin
    .from("content_scenes")
    .update({ image_url: null, image_error: null, slack_image_ts: null })
    .eq("content_package_id", pkgId);

  await slack.postThreadReply(channel, threadTs, "🔄 Regenerating all stills…");
  await startStillsGeneration(pkgId, channel, threadTs);
}

// Stage 2: Animate all scenes with ElevenLabs Seedance, stitch the clips with
// ffmpeg, and post the final MP4 to the Slack thread.
// Triggered by "animate" text reply OR ✅ on the stills gate message.
export async function animateAndStitch(
  pkgId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] animateAndStitch pkg=${pkgId}`);

  await supabaseAdmin
    .from("content_packages")
    .update({ status: "animating" })
    .eq("id", pkgId);

  const { data: scenes } = await supabaseAdmin
    .from("content_scenes")
    .select("id, slide_number, image_url, animation_prompt")
    .eq("content_package_id", pkgId)
    .not("image_url", "is", null)
    .order("slide_number");

  if (!scenes || scenes.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ No stills found — run Stage 1 first (generate this).");
    return;
  }

  const motion = getMotionAdapter();

  await slack.postThreadReply(
    channel, threadTs,
    `🎬 Animating ${scenes.length} shots… (running in parallel)`
  );

  // Animate all clips in parallel; collect MP4 buffers in slide order
  const clipBuffers = await Promise.all(
    scenes.map(async (scene) => {
      const label = getShotLabel(scene.slide_number as number);
      try {
        console.log(`[scene-runner] animating ${label}`);
        const buffer = await motion.animate(
          scene.image_url as string,
          (scene.animation_prompt as string) || ""
        );

        // Upload individual clip so the user can see each shot
        await slack.uploadFile(channel, `${label}.mp4`, buffer, "video/mp4", threadTs);

        // Persist a durable URL for the clip (adapter returns bytes, not a URL).
        const videoUrl = await uploadToReels(buffer, "video/mp4");
        await supabaseAdmin
          .from("content_scenes")
          .update({ video_url: videoUrl, video_approved: true })
          .eq("id", scene.id);

        console.log(`[scene-runner] ${label} clip uploaded`);
        return buffer;
      } catch (err) {
        const errMsg = (err as Error).message;
        console.error(`[scene-runner] ${label} animation failed:`, errMsg);
        await slack.postThreadReply(
          channel, threadTs,
          `⚠️ *${label}* animation failed: ${errMsg.slice(0, 200)}`
        );
        return null;
      }
    })
  );

  const validClips = clipBuffers.filter((b) => b !== null) as Buffer[];

  if (validClips.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ All clips failed — individual errors above.");
    await supabaseAdmin.from("content_packages").update({ status: "error" }).eq("id", pkgId);
    return;
  }

  // Stitch and post final video
  if (validClips.length > 1) {
    await slack.postThreadReply(channel, threadTs, "🎞️ Stitching final video…");
    try {
      let finalMp4: Buffer;
      if (process.env.REEL_STITCH_REMOTE === "1") {
        // Remote stitch (render-service) lays the song bed + a beat-synced hook chip.
        const { data: pkg } = await supabaseAdmin
          .from("content_packages")
          .select("package_json")
          .eq("id", pkgId)
          .maybeSingle();
        const hook = (pkg?.package_json as PackageJson | null)?.format_hook;
        finalMp4 = await stitchClipsRemote(validClips, hook);
      } else {
        finalMp4 = await stitchClips(validClips);
      }
      await slack.uploadFile(channel, "final-video.mp4", finalMp4, "video/mp4", threadTs);
      await slack.postThreadReply(channel, threadTs, "✅ Final video ready — download above!");
    } catch (err) {
      await slack.postThreadReply(
        channel, threadTs,
        `⚠️ Stitch failed — individual clips are above.\n_${(err as Error).message.slice(0, 200)}_`
      );
    }
  } else {
    await slack.postThreadReply(channel, threadTs, "✅ Clip ready — see above.");
  }

  await supabaseAdmin
    .from("content_packages")
    .update({ status: "rendered", assembly_guide_posted: true })
    .eq("id", pkgId);
}

// Concatenates MP4 clip buffers using ffmpeg concat demuxer (stream copy, no re-encode).
async function stitchClips(clips: Buffer[]): Promise<Buffer> {
  let ffmpegPath: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require("ffmpeg-static") as string;
  } catch {
    ffmpegPath = "ffmpeg";
  }

  const id = randomUUID();
  const clipPaths = clips.map((_, i) => `/tmp/stitch-${id}-${i}.mp4`);
  const listPath = `/tmp/stitch-list-${id}.txt`;
  const outPath = `/tmp/stitch-out-${id}.mp4`;

  try {
    clips.forEach((buf, i) => writeFileSync(clipPaths[i], buf));
    writeFileSync(listPath, clipPaths.map((p) => `file '${p}'`).join("\n"));

    const result = spawnSync(
      ffmpegPath,
      ["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outPath],
      { timeout: 120_000 }
    );

    if (result.status !== 0) {
      const stderr = result.stderr?.toString() ?? "";
      throw new Error(`ffmpeg concat failed: ${stderr.slice(0, 400)}`);
    }

    console.log("[scene-runner] stitch complete");
    return readFileSync(outPath);
  } finally {
    clipPaths.forEach((p) => { if (existsSync(p)) unlinkSync(p); });
    if (existsSync(listPath)) unlinkSync(listPath);
    if (existsSync(outPath)) unlinkSync(outPath);
  }
}
