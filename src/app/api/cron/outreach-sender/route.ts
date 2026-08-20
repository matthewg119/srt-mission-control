// The send loop. Every 5 minutes, at most ONE email per mailbox per tick.
//
// A Vercel function caps at 300s, so it cannot sleep 5 to 8 minutes between sends. The pacing
// therefore lives in outreach_send_queue.send_after, set at enqueue time, and this route simply
// sends whatever has come due. That also makes it resumable: a timeout mid-drain loses nothing,
// because the queue records what was claimed and what was sent.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { drainSendQueue, senderEnabled } from "@/lib/outreach-sender/queue";
import { runReplyMailSweep } from "@/lib/followup-operator/reply-sweep";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  if (!dry && !senderEnabled()) {
    return NextResponse.json({ ok: true, skipped: "OUTREACH_SENDER_ENABLED is not set" });
  }

  try {
    // Replies first, on a 15-minute floor. This is what makes the per-send last_reply_at re-read
    // meaningful for someone who answered after the queue was built.
    const replies = await runReplyMailSweep({ minIntervalMinutes: 15 }).catch((e) => {
      console.error("[cron/outreach-sender] reply sweep failed:", (e as Error).message);
      return null;
    });

    const result = await drainSendQueue({ dry });
    await supabaseAdmin
      .from("outreach_sweep_state")
      .upsert({ id: 1, last_queue_tick_at: new Date().toISOString() });

    if (result.sent || result.failed || result.canceled) {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "outreach_sender_tick",
        description: `Outreach sender: ${result.sent} sent, ${result.canceled} canceled, ${result.failed} failed`,
        metadata: { ...result },
      });
    }

    return NextResponse.json({ ok: true, ...result, replies: replies?.replies ?? 0 });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/outreach-sender] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
