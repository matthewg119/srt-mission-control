import Anthropic from "@anthropic-ai/sdk";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { generateImage, generateVideo, pollVideo } from "@/lib/elevenlabs-media";
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

const SHOT_LABELS = ["Shot 1 — Hook", "Shot 2 — Problem Setup", "Shot 3 — Problem Amplified"];

function getShotLabel(slideNumber: number): string {
  return SHOT_LABELS[slideNumber - 1] ?? `Shot ${slideNumber}`;
}

// Converts an image URL (HTTPS or data:) to a raw buffer for Slack file upload.
async function imageUrlToBuffer(imageUrl: string): Promise<{ buffer: Buffer; mimetype: string }> {
  if (imageUrl.startsWith("data:")) {
    const [header, b64] = imageUrl.split(",");
    const mimetype = header.split(":")[1].split(";")[0];
    return { buffer: Buffer.from(b64, "base64"), mimetype };
  }
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Image download failed (${res.status})`);
  const mimetype = (res.headers.get("content-type") ?? "image/png").split(";")[0];
  return { buffer: Buffer.from(await res.arrayBuffer()), mimetype };
}

// Stage 1: Generate 3 still images via OpenAI, upload as Slack files, post a
// single approval gate message. Set package status to 'stills_pending'.
// Does NOT kick off video. Triggered by "generate this [N]" in the thread.
export async function startStillsGeneration(
  pkgId: string,
  channel: string,
  threadTs: string
): Promise<void> {
  console.log(`[scene-runner] startStillsGeneration pkg=${pkgId}`);

  const { data: pkg } = await supabaseAdmin
    .from("content_packages")
    .select("id, package_json")
    .eq("id", pkgId)
    .maybeSingle();

  if (!pkg) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Package not found.");
    return;
  }

  const packageJson = pkg.package_json as {
    slides: Array<{ n: number; image_prompt: string; animation_prompt?: string; duration_seconds?: number }>;
  };

  // Seed content_scenes rows if not already seeded (hook flow was skipped)
  const { count: existing } = await supabaseAdmin
    .from("content_scenes")
    .select("id", { count: "exact", head: true })
    .eq("content_package_id", pkgId);

  if (!existing || existing === 0) {
    const rows = (packageJson.slides ?? []).map((slide) => ({
      content_package_id: pkgId,
      slide_number: slide.n,
      image_prompt: slide.image_prompt,
      animation_prompt: slide.animation_prompt ?? "",
      duration_seconds: slide.duration_seconds ?? 2,
    }));
    await supabaseAdmin
      .from("content_scenes")
      .upsert(rows, { onConflict: "content_package_id,slide_number" });
  }

  // Generate shots 1, 2, 3 in parallel via OpenAI
  await slack.postThreadReply(channel, threadTs, "🎨 Generating 3 stills with OpenAI…");

  const results = await Promise.allSettled([
    generateAndPostStill(pkgId, 1, channel, threadTs),
    generateAndPostStill(pkgId, 2, channel, threadTs),
    generateAndPostStill(pkgId, 3, channel, threadTs),
  ]);

  const failed = results.filter((r) => r.status === "rejected").length;
  if (failed === 3) {
    await slack.postThreadReply(channel, threadTs, "⚠️ All 3 stills failed — check OPENAI_API_KEY.");
    return;
  }

  // Post the approval gate message and save its ts to hooks_message_ts so
  // a ✅ reaction on it can be detected by handleContentReaction.
  const gateText = [
    `🖼️ *3 stills generated${failed ? ` (${failed} failed)` : ""}.* Review above.`,
    `React ✅ on this message *or* reply \`animate\` to animate all shots with Seedance + stitch final video.`,
    `React 🔄 on this message to regenerate all stills.`,
  ].join("\n");

  const gateRes = await slack.postThreadReply(channel, threadTs, gateText);
  const gateTs = (gateRes as Record<string, unknown>).ts as string | undefined;

  await supabaseAdmin
    .from("content_packages")
    .update({ status: "stills_pending", hooks_message_ts: gateTs ?? null })
    .eq("id", pkgId);

  console.log(`[scene-runner] stills gate posted pkg=${pkgId} ts=${gateTs}`);
}

// Generates one still image via ElevenLabs Seedream and uploads it to the
// Slack thread as a file. Saves image_url to content_scenes for Seedance Stage 2.
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
  let imageUrl: string;

  try {
    imageUrl = await generateImage(scene.image_prompt as string);
    console.log(`[scene-runner] still ${slideNumber} generated (ElevenLabs Seedream)`);
  } catch (err) {
    const errMsg = (err as Error).message;
    console.error(`[scene-runner] still ${slideNumber} generation failed:`, errMsg);
    await supabaseAdmin
      .from("content_scenes")
      .update({ image_error: errMsg })
      .eq("id", scene.id);
    await slack.postThreadReply(
      channel, threadTs,
      `⚠️ *${label}* failed.\n_${errMsg.slice(0, 200)}_`
    );
    return;
  }

  // Convert URL / data URL to a buffer and upload as a Slack file
  try {
    const { buffer, mimetype } = await imageUrlToBuffer(imageUrl);
    await slack.uploadFile(channel, `${label}.png`, buffer, mimetype, threadTs);
  } catch (err) {
    console.error(`[scene-runner] still ${slideNumber} Slack upload failed:`, (err as Error).message);
    // Fall back: post as an image block so the user can still see it
    await slack.postThreadReply(channel, threadTs, `🖼️ *${label}*`, [
      { type: "image", image_url: imageUrl, alt_text: label },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ] as any);
  }

  // Save URL to content_scenes so Seedance can use it as image_url in Stage 2
  await supabaseAdmin
    .from("content_scenes")
    .update({ image_url: imageUrl, image_error: null })
    .eq("id", scene.id);

  console.log(`[scene-runner] still ${slideNumber} posted to Slack`);
}

// Regenerate a single still (used when 🔄 is reacted to the stills gate).
// Resets ALL 3 stills and restarts Stage 1.
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

  await slack.postThreadReply(channel, threadTs, "🔄 Regenerating all 3 stills…");
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
    .order("slide_number")
    .limit(3);

  if (!scenes || scenes.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ No stills found — run Stage 1 first (generate this).");
    return;
  }

  await slack.postThreadReply(
    channel, threadTs,
    `🎬 Animating ${scenes.length} shots with Seedance… (~4 min, running in parallel)`
  );

  // Animate all clips in parallel; collect MP4 buffers in slide order
  const clipBuffers = await Promise.all(
    scenes.map(async (scene) => {
      const label = getShotLabel(scene.slide_number as number);
      try {
        console.log(`[scene-runner] animating ${label}`);
        const jobId = await generateVideo(
          (scene.animation_prompt as string) || "Slow cinematic drift. Photorealistic.",
          scene.image_url as string
        );
        const videoUrl = await pollVideo(jobId, 300_000);

        const res = await fetch(videoUrl);
        if (!res.ok) throw new Error(`download failed (${res.status})`);
        const buffer = Buffer.from(await res.arrayBuffer());

        // Upload individual clip so the user can see each shot
        await slack.uploadFile(channel, `${label}.mp4`, buffer, "video/mp4", threadTs);

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
      const finalMp4 = await stitchClips(validClips);
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
