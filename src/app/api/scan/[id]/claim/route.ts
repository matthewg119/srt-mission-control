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
import { ingestLead } from "@/lib/lead-intake";
import { getSession, updateSession } from "@/lib/scan/session";
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

function isEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

/** The report URL, or null while the run is still going. */
function reportUrlFor(report: AuditReportRow | null): string | null {
  if (!report || report.status !== "done" || !report.slug) return null;
  return `${appUrl()}/r/${report.slug}`;
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

  const email = clean(body.email, 120).toLowerCase();
  const name = clean(body.name, 80);
  // No phone is read, deliberately. ingestLead fires Speed-to-Lead whenever it gets one, and
  // this route is public and unauthenticated: accepting a number here would be an open
  // outbound dialer pointed at anything a stranger typed. The page also promises we do not
  // collect one. Keep those two facts in agreement.

  if (!isEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "invalid_email", message: "Enter a valid email address." },
      { status: 400 }
    );
  }

  const session = await getSession(params.id);
  if (!session) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  let report: AuditReportRow | null = null;
  if (session.report_id) {
    const { data } = await supabaseAdmin
      .from("audit_reports")
      .select("*")
      .eq("id", session.report_id)
      .maybeSingle();
    report = (data as AuditReportRow) ?? null;
  }

  // Idempotent. A session is shared by everyone who scans that domain inside the cache window,
  // and the button can be double-clicked. Without this, each POST creates another contact,
  // another Zoho lead and another top-level #hot-leads post.
  if (session.contact_id) {
    return NextResponse.json({ ok: true, alreadyClaimed: true, reportUrl: reportUrlFor(report) });
  }

  const nameParts = name.split(" ").filter(Boolean);
  const stillRunning = !report || report.status !== "done";

  const { contactId } = await ingestLead({
    firstName: nameParts[0] || "",
    lastName: nameParts.slice(1).join(" ") || "",
    email,
    website: session.website,
    businessName: report?.client_name ?? undefined,
    city: report?.city ?? undefined,
    source: "scan",
    // No phone was collected, so there is nothing to dial and nothing to promise.
    speedToLead: false,
    noteTitle: "Self-serve AI visibility scan",
    headline: `:satellite: *Ran their own scan* on ${session.domain} at srtagency.com/scan and asked for the report.`,
    detailLines: [
      `Website: ${session.website}`,
      report?.business_type ? `Business type: ${report.business_type}` : "",
      report?.city ? `City: ${report.city}` : "",
      stillRunning
        ? "Scan still running. The report and the draft pitch land in #ai-visibility-audits when it finishes."
        : `AI visibility score: ${report?.score ?? "not scored"}/100`,
      "SMS consent: not collected (scan funnel asks for email only)",
      "Funnel: /scan",
    ],
  });

  await updateSession(session.id, { contact_id: contactId ?? null });

  // Attach the person to the report so finishReport addresses them and drafts the pitch.
  // Only fills blanks: a report that already belongs to a lead is never reassigned.
  if (report && !report.requester_email) {
    await supabaseAdmin
      .from("audit_reports")
      .update({
        requester_email: email,
        requester_name: name || null,
        contact_id: contactId ?? null,
      })
      .eq("id", report.id);
  }

  return NextResponse.json({ ok: true, pending: stillRunning, reportUrl: reportUrlFor(report) });
}
