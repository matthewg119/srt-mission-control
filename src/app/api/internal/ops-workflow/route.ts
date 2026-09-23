export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { continueOpsRun } from "@/lib/ops/workflows";

// The runner for an ops workflow, behind a 202.
//
// ‼️ IT EXISTS BECAUSE /api/chat IS CAPPED AT 60 SECONDS. A workflow that reads the whole board and
// writes a summary does not reliably fit in a chat turn, so the turn STARTS it and this finishes it.
// The same shape /api/internal/client-workflow, /api/internal/pre-call-pages,
// /api/internal/audit-continue and four others already use.
//
// ‼️ 404, NEVER 401. A 401 confirms the route exists. Every internal route here answers a bad secret
// the same way.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => ({}))) as { runId?: unknown };
  const runId = typeof body.runId === "string" ? body.runId : "";
  if (!UUID.test(runId)) return NextResponse.json({ error: "runId must be a uuid" }, { status: 400 });

  // ‼️ 202 GOES BACK BEFORE THE WORK STARTS, and startOpsWorkflow checks for exactly 202. An awaited
  // run here would make the caller wait for the thing this route exists to move off its budget.
  waitUntil(
    continueOpsRun(runId).catch((e) => console.error("[internal/ops-workflow] run threw:", (e as Error).message))
  );
  return NextResponse.json({ ok: true, runId }, { status: 202 });
}
