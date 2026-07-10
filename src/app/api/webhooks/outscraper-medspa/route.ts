export const dynamic = "force-dynamic";
// Route B (med spa) — Outscraper results webhook. Outscraper POSTs here when an
// async Google Maps job for one city finishes. We map -> filter -> dedupe ->
// score the businesses into med_spa_leads, close the med_spa_runs row, and post
// a Slack report. Paired with src/app/api/cron/pull-medspa/route.ts (Route A).
// Shared record logic lives in src/lib/medspa.ts; see docs/2026-07-10-medspa-pipeline.sql.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { toGroups } from "@/lib/outscraper";
import { processCityResults } from "@/lib/medspa";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RunRow {
  id: string;
  run_date: string;
  city: string | null;
  state: string | null;
  outscraper_request_id: string | null;
  status: string;
}

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
  const followups = process.env.SLACK_MEDSPA_CHANNEL || process.env.SLACK_FOLLOWUPS_CHANNEL || "";

  // Light guard on the webhook query string (optional).
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
    const { data } = await supabaseAdmin
      .from("med_spa_runs")
      .select("id, run_date, city, state, outscraper_request_id, status")
      .eq("id", runIdParam)
      .single();
    run = (data as RunRow) ?? null;
  }
  if (!run && requestId) {
    const { data } = await supabaseAdmin
      .from("med_spa_runs")
      .select("id, run_date, city, state, outscraper_request_id, status")
      .eq("outscraper_request_id", requestId)
      .single();
    run = (data as RunRow) ?? null;
  }

  // Unknown id — ack with 200 so Outscraper stops retrying.
  if (!run) {
    return NextResponse.json({ ok: true, ignored: "unknown_run" });
  }
  // Idempotency: if we already completed this run, don't double-insert.
  if (run.status === "completed") {
    return NextResponse.json({ ok: true, ignored: "already_completed" });
  }

  const city = run.city ?? "";
  const state = run.state ?? "";

  try {
    const groups = toGroups(await extractData(body));
    const result = await processCityResults(supabaseAdmin, groups, city, state, { write: true });

    await supabaseAdmin
      .from("med_spa_runs")
      .update({
        status: "completed",
        requested: result.requested,
        new_leads: result.newLeads,
        duplicates: result.duplicates,
        filtered_out: result.filteredOut,
      })
      .eq("id", run.id);

    // Running totals + score signal for the report.
    const { count: runningTotal } = await supabaseAdmin
      .from("med_spa_leads")
      .select("*", { count: "exact", head: true });

    const scores = result.inserted.map((r) => r.lead_score ?? 0);
    const avgScore = scores.length ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10 : 0;
    const highScore = result.inserted.filter((r) => (r.lead_score ?? 0) >= 8).length;
    const withInsta = result.inserted.filter((r) => r.instagram_handle).length;

    if (followups) {
      const blocks: SlackBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `Med Spa Prospects — ${city}, ${state}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*New / Dupes:*\n${result.newLeads} / ${result.duplicates}` },
            { type: "mrkdwn", text: `*Filtered out:*\n${result.filteredOut}` },
            { type: "mrkdwn", text: `*Avg score / 8+:*\n${avgScore} / ${highScore}` },
            { type: "mrkdwn", text: `*With Instagram:*\n${withInsta}` },
            { type: "mrkdwn", text: `*Total in DB:*\n${runningTotal ?? 0}` },
            { type: "mrkdwn", text: `*Requested:*\n${result.requested}` },
          ],
        },
      ];
      await slack.postMessage(followups, `Med spa prospects — ${result.newLeads} new (${city}, ${state})`, blocks);
    }

    return NextResponse.json({
      ok: true,
      runId: run.id,
      requested: result.requested,
      newLeads: result.newLeads,
      duplicates: result.duplicates,
      filteredOut: result.filteredOut,
      runningTotal: runningTotal ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin.from("med_spa_runs").update({ status: "failed", error: message }).eq("id", run.id);
    if (followups) {
      await slack.postMessage(followups, `Med spa results failed to process (${city}, ${state}): ${message}`);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
