export const dynamic = "force-dynamic";
// Morning follow-up board cron — scans Zoho for active-stage deals with no contact
// in 7+ days (plus a Deal Lost revival cadence) and posts one digest to
// SLACK_FOLLOWUPS_CHANNEL with 1-click Zoho links + drafted email cards.
// See src/lib/hanging-leads.ts. Scheduled 8am ET on weekdays.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runHangingLeadScan } from "@/lib/hanging-leads";

export const runtime = "nodejs";
export const maxDuration = 60;

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

  const result = await runHangingLeadScan();

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_hanging_leads",
    description: `Morning board: ${result.hanging} hanging, ${result.lostDue} lost-due, ${result.emailCards} email cards`,
    metadata: result,
  });

  return NextResponse.json({ ok: true, ...result });
}
