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
