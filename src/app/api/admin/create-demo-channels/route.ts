// One-time admin endpoint to create the two SMS provider test channels in Slack.
// Hit POST /api/admin/create-demo-channels once. Safe to call again — Slack returns
// name_taken if the channel already exists, and we handle it gracefully.

import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";

const DEMO_CHANNELS = [
  {
    name: "linq-demo",
    description: "LINQ SMS provider test channel — real sends via LINQ API",
  },
  {
    name: "loopmessage-demo",
    description: "LoopMessage provider test channel — placeholder for future LoopMessage integration",
  },
];

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const matthewId = process.env.MATTHEW_SLACK_USER_ID;
  const results: Array<{ channel: string; ok: boolean; id?: string; error?: string }> = [];

  for (const ch of DEMO_CHANNELS) {
    const created = await slack.createChannel(ch.name);

    if (!created.ok) {
      results.push({ channel: ch.name, ok: false, error: created.error ?? "unknown" });
      continue;
    }

    const channelId = created.id!;

    // Invite Matthew
    if (matthewId) {
      await slack.inviteToChannel(channelId, matthewId).catch(() => {});
    }

    // Post a pinned description
    const pinRes = await slack.postMessage(
      channelId,
      `📱 *${ch.name}*\n${ch.description}\n\nDrop a phone number here to test a send, or wait for the auto-trigger flow to route a test lead here.`
    );
    if (pinRes.ok && pinRes.ts) {
      await slack.pinMessage(channelId, pinRes.ts as string).catch(() => {});
    }

    results.push({ channel: ch.name, ok: true, id: channelId });
  }

  return NextResponse.json({ ok: true, results });
}
