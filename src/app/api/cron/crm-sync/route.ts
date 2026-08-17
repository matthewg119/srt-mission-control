import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runIncrementalSync } from "@/lib/zoho-pull";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Keeps the Supabase mirror fresh while Zoho is still authoritative.
//
// Each entity carries its own Modified_Time watermark in crm_sync_state,
// rewound five minutes on each run. The overlap is deliberate and free: every
// write upserts on a unique index, so re-reading a record is a no-op, and the
// rewind covers records whose Modified_Time straddles a page boundary.
//
// Runs every 15 minutes via vercel.json. Turn it off in Phase 6 when
// CRM_WRITE_MODE flips to supabase_only — at that point Zoho has nothing left
// to tell us.

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header =
    req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Once Supabase owns the data, pulling from Zoho would fight our own writes.
  if (process.env.CRM_WRITE_MODE === "supabase_only") {
    return NextResponse.json({
      ok: true,
      skipped: "CRM_WRITE_MODE=supabase_only — Zoho is no longer a source",
    });
  }

  const started = Date.now();

  try {
    const results = await runIncrementalSync();

    const totals = results.reduce(
      (acc, r) => ({
        seen: acc.seen + r.seen,
        written: acc.written + r.created + r.updated,
        unmatched: acc.unmatched + r.unmatched,
        errored: acc.errored + r.errored,
      }),
      { seen: 0, written: 0, unmatched: 0, errored: 0 }
    );

    const elapsedMs = Date.now() - started;

    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_crm_sync",
      description: `CRM sync: ${totals.seen} seen, ${totals.written} written, ${totals.errored} errored in ${(elapsedMs / 1000).toFixed(1)}s`,
      metadata: { totals, elapsedMs, byEntity: results },
    });

    return NextResponse.json({ ok: true, totals, elapsedMs, results });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[cron/crm-sync] failed:", message);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_crm_sync_failed",
      description: `CRM sync failed: ${message.slice(0, 400)}`,
      metadata: { error: message },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
