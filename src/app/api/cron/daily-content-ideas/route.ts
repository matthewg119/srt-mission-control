import { NextRequest, NextResponse } from "next/server";
import { generateDailyIdeasAndHooks } from "@/lib/ai-intel/content-ideas-generator";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { VEKTOR_CHANNELS } from "@/config/vektor";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Daily content ideas cron.
// Fires once per weekday at 9 AM ET from vercel.json / GitHub Actions.
// Generates 10 divergent video ideas + 30 direct-response hooks and posts
// them as stand-alone messages in #content-full for Matthew to write from.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function todayLabel(): string {
  return new Date().toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const channel = VEKTOR_CHANNELS.contentFull;
  if (!channel) {
    return NextResponse.json({ error: "SLACK_CONTENT_FULL_CHANNEL not set" }, { status: 500 });
  }

  let output;
  try {
    output = await generateDailyIdeasAndHooks();
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[daily-content-ideas] generation failed:", msg);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_daily_ideas_hooks_error",
      description: `generation failed: ${msg}`,
      metadata: { duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  const date = todayLabel();

  // Message A — 10 video ideas
  const ideasText = [
    `💡 *10 Video Ideas — ${date}*`,
    "",
    ...output.video_ideas.map((idea, i) => `${i + 1}. ${idea}`),
  ].join("\n");

  await slack.postMessage(channel, ideasText);

  // Message B — hooks 1–15
  const hooks1Text = [
    `🎣 *30 Hooks — ${date} (1–15)*`,
    "",
    ...output.hooks.slice(0, 15).map((hook, i) => `${i + 1}. ${hook}`),
  ].join("\n");

  await slack.postMessage(channel, hooks1Text);

  // Message C — hooks 16–30
  const hooks2Text = [
    `🎣 *(16–30)*`,
    "",
    ...output.hooks.slice(15).map((hook, i) => `${i + 16}. ${hook}`),
  ].join("\n");

  await slack.postMessage(channel, hooks2Text);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_daily_ideas_hooks",
    description: `Generated ${output.video_ideas.length} video ideas + ${output.hooks.length} hooks`,
    metadata: {
      ideas: output.video_ideas,
      hooks: output.hooks,
      duration_ms: Date.now() - start,
    },
  });

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - start,
    ideas_count: output.video_ideas.length,
    hooks_count: output.hooks.length,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
