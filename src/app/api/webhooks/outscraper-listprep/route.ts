export const dynamic = "force-dynamic";
// The 4 door's callback: Outscraper POSTs here when an async Google Maps job finishes, and the
// records land in raw_leads for the shared workflow C engine to qualify, crawl, verify and suppress.
//
// IT WRITES raw_leads, NOT med_spa_leads. The two existing Outscraper webhooks in this repo
// (outscraper-medspa, outscraper-trt) write their own vertical tables and resolve their run out of
// med_spa_runs / trt_runs. They are a different lane and they stay paused behind MAPS_PULL_ENABLED.
// This route belongs to the scraper lane and has its own switch, LISTPREP_MAPS_ENABLED, so turning
// one on never turns the other on.
//
// IT MARKS AND RETURNS, IT DOES NOT QUALIFY. Qualification is a paid model sweep over every row and
// this function has 60 seconds. Setting pull_finished_at is the whole job; the five-minute cron picks
// the batch up and drives the rest, which is the same division of labour every other stage uses.

import { NextRequest, NextResponse } from "next/server";
import { toGroups } from "@/lib/outscraper";
import { fromOutscraper, storeRawLeads, type RawLeadInput } from "@/lib/scraper/pull";
import { getRun, updateRun } from "@/lib/scraper/listprep";
import { getBatch } from "@/lib/scraper/store";
import { parseMapsCommand } from "@/lib/scraper/maps-command";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Pull the results array out of the webhook body, fetching results_location if needed.
 *
 * THE FALLBACK IS LOAD BEARING, NOT DEFENSIVE. Outscraper delivers a large result set BY REFERENCE:
 * the POST body carries a results_location URL and no data at all. A route without this receives an
 * empty payload, stores nothing, and reports success, which is the silent truncation this lane's
 * store.ts header opens with. Copied from outscraper-medspa for that reason.
 */
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
  const runId = url.searchParams.get("run");
  const token = url.searchParams.get("token");

  const expected = process.env.OUTSCRAPER_WEBHOOK_SECRET || "";
  if (expected && token !== expected) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (!runId) {
    return NextResponse.json({ error: "no run id on the callback URL" }, { status: 400 });
  }

  // NOT {ok:true, paused} AND SILENCE. The paused med-spa routes answer that way, which for a NEW
  // door would swallow a real delivery and leave the batch polling for six hours over an unset env
  // var. The reason is written onto the run, and sweepPullMaps fails the batch loudly on the next
  // tick with that reason in the thread.
  if (process.env.LISTPREP_MAPS_ENABLED !== "1") {
    await updateRun(runId, {
      error: "a Maps callback arrived while LISTPREP_MAPS_ENABLED was not 1, so the results were dropped",
    }).catch(() => undefined);
    return NextResponse.json({ ok: true, refused: "listprep_maps_disabled" });
  }

  const run = await getRun(runId);
  if (!run) return NextResponse.json({ error: "no such run" }, { status: 404 });

  // A replay after the first delivery. storeRawLeads is idempotent on (run_id, place_id), but
  // re-marking a finished pull would restate the count, so it is simply acknowledged.
  if (run.pull_finished_at) {
    return NextResponse.json({ ok: true, already: "delivered" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "body was not json" }, { status: 400 });
  }

  const data = await extractData(body);
  const groups = toGroups(data);

  // The vertical was decided before anything was bought and is read back, never re-derived. Same
  // contract sweepPullCsv uses, and the reason beginListPrepWorkflow writes it to the run.
  const verticalSlug = run.vertical_slug ?? "medspa";

  // source_metro has had a column, a RawLeadInput field and a storeRawLeads slot since 2026-09-17
  // and never a writer. The metro is read off the batch's own command, verbatim, which is the only
  // place it was ever recorded. Null when the batch is gone rather than guessed out of the query.
  let sourceMetro: string | null = null;
  if (run.batch_id) {
    const batch = await getBatch(run.batch_id);
    const parsed = parseMapsCommand(batch?.batch_label ?? "");
    if (parsed.ok) sourceMetro = parsed.command.metro;
  }
  const queries = run.label ? [run.label] : [];

  const rows: RawLeadInput[] = [];
  for (let i = 0; i < groups.length; i++) {
    // toGroups returns one array per submitted query, in submitted order, so the query a record came
    // from is positional rather than guessed.
    const sourceQuery = queries[i] ?? queries[0] ?? (run.label ?? "");
    for (const rec of groups[i]) {
      const mapped = fromOutscraper(rec, { runId, sourceQuery, sourceMetro, verticalSlug });
      if (mapped) rows.push(mapped);
    }
  }

  const stored = await storeRawLeads(rows);

  // pull_finished_at is set EVEN WHEN NOTHING CAME BACK. An empty metro is a real answer, and a row
  // count can never be the marker: polling on one would park the batch in ACTIVE_STATUSES forever.
  await updateRun(runId, {
    pull_finished_at: new Date().toISOString(),
    raw_count: stored.inserted,
    error: stored.error ?? null,
    pull_request_id: run.pull_request_id ?? (typeof body.id === "string" ? body.id : null),
  });

  return NextResponse.json({
    ok: true,
    run: runId,
    groups: groups.length,
    mapped: rows.length,
    inserted: stored.inserted,
    skipped: stored.skipped,
    error: stored.error ?? null,
  });
}
