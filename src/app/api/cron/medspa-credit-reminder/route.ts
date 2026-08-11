// Daily: the one-time "$39 unused in your cart" email, 18 days after an audit.
//
// Vercel Hobby allows daily crons only, which is plenty for an 18-day trigger. The
// eligibility window in runDueCreditReminders() is bounded on BOTH sides, so a missed
// day is caught up the next day and an outage cannot cause a mass send.
//
// `?dry=1` reports what it would do without sending, the same affordance
// followup-digest has.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runDueCreditReminders } from "@/lib/medspa/credit-reminder";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;

/** House pattern: fails OPEN when CRON_SECRET is unset, so local dev works. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const dry = new URL(req.url).searchParams.get("dry") === "1";

  try {
    const result = await runDueCreditReminders(dry);

    await supabaseAdmin
      .from("system_logs")
      .insert({
        event_type: "cron_medspa_credit_reminder",
        metadata: { ...result, dry },
      })
      .then(() => undefined, () => undefined);

    return NextResponse.json({ ok: true, dry, ...result });
  } catch (e) {
    console.error("[cron/medspa-credit-reminder] failed:", (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
