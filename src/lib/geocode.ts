// A metro name into a latitude and longitude, free, through the dataset cache.
//
// ‼️ IT EXISTS BECAUSE DataForSEO's `location_name` AND `location_code` ARE SILENTLY IGNORED BY THE
// BUSINESS LISTINGS ENDPOINT. Measured 2026-09-27: `location_name: "Dallas,Texas,United States"`
// returns status 20000 Ok and 85,179 total matches, with results from Miami, Doncaster, Leicester and
// Vancouver. `location_code` behaves identically. Only `location_coordinate` filters, and it returned
// 804 with every city in the Dallas metro. So a coordinate is not optional, and the API will not
// convert one for us.
//
// That failure shape is worth naming: the endpoint did not refuse the unsupported filter, it accepted
// it and answered a different question. Checking the status code proves nothing here; only looking at
// the rows does.
//
// Nominatim is OpenStreetMap's own geocoder. No key, free, and its usage policy asks for at most one
// request a second and a User-Agent that identifies the caller. One lookup per pull, cached for a
// year, so both are comfortably satisfied.

import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";

/** A place does not move, so this is effectively permanent. */
const GEO_TTL_DAYS = 365;

const UA = "srt-mission-control/1.0 (lead sourcing; mission.srtagency.com)";

export interface Coordinate {
  lat: number;
  lon: number;
  /** What Nominatim thought it found, so a card can show the operator what was matched. */
  label: string;
}

/**
 * Geocode a metro, or null when nothing was matched.
 *
 * ‼️ NULL IS A REFUSAL, NOT A DEFAULT. A pull whose metro could not be resolved must not fall back to
 * a coordinate somebody picked: that is how "Springfield" buys the wrong one of thirty-four, except
 * the operator has no way to tell because the card still says Springfield.
 */
export async function geocodeMetro(query: string): Promise<Coordinate | null> {
  const q = query.trim();
  if (!q) return null;

  try {
    const { payload } = await getOrFetch<Coordinate | null>({
      clientId: null,
      kind: "geo.nominatim",
      cacheKey: cacheKeyOf({ q: q.toLowerCase() }),
      ttlDays: GEO_TTL_DAYS,
      provider: "nominatim openstreetmap",
      params: { q },
      fetch: async () => ({ payload: await lookup(q), costUsd: 0 }),
    });
    return payload ?? null;
  } catch {
    // A geocoder that could not be reached is not a licence to guess. The caller refuses.
    return null;
  }
}

/** What a reverse lookup can say about a point. */
export interface ReversePlace {
  /** The state as Nominatim spelled it, unvalidated. Callers put it through canonicalStateName. */
  stateName: string | null;
  /** Lowercase ISO country code, e.g. "us". Null when Nominatim did not say. */
  countryCode: string | null;
  label: string;
}

/**
 * Which state (and country) a coordinate is in, or null when nothing was matched.
 *
 * ‼️ IT EXISTS FOR THE PROGRESS CARD AND NOTHING ELSE. The national crawl reports "how far through
 * Texas are we", and a cell that measured ZERO has no business rows to read a region off, which is
 * about a quarter of the seed grid (the ocean). So the state has to come from the cell's own centre.
 * `raw_leads.state` answers the different question of how many LEADS are in each state, and the card
 * prints both rather than letting one stand in for the other.
 *
 * ‼️ NULL IS A REFUSAL, exactly as geocodeMetro's is. A cell whose centre could not be placed is
 * reported as `unplaced` and tried again for free later; it is never folded into a neighbouring state,
 * because a progress card that quietly attributes cells to the wrong state is worse than one that
 * admits it does not know yet.
 *
 * `zoom=5` is the state level, which is all that is wanted and is the cheapest thing to ask for. One
 * lookup per cell, cached for a year, so the whole campaign is a few hundred requests over its life
 * and Nominatim's one-request-a-second policy is comfortably satisfied.
 */
export async function reverseGeocode(lat: number, lon: number): Promise<ReversePlace | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  try {
    const { payload } = await getOrFetch<ReversePlace | null>({
      clientId: null,
      kind: "geo.nominatim.reverse",
      // Rounded to the stored cell precision, so the same centre is one cache key.
      cacheKey: cacheKeyOf({ lat: lat.toFixed(4), lon: lon.toFixed(4) }),
      ttlDays: GEO_TTL_DAYS,
      provider: "nominatim openstreetmap",
      params: { lat, lon },
      fetch: async () => ({ payload: await reverseLookup(lat, lon), costUsd: 0 }),
    });
    return payload ?? null;
  } catch {
    return null;
  }
}

async function reverseLookup(lat: number, lon: number): Promise<ReversePlace | null> {
  const url =
    "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=5&addressdetails=1" +
    "&lat=" + encodeURIComponent(String(lat)) +
    "&lon=" + encodeURIComponent(String(lon));
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    display_name?: string;
    address?: { state?: string; province?: string; country_code?: string };
  };
  // ‼️ AN OCEAN POINT IS A SUCCESSFUL LOOKUP WITH NO ADDRESS, not an error. Nominatim answers 200 with
  // an `error` field or an empty address for a point in the Atlantic, and about a quarter of the seed
  // grid is exactly that. Returning null here would leave those cells retrying forever; returning a
  // place with no state lets the caller bucket them as offshore once and be done.
  const addr = body.address ?? {};
  return {
    stateName: addr.state ?? addr.province ?? null,
    countryCode: addr.country_code ? addr.country_code.toLowerCase() : null,
    label: body.display_name ?? "",
  };
}

async function lookup(q: string): Promise<Coordinate | null> {
  const url =
    "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=" + encodeURIComponent(q);
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) return null;
  const body = (await res.json()) as Array<{ lat?: string; lon?: string; display_name?: string }>;
  const hit = body[0];
  if (!hit?.lat || !hit?.lon) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon, label: hit.display_name ?? q };
}
