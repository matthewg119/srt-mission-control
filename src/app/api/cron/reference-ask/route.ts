import { NextRequest, NextResponse } from "next/server";
import { runReferenceAsk } from "@/lib/reel/reference-ask";
import { listDropChannels, loadVertical, dropMode } from "@/config/verticals";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Reference ask - once a morning, 30 min before the morning prompt-drop, in every channel
// running the broll_suggestions lane. Asks the operator for real reference photos; whatever
// he drops in the thread is filed into content_examples and grounds the next drop's prompts.
// Channels on the legacy reel_prompts lane are skipped: they already collect references
// through their own drop threads.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const targets = await listDropChannels();
  if (!targets.length) {
    return NextResponse.json({ ok: true, results: [], note: "no drop channels configured" });
  }
  const results = [];
  for (const t of targets) {
    const vertical = await loadVertical(t.verticalId);
    if (dropMode(vertical) !== "broll_suggestions") continue;
    const result = await runReferenceAsk({ channel: t.channelId, verticalId: t.verticalId });
    results.push({ channel: t.channelId, vertical: t.verticalId, ...result });
  }
  const ok = results.every((r) => r.ok);
  return NextResponse.json({ ok, results }, { status: ok ? 200 : 500 });
}
