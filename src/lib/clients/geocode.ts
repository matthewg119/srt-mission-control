// Geocoding, for the market check only.
//
// ‼️ THE US CENSUS GEOCODER, NOT PLACES, AND THAT IS A TERMS DECISION.
// Amendment A2 §2 (revised): "Geocode with the US Census geocoder or a static ZIP-centroid
// dataset, not Places — market_center lives for the life of the tenant and Places
// coordinates are (as I understand the terms) cacheable for about 30 days."
//
// A market centre is stored for as long as the client exists and is the thing an
// exclusivity promise is measured against. Storing a Places coordinate for two years to
// enforce a contract term is not a thing to do quietly. The Census geocoder is a US
// government service, free, no key, and its output is public-domain data.
//
// It also means D-P13 is buildable today. The earlier read said the market check was
// blocked on a Google Places key nobody has. It is not.
//
// LIMITS, stated rather than discovered: US only, and it geocodes what the address FILE
// knows. A brand-new building or a suite in a plaza can miss. A miss returns null and the
// caller falls back to a hand-entered centre, which is what the board already supports.

import { supabaseAdmin } from "@/lib/db";
import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";

const BASE = "https://geocoding.geo.census.gov/geocoder/locations";

/** Their current national address benchmark. Versioned by them, not by us. */
const BENCHMARK = "Public_AR_Current";

export interface GeoPoint {
  lat: number;
  lng: number;
  /** What the geocoder matched, so a wrong pin is traceable rather than mysterious. */
  matchedAddress: string;
}

/**
 * Thrown when the geocoder could not be ASKED, as opposed to answering "no match".
 *
 * ‼️ THIS DISTINCTION DID NOT EXIST UNTIL 2026-09-18 AND ITS ABSENCE IS WHY THIS FILE COULD NOT BE
 * CACHED. Every failure here collapsed into the same null: a timeout, a 503 and "the national
 * address file does not contain this address" were one value. The first two must never be kept;
 * the third is a real answer and keeping it is the entire point. geocodeZip's own doc comment
 * already states the general rule, in capitals, about its own null: the caller must treat it as
 * "could not check" and never as "no conflict".
 */
class GeocodeUnavailable extends Error {
  constructor() {
    super("the geocoder did not answer");
    this.name = "GeocodeUnavailable";
  }
}

async function call(url: string): Promise<GeoPoint | null> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // A slow geocoder must never hold up provisioning or a checkout.
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) throw new GeocodeUnavailable();

  const json = (await res.json()) as {
    result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number }; matchedAddress?: string }> };
  };

  // ‼️ NO `result` KEY IS AN OUTAGE, NOT A NO-MATCH, AND THE SPLIT ABOVE IS USELESS WITHOUT THIS.
  // The Census service answers 200 with an error envelope for some malformed and edge inputs. A
  // real no-match returns `result.addressMatches: []`. Without this line the error envelope falls
  // through as `null` and gets FILED as "the national address file does not contain this address"
  // for ninety days, which then pins the client's market centre to a ZIP centroid for the life of
  // the tenant. That centre is what an exclusivity promise is measured against.
  if (!json.result) throw new GeocodeUnavailable();

  const match = json.result.addressMatches?.[0];
  const x = match?.coordinates?.x;
  const y = match?.coordinates?.y;

  // x is LONGITUDE and y is LATITUDE. Getting this backwards puts every American clinic in
  // the Indian Ocean, and it is the single easiest mistake to make here.
  if (typeof x !== "number" || typeof y !== "number") return null;

  return { lat: y, lng: x, matchedAddress: match?.matchedAddress ?? "" };
}

/**
 * How long a geocode stays true.
 *
 * ‼️ NINETY DAYS, AND THE CADENCE IS THEIRS RATHER THAN OURS. A matched street address does not
 * move, so the number could live forever; a NO MATCH is the half that has to expire, because the
 * header above says why one happens: "a brand-new building or a suite in a plaza can miss", and
 * that stops being true when the Census publishes its next address file. One constant covers both
 * because a free re-read of a permanent coordinate costs nothing, and pinning the window to their
 * release schedule is the only honest number available.
 */
const GEOCODE_TTL_DAYS = 90;

/**
 * A full street address to a point, through the cache.
 *
 * ‼️ null IS CACHED HERE AND THAT IS DELIBERATE, WHICH MAKES THIS THE ONE LANE THAT INVERTS THE
 * HOUSE RULE. Everywhere else null means "we could not check" and must never be kept. Here the
 * unreachable case throws GeocodeUnavailable and the surviving null means something else
 * entirely: the national address file does not contain this address. That is an answer, it is the
 * answer the caller acts on by falling back to a hand-entered centre, and re-asking gets the same
 * no until the next Census release.
 *
 * client_id is null because a street address resolves to the same point for whoever asks.
 */
export async function geocodeAddress(parts: {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): Promise<GeoPoint | null> {
  const line = [parts.addressLine1, parts.city, parts.state, parts.postalCode]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ");

  if (!line) return null;

  try {
    const { payload } = await getOrFetch<GeoPoint | null>({
      clientId: null,
      kind: "census.geocode",
      cacheKey: cacheKeyOf({ line, benchmark: BENCHMARK }),
      ttlDays: GEOCODE_TTL_DAYS,
      provider: "us census geocoder",
      params: { line, benchmark: BENCHMARK },
      // A US government service, free and public domain, so this zero is a measurement. The
      // benchmark is in the key because a new benchmark is a different question.
      fetch: async () => ({
        payload: await call(
          `${BASE}/onelineaddress?address=${encodeURIComponent(line)}&benchmark=${BENCHMARK}&format=json`
        ),
        costUsd: 0,
      }),
    });
    return payload;
  } catch {
    // Unreachable, malformed, or timed out. Nothing was cached, and the caller falls back the
    // same way it always did.
    return null;
  }
}

/**
 * A ZIP to its centroid.
 *
 * ‼️ THE CENSUS GEOCODER CANNOT DO THIS, AND I CHECKED RATHER THAN ASSUMED.
 * Measured 2026-08-18 against the live service:
 *
 *   "27403"                                  -> NO MATCH
 *   "27403, NC"                              -> NO MATCH
 *   "Greensboro, NC 27403"                   -> NO MATCH
 *   "1200 W Market St, Greensboro, NC 27403" -> 36.0734, -79.8069
 *
 * It geocodes STREET ADDRESSES. That is fine for the intake side, where we have the
 * clinic's canonical address, and useless for the checkout side, where a stranger types a
 * ZIP. This is exactly why A2 §2 offers two options: "the US Census geocoder OR a static
 * ZIP-centroid dataset". The first serves intake; the second serves checkout.
 *
 * So this reads a local table rather than calling anything. `zip_centroids` is loaded from
 * the Census ZCTA Gazetteer (public domain, one file, no key, no vendor). Until it is
 * loaded this returns null — and the CALLER MUST TREAT NULL AS "COULD NOT CHECK" AND SAY SO,
 * never as "no conflict". A market check that silently always passes is worse than no market
 * check, because everyone believes it ran.
 */
export async function geocodeZip(zip: string): Promise<GeoPoint | null> {
  const clean = zip.trim().slice(0, 5);
  if (!/^\d{5}$/.test(clean)) return null;

  const { data } = await supabaseAdmin
    .from("zip_centroids")
    .select("zip, lat, lng")
    .eq("zip", clean)
    .maybeSingle();

  if (!data) return null;

  return {
    lat: data.lat as number,
    lng: data.lng as number,
    matchedAddress: `ZCTA ${data.zip as string}`,
  };
}

/** Has the ZIP table been loaded at all? Distinguishes "unknown ZIP" from "no data". */
export async function zipCentroidsLoaded(): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from("zip_centroids")
    .select("zip", { count: "exact", head: true });
  return (count ?? 0) > 0;
}

/**
 * The market centre, with the precision it was found at.
 *
 * ‼️ THE STREET ADDRESS IS NOT ALWAYS THERE, AND THAT IS NOT AN EDGE CASE.
 * Measured 2026-08-18 on SRT's own record: "2701 seabiscuit ln, Greensboro, NC 27410"
 * returns NO MATCH from Census in every formatting we tried. The national address file does
 * not cover everything — new builds, some residential streets, suites in plazas.
 *
 * Before this existed, that meant market_center stayed NULL, which means the client HOLDS NO
 * MARKET AT ALL: findHeldMarketForZip skips centre-less rows, so an exclusivity promise
 * silently stops being enforced for exactly the clients whose address is unusual. That is
 * the worst kind of failure — it looks like everything is fine.
 *
 * So the ZIP centroid is the fallback. A ZCTA centroid is typically two to three miles from
 * any address inside it, against a ten-mile radius, so it is fit for the question being
 * asked. It is NOT as good as the address, so the precision comes back with it and gets
 * stored — a market boundary drawn from a ZIP is a thing somebody should be able to see.
 */
export interface MarketCenter extends GeoPoint {
  precision: "address" | "zip";
}

export async function resolveMarketCenter(parts: {
  addressLine1?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}): Promise<MarketCenter | null> {
  const exact = await geocodeAddress(parts).catch(() => null);
  if (exact) return { ...exact, precision: "address" };

  const zip = (parts.postalCode ?? "").trim();
  if (!zip) return null;

  const centroid = await geocodeZip(zip).catch(() => null);
  if (!centroid) return null;

  return { ...centroid, precision: "zip" };
}
