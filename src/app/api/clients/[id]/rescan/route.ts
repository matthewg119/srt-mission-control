// Re-run Photograph I for one client.
//
// ‼️ THIS ROUTE EXISTS BECAUSE THERE WAS NO WAY TO ASK FOR A SECOND BASELINE.
// The only trigger was the last step of the /onboarding funnel, so a scan that ran against a
// dead OpenAI key measured nothing, and the only recovery was to re-run a client's intake.
// The SRT pilot hit exactly that: twenty prompts, every one no_data, `baseline_scan` ticked
// green, and the competitor shortlist built off it named nobody.
//
// AUTHENTICATED: middleware guards /dashboard/*, not /api/*. Same pattern as the dns, hub,
// delivery-step, draft and time-log routes beside it.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { waitUntil } from "@vercel/functions";
import { rerunBaselineScan } from "@/lib/clients/baseline-scan";
import { RUN_IN_FLIGHT_MINUTES } from "@/lib/audit-engine/run-audit-pipeline";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth().catch(() => null);
  if (!session?.user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, website, contact_id, legal_name, dba_name")
    .eq("id", id)
    .maybeSingle();

  if (!client) {
    return NextResponse.json({ ok: false, error: "No such client." }, { status: 404 });
  }

  if (!client.website) {
    return NextResponse.json(
      { ok: false, error: "No website on file, so there is nothing to scan." },
      { status: 400 }
    );
  }

  // Claim guard, same doctrine as the lead workflow route: a run is one classification call
  // plus forty engine calls, so an impatient second press must not buy two of them.
  const cutoff = new Date(Date.now() - RUN_IN_FLIGHT_MINUTES * 60_000).toISOString();
  const { data: inFlight } = await supabaseAdmin
    .from("audit_reports")
    .select("id")
    .eq("client_id", id)
    .in("status", ["classifying", "running"])
    .gte("created_at", cutoff)
    .limit(1)
    .maybeSingle();

  if (inFlight) {
    return NextResponse.json(
      { ok: false, error: "A scan is already running for this client. Give it a few minutes." },
      { status: 409 }
    );
  }

  const actor = (session.user.email as string) || (session.user.name as string) || "Mission Control";

  // NOT awaited, for the same reason the onboarding route does not await it: runAuditPipeline
  // does not return until every batch and finishReport are done, which is minutes. The board
  // gets its answer immediately and the thread narrates the rest.
  waitUntil(
    rerunBaselineScan(id, actor).catch((e) =>
      console.error("[clients/rescan] baseline re-run failed:", (e as Error).message)
    )
  );

  return NextResponse.json({
    ok: true,
    message:
      "Baseline scan started. It takes four to six minutes and reports into the ops thread. " +
      "The step ticks only if prompts actually came back with answers.",
  });
}
