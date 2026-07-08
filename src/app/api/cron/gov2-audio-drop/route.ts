import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { insertBuilderSessionAtThread } from "@/lib/reel/workflow-builder";
import { listVerticals, DEFAULT_VERTICAL_ID } from "@/config/verticals";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Workflow of the day (gov2) — every morning, ask for the audio of the day in
// #content-full. Dropping the audio file in that thread starts a full Workflow
// Builder v2 session (song -> style DNA -> timings -> scene boards -> prompts ->
// images -> save -> test render -> caption). One new workflow per day.

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
  const channel = VEKTOR_CHANNELS.contentFull;
  if (!channel) {
    return NextResponse.json({ error: "contentFull channel is not configured" }, { status: 500 });
  }

  // Single active avatar -> pin the session to it; otherwise the first reply picks one.
  let verticalId = DEFAULT_VERTICAL_ID;
  try {
    const avatars = (await listVerticals()).filter((a) => a.status !== "archived");
    if (avatars.length === 1) verticalId = avatars[0].id;
  } catch {
    /* keep the default */
  }

  const res = await slack
    .postMessage(
      channel,
      [
        "*Workflow of the day.* Send me the audio in this thread and I will start the v2 builder:",
        "song -> style DNA -> your timings -> scene boards -> prompts -> images -> test render -> caption.",
        "(Or type `gov2` anywhere in this channel to start one yourself.)",
      ].join("\n")
    )
    .catch(() => null);
  const ts = ((res as { ts?: string } | null)?.ts as string) ?? null;
  if (!ts) {
    return NextResponse.json({ error: "could not post the daily card" }, { status: 500 });
  }

  await insertBuilderSessionAtThread({ channel, threadTs: ts, verticalId, sourceKind: "cron" });
  return NextResponse.json({ ok: true, thread_ts: ts, vertical_id: verticalId });
}
