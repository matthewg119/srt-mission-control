// Webinar deck builder — the long half of the `webinar` lane in #content-full.
//
// The Slack events function has to ack inside seconds and this is a dozen Claude calls plus a
// pptx render, so `startWebinarDeck` fires a non-blocking POST here and this route owns the
// 300s budget. Same hand-off shape as /api/content/ingest-avatar.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { buildWebinarDeck } from "@/lib/deck/webinar-lane";

export const runtime = "nodejs";
export const maxDuration = 300; // one Claude call per ~420 script words, plus the render

interface Body {
  channel?: string;
  thread_ts?: string;
  text?: string;
  files?: Array<{ name?: string; mimetype?: string; url_private_download?: string }>;
}

export async function POST(req: NextRequest) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  const channel = body.channel;
  const threadTs = body.thread_ts;
  if (!channel || !threadTs) {
    return NextResponse.json({ error: "channel and thread_ts are required" }, { status: 400 });
  }

  waitUntil(
    buildWebinarDeck({
      channel,
      threadTs,
      text: body.text ?? "",
      files: body.files ?? [],
    }).catch(async (e) => {
      // A build that dies silently looks exactly like one still running, and this one runs for
      // minutes — so the thread is always told, even when the failure is ours.
      console.error("[webinar-deck] build error:", (e as Error).message);
      await slack
        .postThreadReply(channel, threadTs, `The deck build failed: ${(e as Error).message}`)
        .catch(() => {});
    })
  );

  return NextResponse.json({ ok: true });
}
