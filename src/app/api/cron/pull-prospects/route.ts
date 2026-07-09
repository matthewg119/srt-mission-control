export const dynamic = "force-dynamic";
// Route A — daily pest-control prospecting submit (Vercel Cron, 12:00 UTC).
// Picks the next batch of uncovered ZIPs (Sun Belt first), submits ONE async
// Outscraper Google Maps job, records a prospect_runs row, and bumps the ZIPs'
// last_pulled_at. Results arrive later at /api/webhooks/outscraper, which posts
// the morning report to SLACK_FOLLOWUPS_CHANNEL.
//
// When every active ZIP is exhausted, the USA is fully harvested: post a
// one-time "no more records available in USA" note and stop submitting.
//
// The handler only SUBMITS — it never waits for results (stays well under the
// serverless timeout). See src/lib/outscraper.ts and docs/prospect-pipeline.md.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { submitMapsSearch } from "@/lib/outscraper";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 60;

const USA_COMPLETE_EVENT = "prospect_usa_complete";

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

  const followups = process.env.SLACK_FOLLOWUPS_CHANNEL || "";
  const zipsPerRun = Math.max(1, Number(process.env.PROSPECT_ZIPS_PER_RUN) || 25);
  const limitPerZip = Math.max(1, Number(process.env.PROSPECT_LIMIT_PER_ZIP) || 20);
  const webhookBase = process.env.OUTSCRAPER_WEBHOOK_URL || "";
  const webhookSecret = process.env.OUTSCRAPER_WEBHOOK_SECRET || "";

  // 1. Pick the next batch of active, uncovered ZIPs (Sun Belt first).
  const { data: rows, error: pickErr } = await supabaseAdmin
    .from("prospect_rotation")
    .select("id, zip, city, state, query")
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
          "✅ No more records available in USA — pest-control vertical fully harvested. Start a new vertical or re-point the daily pull (set PROSPECT_QUERY + reseed prospect_rotation)."
        );
      }
      await supabaseAdmin.from("system_logs").insert({
        event_type: USA_COMPLETE_EVENT,
        description: "Pest-control prospecting rotation fully exhausted across the USA.",
        metadata: {},
      });
    }
    return NextResponse.json({ done: true, message: "usa_complete" });
  }

  // 3. Build the query batch, one per ZIP: "<query> <zip>".
  const queries = rows.map((r) => `${r.query || "pest control"} ${r.zip}`);
  const zips = rows.map((r) => r.zip as string);
  const states = Array.from(new Set(rows.map((r) => r.state).filter(Boolean))) as string[];

  const { data: runRow, error: runErr } = await supabaseAdmin
    .from("prospect_runs")
    .insert({
      zips_covered: zips,
      states,
      requested: 0,
      status: "submitted",
    })
    .select("id")
    .single();

  if (runErr || !runRow) {
    return NextResponse.json({ error: runErr?.message || "run insert failed" }, { status: 500 });
  }

  // 4. Submit the async Outscraper job. The webhook carries the run id so
  //    Route B can find this run without trusting the request-id alone.
  const webhookUrl = webhookSecret
    ? `${webhookBase}?run=${runRow.id}&token=${encodeURIComponent(webhookSecret)}`
    : `${webhookBase}?run=${runRow.id}`;

  const submit = await submitMapsSearch(queries, { limit: limitPerZip, webhook: webhookUrl });

  if (!submit.ok) {
    await supabaseAdmin
      .from("prospect_runs")
      .update({ status: "failed", error: submit.error })
      .eq("id", runRow.id);
    if (followups) {
      await slack.postMessage(
        followups,
        `❌ Pest-control pull failed to submit (${states.join(", ") || "USA"}): ${submit.error}`
      );
    }
    return NextResponse.json({ error: submit.error }, { status: 502 });
  }

  // 5. Record the request id + mark the ZIPs as pulled (exhaustion decided in Route B).
  await supabaseAdmin
    .from("prospect_runs")
    .update({ outscraper_request_id: submit.requestId })
    .eq("id", runRow.id);

  // Stamp last_pulled_at now; times_pulled / exhausted are updated per ZIP in
  // Route B once results arrive.
  const nowIso = new Date().toISOString();
  await supabaseAdmin
    .from("prospect_rotation")
    .update({ last_pulled_at: nowIso })
    .in("id", rows.map((r) => r.id));

  return NextResponse.json({
    ok: true,
    runId: runRow.id,
    requestId: submit.requestId,
    zips: zips.length,
    states,
  });
}

export const GET = handle;
export const POST = handle;
