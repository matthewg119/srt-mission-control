// Internal batch worker for the Audit Engine.
//
// The batch loop itself lives in lib/audit-engine/process-run.ts, because two routes now enter it:
// this one (the kick-off from run-audit-pipeline, and the watchdog's re-kick) and
// api/internal/audit-continue (the hand-off between hops). Read that file's header before changing
// anything about the chaining: this route's OWN history is a self-chain that Vercel silently
// dropped, and the fix that replaced it assumed twenty questions, which supplied runs broke.
//
// A prospect audit is twenty questions and still finishes in a single invocation. A forty or
// eighty question supplied run hands the rest to a fresh request when the budget runs out.
//
// Writes are idempotent (each batch clears its prior rows first), so a re-kick from the daily
// watchdog never double-counts. Gated by AUDIT_INTERNAL_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { processRun } from "@/lib/audit-engine/process-run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.AUDIT_INTERNAL_SECRET;
  return !!secret && req.headers.get("x-audit-secret") === secret;
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const batch = parseInt(searchParams.get("batch") ?? "0", 10);
  if (!id || Number.isNaN(batch)) {
    return NextResponse.json({ error: "missing id/batch" }, { status: 400 });
  }

  const result = await processRun({ reportId: id, fromBatch: batch, hop: 0 });

  if (result.skipped) return NextResponse.json({ ok: true, skipped: result.skipped });
  if (!result.ok) return NextResponse.json({ ok: false, error: result.error });
  return NextResponse.json({
    ok: true,
    done: result.finished === true,
    ...(result.handedOffAt === undefined ? {} : { handedOffAt: result.handedOffAt }),
    fromBatch: batch,
  });
}
