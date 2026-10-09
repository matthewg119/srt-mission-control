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
import { advanceBatch, advancePullPlans, reconcileCallLists } from "@/lib/scraper/lane";

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
    // ‼️ THE PLAN WALK GOES FIRST, AND IT IS NOT AN ORDERING PREFERENCE. The batch drain below can
    // legitimately consume the whole 240s budget on an MX sweep, so a plan stepped afterwards would
    // be stepped on the ticks where there is nothing else to do and never on the busy ones, which is
    // precisely backwards: a plan is only ever walking because a pull has just finished. It takes
    // one step per plan and refuses to start anything while a pull is in flight, so it is cheap.
    //
    // ‼️ AND IT NEVER THROWS. advancePullPlans catches its own failures onto the plan row and into
    // the thread, because a feature whose migration has not been run must not stop the lane.
    const plans = await advancePullPlans();

    const batches = await activeBatches();
    if (batches.length === 0) {
      // ‼️ THE QUIET TICK IS WHERE THE CALL LIST IS RECONCILED, AND IDLE IS A PRECONDITION RATHER
      // THAN A COURTESY. A sweep run mid-pipeline reads rows the qualification pass has not finished
      // routing and would insert a lead whose route is about to change. It also says nothing unless
      // something was actually missing, so this is not a message every five minutes.
      const synced = await reconcileCallLists();
      return NextResponse.json({
        ok: true,
        batches: 0,
        plans: plans.plans,
        planSteps: plans.stepped,
        callListAdded: synced,
      });
    }

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

    return NextResponse.json({
      ok: true,
      batches: batches.length,
      advanced: moved.length,
      plans: plans.plans,
      planSteps: plans.stepped,
    });
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
