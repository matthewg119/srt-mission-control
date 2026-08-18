export const dynamic = "force-dynamic";
// Route B (TRT) — Outscraper results webhook. Outscraper POSTs here when an
// async Google Maps job finishes. We filter/dedupe/verify businesses into
// trt_leads, sync the callable ones to Zoho (silent), stamp each rotation row's
// coverage, activate expansion queries for metros whose core just drained,
// close the trt_runs row, and post the nightly report to Slack.
//
// Paired with src/app/api/cron/pull-trt/route.ts (Route A). Shared record logic
// lives in src/lib/trt.ts; see docs/2026-07-20-trt-pipeline.sql.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { toGroups } from "@/lib/outscraper";
import { processQueryResults, activateExpansionForMetros, TrtJob, METROS } from "@/lib/trt";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RunRow {
  id: string;
  run_date: string;
  metros: string[] | null;
  queries: string[] | null;
  rotation_ids: number[] | null;
  outscraper_request_id: string | null;
  status: string;
}

const RUN_COLUMNS = "id, run_date, metros, queries, rotation_ids, outscraper_request_id, status";

/** Pull the results array out of the webhook body, fetching results_location if needed. */
async function extractData(body: Record<string, unknown>): Promise<unknown> {
  if (body.data !== undefined && body.data !== null) return body.data;
  const loc = body.results_location as string | undefined;
  if (loc && process.env.OUTSCRAPER_API_KEY) {
    try {
      const res = await fetch(loc, { headers: { "X-API-KEY": process.env.OUTSCRAPER_API_KEY } });
      const json = (await res.json()) as { data?: unknown };
      return json.data ?? null;
    } catch {
      return null;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url);
  const runIdParam = url.searchParams.get("run");
  const token = url.searchParams.get("token");
  // Maps prospecting is PAUSED (2026-07-31). Route A no longer submits jobs, but
  // Outscraper can replay an old callback. Set MAPS_PULL_ENABLED=1 to resume.
  if (process.env.MAPS_PULL_ENABLED !== "1") {
    return NextResponse.json({ ok: true, paused: "maps_pull_disabled" });
  }

  // #ceo, never #followups: that channel belongs to the Follow-Up Operator now.
  const followups = process.env.SLACK_TRT_CHANNEL || process.env.SLACK_CEO_CHANNEL || "";
  const limitPerQuery = Math.max(1, Number(process.env.TRT_LIMIT_PER_QUERY) || 40);

  const expected = process.env.OUTSCRAPER_WEBHOOK_SECRET || "";
  if (expected && token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    // some webhooks send form-encoded; ignore and rely on the run param
  }
  const requestId = (body.id as string) || undefined;

  // Locate the run by our run param first, else by Outscraper's request id.
  let run: RunRow | null = null;
  if (runIdParam) {
    const { data } = await supabaseAdmin.from("trt_runs").select(RUN_COLUMNS).eq("id", runIdParam).single();
    run = (data as RunRow | null) ?? null;
  }
  if (!run && requestId) {
    const { data } = await supabaseAdmin.from("trt_runs").select(RUN_COLUMNS).eq("outscraper_request_id", requestId).single();
    run = (data as RunRow | null) ?? null;
  }

  if (!run) return NextResponse.json({ ok: true, ignored: "unknown_run" });
  if (run.status === "completed") return NextResponse.json({ ok: true, ignored: "already_completed" });

  const queries = run.queries ?? [];
  const rotationIds = run.rotation_ids ?? [];
  const metrosLabel = (run.metros ?? []).join(", ") || "?";

  try {
    // Rebuild the job list (rotation id + metro per query), order-aligned with queries.
    const { data: rotRows } = await supabaseAdmin
      .from("trt_rotation")
      .select("id, metro_key, query")
      .in("id", rotationIds.length ? rotationIds : [-1]);
    const byId = new Map((rotRows ?? []).map((r) => [r.id as number, r]));
    const jobs: TrtJob[] = queries.map((q, i) => {
      const rot = byId.get(rotationIds[i]);
      return { rotationId: rotationIds[i] ?? 0, query: q, metroKey: (rot?.metro_key as string) ?? "" };
    });

    const groups = toGroups(await extractData(body));
    const result = await processQueryResults(supabaseAdmin, groups, jobs, { write: true });

    // Coverage per rotation row: fewer than the cap => we got everything, mark exhausted.
    await Promise.all(
      jobs.map(async (job) => {
        if (!job.rotationId) return;
        const cnt = result.perQueryCount[job.query] ?? 0;
        const exhausted = cnt < limitPerQuery;
        const { data: cur } = await supabaseAdmin
          .from("trt_rotation")
          .select("times_pulled, consecutive_empty")
          .eq("id", job.rotationId)
          .single();
        await supabaseAdmin
          .from("trt_rotation")
          .update({
            exhausted,
            times_pulled: ((cur?.times_pulled as number) ?? 0) + 1,
            consecutive_empty: cnt === 0 ? ((cur?.consecutive_empty as number) ?? 0) + 1 : 0,
          })
          .eq("id", job.rotationId);
      })
    );

    // Metros whose core just drained get their expansion queries switched on.
    const activated = await activateExpansionForMetros(
      supabaseAdmin,
      jobs.map((j) => j.metroKey).filter(Boolean)
    );
    const activatedLabels = activated.map((k) => METROS.find((m) => m.key === k)?.label ?? k);

    await supabaseAdmin
      .from("trt_runs")
      .update({
        status: "completed",
        requested: result.requested,
        new_leads: result.newLeads,
        duplicates: result.duplicates,
        filtered_out: result.filteredOut,
        invalid_phone: result.invalidPhone,
        flagged_chains: result.flaggedChains,
        with_phone: result.withPhone,
        with_website: result.withWebsite,
        with_owner: result.withOwner,
      })
      .eq("id", run.id);

    // Running totals + core coverage for the report.
    const { count: runningTotal } = await supabaseAdmin.from("trt_leads").select("*", { count: "exact", head: true });
    const { count: totalCore } = await supabaseAdmin.from("trt_rotation").select("*", { count: "exact", head: true }).eq("tier", "core");
    const { count: exhaustedCore } = await supabaseAdmin.from("trt_rotation").select("*", { count: "exact", head: true }).eq("tier", "core").eq("exhausted", true);
    const pct = totalCore ? Math.round(((exhaustedCore ?? 0) / totalCore) * 1000) / 10 : 0;
    const avgScore = result.inserted.length
      ? Math.round((result.inserted.reduce((a, r) => a + (r.lead_score ?? 0), 0) / result.inserted.length) * 10) / 10
      : 0;
    if (followups) {
      const blocks: SlackBlock[] = [
        { type: "header", text: { type: "plain_text", text: `💉 Daily TRT Clinic Prospects — ${run.run_date}`, emoji: true } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*📍 Metros:*\n${metrosLabel} (${queries.length} queries)` },
            { type: "mrkdwn", text: `*✅ New / ♻️ Dupes:*\n${result.newLeads} / ${result.duplicates}` },
            { type: "mrkdwn", text: `*📞 Callable / 🌐 Site:*\n${result.withPhone} / ${result.withWebsite}` },
            { type: "mrkdwn", text: `*🏢 Chains flagged / ⭐ Avg:*\n${result.flaggedChains} / ${avgScore}` },
            { type: "mrkdwn", text: `*📊 Total in DB:*\n${runningTotal ?? 0}` },
            { type: "mrkdwn", text: `*🗺️ Core coverage:*\n${exhaustedCore ?? 0}/${totalCore ?? 0} (${pct}%)` },
          ],
        },
      ];
      if (activatedLabels.length) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `🔓 *Expansion queries activated:* ${activatedLabels.join(", ")}` },
        });
      }
      await slack.postMessage(followups, `💉 TRT clinic prospects — ${result.newLeads} new (${metrosLabel})`, blocks);
    }

    return NextResponse.json({
      ok: true,
      runId: run.id,
      requested: result.requested,
      newLeads: result.newLeads,
      duplicates: result.duplicates,
      filteredOut: result.filteredOut,
      invalidPhone: result.invalidPhone,
      flaggedChains: result.flaggedChains,
      expansionActivated: activated,
      runningTotal: runningTotal ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin.from("trt_runs").update({ status: "failed", error: message }).eq("id", run.id);
    if (followups) {
      await slack.postMessage(followups, `❌ TRT results failed to process (${metrosLabel}, ${queries.length} queries): ${message}`);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
