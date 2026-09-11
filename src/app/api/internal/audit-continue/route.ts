// The next pass of an audit run, started by the pass before it.
//
// ‼️ WHY A ROUTE AND NOT A LOOP. A supplied run (Photograph II, a re-test, a keyword measurement)
// is forty to eighty questions, which is more than one 300 second request can hold. process-run.ts
// runs batches until its budget is spent and then POSTs here, and this starts a fresh request with
// its own 300 seconds. runBatch deletes a batch's rows before writing them, so an overlapping pass
// can never double-count.
//
// ‼️ IT ANSWERS 202 AND DOES THE WORK IN waitUntil, and the caller AWAITS that 202. This is the
// shape pre-call-pages proved. The audit engine's original self-chain was a fetch inside waitUntil
// that nobody awaited, and Vercel dropped it after the response returned: every stalled run in this
// system's history traces back to that one difference.
//
// ‼️ 404 WHEN THE SECRET IS WRONG, never a 401: a 401 confirms the route exists. Same shape as the
// pre-call-pages route and the hub hit logger. It carries the AUDIT lane's secret rather than
// CRON_SECRET so the audit engine keeps one key, the one api/audit/process already checks.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.AUDIT_INTERNAL_SECRET;
  if (!secret || req.headers.get("x-audit-secret") !== secret) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as
    | { id?: unknown; batch?: unknown; hop?: unknown }
    | null;

  const id = typeof body?.id === "string" ? body.id : "";
  if (!UUID.test(id)) return NextResponse.json({ ok: false, error: "bad id" }, { status: 400 });

  const batch = Number.isInteger(body?.batch) ? Math.max(0, body?.batch as number) : 0;
  const hop = Number.isInteger(body?.hop) ? Math.max(0, body?.hop as number) : 0;

  const { processRun } = await import("@/lib/audit-engine/process-run");
  waitUntil(
    processRun({ reportId: id, fromBatch: batch, hop }).catch((e) =>
      console.error("[internal/audit-continue] pass failed:", (e as Error).message)
    )
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
