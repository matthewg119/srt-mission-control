import { NextRequest, NextResponse } from "next/server";
import { runPromptDrop } from "@/lib/reel/drop-studio";
import { listDropChannels } from "@/config/verticals";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Prompt drop — 3x/day in EVERY wired drop channel (the env pest channel + every
// verticals row with slack_drop_channel_id; offset 30 min from reel-drop). Each channel
// picks the least-recently-used ACTIVE workflow from its library and posts 9 image
// prompts in its style; uploads into the thread flow through drop-studio.ts to a
// rendered reel. Sequential on purpose: each drop is one Claude call + a few Slack
// posts (~15s), well inside maxDuration.

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

function resolveSlot(req: NextRequest): string {
  const raw = req.nextUrl.searchParams.get("slot");
  if (raw === "morning" || raw === "midday" || raw === "evening") return raw;
  const h = etHour();
  if (h < 11) return "morning";
  if (h < 15) return "midday";
  return "evening";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const targets = await listDropChannels();
  if (!targets.length) {
    return NextResponse.json(
      { error: "no drop channels configured (SLACK_AI_CONTENT_PEST_CONTROL_CHANNEL or verticals.slack_drop_channel_id)" },
      { status: 500 }
    );
  }
  const slot = resolveSlot(req);
  const results = [];
  for (const t of targets) {
    const result = await runPromptDrop({ channel: t.channelId, slot, verticalId: t.verticalId });
    results.push({ channel: t.channelId, vertical: t.verticalId, ...result });
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
