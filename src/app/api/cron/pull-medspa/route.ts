export const dynamic = "force-dynamic";
// Route A (med spa) — daily prospecting submit. Loops the static CITIES list and
// submits ONE async Outscraper Google Maps job PER CITY (the 7 SEARCH_TERMS as
// separate queries). Results arrive later at /api/webhooks/outscraper-medspa,
// which dedupes/scores into med_spa_leads and posts the report.
//
// The handler only SUBMITS — it never waits for results (stays under the
// serverless timeout). See src/lib/medspa.ts and docs/2026-07-10-medspa-pipeline.sql.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { submitMapsSearch } from "@/lib/outscraper";
import { CITIES, SEARCH_TERMS, buildQuery } from "@/lib/medspa";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow when unset (local dev)
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const limitPerQuery = Math.max(1, Number(process.env.MEDSPA_LIMIT_PER_QUERY) || 20);
  const webhookBase = process.env.OUTSCRAPER_WEBHOOK_URL || "";
  const webhookSecret = process.env.OUTSCRAPER_WEBHOOK_SECRET || "";
  // Med-spa webhook lives at /api/webhooks/outscraper-medspa. Derive it from the
  // shared base by swapping the pest suffix, else fall back to an explicit env.
  const medspaWebhookBase =
    process.env.OUTSCRAPER_MEDSPA_WEBHOOK_URL ||
    webhookBase.replace(/\/outscraper$/, "/outscraper-medspa");

  const submitted: { city: string; runId: string; requestId?: string }[] = [];
  const failures: { city: string; error: string }[] = [];

  for (const { city, state } of CITIES) {
    const queries = SEARCH_TERMS.map((term) => buildQuery(term, city, state));

    const { data: runRow, error: runErr } = await supabaseAdmin
      .from("med_spa_runs")
      .insert({ city, state, queries: SEARCH_TERMS, status: "submitted" })
      .select("id")
      .single();

    if (runErr || !runRow) {
      failures.push({ city, error: runErr?.message || "run insert failed" });
      continue;
    }

    const webhookUrl = webhookSecret
      ? `${medspaWebhookBase}?run=${runRow.id}&token=${encodeURIComponent(webhookSecret)}`
      : `${medspaWebhookBase}?run=${runRow.id}`;

    const submit = await submitMapsSearch(queries, { limit: limitPerQuery, webhook: webhookUrl });

    if (!submit.ok) {
      await supabaseAdmin.from("med_spa_runs").update({ status: "failed", error: submit.error }).eq("id", runRow.id);
      failures.push({ city, error: submit.error || "submit failed" });
      continue;
    }

    await supabaseAdmin
      .from("med_spa_runs")
      .update({ outscraper_request_id: submit.requestId })
      .eq("id", runRow.id);

    submitted.push({ city, runId: runRow.id, requestId: submit.requestId });
  }

  return NextResponse.json({
    ok: failures.length === 0,
    submitted,
    failures,
    cities: CITIES.length,
  });
}

export const GET = handle;
export const POST = handle;
