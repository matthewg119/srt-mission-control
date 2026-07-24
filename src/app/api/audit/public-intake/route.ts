// POST /api/audit/public-intake — secret-gated intake for the srtagency.com
// "Free Audit" funnel (a static-site form → api/free-audit-notify.js → here).
// Same trust model as /api/leads/funnel: server-to-server only, x-funnel-secret
// gated with the existing FUNNEL_NOTIFY_SECRET (no new secret needed).
//
// Unlike the Slack /audit command, this has no thread to ask a follow-up
// question in — so a low-confidence city doesn't block the run, it just
// proceeds on the best guess (see runAuditPipeline's allowLowConfidenceCity).
// The completed report gets emailed to the requester (see process/route.ts's
// finishReport), since they're not in Slack to see it.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { runAuditPipeline } from "@/lib/audit-engine/run-audit-pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function isUrl(v: string): boolean {
  try {
    const u = new URL(/^https?:\/\//i.test(v) ? v : `https://${v}`);
    return !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.FUNNEL_NOTIFY_SECRET;
  if (!secret || req.headers.get("x-funnel-secret") !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  const name = clean(body.name, 80);
  const email = clean(body.email, 120).toLowerCase();
  const phone = clean(body.phone, 20).replace(/[^\d+]/g, "");
  const rawWebsite = clean(body.website, 200);
  const website = isUrl(rawWebsite) ? (rawWebsite.startsWith("http") ? rawWebsite : `https://${rawWebsite}`) : "";

  if (!website) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_website" }, { status: 400 });
  }
  if (!email || !isEmail(email)) {
    return NextResponse.json({ ok: false, error: "missing_or_invalid_email" }, { status: 400 });
  }

  // Ack fast; the visitor already saw a "we'll email your report" screen —
  // the real work (research/classify/run) happens in the background.
  waitUntil(
    runAuditPipeline({
      website,
      requesterName: name || undefined,
      requesterEmail: email,
      requesterPhone: phone || undefined,
      allowLowConfidenceCity: true,
      onError: async (message) => console.error("[audit/public-intake] pipeline error:", message),
    })
  );

  return NextResponse.json({ ok: true });
}
