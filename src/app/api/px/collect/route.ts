// POST /api/px/collect  ->  LAYER 1, and the only unauthenticated write in this feature.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THIS ROUTE CANNOT PRODUCE A QUALIFIED APPOINTMENT AND THERE IS NO REQUEST FIELD FOR ONE.
//
// It does not read `count_basis`, `self_report` or `ai_evidence` from the body. There is no
// branch here that could. `recordPixelBooking` takes no basis argument, writes the literal
// 'pixel_only', and the generated `qualified` column in the database excludes that value by
// construction. Three locks, in three places, because this endpoint is reachable by anyone who
// has read a client's page source.
//
// The reason, from Matthew, 2026-09-03: somebody reads a ChatGPT answer, then types the clinic
// name into Google and books. No referrer, no UTM, no AI domain. That is the MAJORITY path. SRT
// is not paid until 5 qualified appointments land, so a pixel-defined count silently deletes
// appointments that were earned. The pixel corroborates and feeds the monthly report.
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ IT ALWAYS ANSWERS 204, INCLUDING FOR A KEY THAT DOES NOT EXIST. The response is read by
// nobody: sendBeacon discards it and the fetch fallback runs in no-cors. A 404 for an unknown
// key would turn this into an oracle that tells a stranger which site keys are live, for no
// benefit to anybody who is meant to be using it. Real faults are logged server side.
//
// ‼️ THE BODY ARRIVES AS text/plain, WHICH IS DELIBERATE. It keeps the beacon a CORS-simple
// request, so there is no preflight on the clinic's website. Do not "fix" it to application/json
// unless you are also prepared to answer OPTIONS on every page view of every client site.

import { NextRequest, NextResponse } from "next/server";
import { clientIpFrom, hashIp } from "@/lib/scan/session";
import {
  clientForPixelKey,
  openOrTouchSession,
  recordPixelBooking,
} from "@/lib/attribution/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// supabase-js calls the patched global fetch, so reads land in the DATA cache without this.
// `dynamic` governs the ROUTE cache and does not cover it. Same note every /scan route carries.
export const fetchCache = "force-no-store";

/** Bigger than any honest beacon. A body past this is somebody probing, not a page view. */
const MAX_BODY = 8_000;

const NO_CONTENT = () =>
  new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });

export async function OPTIONS() {
  // Not needed by the beacon, which is CORS-simple. Present so a client whose CSP or CDN
  // upgrades the request to a preflighted one still works rather than failing silently.
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const raw = await req.text();
    if (!raw || raw.length > MAX_BODY) return NO_CONTENT();
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return NO_CONTENT();
  }

  const key = typeof body.k === "string" ? body.k : "";
  const sessionKey = typeof body.s === "string" ? body.s : "";
  const kind = body.e === "booking" ? "booking" : "view";
  if (!key || !sessionKey) return NO_CONTENT();

  try {
    const client = await clientForPixelKey(key);
    // A stale snippet on an ex-client's site. Not an error, and not worth a log line per view.
    if (!client) return NO_CONTENT();

    const testCode = typeof body.t === "string" && body.t.trim() ? body.t.trim() : null;

    const sessionId = await openOrTouchSession({
      clientId: client.id,
      sessionKey,
      href: typeof body.href === "string" ? body.href : null,
      referrer: typeof body.ref === "string" ? body.ref : null,
      search: typeof body.search === "string" ? body.search : null,
      ipHash: hashIp(clientIpFrom(req)),
      userAgent: req.headers.get("user-agent"),
      testCode,
    });

    if (kind === "booking") {
      await recordPixelBooking({
        clientId: client.id,
        sessionId,
        testCode,
        payload: typeof body.x === "object" && body.x !== null ? (body.x as Record<string, unknown>) : {},
      });
    }
  } catch (err) {
    // ‼️ SWALLOWED ON PURPOSE, AND LOGGED. A telemetry endpoint that throws in front of a
    // clinic's booking confirmation page is a worse outcome than a lost event, and the caller
    // cannot read the status anyway. A failure here must never be mistaken for "no traffic":
    // it is on the server log, which is where an absence of rows gets diagnosed from.
    console.error("[px/collect]", err instanceof Error ? err.message : err);
  }

  return NO_CONTENT();
}
