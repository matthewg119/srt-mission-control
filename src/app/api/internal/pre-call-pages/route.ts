// The next pass of the pre-call drafting, started by the pass before it.
//
// ‼️ WHY A ROUTE AND NOT A LOOP. Nine full drafts are nine model calls, more than one 300 second
// request can hold. continueDrafting() drafts until its budget is spent and then POSTs here, and
// this starts a fresh request with its own 300 seconds. Each plan row is leased while it is drafted
// (pre-call-pages.ts), so a pass that overlaps another never writes the same page twice.
//
// ‼️ CRON_SECRET, AND A 404 WHEN IT IS WRONG, never a 401: a 401 confirms the route exists. Same
// shape as the hub hit logger. Middleware passes /api/* on the internal host and refuses it on a
// client host, and this route checks the secret itself anyway, because middleware is a layer and
// never the only one.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";

export const maxDuration = 300;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new NextResponse("Not found", { status: 404 });
  }

  const body = (await req.json().catch(() => null)) as { clientId?: unknown; by?: unknown; hop?: unknown } | null;
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!UUID.test(clientId)) return NextResponse.json({ ok: false, error: "bad clientId" }, { status: 400 });

  const by = typeof body?.by === "string" && body.by.trim() ? body.by.trim().slice(0, 120) : "the drafting pass";
  const hop = Number.isInteger(body?.hop) ? Math.max(0, Math.min(20, body?.hop as number)) : 0;

  const { continueDrafting } = await import("@/lib/clients/pre-call-pages");
  waitUntil(
    continueDrafting(clientId, by, hop).catch((e) =>
      console.error("[internal/pre-call-pages] pass failed:", (e as Error).message)
    )
  );

  return NextResponse.json({ ok: true }, { status: 202 });
}
