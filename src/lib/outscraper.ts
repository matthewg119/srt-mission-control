// Outscraper Google Maps Search client + record mappers for the pest-control
// prospecting pipeline. We use the REST API directly (no SDK) with the
// `X-API-KEY` header, and always submit ASYNC with a webhook so the serverless
// function never blocks waiting for a 500-record pull.
//
// Email enrichment is intentionally OFF (base records only) — see the
// prospect-pipeline plan. Records land in the `prospect_leads` shape below.
//
// Docs: https://app.outscraper.com/api-docs#tag/Google-Maps

const OUTSCRAPER_BASE = "https://api.outscraper.com";

export interface OutscraperRecord {
  // Field names vary slightly across Outscraper responses; we read defensively.
  name?: string;
  full_address?: string;
  city?: string;
  state?: string;
  us_state?: string;
  postal_code?: string;
  phone?: string;
  phone_1?: string;
  site?: string;
  website?: string;
  type?: string;
  category?: string;
  subtypes?: string;
  rating?: number | string;
  reviews?: number | string;
  reviews_count?: number | string;
  place_id?: string;
  google_id?: string;
  email?: string;
  [key: string]: unknown;
}

export interface ProspectLeadRow {
  business_name: string;
  phone: string | null;
  phone_normalized: string | null;
  email: string | null;
  website: string | null;
  full_address: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  categories: string | null;
  rating: number | null;
  review_count: number | null;
  google_place_id: string | null;
  source: string;
  search_zip: string;
}

/** Reduce a phone string to digits only; empty -> null so the unique index skips it. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  return digits.length ? digits : null;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

/** Map one raw Outscraper business record into a `prospect_leads` row. */
export function mapRecord(r: OutscraperRecord, searchZip: string): ProspectLeadRow | null {
  const business_name = str(r.name);
  if (!business_name) return null; // skip junk rows with no name
  const phone = str(r.phone) ?? str(r.phone_1);
  return {
    business_name,
    phone,
    phone_normalized: normalizePhone(phone),
    email: str(r.email),
    website: str(r.site) ?? str(r.website),
    full_address: str(r.full_address),
    city: str(r.city),
    state: str(r.state) ?? str(r.us_state),
    postal_code: str(r.postal_code),
    categories: str(r.category) ?? str(r.type) ?? str(r.subtypes),
    rating: num(r.rating),
    review_count: num(r.reviews) ?? num(r.reviews_count),
    google_place_id: str(r.place_id) ?? str(r.google_id),
    source: "outscraper",
    search_zip: searchZip,
  };
}

export interface SubmitResult {
  ok: boolean;
  requestId?: string;
  error?: string;
}

/**
 * Submit an ASYNC Google Maps search for a batch of queries (one per ZIP).
 * Returns Outscraper's request id; results arrive later via the webhook.
 */
export async function submitMapsSearch(
  queries: string[],
  opts: { limit: number; webhook: string; region?: string }
): Promise<SubmitResult> {
  const apiKey = process.env.OUTSCRAPER_API_KEY;
  if (!apiKey) return { ok: false, error: "OUTSCRAPER_API_KEY not set" };
  if (!queries.length) return { ok: false, error: "no queries" };

  // Repeated `query` params + async + webhook. No enrichment param (email off).
  const params = new URLSearchParams();
  for (const q of queries) params.append("query", q);
  params.set("limit", String(opts.limit));
  params.set("async", "true");
  params.set("webhook", opts.webhook);
  params.set("region", opts.region ?? "US");
  params.set("language", "en");

  const url = `${OUTSCRAPER_BASE}/maps/search-v3?${params.toString()}`;

  try {
    const res = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    const json = (await res.json()) as { id?: string; error?: string; message?: string };
    if (!res.ok || !json.id) {
      return { ok: false, error: json.error || json.message || `http_${res.status}` };
    }
    return { ok: true, requestId: json.id };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Normalize the webhook payload's `data` into per-query groups.
 * Outscraper returns `data` as an array of arrays (one inner array per query,
 * in the submitted order). Older/edge responses may send a flat array — treat
 * that as a single group so nothing is lost.
 */
export function toGroups(data: unknown): OutscraperRecord[][] {
  if (!Array.isArray(data)) return [];
  if (data.length && Array.isArray(data[0])) {
    return data as OutscraperRecord[][];
  }
  return [data as OutscraperRecord[]];
}
