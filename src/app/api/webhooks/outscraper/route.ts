export const dynamic = "force-dynamic";
// Route B — Outscraper results webhook for the pest-control prospecting pipeline.
// Outscraper POSTs here when an async Google Maps job finishes. We dedupe the
// businesses into prospect_leads, mark each ZIP's coverage, update the run, and
// post the morning report to SLACK_FOLLOWUPS_CHANNEL.
//
// Paired with src/app/api/cron/pull-prospects/route.ts (Route A). See
// docs/prospect-pipeline.md.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { mapRecord, toGroups, OutscraperRecord, ProspectLeadRow } from "@/lib/outscraper";

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
  const followups = process.env.SLACK_FOLLOWUPS_CHANNEL || "";
  const limitPerZip = Math.max(1, Number(process.env.PROSPECT_LIMIT_PER_ZIP) || 20);

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
      .from("prospect_runs")
      .select("id, run_date, zips_covered, states, outscraper_request_id, status")
      .eq("id", runIdParam)
      .single();
    run = (data as RunRow) ?? null;
  }
  if (!run && requestId) {
    const { data } = await supabaseAdmin
      .from("prospect_runs")
      .select("id, run_date, zips_covered, states, outscraper_request_id, status")
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

  const zips = run.zips_covered ?? [];

  try {
    const groups = toGroups(await extractData(body));

    // 1. Map every record, tagged with the ZIP its query targeted (by group order).
    const mapped: ProspectLeadRow[] = [];
    const perZipCount: Record<string, number> = {};
    let requested = 0;
    groups.forEach((group, i) => {
      const zip = zips[i] ?? zips[0] ?? "";
      const list = Array.isArray(group) ? group : [];
      perZipCount[zip] = (perZipCount[zip] ?? 0) + list.length;
      requested += list.length;
      for (const rec of list) {
        const row = mapRecord(rec as OutscraperRecord, zip);
        if (row) mapped.push(row);
      }
    });

    // 2. Dedupe: against the DB (by place_id + phone) and within this batch.
    const placeIds = Array.from(
      new Set(mapped.map((m) => m.google_place_id).filter(Boolean) as string[])
    );
    const phones = Array.from(
      new Set(mapped.map((m) => m.phone_normalized).filter(Boolean) as string[])
    );

    const existingPlace = new Set<string>();
    const existingPhone = new Set<string>();
    // Chunk the .in() lookups to stay under URL/row limits.
    for (let i = 0; i < placeIds.length; i += 200) {
      const chunk = placeIds.slice(i, i + 200);
      const { data } = await supabaseAdmin
        .from("prospect_leads")
        .select("google_place_id")
        .in("google_place_id", chunk);
      (data ?? []).forEach((r) => r.google_place_id && existingPlace.add(r.google_place_id));
    }
    for (let i = 0; i < phones.length; i += 200) {
      const chunk = phones.slice(i, i + 200);
      const { data } = await supabaseAdmin
        .from("prospect_leads")
        .select("phone_normalized")
        .in("phone_normalized", chunk);
      (data ?? []).forEach((r) => r.phone_normalized && existingPhone.add(r.phone_normalized));
    }

    const seenPlace = new Set<string>();
    const seenPhone = new Set<string>();
    const toInsert: ProspectLeadRow[] = [];
    for (const m of mapped) {
      const pid = m.google_place_id;
      const ph = m.phone_normalized;
      if (pid && (existingPlace.has(pid) || seenPlace.has(pid))) continue;
      if (ph && (existingPhone.has(ph) || seenPhone.has(ph))) continue;
      if (pid) seenPlace.add(pid);
      if (ph) seenPhone.add(ph);
      toInsert.push(m);
    }

    // 3. Insert the genuinely new rows (chunked).
    let inserted = 0;
    for (let i = 0; i < toInsert.length; i += 500) {
      const chunk = toInsert.slice(i, i + 500);
      const { error, count } = await supabaseAdmin
        .from("prospect_leads")
        .insert(chunk, { count: "exact" });
      if (error) throw error;
      inserted += count ?? chunk.length;
    }

    const newLeads = toInsert.length;
    const duplicates = mapped.length - newLeads;
    const withPhone = toInsert.filter((r) => r.phone_normalized).length;
    const withWebsite = toInsert.filter((r) => r.website).length;

    // 4. Coverage per ZIP: fewer than the cap => we got everything, mark exhausted.
    await Promise.all(
      zips.map(async (zip) => {
        const cnt = perZipCount[zip] ?? 0;
        const exhausted = cnt < limitPerZip; // full ZIP fetched (incl. cnt === 0)
        const { data: cur } = await supabaseAdmin
          .from("prospect_rotation")
          .select("times_pulled, consecutive_empty")
          .eq("zip", zip)
          .single();
        await supabaseAdmin
          .from("prospect_rotation")
          .update({
            exhausted,
            times_pulled: ((cur?.times_pulled as number) ?? 0) + 1,
            consecutive_empty: cnt === 0 ? ((cur?.consecutive_empty as number) ?? 0) + 1 : 0,
          })
          .eq("zip", zip);
      })
    );

    // 5. Close out the run.
    await supabaseAdmin
      .from("prospect_runs")
      .update({
        status: "completed",
        requested,
        new_leads: newLeads,
        duplicates,
        with_phone: withPhone,
        with_website: withWebsite,
      })
      .eq("id", run.id);

    // 6. Running totals + USA coverage for the report.
    const { count: runningTotal } = await supabaseAdmin
      .from("prospect_leads")
      .select("*", { count: "exact", head: true });
    const { count: totalZips } = await supabaseAdmin
      .from("prospect_rotation")
      .select("*", { count: "exact", head: true });
    const { count: exhaustedZips } = await supabaseAdmin
      .from("prospect_rotation")
      .select("*", { count: "exact", head: true })
      .eq("exhausted", true);
    const pct = totalZips ? Math.round(((exhaustedZips ?? 0) / totalZips) * 1000) / 10 : 0;
    const statesLabel = (run.states ?? []).join(", ") || "USA";

    if (followups) {
      const blocks: SlackBlock[] = [
        {
          type: "header",
          text: { type: "plain_text", text: `🐛 Daily Pest Control Prospects — ${run.run_date}`, emoji: true },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `*📍 Area:*\n${zips.length} ZIPs · ${statesLabel}` },
            { type: "mrkdwn", text: `*✅ New / ♻️ Dupes:*\n${newLeads} / ${duplicates}` },
            { type: "mrkdwn", text: `*📞 With phone:*\n${withPhone}` },
            { type: "mrkdwn", text: `*🌐 With website:*\n${withWebsite}` },
            { type: "mrkdwn", text: `*📊 Total in DB:*\n${runningTotal ?? 0}` },
            { type: "mrkdwn", text: `*🗺️ USA coverage:*\n${exhaustedZips ?? 0}/${totalZips ?? 0} ZIPs (${pct}%)` },
          ],
        },
      ];
      await slack.postMessage(followups, `🐛 Pest control prospects — ${newLeads} new (${statesLabel})`, blocks);
    }

    return NextResponse.json({
      ok: true,
      runId: run.id,
      requested,
      newLeads,
      duplicates,
      runningTotal: runningTotal ?? 0,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabaseAdmin
      .from("prospect_runs")
      .update({ status: "failed", error: message })
      .eq("id", run.id);
    if (followups) {
      const statesLabel = (run.states ?? []).join(", ") || "USA";
      await slack.postMessage(
        followups,
        `❌ Pest-control results failed to process (${statesLabel}, ${zips.length} ZIPs): ${message}`
      );
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
