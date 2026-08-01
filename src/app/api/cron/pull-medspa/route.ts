export const dynamic = "force-dynamic";
// Route A (med spa) — daily prospecting submit (Vercel Cron). Picks the next batch
// of uncovered ZIPs (density states first), submits ONE async Outscraper Google
// Maps job ("med spa <zip>" per ZIP), records a med_spa_runs row, and bumps the
// ZIPs' last_pulled_at. Results arrive later at /api/webhooks/outscraper-medspa,
// which dedupes/scores into med_spa_leads, syncs Zoho, and posts the report.
//
// When every active ZIP is exhausted, the USA is fully harvested: post a one-time
// note and stop. The handler only SUBMITS — never waits for results.
// See src/lib/medspa.ts and docs/2026-07-10-medspa-pipeline.sql.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { submitMapsSearch } from "@/lib/outscraper";
import { buildQuery } from "@/lib/medspa";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 60;

const USA_COMPLETE_EVENT = "medspa_usa_complete";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow when unset (local dev)
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Maps prospecting is PAUSED (2026-07-31). This route was already unscheduled;
  // the guard covers a manual hit. Set MAPS_PULL_ENABLED=1 to resume.
  if (process.env.MAPS_PULL_ENABLED !== "1") {
    return NextResponse.json({ ok: true, paused: "maps_pull_disabled" });
  }

  // #ceo, never #followups: that channel belongs to the Follow-Up Operator now.
  const followups = process.env.SLACK_MEDSPA_CHANNEL || process.env.SLACK_CEO_CHANNEL || "";
  const zipsPerRun = Math.max(1, Number(process.env.MEDSPA_ZIPS_PER_RUN) || 25);
  const limitPerZip = Math.max(1, Number(process.env.MEDSPA_LIMIT_PER_ZIP) || 20);
  const webhookBase = process.env.OUTSCRAPER_MEDSPA_WEBHOOK_URL
    || (process.env.OUTSCRAPER_WEBHOOK_URL || "").replace(/\/outscraper$/, "/outscraper-medspa");
  const webhookSecret = process.env.OUTSCRAPER_WEBHOOK_SECRET || "";

  // 1. Pick the next batch of active, uncovered ZIPs (density states first).
  const { data: rows, error: pickErr } = await supabaseAdmin
    .from("med_spa_rotation")
    .select("id, zip, city, state")
    .eq("active", true)
    .eq("exhausted", false)
    .order("state_priority", { ascending: true })
    .order("zip", { ascending: true })
    .limit(zipsPerRun);

  if (pickErr) {
    return NextResponse.json({ error: pickErr.message }, { status: 500 });
  }

  // 2. Empty batch => the whole US ZIP list is covered. Post ONCE, then stop.
  if (!rows || rows.length === 0) {
    const { data: already } = await supabaseAdmin
      .from("system_logs")
      .select("id")
      .eq("event_type", USA_COMPLETE_EVENT)
      .limit(1);
    if (!already || already.length === 0) {
      if (followups) {
        await slack.postMessage(
          followups,
          "✅ No more records available in USA — med-spa vertical fully harvested."
        );
      }
      await supabaseAdmin.from("system_logs").insert({
        event_type: USA_COMPLETE_EVENT,
        description: "Med-spa prospecting rotation fully exhausted across the USA.",
        metadata: {},
      });
    }
    return NextResponse.json({ done: true, message: "usa_complete" });
  }

  // 3. Build the query batch, one per ZIP.
  const zips = rows.map((r) => r.zip as string);
  const queries = zips.map((zip) => buildQuery(zip));
  const states = Array.from(new Set(rows.map((r) => r.state).filter(Boolean))) as string[];

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("med_spa_runs")
    .insert({ zips_covered: zips, states, queries, status: "submitted" })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return NextResponse.json({ error: runErr?.message || "run insert failed" }, { status: 500 });
  }

  // 4. Submit the async Outscraper job (webhook carries the run id).
  const webhookUrl = webhookSecret
    ? `${webhookBase}?run=${runRow.id}&token=${encodeURIComponent(webhookSecret)}`
    : `${webhookBase}?run=${runRow.id}`;

  const submit = await submitMapsSearch(queries, { limit: limitPerZip, webhook: webhookUrl });

  if (!submit.ok) {
    await supabaseAdmin.from("med_spa_runs").update({ status: "failed", error: submit.error }).eq("id", runRow.id);
    if (followups) {
      await slack.postMessage(followups, `❌ Med-spa pull failed to submit (${states.join(", ") || "USA"}): ${submit.error}`);
    }
    return NextResponse.json({ error: submit.error }, { status: 502 });
  }

  // 5. Record the request id + stamp last_pulled_at (exhaustion decided in Route B).
  await supabaseAdmin.from("med_spa_runs").update({ outscraper_request_id: submit.requestId }).eq("id", runRow.id);
  await supabaseAdmin
    .from("med_spa_rotation")
    .update({ last_pulled_at: new Date().toISOString() })
    .in("id", rows.map((r) => r.id));

  return NextResponse.json({ ok: true, runId: runRow.id, requestId: submit.requestId, zips: zips.length, states });
}

export const GET = handle;
export const POST = handle;
