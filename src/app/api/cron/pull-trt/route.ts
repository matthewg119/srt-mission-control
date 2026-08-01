export const dynamic = "force-dynamic";
// Route A (TRT) — nightly prospecting submit (Vercel Cron). Picks the next batch
// of active metro x query rotation rows (Sun Belt metros first, core queries
// before expansion), submits ONE async Outscraper Google Maps job, records a
// trt_runs row, and bumps last_pulled_at. Results arrive later at
// /api/webhooks/outscraper-trt, which filters/dedupes/verifies into trt_leads,
// syncs Zoho, and posts the report.
//
// Volume math: 15 queries x 40 = 600 raw. TRT queries inside a metro overlap
// heavily ("TRT clinic" vs "testosterone clinic" surface the same pins), so
// expect 25-45% dupes + 10-20% filter drops => ~250-400 net new early on,
// decaying as a metro saturates (the rotation then advances). Tune with
// TRT_QUERIES_PER_RUN / TRT_LIMIT_PER_QUERY — bump queries-per-run before limit.
//
// When every rotation row (core + expansion) is exhausted, the vertical is fully
// harvested: post a one-time note and stop. The handler only SUBMITS.
// See src/lib/trt.ts and docs/2026-07-20-trt-pipeline.sql.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { submitMapsSearch } from "@/lib/outscraper";
import { METROS, activateExpansionForMetros } from "@/lib/trt";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 60;

const TRT_COMPLETE_EVENT = "trt_complete";

interface PickRow {
  id: number;
  metro_key: string;
  query: string;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true; // allow when unset (local dev)
  return (req.headers.get("authorization") ?? "") === `Bearer ${secret}`;
}

async function pickBatch(limit: number): Promise<PickRow[]> {
  const { data, error } = await supabaseAdmin
    .from("trt_rotation")
    .select("id, metro_key, query")
    .eq("active", true)
    .eq("exhausted", false)
    .order("metro_priority", { ascending: true })
    .order("tier", { ascending: true }) // 'core' < 'expansion'
    .order("id", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data ?? []) as PickRow[];
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Maps prospecting is PAUSED (2026-07-31). The cron entry is gone from
  // vercel.json; this guard covers a manual hit. Set MAPS_PULL_ENABLED=1 in
  // Vercel to resume. Nothing was deleted. See CLAUDE.md "Follow-Up Operator".
  if (process.env.MAPS_PULL_ENABLED !== "1") {
    return NextResponse.json({ ok: true, paused: "maps_pull_disabled" });
  }

  // Falls back to #ceo, never #followups: that channel is now the Follow-Up
  // Operator's home and a stray prospecting post would corrupt the digest.
  const followups = process.env.SLACK_TRT_CHANNEL || process.env.SLACK_CEO_CHANNEL || "";
  const queriesPerRun = Math.max(1, Number(process.env.TRT_QUERIES_PER_RUN) || 15);
  const limitPerQuery = Math.max(1, Number(process.env.TRT_LIMIT_PER_QUERY) || 40);
  const webhookBase = process.env.OUTSCRAPER_TRT_WEBHOOK_URL
    || (process.env.OUTSCRAPER_WEBHOOK_URL || "").replace(/\/outscraper$/, "/outscraper-trt");
  const webhookSecret = process.env.OUTSCRAPER_WEBHOOK_SECRET || "";

  try {
    // 1. Pick the next batch of active, unexhausted metro x query rows.
    let rows = await pickBatch(queriesPerRun);

    // 2. Empty pick: activation normally happens in Route B, but run it here
    //    defensively (e.g. a metro's last core row exhausted on a manual run),
    //    then re-pick once.
    if (rows.length === 0) {
      await activateExpansionForMetros(supabaseAdmin, METROS.map((m) => m.key));
      rows = await pickBatch(queriesPerRun);
    }

    // 3. Still empty => every core + expansion query is exhausted. Post ONCE.
    if (rows.length === 0) {
      const { data: already } = await supabaseAdmin
        .from("system_logs")
        .select("id")
        .eq("event_type", TRT_COMPLETE_EVENT)
        .limit(1);
      if (!already || already.length === 0) {
        if (followups) {
          await slack.postMessage(
            followups,
            "✅ No more records available. TRT vertical fully harvested across all metros."
          );
        }
        await supabaseAdmin.from("system_logs").insert({
          event_type: TRT_COMPLETE_EVENT,
          description: "TRT prospecting rotation fully exhausted (core + expansion, all metros).",
          metadata: {},
        });
      }
      return NextResponse.json({ done: true, message: "trt_complete" });
    }

    // 4. Record the run (rotation_ids order-aligned with queries for Route B).
    const queries = rows.map((r) => r.query);
    const rotationIds = rows.map((r) => r.id);
    const metros = Array.from(new Set(rows.map((r) => r.metro_key)));

    const { data: runRow, error: runErr } = await supabaseAdmin
      .from("trt_runs")
      .insert({ metros, queries, rotation_ids: rotationIds, status: "submitted" })
      .select("id")
      .single();

    if (runErr || !runRow) {
      return NextResponse.json({ error: runErr?.message || "run insert failed" }, { status: 500 });
    }

    // 5. Submit the async Outscraper job (webhook carries the run id).
    const webhookUrl = webhookSecret
      ? `${webhookBase}?run=${runRow.id}&token=${encodeURIComponent(webhookSecret)}`
      : `${webhookBase}?run=${runRow.id}`;

    const submit = await submitMapsSearch(queries, { limit: limitPerQuery, webhook: webhookUrl });

    if (!submit.ok) {
      await supabaseAdmin.from("trt_runs").update({ status: "failed", error: submit.error }).eq("id", runRow.id);
      if (followups) {
        await slack.postMessage(followups, `❌ TRT pull failed to submit (${metros.join(", ")}): ${submit.error}`);
      }
      return NextResponse.json({ error: submit.error }, { status: 502 });
    }

    // 6. Record the request id + stamp last_pulled_at (exhaustion decided in Route B).
    await supabaseAdmin.from("trt_runs").update({ outscraper_request_id: submit.requestId }).eq("id", runRow.id);
    await supabaseAdmin
      .from("trt_rotation")
      .update({ last_pulled_at: new Date().toISOString() })
      .in("id", rotationIds);

    return NextResponse.json({ ok: true, runId: runRow.id, requestId: submit.requestId, queries: queries.length, metros });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
