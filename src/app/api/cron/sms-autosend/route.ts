export const dynamic = "force-dynamic";
// 2-minute auto-send cron — belt-and-suspenders for when the Mac is mid-restart
// and not polling /api/imessage/outbox (which normally runs the same sweep every
// ~10s). Fires any suggestion drafts whose auto_send_at has elapsed.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sweepAutoSends } from "@/lib/imessage-autosend";

export const runtime = "nodejs";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { sent } = await sweepAutoSends();

  if (sent > 0) {
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_sms_autosend",
      description: `Auto-send sweep: ${sent} draft(s) dispatched`,
      metadata: { sent },
    });
  }

  return NextResponse.json({ ok: true, sent });
}
