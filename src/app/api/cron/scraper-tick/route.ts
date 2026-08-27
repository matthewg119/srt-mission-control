// The resumable half of the scraper lane. Every 5 minutes, move every unfinished batch forward.
//
// Two things need it, for opposite reasons. The MX sweep is thousands of our own DNS lookups and
// can outrun a 300s function on a large pull, so it parks and this finishes it. MillionVerifier
// runs on somebody else's queue for minutes to hours, so there is nothing to do but ask again.
//
// Same shape as `cron/outreach-sender`: a timeout mid-drain loses nothing, because the batch row
// records exactly how far it got.

import { NextRequest, NextResponse } from "next/server";
import { activeBatches } from "@/lib/scraper/store";
import { advanceBatch } from "@/lib/scraper/lane";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  try {
    const batches = await activeBatches();
    if (batches.length === 0) return NextResponse.json({ ok: true, batches: 0 });

    // One shared deadline across every batch, not one each. Two large pulls in flight would
    // otherwise each claim the full MX budget and the second would be killed mid-sweep, which is
    // survivable but wastes a whole tick re-asking domains the first one already resolved.
    const deadline = Date.now() + 240_000;

    const moved: string[] = [];
    for (const batch of batches) {
      if (Date.now() > deadline) break;
      // advanceBatch never throws: a failure lands on the row and in the thread. One bad batch
      // must not stop the others from draining.
      await advanceBatch(batch, deadline);
      moved.push(batch.id);
    }

    return NextResponse.json({ ok: true, batches: batches.length, advanced: moved.length });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/scraper-tick] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
