// The market competitor dataset: who the engines actually name in a city, across every report.
//
// ‼️ WHAT MAKES THIS DIFFERENT FROM competitors.ts. That file answers "who beat THIS client" and
// scopes every query to one report_id. This answers "who does ChatGPT name in Austin", which no
// query in this repo has ever asked. The point is that a business we have never audited, in a city
// we have, already has a true and specific sentence waiting for it.
//
// ‼️ A COMPETITOR MAY NEVER BE INVENTED, AND THAT IS ENFORCED IN THREE PLACES, NOT ONE.
//   1. market_mentions.run_id is NOT NULL with an FK to audit_runs. A row cannot exist without a
//      run that exists. The database refuses it.
//   2. Only status='ok' runs are read here. A no_data row means the engine answered nothing, and
//      820 of the 2,860 rows in production are exactly that.
//   3. scripts/_probe-market-ammo.ts re-reads every stored row and asserts the run's own
//      `recommended` array still contains the name. The FK proves the run is real; only the probe
//      proves the NAME came out of it.
// None of the three is redundant. The FK cannot see inside the jsonb, and the probe cannot stop a
// bad write, it can only find one.
//
// ‼️ THE NAME FILTERS ARE NOT REIMPLEMENTED HERE. tallyRecommended() in clients/competitors.ts
// already trims, normalizes, strips entity suffixes, drops the client's own aliases, drops
// aggregators and national chains via isExcludedFromShortlist, and dedupes a name repeated inside
// one prompt. Rewriting that would put a second, drifting copy of "is Walmart a competitor" in the
// codebase. It is called with a ONE-RUN array so the run_id survives, which its own aggregate
// return value would otherwise throw away.

import { supabaseAdmin } from "@/lib/db";
import { tallyRecommended } from "@/lib/clients/competitors";
import { parseCityCell, type Place } from "./place";

/** The smallest compacted business name we will claim a domain for. Below this it is noise. */
const MIN_DOMAIN_MATCH_LEN = 5;

export interface MentionRow {
  run_id: string;
  report_id: string;
  city: string;
  state: string | null;
  service: string;
  display_name: string;
  normalized_name: string;
  engine: string;
  prompt: string;
  cited_domains: string[];
  seen_at: string;
}

/** A run joined to the few report columns that place it on the map. */
export interface RunWithReport {
  id: string;
  report_id: string;
  engine: string;
  prompt: string;
  status: string;
  recommended: unknown;
  citations: unknown;
  created_at: string;
  city: string | null;
  vertical_slug: string | null;
  business_type: string | null;
  client_name: string | null;
  website: string | null;
}

/**
 * Read a jsonb column that has held two shapes over the life of the table.
 *
 * ‼️ SAME DEFENCE measuredContext() IN artifacts/deep-research-run.ts MAKES, and for the same
 * reason: that is the only other reader that scans HISTORY rather than one fresh report.
 * `citations` has carried bare strings and {url} objects. Assuming the newer shape, as
 * report-view.ts safely does for a single live report, silently drops the older half of a
 * 2,860-row backfill and there is no error to notice.
 */
function stringsFrom(value: unknown, key: "url" | "name"): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const s = item.trim();
      if (s) out.push(s);
      continue;
    }
    const nested = (item as Record<string, unknown> | null)?.[key];
    if (typeof nested === "string" && nested.trim()) out.push(nested.trim());
  }
  return out;
}

/** Hostname without www, lowercased. Null on anything that is not a parseable absolute URL. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Which of this run's cited URLs plausibly belong to this business.
 *
 * ‼️ DELIBERATELY CONSERVATIVE, AND IT UNDER-CLAIMS ON PURPOSE. The only honest link available is
 * "the engine cited this domain in the same answer that named this business", which is weaker than
 * "this is their website". So the compacted name must actually appear in the host, and it must be
 * at least MIN_DOMAIN_MATCH_LEN characters first, or a clinic called "Ora" would claim orange.com
 * and every three-letter name would collect the internet. A missed real domain costs one detail in
 * one sentence. A wrong one puts someone else's URL in an email as fact.
 */
export function matchCitedDomains(name: string, citations: string[]): string[] {
  const compact = name.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact.length < MIN_DOMAIN_MATCH_LEN) return [];

  const out = new Set<string>();
  for (const url of citations) {
    const host = hostOf(url);
    if (!host) continue;
    // Compare against the host with dots and dashes removed, so "renew-vitality.com" and
    // "renewvitality.com" are the same evidence.
    const hostCompact = host.replace(/[^a-z0-9]/g, "");
    if (hostCompact.includes(compact)) out.add(host);
  }
  return [...out];
}

/**
 * Turn one measured run into zero or more mention rows.
 *
 * Pure. No database, no model, no clock. Returns [] rather than throwing for every reason a run
 * cannot be placed: not ok, no city on its report, no service, nothing named.
 */
export function mentionsFromRun(run: RunWithReport): MentionRow[] {
  if (run.status !== "ok") return [];

  const place: Place | null = parseCityCell(run.city);
  if (!place) return [];

  const service = (run.vertical_slug ?? "").trim() || (run.business_type ?? "").trim();
  if (!service) return [];

  const recommended = stringsFrom(run.recommended, "name");
  if (!recommended.length) return [];

  const citations = stringsFrom(run.citations, "url");

  // The business the report is ABOUT is not a competitor in its own market row. These are the
  // aliases tallyRecommended already knows how to drop, passed in rather than filtered afterwards.
  const aliases = [run.client_name, hostOf(run.website ?? "")].filter(
    (a): a is string => !!a && a.trim().length > 0
  );

  const tallies = tallyRecommended(
    [{ prompt: run.prompt, engine: run.engine, recommended }],
    aliases
  );

  return tallies.map((t) => ({
    run_id: run.id,
    report_id: run.report_id,
    city: place.city,
    state: place.state,
    service: service.toLowerCase(),
    display_name: t.name,
    normalized_name: t.normalized,
    engine: run.engine,
    prompt: run.prompt,
    cited_domains: matchCitedDomains(t.name, citations),
    seen_at: run.created_at,
  }));
}

/** Page size for the historical scan. */
const PAGE = 500;

/**
 * Every ok run in the database, joined to the report columns that place it.
 *
 * ‼️ raw_response IS NOT SELECTED. It is the full untruncated engine body on every row and this
 * scan needs none of it. Selecting * here is the difference between a few MB and a few hundred.
 */
export async function loadRunsWithReports(): Promise<RunWithReport[]> {
  const out: RunWithReport[] = [];

  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("audit_runs")
      .select(
        "id, report_id, engine, prompt, status, recommended, citations, created_at, " +
          "audit_reports!inner(city, vertical_slug, business_type, client_name, website)"
      )
      .eq("status", "ok")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);

    if (error) throw new Error(`loadRunsWithReports: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const row of data as unknown as Array<Record<string, unknown>>) {
      const rep = row.audit_reports as Record<string, unknown> | null;
      out.push({
        id: row.id as string,
        report_id: row.report_id as string,
        engine: row.engine as string,
        prompt: row.prompt as string,
        status: row.status as string,
        recommended: row.recommended,
        citations: row.citations,
        created_at: row.created_at as string,
        city: (rep?.city as string | null) ?? null,
        vertical_slug: (rep?.vertical_slug as string | null) ?? null,
        business_type: (rep?.business_type as string | null) ?? null,
        client_name: (rep?.client_name as string | null) ?? null,
        website: (rep?.website as string | null) ?? null,
      });
    }

    if (data.length < PAGE) break;
  }

  return out;
}

export interface AggregateStats {
  runsScanned: number;
  runsPlaced: number;
  runsUnplaceable: number;
  mentions: number;
  distinctBusinesses: number;
  cities: number;
  cells: number;
  marketRows: number;
  namesDropped: number;
}

/**
 * Build every mention row and count what happened, without writing anything.
 *
 * `namesDropped` is what isExcludedFromShortlist and the alias filter removed. It is reported
 * rather than swallowed because it is the gap between the raw name count measured before this lane
 * and the smaller number that survives, and a silent drop of a large share of the dataset reads as
 * "the aggregation is broken" to anyone comparing the two.
 */
export function aggregate(runs: RunWithReport[]): { rows: MentionRow[]; stats: AggregateStats } {
  const rows: MentionRow[] = [];
  let runsPlaced = 0;
  let rawNames = 0;

  for (const run of runs) {
    rawNames += stringsFrom(run.recommended, "name").length;
    const produced = mentionsFromRun(run);
    if (produced.length) runsPlaced += 1;
    rows.push(...produced);
  }

  const businesses = new Set(rows.map((r) => r.normalized_name));
  const cities = new Set(rows.map((r) => `${r.city}|${r.state ?? ""}`));
  const cells = new Set(rows.map((r) => `${r.city}|${r.state ?? ""}|${r.service}`));
  const marketRows = new Set(
    rows.map((r) => `${r.city}|${r.state ?? ""}|${r.service}|${r.normalized_name}`)
  );

  return {
    rows,
    stats: {
      runsScanned: runs.length,
      runsPlaced,
      runsUnplaceable: runs.length - runsPlaced,
      mentions: rows.length,
      distinctBusinesses: businesses.size,
      cities: cities.size,
      cells: cells.size,
      marketRows: marketRows.size,
      namesDropped: rawNames - rows.length,
    },
  };
}
