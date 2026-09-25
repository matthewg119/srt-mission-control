// Stage 1: the raw pull, into one table, whatever the source was.
//
// Matthew, 2026-09-17: "Raw pull → Supabase raw_leads table with source + pull metadata."
//
// ‼️ THE TRANSPORT ALREADY EXISTED AND IS NOT REBUILT HERE. src/lib/outscraper.ts is a generic async
// Google Maps client (submitMapsSearch, toGroups, webhook, no SDK) and src/lib/medspa.ts already maps
// a Maps record to a row, drops dermatology, plastic surgery and hospital groups, holds a national
// chain list and scores each lead. This file is the part that was missing: writing those rows into
// the shared raw_leads table with the pull metadata, so every source lands in one shape.
//
// ‼️ EMAIL ENRICHMENT STAYS OFF IN THE PULL. outscraper.ts says so on the params ("No enrichment
// param (email off)") and that is now load-bearing rather than incidental: enrichment is stage 4 and
// it runs on the KEPT file only. Turning it on here would buy addresses for every company including
// the half about to be dropped, which is the exact spend the reorder exists to avoid.
//
// ‼️ ONE ROW PER PLACE PER RUN, ENFORCED BY THE DATABASE. raw_leads has a unique index on
// (run_id, place_id), so a webhook that fires twice or a cron that re-enters inserts nothing twice.
// Dedupe ACROSS runs is a different question and belongs to suppression.

import { supabaseAdmin } from "@/lib/db";
import { normalizePhone, type OutscraperRecord } from "@/lib/outscraper";
import { normalizeDomain } from "@/lib/outreach/suppression";

export type LeadSource = "outscraper" | "dataforseo" | "socialscraper" | "csv" | "apollo";

export interface RawLeadInput {
  runId: string;
  source: LeadSource;
  sourceQuery: string | null;
  sourceMetro: string | null;
  placeId: string | null;
  businessName: string;
  domain: string | null;
  website: string | null;
  phone: string | null;
  fullAddress: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  categories: string | null;
  primaryType: string | null;
  rating: number | null;
  reviewCount: number | null;
  instagramHandle: string | null;
  ownerName: string | null;
  verticalSlug: string | null;
  businessType: string | null;
  avatarSlug: string | null;
  raw: Record<string, unknown>;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** The handle out of whichever field carries it, the same four medspa.ts already reads. */
export function extractInstagram(rec: OutscraperRecord): string | null {
  const candidates = [rec.instagram, rec.instagram_url, rec.site, rec.website].map((v) => str(v));
  for (const c of candidates) {
    if (!c) continue;
    const m = c.match(/instagram\.com\/([A-Za-z0-9_.]+)/i);
    if (m) return m[1];
  }
  return null;
}

/**
 * One Outscraper Maps record, in the shared shape.
 *
 * ‼️ READ DEFENSIVELY, because Outscraper's field names vary between responses. That is not
 * paranoia: OutscraperRecord's own comment says so, and the fields below each have two or three
 * spellings in the wild.
 */
export function fromOutscraper(
  rec: OutscraperRecord,
  ctx: { runId: string; sourceQuery: string | null; sourceMetro: string | null; verticalSlug?: string | null }
): RawLeadInput | null {
  const businessName = str(rec.name);
  if (!businessName) return null;

  const website = str(rec.site) ?? str(rec.website);

  return {
    runId: ctx.runId,
    source: "outscraper",
    sourceQuery: ctx.sourceQuery,
    sourceMetro: ctx.sourceMetro,
    placeId: str(rec.place_id) ?? str(rec.google_id),
    businessName,
    domain: normalizeDomain(website),
    website,
    phone: str(rec.phone) ?? str(rec.phone_1),
    fullAddress: str(rec.full_address),
    city: str(rec.city),
    state: str(rec.state) ?? str(rec.us_state),
    postalCode: str(rec.postal_code),
    categories: str(rec.subtypes) ?? str(rec.category) ?? str(rec.type),
    primaryType: str(rec.type) ?? str(rec.category),
    rating: num(rec.rating),
    reviewCount: num(rec.reviews) ?? num(rec.reviews_count),
    instagramHandle: extractInstagram(rec),
    ownerName: null,
    verticalSlug: ctx.verticalSlug ?? null,
    businessType: null,
    avatarSlug: null,
    raw: rec as Record<string, unknown>,
  };
}

/** The header names a dropped CSV resolved to, already matched by rules.ts. */
export interface CsvColumns {
  company: string;
  website: string;
  city: string | null;
  state: string | null;
  phone: string | null;
  email: string | null;
  /** Maps-shaped extras, when the scraper emitted them. All optional. */
  rating: string | null;
  reviews: string | null;
  categories: string | null;
  placeId: string | null;
}

/**
 * One row of a dropped CSV, in the shared shape.
 *
 * ‼️ `place_id` IS SYNTHESISED FROM THE ROW INDEX, AND IT IS NOT A HACK. storeRawLeads dedupes on
 * (run_id, place_id) and skips the check entirely when place_id is null, so a CSV pull would not
 * be idempotent: the `pulling` arm is re-driven on any tick that dies mid-write, and every
 * re-entry would insert the whole file again. The column's real contract is "the stable key across
 * two reads of the same source", and for a dropped file the row index is exactly that. There is
 * one run per batch, so (run_id, "csv:17") is unique.
 *
 * The `csv:` prefix is load-bearing in a different way: it keeps the value greppably NOT a Google
 * place id, so nobody later joins raw_leads to med_spa_leads on it and gets silence.
 *
 * ‼️ A REAL place_id FROM THE FILE WINS. A Maps scraper that emitted one is identifying the same
 * business better than the row number can, and two exports of one metro then dedupe against each
 * other rather than both landing.
 */
export function fromCsv(
  row: Record<string, string>,
  ctx: {
    runId: string;
    rowIndex: number;
    cols: CsvColumns;
    sourceQuery: string | null;
    sourceMetro?: string | null;
    verticalSlug?: string | null;
  }
): RawLeadInput | null {
  const cell = (header: string | null): string | null => (header ? str(row[header]) : null);

  const businessName = cell(ctx.cols.company);
  // Same refusal as fromOutscraper: raw_leads.business_name is NOT NULL, and a nameless row could
  // not be judged by qualify.ts even if it could be stored.
  if (!businessName) return null;

  const website = cell(ctx.cols.website);
  const realPlaceId = cell(ctx.cols.placeId);

  return {
    runId: ctx.runId,
    source: "csv",
    sourceQuery: ctx.sourceQuery,
    sourceMetro: ctx.sourceMetro ?? null,
    placeId: realPlaceId ?? "csv:" + ctx.rowIndex,
    businessName,
    domain: normalizeDomain(website),
    website,
    phone: cell(ctx.cols.phone),
    fullAddress: null,
    city: cell(ctx.cols.city),
    state: cell(ctx.cols.state),
    postalCode: null,
    categories: cell(ctx.cols.categories),
    primaryType: cell(ctx.cols.categories),
    rating: num(cell(ctx.cols.rating)),
    reviewCount: num(cell(ctx.cols.reviews)),
    instagramHandle: null,
    ownerName: null,
    verticalSlug: ctx.verticalSlug ?? null,
    businessType: null,
    avatarSlug: null,
    raw: row as Record<string, unknown>,
  };
}

export interface StoreResult {
  inserted: number;
  skipped: number;
  error?: string;
}

// Same bound and the same reasoning as store.ts and listprep.ts: a PostgREST write is one HTTP
// request, so the chunk is bounded by what a body can carry rather than by anything Postgres
// cares about.
const INSERT_CHUNK = 500;

/**
 * Write a pull into raw_leads.
 *
 * ‼️ ignoreDuplicates, SO A RE-ENTERED WEBHOOK ADDS NOTHING TWICE. The unique index is on
 * (run_id, place_id) and a row with no place_id is not covered by it, which is correct: a source
 * that cannot identify a place cannot promise the same place twice either, and refusing those rows
 * would drop every CSV lead.
 */
export async function storeRawLeads(rows: readonly RawLeadInput[]): Promise<StoreResult> {
  if (!rows.length) return { inserted: 0, skipped: 0 };

  const payload = rows.map((r) => ({
    run_id: r.runId,
    source: r.source,
    source_query: r.sourceQuery,
    source_metro: r.sourceMetro,
    place_id: r.placeId,
    business_name: r.businessName,
    domain: r.domain,
    website: r.website,
    phone: r.phone,
    phone_normalized: normalizePhone(r.phone),
    full_address: r.fullAddress,
    city: r.city,
    state: r.state,
    postal_code: r.postalCode,
    categories: r.categories,
    primary_type: r.primaryType,
    rating: r.rating,
    review_count: r.reviewCount,
    instagram_handle: r.instagramHandle,
    owner_name: r.ownerName,
    vertical_slug: r.verticalSlug,
    business_type: r.businessType,
    avatar_slug: r.avatarSlug,
    found_in_sources: [r.source],
    raw: r.raw,
  }));

  // ‼️ CHUNKED, BECAUSE THIS PATH HAD NEVER RUN. `fromOutscraper` had no production caller until the
  // 4️⃣ door, so every real call here came from a CSV that sweepPull had already trimmed. A Maps pull
  // of twenty queries at a 500 limit is ten thousand rows, and this was one PostgREST POST. Same
  // bound and same reasoning as INSERT_CHUNK in store.ts and listprep.ts.
  let inserted = 0;
  for (let i = 0; i < payload.length; i += INSERT_CHUNK) {
    const slice = payload.slice(i, i + INSERT_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("raw_leads")
      .upsert(slice, { onConflict: "run_id,place_id", ignoreDuplicates: true })
      .select("id");

    if (error) {
      // ‼️ PARTIAL SUCCESS IS REPORTED AS SUCH. The rows already committed are real, and a caller
      // told "0 inserted" would re-drive the whole pull to find them again.
      return {
        inserted,
        skipped: rows.length - inserted,
        error:
          `${error.message}. If that names raw_leads, ` +
          "docs/2026-09-17-list-prep-pipeline.sql has not been run on this database.",
      };
    }
    inserted += data?.length ?? 0;
  }

  return { inserted, skipped: rows.length - inserted };
}

/** Open a run. Everything downstream hangs off its id. */
export async function startRun(args: {
  label: string | null;
  source: LeadSource;
  queries: string[];
  icp: string | null;
  /** serviceKey() shaped, e.g. `medspa` or `dentist`. Copied onto every raw lead the run pulls. */
  vertical: string;
  slackChannelId?: string | null;
  slackThreadTs?: string | null;
}): Promise<{ ok: true; runId: string } | { ok: false; error: string }> {
  const { data, error } = await supabaseAdmin
    .from("list_pipeline_runs")
    .insert({
      label: args.label,
      source: args.source,
      source_queries: args.queries,
      icp_text: args.icp,
      vertical_slug: args.vertical,
      stage: "pulling",
      slack_channel_id: args.slackChannelId ?? null,
      slack_thread_ts: args.slackThreadTs ?? null,
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    return {
      ok: false,
      error:
        `the run could not be opened: ${error?.message ?? "no row"}. If that names ` +
        "list_pipeline_runs, docs/2026-09-17-list-prep-pipeline.sql has not been run.",
    };
  }
  return { ok: true, runId: String(data.id) };
}

/** The funnel, as it stands. Counts, never rates: a rate hides the denominator. */
export interface Funnel {
  raw: number;
  qualified: number;
  enriched: number;
  verified: number;
  sendable: number;
}

export function funnelLines(f: Funnel): string[] {
  const pct = (n: number) => (f.raw ? ` (${Math.round((n / f.raw) * 100)}%)` : "");
  return [
    "*The funnel*",
    `  raw        ${f.raw}`,
    `  qualified  ${f.qualified}${pct(f.qualified)}`,
    `  enriched   ${f.enriched}${pct(f.enriched)}`,
    `  verified   ${f.verified}${pct(f.verified)}`,
    `  sendable   ${f.sendable}${pct(f.sendable)}`,
    "",
    // ‼️ A PLANNING NUMBER, AND IT SAYS SO. Roughly 0.7 of a raw pull survives. Printing it without
    // the caveat turns an estimate into a target somebody then optimises the filters to hit.
    "_About 0.7 of a raw pull usually survives. That is a planning number, not a promise._",
  ];
}
