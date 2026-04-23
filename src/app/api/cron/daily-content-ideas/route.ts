import { NextRequest, NextResponse } from "next/server";
import { generateContentBrief } from "@/lib/ai-intel/content-brief-generator";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { VEKTOR_CHANNELS } from "@/config/vektor";

export const runtime = "nodejs";
export const maxDuration = 300;

// Daily content ideas cron.
// Fires 3× per weekday (9 AM / 1 PM / 5 PM ET) from vercel.json.
// Each fire generates one fresh brief and pipes it through the existing
// viral-decoder → video-pipeline (FAL + ElevenLabs + ffmpeg) flow, so
// a finished MP4 lands in #content-full without any manual step.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const start = Date.now();
  const contentFullChannel = VEKTOR_CHANNELS.contentFull;
  if (!contentFullChannel) {
    return NextResponse.json(
      { error: "SLACK_CONTENT_FULL_CHANNEL not set" },
      { status: 500 }
    );
  }

  let brief;
  try {
    brief = await generateContentBrief();
  } catch (e) {
    const msg = (e as Error).message;
    console.error("[daily-content-ideas] brief generation failed:", msg);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_daily_content_ideas_error",
      description: `brief generation failed: ${msg}`,
      metadata: { duration_ms: Date.now() - start },
    });
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }

  // Drop a seed message in #content-full so the package has a thread to land in.
  const seedText = [
    `💡 *Daily content idea*`,
    `> *${brief.hook_angle}*`,
    `_${brief.vertical} • ${brief.persona} • $${brief.funding_amount_usd.toLocaleString()} for ${brief.use_of_funds}_`,
    ``,
    `_Full production package (voiceover, image prompts, animation prompts, SFX) coming in thread — pick 👍 to build, ✏️ to regenerate, 🚫 to kill._`,
  ].join("\n");

  const seed = (await slack.postMessage(contentFullChannel, seedText)) as {
    ok?: boolean;
    ts?: string;
  };
  if (!seed.ok || !seed.ts) {
    return NextResponse.json(
      { ok: false, error: "slack seed post failed" },
      { status: 500 }
    );
  }

  // Call the viral decoder — it generates the full 9-slide text package
  // (voiceover, image prompts, animation prompts, music, timeline) and posts
  // it as a Slack Block Kit reply in the seed thread. Matt picks which idea
  // to shoot later — we do NOT auto-render. Image + animation generation
  // happens manually after Matt reacts, using his own tools (ElevenLabs
  // images, Seedance 1.5 for animation).
  const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const decoderRes = await fetch(`${siteUrl}/api/agent/viral-decoder`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: contentFullChannel,
      thread_ts: seed.ts,
      brief: brief.brief_line,
      files: [],
    }),
  });

  if (!decoderRes.ok) {
    const errText = await decoderRes.text();
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_daily_content_ideas_error",
      description: `viral-decoder call failed (${decoderRes.status}): ${errText.slice(0, 500)}`,
      metadata: { brief, duration_ms: Date.now() - start },
    });
    return NextResponse.json(
      { ok: false, error: `decoder_failed_${decoderRes.status}` },
      { status: 500 }
    );
  }

  const decoderJson = (await decoderRes.json()) as {
    ok?: boolean;
    package_id?: string | null;
  };

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_daily_content_ideas",
    description: `Auto-generated content idea: ${brief.vertical} (${brief.hook_angle})`,
    metadata: {
      brief,
      package_id: decoderJson.package_id,
      seed_ts: seed.ts,
      duration_ms: Date.now() - start,
    },
  });

  return NextResponse.json({
    ok: true,
    duration_ms: Date.now() - start,
    brief,
    package_id: decoderJson.package_id,
    seed_ts: seed.ts,
  });
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
