// One run of one client workflow, started by whoever asked for it.
//
// ‼️ WHY A ROUTE AND NOT A DIRECT CALL. /api/chat has a 60 second budget (its own header says so:
// the Hobby ceiling) and a workflow is one or more model calls over a client's whole plan. Running
// it inside the tool call would time the chat out and leave a run row claiming `running` forever.
//
// ‼️ IT ANSWERS 202 AND WORKS IN waitUntil, and the caller AWAITS that 202. The same shape
// api/internal/pre-call-pages and api/internal/audit-continue use, and the same reason: a fetch
// nobody awaits can be frozen with the lambda before it leaves.
//
// ‼️ CRON_SECRET, AND A 404 WHEN IT IS WRONG, never a 401: a 401 confirms the route exists.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { runId?: unknown } | null;
  const runId = typeof body?.runId === "string" ? body.runId : "";
  if (!UUID.test(runId)) return NextResponse.json({ ok: false, error: "bad runId" }, { status: 400 });

  const { continueWorkflowRun } = await import("@/lib/clients/workflows/registry");
  waitUntil(
    continueWorkflowRun(runId).catch((e) =>
      console.error("[internal/client-workflow] run failed:", (e as Error).message)
    )
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
