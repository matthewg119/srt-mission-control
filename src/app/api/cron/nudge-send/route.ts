// The 7:30am ET nudge run, Monday to Friday.
//
// Vercel schedules crons in UTC, and 7:30am Eastern is 11:30 UTC under EDT and 12:30 UTC under
// EST. Accepting one of those means the send drifts to 8:30am for half the year. So the cron is
// "30 11,12 * * 1-5" -- it fires TWICE every weekday -- and exactly one firing is allowed to act:
//
//   1. the ET wall-clock guard here, which reads 7:30 on one firing and 6:30 or 8:30 on the other
//   2. the once-per-Eastern-day claim inside runNudgeSend, a conditional UPDATE, which also stops
//      a manual hit of this URL from producing a second run
//   3. OUTREACH_SENDER_ENABLED, which ships unset

import { NextRequest, NextResponse } from "next/server";
import { runNudgeSend } from "@/lib/outreach-sender";
import { etWallClock } from "@/lib/followup-operator/cadence";

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

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const force = req.nextUrl.searchParams.get("force") === "1";
  const now = new Date();
  const clock = etWallClock(now);

  // The wrong firing of the pair. 200 rather than an error: it is a scheduled no-op, not a fault,
  // and a red cron every single weekday would train everyone to ignore it.
  const rightTime = clock.hour === 7 && clock.minute >= 20 && clock.minute <= 45;
  const businessDay = clock.weekday >= 1 && clock.weekday <= 5;
  if (!dry && !force && (!rightTime || !businessDay)) {
    return NextResponse.json({
      ok: true,
      skipped: !businessDay ? "not a weekday in ET" : "not 7:30am ET",
      etHour: clock.hour,
      etMinute: clock.minute,
    });
  }

  try {
    const result = await runNudgeSend({ dry, force });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/nudge-send] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
