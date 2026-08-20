// Email pace check-ins at 12pm, 3pm and 6pm ET, into #vektor-email-director.
//
// Same DST problem as the nudge cron: Vercel schedules in UTC, and 12:00 ET is 16:00 UTC under
// EDT and 17:00 UTC under EST. So the cron fires at all SIX candidate hours
// ("0 16,17,19,20,22,23 * * *") and two guards decide which firing acts: the ET wall clock here,
// and a once-per-slot-per-Eastern-day claim keyed "YYYY-MM-DD:hour".

import { NextRequest, NextResponse } from "next/server";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { etWallClock } from "@/lib/followup-operator/cadence";
import { followupChannel } from "@/lib/followup-operator/digest";
import { buildPacingReport, claimPacingSlot, PACING_SLOTS } from "@/lib/outreach-sender/pacing";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

/** #vektor-email-director, falling back to the follow-up channel so a missing env var degrades
 *  to "posted somewhere Matthew reads" rather than to silence. */
function pacingChannel(): string {
  return VEKTOR_CHANNELS.emailDirector || followupChannel();
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  const now = new Date();
  const clock = etWallClock(now);
  const slot = PACING_SLOTS.find((h) => h === clock.hour);

  if (!dry && slot === undefined) {
    return NextResponse.json({ ok: true, skipped: "not a check-in hour in ET", etHour: clock.hour });
  }
  if (!dry && !(await claimPacingSlot(now, slot as number))) {
    return NextResponse.json({ ok: true, skipped: "this slot already posted today", slot });
  }

  try {
    const report = await buildPacingReport(now);
    const channel = pacingChannel();
    if (!dry) {
      if (!channel) return NextResponse.json({ ok: true, skipped: "no channel configured", report });
      await slack.postMessage(channel, report.text);
    }
    return NextResponse.json({ ok: true, posted: !dry, ...report });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/outreach-pacing] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
