export const dynamic = "force-dynamic";
// The Follow-Up Operator's daily run (Vercel Cron, 13:00 UTC = 09:00 ET).
//
// Sweeps Outlook Sent Items for pitches Matthew actually sent, advances the
// permission ladder for each, then posts the board to #followups_channel.
// Nothing here sends anything to a prospect: drafts are created in Outlook only
// after he picks one in the thread.
//
// ?dry=1 runs the sweep and the arithmetic and posts nothing, for checking a
// first run against a real mailbox.
//
// See src/lib/followup-operator/ and docs/2026-07-31-followup-operator.sql.

import { NextRequest, NextResponse } from "next/server";
import { runFollowupDigest } from "@/lib/followup-operator/digest";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow when unset (local dev)
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  try {
    const result = await runFollowupDigest({ dry });
    return NextResponse.json({ ok: true, dry, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[followup-digest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
