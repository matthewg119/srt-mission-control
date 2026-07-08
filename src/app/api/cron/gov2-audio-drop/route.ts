import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { insertJob } from "@/lib/reel/jobs";
import { AGENT_FORMAT_ID } from "@/lib/reel/workflow-agent";
import { listVerticals } from "@/config/verticals";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
export const revalidate = 0;

// Workflow of the day — every morning, open a Workflow Creator session in
// #agent-wokrflow-creator (the creation lane): pick the avatar, then send the
// audio + images + copy and the agent designs 3 render variations.
// (Route path kept as gov2-audio-drop to avoid vercel.json churn.)

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
  const channel = VEKTOR_CHANNELS.agentWorkflowCreator;
  if (!channel) {
    return NextResponse.json({ error: "SLACK_AGENT_WORKFLOW_CREATOR_CHANNEL not set" }, { status: 500 });
  }

  const avatars = (await listVerticals()).filter((a) => a.status !== "archived");
  const res = (await slack
    .postMessage(
      channel,
      [
        "*Workflow of the day.* Which avatar is it for?",
        avatars.map((a, i) => `${i + 1}. ${a.name}  (\`${a.id}\`)`).join("\n"),
        "",
        "Reply with the number, then send the audio + your images/videos + the copy.",
      ].join("\n")
    )
    .catch(() => null)) as { ts?: string } | null;
  const ts = res?.ts ?? null;
  if (!ts) {
    return NextResponse.json({ error: "could not post the daily card" }, { status: 500 });
  }

  await insertJob({
    formatId: AGENT_FORMAT_ID,
    verticalId: "_",
    channel,
    threadTs: ts,
    pickerTs: ts,
    stage: "awc_avatar",
    sourceKind: "cron",
    data: { avatar_ids: avatars.map((a) => a.id) },
  });
  return NextResponse.json({ ok: true, thread_ts: ts });
}
