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

const BASE = "https://geocoding.geo.census.gov/geocoder/locations";

/** Their current national address benchmark. Versioned by them, not by us. */
const BENCHMARK = "Public_AR_Current";

export interface GeoPoint {
  lat: number;
  lng: number;
  /** What the geocoder matched, so a wrong pin is traceable rather than mysterious. */
  matchedAddress: string;
}

async function call(url: string): Promise<GeoPoint | null> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // A slow geocoder must never hold up provisioning or a checkout.
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) return null;

  const json = (await res.json()) as {
    result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number }; matchedAddress?: string }> };
  };

  const match = json.result?.addressMatches?.[0];
  const x = match?.coordinates?.x;
  const y = match?.coordinates?.y;

  // x is LONGITUDE and y is LATITUDE. Getting this backwards puts every American clinic in
  // the Indian Ocean, and it is the single easiest mistake to make here.
  if (typeof x !== "number" || typeof y !== "number") return null;

  return { lat: y, lng: x, matchedAddress: match?.matchedAddress ?? "" };
}

/** A full street address to a point. Returns null on any miss, never throws. */
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
    return await call(
      `${BASE}/onelineaddress?address=${encodeURIComponent(line)}&benchmark=${BENCHMARK}&format=json`
    );
  } catch {
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
