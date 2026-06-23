export const dynamic = "force-dynamic";
// Refresh = ping the Mac. textwin.ai's refresh button calls this so the Mac bridge
// does an immediate sync instead of waiting out its ~10s poll. We reuse the existing
// command queue: enqueue a "resync" (which forces poll() on the Mac) — the bridge
// picks it up on its next outbox GET. Best-effort: if the bridge is offline the
// command simply waits in the queue, so textwin stays an online/Supabase-backed app
// rather than being wired directly to the Mac.
//
// POST — Bearer CRON_SECRET (+ CORS for the Electron/web origin).

import { NextRequest, NextResponse } from "next/server";
import { enqueueBridgeCommand, getBridgeStatus } from "@/lib/imessage-control";

export const runtime = "nodejs";
export const maxDuration = 15;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const requestedBy =
    req.headers.get("x-requested-by") || "textwin refresh";

  const queued = await enqueueBridgeCommand("resync", requestedBy);
  const bridge = await getBridgeStatus();

  return NextResponse.json(
    {
      ok: queued.ok,
      queued_command_id: queued.id ?? null,
      error: queued.error ?? null,
      bridge,
    },
    { headers: CORS_HEADERS }
  );
}
