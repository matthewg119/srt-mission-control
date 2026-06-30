// Cron: 30-minute "finish your application" follow-up
//
// Thin wrapper over runDueStatementsFinishAppFollowups()
// (src/lib/statements-finish-app-followup.ts). Daily backup + the entry point
// for any external pinger (every few minutes) hitting it with the CRON_SECRET,
// so the 30-minute window is honored without waiting on the daily tick.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runDueStatementsFinishAppFollowups } from "@/lib/statements-finish-app-followup";

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
    const run = await runDueStatementsFinishAppFollowups();
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_statements_finish_app_followup",
      description: `Finish-application follow-up: checked=${run.checked} sent=${run.sent}`,
      metadata: { results: run.results },
    });
    return NextResponse.json({ ok: true, ...run });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
