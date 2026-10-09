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
import type { DfsListing } from "@/lib/dataforseo-places";
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

  /**
   * Whether the owner has verified the Google listing.
   *
   * ‼️ TRI-STATE, AND null IS NOT false. Measured on the Dallas 500: 429 claimed, 71 not. An
   * unclaimed listing is the strongest "nobody is managing this" signal in the payload, which is
   * exactly why "the source did not say" must never be written as "not claimed". Same doctrine as
   * MxVerdict in mx.ts, where null and [] mean opposite things.
   */
  isClaimed: boolean | null;

  /** The business pin. Required by /dashboard/territory: a row without one cannot be a dot. */
  latitude: number | null;
  longitude: number | null;

  /**
   * The best-reviewed business Google shows beside this one.
   *
   * ‼️ CHOSEN ON REVIEW COUNT, NOT ON RATING, because the opener compares COUNTS: "you have 23
   * reviews, the clinic down the road has 310". A 5.0 rating from four people is not the thing that
   * makes a clinic owner uncomfortable.
   */
  competitorName: string | null;
  competitorRating: number | null;
  competitorReviews: number | null;

  raw: Record<string, unknown>;
}

/**
 * The best-reviewed neighbour out of DataForSEO's `people_also_search`.
 *
 * ‼️ IT REFUSES AN ENTRY WITH NO VOTE COUNT RATHER THAN RANKING IT TOP. Measured on the stored
 * payload: plenty of entries carry `"votes_count": null`, and any comparison that treats a missing
 * count as zero still SORTS it, so a lead whose neighbours all lack counts would be handed one at
 * random and the opening line would read "the clinic down the road has  reviews". Nothing is a
 * better answer than something invented.
 *
 * Pure and total, so the backfill in docs/2026-10-08-lead-personalisation.sql and this mapper can be
 * compared against each other.
 */
export function topCompetitor(
  raw: Record<string, unknown>
): { name: string; rating: number | null; reviews: number } | null {
  const list = raw.people_also_search;
  if (!Array.isArray(list)) return null;

  let best: { name: string; rating: number | null; reviews: number } | null = null;
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { title?: unknown; rating?: { value?: unknown; votes_count?: unknown } | null };
    const name = str(e.title);
    const reviews = num(e.rating?.votes_count);
    if (!name || reviews === null) continue;
    if (!best || reviews > best.reviews) {
      best = { name, rating: num(e.rating?.value), reviews };
    }
  }
  return best;
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

/**
 * A coordinate, which `num` above CANNOT read.
 *
 * ‼️ num() STRIPS THE MINUS SIGN, AND FOR A LONGITUDE THAT IS THE WRONG HEMISPHERE. Its
 * character class is `[^0-9.]`, written for "1,234 reviews" and "4.7 stars" where a sign is noise.
 * Every US longitude is negative, so a vendor that ever answers "-96.7970" as a STRING rather than a
 * number would put a Dallas clinic in the Yellow Sea, with no error anywhere and a dot on the map to
 * prove it. DataForSEO sends numbers today, which is exactly the kind of thing that changes quietly.
 *
 * Bounds are checked here as well as in the column's CHECK, because a mapper that hands Postgres a
 * value it will reject fails the whole 500-row insert over one bad coordinate.
 */
function coord(v: unknown, limit: 90 | 180): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  if (!Number.isFinite(n) || Math.abs(n) > limit) return null;
  // ‼️ 0,0 IS REFUSED. It is the shape a missing coordinate takes when something upstream
  // coalesced it, it is in the Gulf of Guinea, and on a US map it is not even visible as wrong: the
  // dot simply does not render and the lead reads as unmapped. Better refused by name here.
  if (n === 0) return null;
  return n;
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
    // ‼️ A SYNTHETIC ID WHEN MAPS GIVES NONE, THE SAME WAY fromCsv DOES. Null place_ids are DISTINCT
    // in the unique index, so a re-driven pull inserts every placeless row again: measured on a
    // synthetic payload where one record in four had no place_id. Falling back to the domain makes
    // those rows idempotent too, and the domain is already this lane's identity rule, which is what
    // ACTIVE_KEYS in dedup.ts narrows to. The prefix keeps the value greppably NOT a Google id.
    placeId: str(rec.place_id) ?? str(rec.google_id) ?? (normalizeDomain(website) ? "site:" + normalizeDomain(website) : null),
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
    // ‼️ READ OFF THE INDEX SIGNATURE AND UNMEASURED, WHICH IS WHY IT IS num()/str() AND NOT A
    // CAST. Outscraper's Maps rows do usually carry latitude and longitude, but this door has had no
    // production pull since the DataForSEO one was built, so nothing here is measured the way the
    // 500 Dallas rows are. A field that is absent reads null and the lead is simply not mappable,
    // which is the correct outcome rather than a dot at 0,0 in the Gulf of Guinea.
    isClaimed: typeof rec.verified === "boolean" ? rec.verified : null,
    latitude: coord(rec.latitude, 90),
    longitude: coord(rec.longitude, 180),
    // No people_also_search on this vendor. Null rather than guessed.
    competitorName: null,
    competitorRating: null,
    competitorReviews: null,
    raw: rec as Record<string, unknown>,
  };
}


/**
 * A DataForSEO business listing into a raw lead.
 *
 * Sibling of `fromOutscraper` and deliberately the same shape: the pull stage, the qualify sweep, the
 * crawl and the verifier all read `RawLeadInput` and none of them knows or cares which vendor filled
 * it. That is what makes a source a DOOR rather than a second engine.
 *
 * ‼️ THE SYNTHETIC PLACE ID FALLBACK IS HERE TOO, for the reason it is in fromOutscraper: a null
 * place_id is DISTINCT in the unique index, so without it a re-driven pull inserts the row again.
 */
export function fromDataForSeo(
  item: DfsListing,
  ctx: { runId: string; sourceQuery: string | null; sourceMetro: string | null; verticalSlug?: string | null }
): RawLeadInput | null {
  const businessName = str(item.title) ?? str(item.original_title);
  if (!businessName) return null;

  const website = str(item.url);
  const domain = normalizeDomain(website);
  const addr = item.address_info ?? {};
  // Once, not once per column: it walks the whole people_also_search array.
  const rival = topCompetitor(item as Record<string, unknown>);

  return {
    runId: ctx.runId,
    source: "dataforseo",
    sourceQuery: ctx.sourceQuery,
    sourceMetro: ctx.sourceMetro,
    placeId: str(item.place_id) ?? str(item.cid) ?? (domain ? "site:" + domain : null),
    businessName,
    domain,
    website,
    phone: str(item.phone),
    fullAddress: str(addr.address),
    city: str(addr.city),
    // DataForSEO returns the full region name ("Texas"), which is what geo.ts already reads.
    state: str(addr.region),
    postalCode: str(addr.zip),
    categories: [str(item.category), ...(item.additional_categories ?? [])].filter(Boolean).join(", ") || null,
    primaryType: str(item.category),
    rating: typeof item.rating?.value === "number" ? item.rating.value : null,
    reviewCount: typeof item.rating?.votes_count === "number" ? item.rating.votes_count : null,
    // No Instagram field on this endpoint. Null rather than guessed.
    instagramHandle: null,
    ownerName: null,
    verticalSlug: ctx.verticalSlug ?? null,
    businessType: null,
    avatarSlug: null,
    // ‼️ ALL FOUR ARE MEASURED PRESENT ON EVERY ONE OF THE 500 STORED DALLAS ROWS, which is why
    // this door fills them and the other two do not. They were in `raw` from the first pull and
    // nothing read them for ten days.
    isClaimed: typeof item.is_claimed === "boolean" ? item.is_claimed : null,
    latitude: coord(item.latitude, 90),
    longitude: coord(item.longitude, 180),
    competitorName: rival?.name ?? null,
    competitorRating: rival?.rating ?? null,
    competitorReviews: rival?.reviews ?? null,
    raw: item as Record<string, unknown>,
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
    // A dropped CSV carries none of these, and inventing a coordinate from a city name would put
    // every lead in a metro on one pixel. Null, and the row is simply not a dot.
    isClaimed: null,
    latitude: null,
    longitude: null,
    competitorName: null,
    competitorRating: null,
    competitorReviews: null,
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
    is_claimed: r.isClaimed,
    latitude: r.latitude,
    longitude: r.longitude,
    competitor_name: r.competitorName,
    competitor_rating: r.competitorRating,
    competitor_reviews: r.competitorReviews,
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
