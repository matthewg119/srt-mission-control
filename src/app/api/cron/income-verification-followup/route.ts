// Cron: 7-minute Income-Verification Follow-up
//
// Thin wrapper over runDueIncomeVerificationFollowups() (src/lib/income-verification-followup.ts).
// The Vercel account is on Hobby (crons are daily-only), so the real-time
// trigger is the Mac-bridge outbox poll (~10s) which also calls the runner.
// This route is the daily backup + the entry point for any external pinger
// (every few minutes) hitting it with the CRON_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runDueIncomeVerificationFollowups } from "@/lib/income-verification-followup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const run = await runDueIncomeVerificationFollowups();
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_income_verification_followup",
      description: `Income-verification follow-up: checked=${run.checked} sent=${run.sent}`,
      metadata: { results: run.results },
    });
    return NextResponse.json({ ok: true, ...run });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
