// Audit progress for a paid order, polled by the OTO page.
//
// The buyer reads the $299 offer while their audit runs, so elapsed time is
// something they watch rather than a promise the copy has to keep.
//
// STEPS ARE DERIVED, NEVER ASSERTED. Everything below is computed from the report
// row and a count of audit_runs, the same no-fabrication rule as report-view.ts and
// buildStatusPayload(). A stalled pipeline stalls the UI, on purpose.
//
// This route deliberately does NOT create a scan_sessions row. That table has a
// partial unique index on an in-flight domain, so a paid order for a domain someone
// free-scanned minutes ago would be rejected, and findCachedSession() would happily
// hand a paying customer a week-old free report.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { TOTAL_PROMPTS, ENGINES_PER_PROMPT } from "@/lib/audit-engine/types";
import type { AuditReportRow } from "@/lib/audit-engine/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  if (!UUID.test(params.id)) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: order } = await supabaseAdmin
    .from("medspa_orders")
    .select("id, clinic_domain, fulfillment_state, audit_report_id")
    .eq("id", params.id)
    .maybeSingle();

  if (!order) return NextResponse.json({ ok: false }, { status: 404 });

  const base = {
    ok: true as const,
    domain: order.clinic_domain as string,
    state: order.fulfillment_state as string,
    activeStep: 1,
    engine: { done: 0, total: TOTAL_PROMPTS * ENGINES_PER_PROMPT },
    done: false,
  };

  if (order.fulfillment_state === "failed") {
    return NextResponse.json({ ...base, activeStep: 0 });
  }

  // The report row does not exist for the first ~15s, while research and classify
  // run. That is step 1 and it is honest to show it.
  if (!order.audit_report_id) return NextResponse.json(base);

  const { data: reportData } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("id", order.audit_report_id)
    .maybeSingle();

  if (!reportData) return NextResponse.json(base);
  const report = reportData as AuditReportRow;

  const { count } = await supabaseAdmin
    .from("audit_runs")
    .select("id", { count: "exact", head: true })
    .eq("report_id", report.id);

  const engineDone = count ?? 0;
  // From the row's OWN prompt count. classify is a model call, and if it returns 19
  // prompts a hardcoded 20 means done never reaches total and the UI hangs one step
  // short forever.
  const engineTotal = (report.prompts?.length || TOTAL_PROMPTS) * ENGINES_PER_PROMPT;

  let activeStep = 4;
  if (report.status === "done") activeStep = 7;
  else if (engineDone >= engineTotal) activeStep = 5;

  return NextResponse.json({
    ...base,
    activeStep,
    engine: { done: engineDone, total: engineTotal },
    done: report.status === "done",
  });
}
