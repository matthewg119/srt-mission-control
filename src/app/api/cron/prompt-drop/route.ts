import { NextRequest, NextResponse } from "next/server";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { runPromptDrop } from "@/lib/reel/drop-studio";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Prompt drop — 3x/day in #ai-content-pest-control (offset 30 min from reel-drop).
// Picks the least-recently-used ACTIVE workflow and posts 9 image prompts in its
// style; uploads into the thread flow through drop-studio.ts to a rendered reel.

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
  const channel = VEKTOR_CHANNELS.aiContentPestControl;
  if (!channel) {
    return NextResponse.json({ error: "SLACK_AI_CONTENT_PEST_CONTROL_CHANNEL not set" }, { status: 500 });
  }
  const slot = resolveSlot(req);
  const result = await runPromptDrop({ channel, slot });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
