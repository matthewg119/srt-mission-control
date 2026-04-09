/**
 * Server-side visit beacon for srtagency.com landing pages.
 *
 * Pages POST here on load via navigator.sendBeacon — gives us a record of
 * every visit even when ad blockers strip Vercel Web Analytics. Logs to the
 * existing system_logs table with event_type='page_visit'.
 */
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getClientIp, getCorsHeaders } from "@/lib/lead-validation";

// Local rate limiter — visit beacons fire on every page load, so the
// 5/10min cap from lead-validation is way too strict. 120/min per IP is
// generous enough for real users (incl. devs reloading) while still
// blocking obvious flood traffic.
interface VisitRateEntry { count: number; resetAt: number; }
const visitRateMap = new Map<string, VisitRateEntry>();
const VISIT_RATE_MAX = 120;
const VISIT_RATE_WINDOW_MS = 60 * 1000;

function checkVisitRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = visitRateMap.get(ip);
  if (!entry || now > entry.resetAt) {
    visitRateMap.set(ip, { count: 1, resetAt: now + VISIT_RATE_WINDOW_MS });
    return true;
  }
  entry.count++;
  return entry.count <= VISIT_RATE_MAX;
}

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientIp = getClientIp(request);
  const clientUserAgent = request.headers.get("user-agent") || "";

  // Always return 204 — never block or surface errors to a beacon caller.
  // Failures get console-logged for debugging but the visitor never sees them.
  try {
    if (!checkVisitRateLimit(clientIp)) {
      return new NextResponse(null, { status: 204, headers: corsHeaders });
    }

    const body = await request.json().catch(() => ({} as Record<string, unknown>));

    const {
      path = "",
      host = "",
      referrer = "",
      variant = "",
      utmSource = "",
      utmCampaign = "",
      utmContent = "",
      utmMedium = "",
      adId = "",
      fbclid = "",
      _fbc = "",
      _fbp = "",
      screenW = null,
      screenH = null,
      tz = "",
    } = body as Record<string, string | number | null>;

    await supabaseAdmin.from("system_logs").insert({
      event_type: "page_visit",
      description: `${host}${path}`,
      metadata: {
        path,
        host,
        referrer,
        variant,
        utmSource,
        utmCampaign,
        utmContent,
        utmMedium,
        adId,
        fbclid,
        _fbc,
        _fbp,
        screenW,
        screenH,
        tz,
        ip: clientIp,
        ua: clientUserAgent,
        ts: new Date().toISOString(),
      },
    });
  } catch (err) {
    console.error("[page-visit] beacon insert failed:", err);
  }

  return new NextResponse(null, { status: 204, headers: corsHeaders });
}
