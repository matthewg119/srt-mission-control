// DataForSEO Business Listings: a database query for local businesses, not a live scrape.
//
//   POST https://api.dataforseo.com/v3/business_data/business_listings/search/live
//
// WHY THIS AND NOT OUTSCRAPER. Measured 2026-09-27 on the account that already exists: $0.012 per
// task plus $0.00036 per result, so 1,000 businesses is about $0.37 against Outscraper's $3.00, and
// the balance was already $49.57, which is roughly 137,000 records of credit nobody has to buy. It is
// also SYNCHRONOUS, so there is no webhook to lose a delivery in and no timeout to hold a batch open.
//
// AND IT IS A QUERY, WHICH IS THE PART THAT MATTERS MORE THAN THE PRICE. `categories` takes up to ten
// Google category keys, `location_name` takes "Dallas,Texas,United States" so nothing has to be
// geocoded, and `is_claimed` says whether the owner has verified the listing, which is a free quality
// gate on a list we are about to pay a model to qualify.
//
// Auth is HTTP Basic over DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD, which this deployment already has.

const BASE = "https://api.dataforseo.com/v3";

/** One item from the listings search. Only the fields the lane actually maps. */
export interface DfsListing {
  title?: string | null;
  original_title?: string | null;
  /** The business website. The field this whole lane exists to get. */
  url?: string | null;
  domain?: string | null;
  phone?: string | null;
  place_id?: string | null;
  cid?: string | null;
  category?: string | null;
  additional_categories?: string[] | null;
  rating?: { value?: number | null; votes_count?: number | null } | null;
  is_claimed?: boolean | null;
  address_info?: {
    address?: string | null;
    city?: string | null;
    zip?: string | null;
    region?: string | null;
    country_code?: string | null;
  } | null;
  [key: string]: unknown;
}

export interface DfsSearchResult {
  ok: boolean;
  items: DfsListing[];
  /** How many match the filter in total, which is usually far more than were returned. */
  totalCount: number;
  /** What DataForSEO charged for this call, from its own response. Never estimated. */
  costUsd: number;
  error?: string;
}

function creds(): { login: string; password: string } | null {
  const login = (process.env.DATAFORSEO_LOGIN ?? "").trim();
  const password = (process.env.DATAFORSEO_PASSWORD ?? "").trim();
  return login && password ? { login, password } : null;
}

/** No credentials means the door refuses before anything is spent, never a throw. */
export function isConfigured(): boolean {
  return creds() !== null;
}

/**
 * One page of listings.
 *
 * ‼️ `limit` IS CAPPED AT 1000 BY THE API, and the cap is not the interesting constraint. Records cost
 * $0.00036 each; what costs real money downstream is the Claude qualification sweep that runs over
 * every row this returns. So the caller decides the limit from what it is willing to qualify, not
 * from what is affordable to pull.
 */
export async function searchListings(args: {
  categories: string[];
  /**
   * "lat,lng,radiusKm". THE ONLY GEO FILTER THIS ENDPOINT HONOURS.
   *
   * ‼️ `location_name` AND `location_code` ARE ACCEPTED AND THEN IGNORED. Measured 2026-09-27: a
   * name-filtered query returns status 20000 Ok with 85,179 matches from Miami, Doncaster and
   * Vancouver, where the same query by coordinate returns 804, all in the Dallas metro. The endpoint
   * answers a different question rather than refusing, so the status code proves nothing. See
   * src/lib/geocode.ts, which exists only because of this.
   */
  locationCoordinate: string;
  limit: number;
  offset?: number;
  /** Only listings whose owner has verified them on Google. */
  claimedOnly?: boolean;
}): Promise<DfsSearchResult> {
  const c = creds();
  if (!c) return { ok: false, items: [], totalCount: 0, costUsd: 0, error: "DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD are not set" };

  const task: Record<string, unknown> = {
    categories: args.categories.slice(0, 10),
    location_coordinate: args.locationCoordinate,
    limit: Math.max(1, Math.min(1000, args.limit)),
  };
  if (args.offset) task.offset = args.offset;
  if (args.claimedOnly) task.filters = [["is_claimed", "=", true]];

  const auth = Buffer.from(`${c.login}:${c.password}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(`${BASE}/business_data/business_listings/search/live`, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([task]),
    });
  } catch (e) {
    return { ok: false, items: [], totalCount: 0, costUsd: 0, error: "DataForSEO unreachable: " + (e as Error).message };
  }
  if (!res.ok) {
    return { ok: false, items: [], totalCount: 0, costUsd: 0, error: `DataForSEO returned HTTP ${res.status}` };
  }

  const body = (await res.json()) as {
    cost?: number;
    tasks?: Array<{ status_code?: number; status_message?: string; result?: Array<{ total_count?: number; count?: number; items?: DfsListing[] }> }>;
  };
  const t = body.tasks?.[0];
  // 20000 is DataForSEO's success code. Anything else is reported, never thrown.
  if (!t || t.status_code !== 20000) {
    return {
      ok: false, items: [], totalCount: 0, costUsd: body.cost ?? 0,
      error: `DataForSEO refused the query: ${t?.status_code ?? "no task"} ${t?.status_message ?? ""}`.trim(),
    };
  }
  const r = t.result?.[0];
  return {
    ok: true,
    items: r?.items ?? [],
    totalCount: r?.total_count ?? 0,
    costUsd: body.cost ?? 0,
  };
}
