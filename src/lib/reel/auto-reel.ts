// Autonomous multi-shot reel engine (Phase 2 / 2.5).
//
// runAutoReel(vertical, format) produces a 10-20s, >=11-shot reel of one consistent
// CEO (Higgsfield Soul) doing a single mundane task from many angles, shot 1 always an
// open-loop pattern-interrupt. It is FULLY AUTONOMOUS: no per-shot Slack approval gate,
// unlike the manual `generate this`/`animate` flow in content-scene-runner.ts.
//
// The flow: shot-list (one Claude call) -> Soul stills (parallel) -> fan out one
// /api/agent/video-poller call PER shot (each its own 300s function, so the long
// motion polls never block the cron) -> the last shot to finish stitches + posts
// (fan-in via an atomic DB claim in finishAutoReel). stitchClipsRemote (below) lays
// the song bed + hook chip when REEL_STITCH_REMOTE=1, else a bare local ffmpeg concat.

import { uploadToReels } from "@/lib/reel/pov";
import { stripEmDashes } from "@/lib/reel/text";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { callClaudeJSON } from "@/lib/claude-calls";
import { generateImages } from "@/lib/providers/image-gen";
import type { Vertical } from "@/config/verticals";
import { spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";

/**
 * Stitch ordered clip buffers into one music + hook MP4 via the render-service
 * `stitch-reel` endpoint. Drop-in replacement for the local stitchClips (same
 * Buffer[] in, Buffer out), used when REEL_STITCH_REMOTE=1.
 */
export async function stitchClipsRemote(clips: Buffer[], hook?: string): Promise<Buffer> {
  if (clips.length === 0) throw new Error("stitchClipsRemote: no clips");

  // The render-service runs as its OWN Vercel project; clips are passed as URLs,
  // never inline base64 (11-16 video clips would blow past Vercel's ~4.5 MB body cap).
  const clipUrls: string[] = [];
  for (const clip of clips) {
    const url = await uploadToReels(clip, "video/mp4");
    if (!url) throw new Error("stitchClipsRemote: clip upload to reels bucket failed");
    clipUrls.push(url);
  }

  const endpoint =
    process.env.REEL_STITCH_URL ||
    (process.env.REEL_RENDER_URL
      ? process.env.REEL_RENDER_URL.replace(/render-reel\/?$/, "stitch-reel")
      : `${process.env.NEXT_PUBLIC_APP_URL || ""}/api/stitch-reel`);

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-reel-secret": process.env.REEL_RENDER_SECRET || "",
    },
    body: JSON.stringify({
      clips: clipUrls,
      hook: hook ? stripEmDashes(hook).trim() : "",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`stitch-reel ${res.status} ${detail.slice(0, 120)}`);
  }

  const data = (await res.json()) as { url?: string; mp4_b64?: string; error?: string };
  if (data.error) throw new Error(data.error);

  if (data.url) {
    const r = await fetch(data.url);
    if (!r.ok) throw new Error(`fetch stitched mp4 ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }
  if (data.mp4_b64) return Buffer.from(data.mp4_b64, "base64");
  throw new Error("stitch-reel returned no url or mp4");
}

// ---- runAutoReel: shot-list -> Soul stills -> fan out animate -> stitch -> post ----

// A vertical_formats table row (read straight from the table; the cron passes one in).
export interface VerticalFormat {
  id: string;
  vertical_id: string;
  format_group?: string | null;
  scene: string;
  hook?: string | null;
  difficulty?: string;
  shot_count?: number;
}

interface ShotPlan {
  image_prompt: string;
  animation_prompt: string;
  role?: string;
}
interface ShotList {
  hook: string;
  shots: ShotPlan[];
}

// Shots are clamped to this band so a reel reads as real (>=11) without runaway cost.
const MIN_SHOTS = 11;
const MAX_SHOTS = 20;

// Rough per-asset cost estimate (cents), env-overridable. Logged to content_packages
// so cost-per-reel is visible while AUTO_REEL_ENABLED tuning is in progress.
const CENTS_PER_STILL = Number(process.env.AUTO_REEL_CENTS_PER_STILL ?? 3);
const CENTS_PER_CLIP = Number(process.env.AUTO_REEL_CENTS_PER_CLIP ?? 10);
const CENTS_PER_SHOTLIST = Number(process.env.AUTO_REEL_CENTS_PER_SHOTLIST ?? 2);

function clampShots(n: number | undefined): number {
  const v = Number.isInteger(n) && (n as number) > 0 ? (n as number) : MIN_SHOTS;
  return Math.min(MAX_SHOTS, Math.max(MIN_SHOTS, v));
}

// One Claude call decomposes the format's single task into N varied sub-shots of the
// SAME CEO + location (Soul keeps the character constant). Shot 1 is the open-loop hook.
async function planShots(vertical: Vertical, format: VerticalFormat, shotCount: number): Promise<ShotList> {
  const role = vertical.wearer_role || "the business owner";
  const biz = vertical.business_descriptor || vertical.name;
  const houseStyle = vertical.house_style_prompt || "";
  const styleToken = vertical.style_token || "";

  const system = [
    `You storyboard short-form vertical (9:16) reels for a ${biz}.`,
    `Decompose ONE mundane task into exactly ${shotCount} distinct shots: different camera angles and b-roll of the SAME person (${role}) doing that one task, in the SAME location and wardrobe, so it reads as one continuous real moment.`,
    `Shot 1 MUST be an open-loop "wtf"/pattern-interrupt that makes a viewer stop scrolling.`,
    houseStyle ? `House look (bake into every image_prompt): ${houseStyle}` : "",
    styleToken ? `Style token to include in every image_prompt: ${styleToken}` : "",
    `Each image_prompt is a photorealistic still description. Each animation_prompt is ONE short sentence of camera/subject motion. No text overlays in prompts. Never use em dashes.`,
    `Return ONLY JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  const user = [
    `Task / scene: ${format.scene}`,
    format.hook ? `Open-loop hook seed for shot 1: ${format.hook}` : "",
    `Return EXACTLY ${shotCount} shots.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await callClaudeJSON<ShotList>({
    model: "claude-sonnet-4-6",
    system,
    user,
    maxTokens: 4000,
    schemaHint: '{ "hook": string, "shots": [{ "image_prompt": string, "animation_prompt": string, "role": string }] }',
  });

  const clean = (s: string) => stripEmDashes(String(s ?? "")).trim();
  const shots: ShotPlan[] = (data.shots ?? []).slice(0, shotCount).map((s) => ({
    image_prompt: clean(s.image_prompt),
    animation_prompt: clean(s.animation_prompt) || "Slow cinematic drift. Photorealistic.",
    role: s.role ? clean(s.role) : undefined,
  }));
  // Pad defensively so the reel always has the requested shot count.
  while (shots.length < shotCount && shots.length > 0) shots.push({ ...shots[shots.length - 1] });
  if (shots.length === 0) throw new Error("shot-list returned no shots");

  return { hook: clean(data.hook) || (format.hook ? clean(format.hook) : ""), shots };
}

/**
 * Autonomously render one multi-shot reel for `format` and post it to #content-full.
 * Returns the new content_packages id, or null if it could not start (too few stills).
 * Long motion polls are offloaded to /api/agent/video-poller (mode:"auto"); the last
 * shot to land calls finishAutoReel, which stitches + posts.
 */
export async function runAutoReel(
  vertical: Vertical,
  format: VerticalFormat
): Promise<{ packageId: string } | null> {
  const channel = VEKTOR_CHANNELS.contentFull;
  if (!channel) {
    console.error("[auto-reel] SLACK_CONTENT_FULL_CHANNEL not set");
    return null;
  }

  const shotCount = clampShots(format.shot_count);

  // 1. Shot list.
  const plan = await planShots(vertical, format, shotCount);

  // 2. Post the thread header (slack_thread_ts is NOT NULL, so we need a ts first).
  const sceneLabel = stripEmDashes(format.scene).slice(0, 80);
  const headerRes = (await slack.postMessage(
    channel,
    `🎥 *Auto-Reel, ${vertical.name}* — ${sceneLabel}\n_Rendering ${plan.shots.length} shots autonomously…_`
  )) as { ts?: string };
  const threadTs = headerRes?.ts;
  if (!threadTs) {
    console.error("[auto-reel] failed to post header to #content-full");
    return null;
  }

  // 3. Create the package row (package_json is NOT NULL; carry the shot list + hook).
  const { data: pkg, error: pkgErr } = await supabaseAdmin
    .from("content_packages")
    .insert({
      slack_channel: channel,
      slack_thread_ts: threadTs,
      brief: `auto-reel: ${vertical.id} / ${format.id}`,
      image_count: plan.shots.length,
      package_json: {
        kind: "auto_reel",
        vertical_id: vertical.id,
        format_id: format.id,
        scene: format.scene,
        format_hook: plan.hook,
        shots: plan.shots,
      },
      status: "animating",
      model: "claude-sonnet-4-6",
    })
    .select("id")
    .single();

  if (pkgErr || !pkg) {
    console.error("[auto-reel] package insert failed:", pkgErr?.message);
    await slack.postThreadReply(channel, threadTs, "⚠️ Auto-reel could not start (package insert failed).");
    return null;
  }
  const packageId = pkg.id as string;

  // 4. Soul stills — same CEO across every shot via the vertical's Higgsfield Soul.
  const stills = await generateImages({
    prompts: plan.shots.map((s) => s.image_prompt),
    provider: "higgsfield",
    soulId: vertical.soul_id ?? undefined,
    aspect: "reel",
  });

  // 5. Seed content_scenes; upload each still to the reels bucket for a durable URL.
  const sceneRows: Array<{
    content_package_id: string;
    slide_number: number;
    image_prompt: string;
    animation_prompt: string;
    duration_seconds: number;
    image_url: string | null;
    image_error: string | null;
  }> = [];
  for (let i = 0; i < plan.shots.length; i++) {
    const shot = plan.shots[i];
    const img = stills[i];
    let imageUrl: string | null = null;
    if (img) imageUrl = (await uploadToReels(img.buffer, img.mimetype)) ?? img.sourceUrl ?? null;
    sceneRows.push({
      content_package_id: packageId,
      slide_number: i + 1,
      image_prompt: shot.image_prompt,
      animation_prompt: shot.animation_prompt,
      duration_seconds: 2,
      image_url: imageUrl,
      image_error: imageUrl ? null : "still generation returned no image",
    });
  }
  await supabaseAdmin.from("content_scenes").upsert(sceneRows, { onConflict: "content_package_id,slide_number" });

  const animatable = sceneRows.filter((r) => r.image_url);
  if (animatable.length < 2) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Auto-reel aborted: too few stills generated.");
    await supabaseAdmin.from("content_packages").update({ status: "error" }).eq("id", packageId);
    return null;
  }

  // 6. Re-read to get the scene ids, then fan out one autonomous poller call per shot.
  const { data: seeded } = await supabaseAdmin
    .from("content_scenes")
    .select("id, slide_number, animation_prompt, image_url")
    .eq("content_package_id", packageId)
    .not("image_url", "is", null)
    .order("slide_number");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  for (const s of seeded ?? []) {
    void fetch(`${baseUrl}/api/agent/video-poller`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        mode: "auto",
        scene_id: s.id,
        package_id: packageId,
        slide_number: s.slide_number,
        animation_prompt: s.animation_prompt ?? "",
        image_url: s.image_url,
        channel,
        thread_ts: threadTs,
      }),
    }).catch((e) => console.error("[auto-reel] poller dispatch failed:", (e as Error).message));
  }

  console.log(`[auto-reel] pkg=${packageId} dispatched ${seeded?.length ?? 0} shots`);
  return { packageId };
}

/**
 * Called by the video-poller after EVERY autonomous shot finishes (success or error).
 * When every animatable shot is terminal, claim the package and stitch + post once.
 */
export async function checkAndFinishAutoReel(packageId: string): Promise<void> {
  const { data: scenes } = await supabaseAdmin
    .from("content_scenes")
    .select("image_url, video_url, video_error")
    .eq("content_package_id", packageId);

  const animatable = (scenes ?? []).filter((s) => s.image_url);
  if (animatable.length === 0) return;
  const allTerminal = animatable.every((s) => s.video_url || s.video_error);
  if (!allTerminal) return;

  await finishAutoReel(packageId);
}

async function finishAutoReel(packageId: string): Promise<void> {
  // Atomic claim: only the one caller that flips animating -> stitching proceeds, so
  // concurrent last-shot finishers can't double-stitch or double-post.
  const { data: claimed } = await supabaseAdmin
    .from("content_packages")
    .update({ status: "stitching" })
    .eq("id", packageId)
    .eq("status", "animating")
    .select("id, slack_channel, slack_thread_ts, image_count, created_at, package_json")
    .maybeSingle();

  if (!claimed) return; // someone else won the claim, or status wasn't 'animating'

  const channel = claimed.slack_channel as string;
  const threadTs = claimed.slack_thread_ts as string;
  const pj = (claimed.package_json ?? {}) as { format_hook?: string };

  const { data: doneScenes } = await supabaseAdmin
    .from("content_scenes")
    .select("slide_number, video_url, image_url")
    .eq("content_package_id", packageId)
    .not("video_url", "is", null)
    .order("slide_number");

  const clipScenes = doneScenes ?? [];
  if (clipScenes.length === 0) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Auto-reel failed: no clips rendered.");
    await supabaseAdmin.from("content_packages").update({ status: "error" }).eq("id", packageId);
    return;
  }

  // Download all clips in parallel, preserving slide order.
  const buffers = await Promise.all(
    clipScenes.map(async (s) => {
      const r = await fetch(s.video_url as string);
      if (!r.ok) throw new Error(`clip download ${r.status} slide ${s.slide_number}`);
      return Buffer.from(await r.arrayBuffer());
    })
  );

  const stillCount = (claimed.image_count as number) ?? clipScenes.length;
  const startMs = claimed.created_at ? Date.parse(claimed.created_at as string) : Date.now();

  let finalMp4Url: string | null = null;
  try {
    const finalMp4 =
      process.env.REEL_STITCH_REMOTE === "1"
        ? await stitchClipsRemote(buffers, pj.format_hook)
        : await stitchClipsLocal(buffers);
    await slack.uploadFile(channel, "auto-reel.mp4", finalMp4, "video/mp4", threadTs);
    finalMp4Url = await uploadToReels(finalMp4, "video/mp4");
    await slack.postThreadReply(
      channel,
      threadTs,
      `✅ *Auto-reel ready* — ${clipScenes.length} shots stitched. Shot 1 is the open-loop hook.`
    );
  } catch (err) {
    await slack.postThreadReply(
      channel,
      threadTs,
      `⚠️ Stitch failed — individual clips are above.\n_${(err as Error).message.slice(0, 200)}_`
    );
  }

  const totalCostCents = Math.round(
    stillCount * CENTS_PER_STILL + clipScenes.length * CENTS_PER_CLIP + CENTS_PER_SHOTLIST
  );
  await supabaseAdmin
    .from("content_packages")
    .update({
      status: "rendered",
      final_mp4_url: finalMp4Url,
      total_cost_cents: totalCostCents,
      latency_ms: Date.now() - startMs,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", packageId);

  console.log(`[auto-reel] pkg=${packageId} rendered clips=${clipScenes.length} cost=${totalCostCents}c`);
}

// Bare local ffmpeg concat (stream copy, no re-encode) — mirrors content-scene-runner's
// stitchClips. Used when REEL_STITCH_REMOTE is off (no song bed / hook chip).
async function stitchClipsLocal(clips: Buffer[]): Promise<Buffer> {
  let ffmpegPath: string;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    ffmpegPath = require("ffmpeg-static") as string;
  } catch {
    ffmpegPath = "ffmpeg";
  }

  const id = randomUUID();
  const clipPaths = clips.map((_, i) => `/tmp/auto-${id}-${i}.mp4`);
  const listPath = `/tmp/auto-list-${id}.txt`;
  const outPath = `/tmp/auto-out-${id}.mp4`;

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
    return readFileSync(outPath);
  } finally {
    clipPaths.forEach((p) => { if (existsSync(p)) unlinkSync(p); });
    if (existsSync(listPath)) unlinkSync(listPath);
    if (existsSync(outPath)) unlinkSync(outPath);
  }
}
