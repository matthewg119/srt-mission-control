// The ReachInbox campaign card, 09:00 ET into #vektor-email-director.
//
// It replaced /api/cron/outreach-pacing in vercel.json. That card counted emails sent from OUR
// Outlook Sent Items and read "0 of 60 sent today, behind by 60" every slot of every day once
// ReachInbox took over the sending, because the mailboxes it sends from are not ours to sweep.
//
// One daily UTC firing, so there is no DST slot to claim: /api/cron/followup-digest runs on the
// same "0 13 * * *" for the same reason. The pacing route needed claimPacingSlot() only because it
// fired at six candidate hours to hit three Eastern slots.

import { NextRequest, NextResponse } from "next/server";
import { runCampaignDigest } from "@/lib/followup-operator/campaign-digest";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const dry = req.nextUrl.searchParams.get("dry") === "1";
  try {
    const result = await runCampaignDigest({ dry });
    return NextResponse.json({ ok: true, dry, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/campaign-digest] failed:", message);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
