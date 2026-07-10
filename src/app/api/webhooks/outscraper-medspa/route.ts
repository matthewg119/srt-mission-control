export const dynamic = "force-dynamic";
// Route B (med spa) — Outscraper results webhook. Outscraper POSTs here when an
// async Google Maps job finishes. We dedupe/filter/score businesses into
// med_spa_leads, sync the new ones to Zoho (silent), mark each ZIP's coverage,
// close the med_spa_runs row, and post the morning report to Slack.
//
// Paired with src/app/api/cron/pull-medspa/route.ts (Route A). Shared record logic
// lives in src/lib/medspa.ts; see docs/2026-07-10-medspa-pipeline.sql.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { toGroups } from "@/lib/outscraper";
import { processZipResults } from "@/lib/medspa";
import { syncMedSpaRows, MedSpaZohoRow } from "@/lib/medspa-zoho-sync";

export const runtime = "nodejs";
export const maxDuration = 60;

interface RunRow {
  id: string;
  run_date: string;
  zips_covered: string[] | null;
  states: string[] | null;
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
  const limitPerZip = Math.max(1, Number(process.env.MEDSPA_LIMIT_PER_ZIP) || 20);

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
      .select("id, run_date, zips_covered, states, outscraper_request_id, status")
      .eq("id", runIdParam)
      .single();
    run = (data as RunRow) ?? null;
  }
  if (!run && requestId) {
    const { data } = await supabaseAdmin
      .from("med_spa_runs")
      .select("id, run_date, zips_covered, states, outscraper_request_id, status")
      .eq("outscraper_request_id", requestId)
      .single();
    run = (data as RunRow) ?? null;
  }

  if (!run) return NextResponse.json({ ok: true, ignored: "unknown_run" });
  if (run.status === "completed") return NextResponse.json({ ok: true, ignored: "already_completed" });

  const zips = run.zips_covered ?? [];

  try {
    const groups = toGroups(await extractData(body));
    const result = await processZipResults(supabaseAdmin, groups, zips, { write: true });

    // Push the new leads to Zoho silently.
    const zoho = await syncMedSpaRows(result.inserted as MedSpaZohoRow[]);

    // Coverage per ZIP: fewer than the cap => we got everything, mark exhausted.
    await Promise.all(
      zips.map(async (zip) => {
        const cnt = result.perZipCount[zip] ?? 0;
        const exhausted = cnt < limitPerZip;
        const { data: cur } = await supabaseAdmin
          .from("med_spa_rotation")
          .select("times_pulled, consecutive_empty")
          .eq("zip", zip)
          .single();
        await supabaseAdmin
          .from("med_spa_rotation")
          .update({
            exhausted,
            times_pulled: ((cur?.times_pulled as number) ?? 0) + 1,
            consecutive_empty: cnt === 0 ? ((cur?.consecutive_empty as number) ?? 0) + 1 : 0,
          })
          .eq("zip", zip);
      })
    );

    await supabaseAdmin
      .from("med_spa_runs")
      .update({
        status: "completed",
        requested: result.requested,
        new_leads: result.newLeads,
        duplicates: result.duplicates,
        filtered_out: result.filteredOut,
        with_phone: result.withPhone,
        with_website: result.withWebsite,
        with_owner: result.withOwner,
      })
      .eq("id", run.id);

    // Running totals + USA coverage for the report.
    const { count: runningTotal } = await supabaseAdmin.from("med_spa_leads").select("*", { count: "exact", head: true });
    const { count: totalZips } = await supabaseAdmin.from("med_spa_rotation").select("*", { count: "exact", head: true });
    const { count: exhaustedZips } = await supabaseAdmin.from("med_spa_rotation").select("*", { count: "exact", head: true }).eq("exhausted", true);
    const pct = totalZips ? Math.round(((exhaustedZips ?? 0) / totalZips) * 1000) / 10 : 0;
    const statesLabel = (run.states ?? []).join(", ") || "USA";
    const avgScore = result.inserted.length
      ? Math.round((result.inserted.reduce((a, r) => a + (r.lead_score ?? 0), 0) / result.inserted.length) * 10) / 10
      : 0;
    const zohoLine = zoho.disabled
      ? "⏸️ sync disabled"
      : zoho.failed === 0 && zoho.ok > 0
        ? `✅ All ${zoho.ok} added to Zoho`
        : zoho.ok === 0 && zoho.failed === 0
          ? "— nothing to add"
          : `${zoho.ok} added, ${zoho.failed} failed`;

    if (followups) {
      const blocks: SlackBlock[] = [
        { type: "header", text: { type: "plain_text", text: `💆 Daily Med Spa Prospects — ${run.run_date}`, emoji: true } },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*📍 Area:*\n${zips.length} ZIPs · ${statesLabel}` },
            { type: "mrkdwn", text: `*✅ New / ♻️ Dupes:*\n${result.newLeads} / ${result.duplicates}` },
            { type: "mrkdwn", text: `*📞 Phone / 🌐 Site:*\n${result.withPhone} / ${result.withWebsite}` },
            { type: "mrkdwn", text: `*👤 Owner / ⭐ Avg:*\n${result.withOwner} / ${avgScore}` },
            { type: "mrkdwn", text: `*📊 Total in DB:*\n${runningTotal ?? 0}` },
            { type: "mrkdwn", text: `*🗺️ USA coverage:*\n${exhaustedZips ?? 0}/${totalZips ?? 0} (${pct}%)` },
          ],
        },
        { type: "section", text: { type: "mrkdwn", text: `*🗂️ Zoho:* ${zohoLine}` } },
      ];
      await slack.postMessage(followups, `💆 Med spa prospects — ${result.newLeads} new (${statesLabel})`, blocks);
    }

    return NextResponse.json({
      ok: true,
      runId: run.id,
      requested: result.requested,
      newLeads: result.newLeads,
      duplicates: result.duplicates,
      filteredOut: result.filteredOut,
      zoho: { ok: zoho.ok, failed: zoho.failed },
      runningTotal: runningTotal ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin.from("med_spa_runs").update({ status: "failed", error: message }).eq("id", run.id);
    if (followups) {
      const statesLabel = (run.states ?? []).join(", ") || "USA";
      await slack.postMessage(followups, `❌ Med-spa results failed to process (${statesLabel}, ${zips.length} ZIPs): ${message}`);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
