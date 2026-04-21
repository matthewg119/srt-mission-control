// Cron: Awaiting-Statements Escalation
//
// Fires a RingOut call to Matt's cell whenever a VeKtor "Awaiting Statements"
// Slack nudge has sat for 5+ minutes without Matt reaching out to the merchant
// himself. The RingOut bridges Matt → merchant (press 1 to connect).
//
// Gate: at most one escalation per lead per 7 days, so a persistently stuck
// merchant can still receive a second push a week later.
//
// Meant to be scheduled every 1–2 minutes so the 5-min window stays tight.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { triggerSpeedToLead } from "@/lib/speed-to-lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ESCALATION_DELAY_MS = 5 * 60 * 1000;        // 5 minutes
const ESCALATION_MAX_AGE_MS = 60 * 60 * 1000;      // 60 minutes — don't chase truly stale nudges
const ESCALATION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days per lead

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const windowStart = new Date(now - ESCALATION_MAX_AGE_MS).toISOString();
  const windowEnd = new Date(now - ESCALATION_DELAY_MS).toISOString();
  const cooldownCutoff = new Date(now - ESCALATION_COOLDOWN_MS).toISOString();

  // Candidates:
  //   signed, no statements, nudge was posted 5–60 min ago,
  //   and no escalation fired in the last 7 days.
  const { data: candidates, error } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, phone, mobile_phone, last_nudge_posted_at, awaiting_escalation_fired_at")
    .eq("portal_app_completed", true)
    .eq("portal_statements_uploaded", false)
    .gte("last_nudge_posted_at", windowStart)
    .lte("last_nudge_posted_at", windowEnd)
    .or(`awaiting_escalation_fired_at.is.null,awaiting_escalation_fired_at.lt.${cooldownCutoff}`)
    .limit(20);

  if (error) {
    console.error("[escalation] query failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ id: string; status: string; reason?: string }> = [];

  for (const c of candidates ?? []) {
    const phone = (c.phone as string) || (c.mobile_phone as string) || "";
    if (!phone) {
      results.push({ id: c.id as string, status: "skipped", reason: "no_phone" });
      continue;
    }

    const name = `${(c.first_name as string) || ""} ${(c.last_name as string) || ""}`.trim()
      || (c.business_name as string)
      || "Awaiting-Statements lead";

    // Fire-and-forget — the speed-to-lead helper polls the RingCentral call for
    // up to 60s itself, but we stamp first so overlapping cron ticks can't
    // double-trigger while the call is mid-poll.
    await supabaseAdmin
      .from("contacts")
      .update({ awaiting_escalation_fired_at: new Date().toISOString() })
      .eq("id", c.id as string);

    triggerSpeedToLead({
      leadId: c.id as string,
      leadPhone: phone,
      leadName: name,
      leadSource: "awaiting-statements-escalation",
    }).catch((err) => console.error("[escalation] RingOut failed for", c.id, err));

    results.push({ id: c.id as string, status: "escalated" });
  }

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_awaiting_statements_escalation",
    description: `Awaiting-statements escalation: checked=${candidates?.length ?? 0} escalated=${results.filter(r => r.status === "escalated").length}`,
    metadata: { results },
  });

  return NextResponse.json({ ok: true, checked: candidates?.length ?? 0, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
