// Generic Outscraper Google Maps Search transport (no SDK): submit ASYNC with the
// `X-API-KEY` header + a webhook so a serverless function never blocks waiting on a
// large pull, and normalize the webhook payload into per-query groups. Vertical-
// specific record mapping lives with each pipeline (see src/lib/medspa.ts).
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

/** Reduce a phone string to digits only; empty -> null so the unique index skips it. */
export function normalizePhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D+/g, "");
  return digits.length ? digits : null;
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
    const json = (await res.json()) as {
      id?: string;
      // Outscraper returns {"error": true, "errorMessage": "..."} — reading
      // `error` first coerced that boolean to "true" and threw the real reason
      // away, which is why every failed pull logged a bare `true`. Read the
      // message field first and only accept `error` when it is a string.
      error?: string | boolean;
      errorMessage?: string;
      message?: string;
    };
    if (!res.ok || !json.id) {
      const detail =
        json.errorMessage
        || (typeof json.error === "string" ? json.error : null)
        || json.message;
      return { ok: false, error: detail || `http_${res.status}` };
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
