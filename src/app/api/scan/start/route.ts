// POST /api/scan/start — the public entry point for srtagency.com/scan.
//
// This is the ONLY unauthenticated, un-secret-gated route in the app that spends
// money: one Claude classify plus one engine call per prompt per accepted
// request. Four things stand between it and a bill, in this order, cheapest
// first:
//   1. normalizeTarget()    — junk and private hosts, no DB, no network
//   2. assertPublicHost()   — resolves DNS, because the blocklist above only
//                             sees literals and 169.254.169.254.nip.io is not one
//   3. findCachedSession()  — a domain scanned this week returns the old session
//   4. countRecentScansForIp() — hard per-IP cap
// Do not reorder them, and do not add a path that skips them.
//
// It returns a session id in ~200ms and does the slow work in waitUntil.

import { NextRequest, NextResponse } from "next/server";
import { startScan } from "@/lib/scan/start-claim";
import { clientIpFrom, hashIp } from "@/lib/scan/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// The cache and rate-limit reads decide whether to spend money. A cached miss spends it twice.
// See the note in status/route.ts: force-dynamic does not cover supabase-js's fetches.
export const fetchCache = "force-no-store";
export const maxDuration = 300;

// The four checks and the pipeline live in lib/scan/start-claim.ts since 2026-09-16, shared with the
// concierge's audit button. This route is the scan page's door to them and nothing else.
export async function POST(req: NextRequest) {
  let body: { url?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const res = await startScan({ url: body.url ?? "", ipHash: hashIp(clientIpFrom(req)) });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error, ...(res.message ? { message: res.message } : {}) },
      { status: res.status }
    );
  }
  return NextResponse.json({ ok: true, id: res.id, domain: res.domain, cached: res.cached });
}
