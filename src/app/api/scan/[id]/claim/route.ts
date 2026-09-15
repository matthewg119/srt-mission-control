// POST /api/scan/:id/claim — the email gate.
//
// The scan runs for anyone; the REPORT costs an email address. This is the point where an
// anonymous session becomes a lead, so it goes through ingestLead() like every other funnel
// (Supabase contact → Zoho lead → #hot-leads thread) rather than writing contacts directly.
//
// ‼️ TIMING IS THE WHOLE POINT OF THIS ROUTE. finish-report.ts gates the entire fulfilment
// lane on `requester_email` being set on the audit_reports row, and it reads that row when the
// run ENDS. So this has to land BEFORE the report finishes or it does nothing at all: no email
// drafted, no scorecard attached, no Send it / Hold card. That is why the UI asks for the email
// during step 4 while the engines are still working, not on the score screen. If you move the
// gate back to the end, you silently switch the whole funnel off.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getSession } from "@/lib/scan/session";
import { claimScan, reportUrlFor } from "@/lib/scan/start-claim";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A cached read here is worse than a stale render: it decides whether this session was already
// claimed, so a stale "no" creates a second contact, Zoho lead and Slack thread. See the note in
// status/route.ts.
export const fetchCache = "force-no-store";
export const maxDuration = 60;


/** Anchored, so a string of 36 dashes cannot reach Postgres and 500 on the uuid cast. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

/**
 * GET — the report URL for a session that has ALREADY been claimed.
 *
 * Someone who gave their email during the run has no link yet, because the report was still
 * being built. The status poll deliberately never carries the slug (see steps.ts), so the page
 * asks here once the run finishes. Returns null for an unclaimed session, which is what keeps
 * the gate a gate.
 */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  const session = await getSession(params.id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!session.contact_id || !session.report_id) {
    return NextResponse.json({ ok: true, claimed: !!session.contact_id, reportUrl: null });
  }
  const { data } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("id", session.report_id)
    .maybeSingle();
  return NextResponse.json({
    ok: true,
    claimed: true,
    reportUrl: reportUrlFor((data as AuditReportRow) ?? null),
  });
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad_json" }, { status: 400 });
  }

  // No phone is read, deliberately. ingestLead fires Speed-to-Lead whenever it gets one, and this route is
  // public and unauthenticated: accepting a number here would be an open outbound dialer pointed at anything
  // a stranger typed. The page also promises we do not collect one. Keep those two facts in agreement.
  const res = await claimScan({ sessionId: params.id, email: clean(body.email, 120), name: clean(body.name, 80) });
  if (!res.ok) {
    return NextResponse.json(
      { ok: false, error: res.error, ...(res.message ? { message: res.message } : {}) },
      { status: res.status }
    );
  }
  return NextResponse.json(
    res.alreadyClaimed
      ? { ok: true, alreadyClaimed: true, reportUrl: res.reportUrl }
      : { ok: true, pending: res.pending, reportUrl: res.reportUrl }
  );
}
