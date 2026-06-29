import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import {
  SCENE_VARIATIONS,
  STYLE_VERSION,
  SOUL_SIZE,
  SOUL_QUALITY,
  IMAGES_PER_DROP,
  buildImagePrompt,
  slotFromEtHour,
  type ReelSlot,
} from "@/config/reel-style";
import { selectBeliefForSlot, recordBeliefUsed } from "@/lib/reel/beliefs";
import { recordDrop } from "@/lib/reel/interactive";
import { stripEmDashes } from "@/lib/reel/text";
import { runPovDrop, type PovDropResult } from "@/lib/reel/pov";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// SRT Daily Creative Drop — fires 3x/day (9am / 12pm / 5pm ET) from vercel.json,
// each passing ?slot=. Picks a belief (rotating) and posts ONE image prompt into
// #content-full. The operator then generates the image in Higgsfield, uploads it
// into the thread, and the Slack events route (src/lib/reel/interactive.ts) takes
// over: image -> 3 headline options -> pick -> caption.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function etHour(): number {
  return Number(
    new Date().toLocaleString("en-US", { hour: "2-digit", hour12: false, timeZone: "America/New_York" })
  );
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}

function resolveSlot(req: NextRequest): ReelSlot {
  const raw = req.nextUrl.searchParams.get("slot");
  if (raw === "morning" || raw === "midday" || raw === "evening") return raw;
  return slotFromEtHour(etHour());
}

// Sample `n` DISTINCT scenes (without replacement) so the images in a single drop
// never repeat the same scene. Shuffles a copy of SCENE_VARIATIONS (Fisher-Yates)
// and takes the first `n`; caps at the list length if asked for more than exist.
function pickDistinctScenes(n: number): string[] {
  const pool = [...SCENE_VARIATIONS];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const slot = resolveSlot(req);
  const channel = VEKTOR_CHANNELS.contentFull;
  if (!channel) {
    return NextResponse.json({ error: "SLACK_CONTENT_FULL_CHANNEL not set" }, { status: 500 });
  }

  const date = todayLabel();
  const belief = await selectBeliefForSlot(slot);
  // One drop = IMAGES_PER_DROP distinct scenes (sampled without replacement) so the
  // operator renders varied b-roll, never the same scene twice in one drop. The first
  // scene is the canonical one recorded against the drop thread; the rest are posted
  // as additional prompt variants in the same thread reply.
  const scenes = pickDistinctScenes(IMAGES_PER_DROP);
  const scene = scenes[0];
  const imagePrompt = buildImagePrompt(scene);
  const soulId = process.env.HIGGSFIELD_SOUL_ID || "(set HIGGSFIELD_SOUL_ID)";

  // Post the prompt (one threaded drop). The header is the parent; everything else
  // (the uploaded pic, headlines, caption) lives as replies in the thread.
  const header = `🎬 *Daily Creative Drop, ${date}* (${slot})\n*Belief ${belief.number}:* ${stripEmDashes(belief.title)}`;
  const main = (await slack.postMessage(channel, header)) as { ok?: boolean; ts?: string };
  const threadTs = main?.ts;

  if (!threadTs) {
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_reel_drop_error",
      description: "failed to post header message to #content-full",
      metadata: { slot, belief: belief.number, duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: false, error: "slack_post_failed" }, { status: 502 });
  }

  const promptBlocks = scenes
    .map((s, i) => [`*Prompt ${i + 1} of ${scenes.length}:*`, "```", buildImagePrompt(s), "```"].join("\n"))
    .join("\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `🖼️ *Generate ${scenes.length} image${scenes.length > 1 ? "s" : ""}* in Higgsfield (Soul V2 / \`text2image_soul\`) — distinct scenes, same character:`,
      `• character *Vargas* (soul_id \`${soulId}\`) · ${SOUL_SIZE} · quality ${SOUL_QUALITY}`,
      "",
      promptBlocks,
      "",
      "Then upload the picture you like best in this thread and I'll give you 3 headline options.",
    ].join("\n")
  );

  try {
    await recordDrop({ channel, threadTs, slot, belief, scene, imagePrompt });
  } catch (e) {
    console.error("[reel-drop] recordDrop failed:", (e as Error).message);
    await slack.postThreadReply(
      channel,
      threadTs,
      "⚠️ Drop not registered (run the reel_drops migration). Image uploads won't be picked up until then."
    );
  }
  await recordBeliefUsed(slot, belief.number);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_reel_drop",
    description: `Reel drop ${slot}: belief ${belief.number} prompt posted`,
    metadata: {
      slot,
      belief: belief.number,
      belief_title: belief.title,
      scene,
      scenes,
      style_version: STYLE_VERSION,
      duration_ms: Date.now() - start,
    },
  });

  // Second format: a Meta Glasses POV drop posted as its OWN top-level message in the
  // same channel. Fully isolated in try/catch so a POV failure never breaks the belief
  // drop above. (Step 1/2: auto-generated image + animation prompt + captions + titles.)
  let pov: PovDropResult | null = null;
  try {
    pov = await runPovDrop({ channel, date, slot });
  } catch (e) {
    console.error("[reel-drop] POV section failed:", (e as Error).message);
  }

  return NextResponse.json({
    ok: true,
    slot,
    belief: belief.number,
    thread_ts: threadTs,
    pov_thread_ts: pov?.thread_ts ?? null,
    pov_scene: pov?.scene ?? null,
    pov_image_ok: pov?.image_ok ?? false,
    duration_ms: Date.now() - start,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
