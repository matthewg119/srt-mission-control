import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { finishReport } from "@/lib/audit-engine/finish-report";
import { TOTAL_PROMPTS, BATCH_SIZE } from "@/lib/audit-engine/types";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Hourly backstop for the Audit Engine. The worker now processes all batches in
// one invocation, so stalls are rare (only a 300s timeout or lambda crash). This
// cron sweeps for any run still stuck at status:"running" and either finalizes
// it (all runs present) or re-kicks the worker from the first incomplete batch.
// Re-kicks are idempotent (the worker deletes a batch's prior rows before
// writing), so a recovery never double-counts or corrupts the score. Also
// callable on demand.
//
// Hourly, not daily: public free-audit leads are waiting on this report, and a
// stall used to mean a next-morning delivery.

const STALL_MINUTES = 3;
const ROWS_PER_BATCH = BATCH_SIZE * 2; // 4 prompts x 2 engines = 8

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

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

  const cutoff = new Date(Date.now() - STALL_MINUTES * 60_000).toISOString();
  // Floor: don't resurrect reports stalled for over a day (cold leads); cap per
  // run so the first deploy doesn't stampede a backlog of old stuck runs.
  const floor = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("status", "running")
    .lt("updated_at", cutoff)
    .gt("updated_at", floor)
    .order("updated_at", { ascending: true })
    .limit(10);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const stalled = (data ?? []) as AuditReportRow[];
  const results: Array<{ id: string; action: string }> = [];

  await Promise.allSettled(
    stalled.map(async (row) => {
      const expected = (row.prompts?.length || TOTAL_PROMPTS) * 2;
      const { count } = await supabaseAdmin
        .from("audit_runs")
        .select("id", { count: "exact", head: true })
        .eq("report_id", row.id);
      const done = count ?? 0;

      if (done >= expected) {
        // All engine runs are present — only the finalize hop dropped. Finish it.
        await finishReport(row);
        results.push({ id: row.id, action: "finalized" });
        return;
      }

      // Re-kick the first incomplete batch. floor(done / 8) is the next batch to run.
      const nextBatch = Math.floor(done / ROWS_PER_BATCH);
      const secret = process.env.AUDIT_INTERNAL_SECRET || "";
      await fetch(`${appUrl()}/api/audit/process?id=${row.id}&batch=${nextBatch}`, {
        method: "POST",
        headers: { "x-audit-secret": secret },
      }).catch(() => {});
      results.push({ id: row.id, action: `re-kicked batch ${nextBatch} (${done}/${expected} runs)` });
    })
  );

  return NextResponse.json({ ok: true, checked: stalled.length, recovered: results });
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
