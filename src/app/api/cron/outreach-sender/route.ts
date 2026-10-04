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

  // ‼️ THE PASSENGER RUNS BEFORE THE SENDER'S OWN GATE, AND PUTTING IT AFTER WAS A DEAD FEATURE.
  //
  // This route returns on the next line whenever OUTREACH_SENDER_ENABLED is unset, which it is in
  // production and has been the whole time. The onboarding nudge was added below that return, so
  // it never executed once: measured 2026-10-03, a real abandoned signup sat for 22 hours with
  // `nudged_at` null while the sweep's own query would have picked it up immediately.
  //
  // The two have nothing to do with each other. The nudge rides this file only for its five-minute
  // schedule, so it belongs above anything that decides whether EMAIL should go out. Its errors are
  // swallowed and reported in the body, so it still cannot fail the send either way.
  let nudge: unknown = null;
  try {
    const { sweepAbandonedOnboardings } = await import("@/lib/onboarding2/nudge");
    nudge = await sweepAbandonedOnboardings();
  } catch (e) {
    console.error("[cron/outreach-sender] onboarding nudge skipped:", (e as Error).message);
  }

  if (!dry && !senderEnabled()) {
    return NextResponse.json({ ok: true, skipped: "OUTREACH_SENDER_ENABLED is not set", nudge });
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

    return NextResponse.json({ ok: true, ...result, replies: replies?.replies ?? 0, nudge });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/outreach-sender] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
