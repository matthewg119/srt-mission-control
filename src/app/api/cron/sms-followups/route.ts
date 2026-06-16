export const dynamic = "force-dynamic";
// Follow-up scheduler cron — fires every reminder whose due_at has passed: posts a
// reminder header + a Vektor-drafted check-in card into the lead's own Slack
// channel, closes the Zoho task, and drops a CRM note. See src/lib/imessage-followups.ts.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runDueFollowups } from "@/lib/imessage-followups";

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

  const { posted } = await runDueFollowups();

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_sms_followups",
    description: `Follow-up runner: ${posted} reminder(s) posted`,
    metadata: { posted },
  });

  return NextResponse.json({ ok: true, posted });
}
