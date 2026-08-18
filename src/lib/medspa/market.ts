// One clinic per market.
//
// A STRING key, not geography. No radius, no geocoder, no lat/lng: the promise we
// make is "we work with one clinic per market", and a normalized "city|state" is
// what a human would check. Anything cleverer is a false precision that would still
// need a human to adjudicate.
//
// The check FLAGS and Slacks. It never blocks. Refunding a duplicate takes two
// minutes; losing a real sale because "Winston Salem" did not match
// "Winston-Salem" is unrecoverable and, worse, invisible.

import { supabaseAdmin } from "@/lib/db";
import { LIVE_SUBSCRIPTION_STATUSES } from "@/lib/medspa/stripe";

const STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca",
  colorado: "co", connecticut: "ct", delaware: "de", florida: "fl", georgia: "ga",
  hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia",
  kansas: "ks", kentucky: "ky", louisiana: "la", maine: "me", maryland: "md",
  massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms",
  missouri: "mo", montana: "mt", nebraska: "ne", nevada: "nv",
  "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok",
  oregon: "or", pennsylvania: "pa", "rhode island": "ri", "south carolina": "sc",
  "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt",
  virginia: "va", washington: "wa", "west virginia": "wv", wisconsin: "wi",
  wyoming: "wy", "district of columbia": "dc",
};

/**
 * Lowercase, strip diacritics and punctuation, collapse whitespace.
 *
 * "Winston-Salem" and "Winston Salem" must land on the same key, which is the whole
 * point: the hyphen is the single most likely difference between two people typing
 * the same city.
 */
function slug(v: string): string {
  return v
    .normalize("NFD")
    .replace(/\p{M}/gu, "") // strip combining marks; \p{M} keeps this source ASCII
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function stateCode(raw: string): string {
  const s = slug(raw);
  if (!s) return "";
  if (s.length === 2) return s;
  return STATES[s] ?? s.replace(/ /g, "");
}

/**
 * "greensboro|nc", or null when there is not enough to key on.
 *
 * Accepts a combined "Greensboro, NC" as well as separate parts, because the field
 * on the form is one input and people type it either way.
 */
export function marketKey(city?: string | null, state?: string | null): string | null {
  let c = (city ?? "").trim();
  let s = (state ?? "").trim();

  if (!s && c.includes(",")) {
    const parts = c.split(",");
    s = parts.pop()!.trim();
    c = parts.join(",").trim();
  }

  const citySlug = slug(c).replace(/ /g, "-");
  const st = stateCode(s);
  if (!citySlug || !st) return null;
  return `${citySlug}|${st}`;
}

export interface MarketConflict {
  conflict: true;
  withSubscriptionId: string;
  withEmail: string;
}

/** An existing LIVE subscription already holding this market, if any. */
export async function findMarketConflict(
  key: string | null,
  excludeSubscriptionId?: string
): Promise<MarketConflict | null> {
  if (!key) return null;

  let q = supabaseAdmin
    .from("medspa_subscriptions")
    .select("id, email")
    .eq("market_key", key)
    .in("status", LIVE_SUBSCRIPTION_STATUSES as unknown as string[])
    .limit(1);

  if (excludeSubscriptionId) q = q.neq("id", excludeSubscriptionId);

  const { data } = await q.maybeSingle();
  if (!data) return null;

  return { conflict: true, withSubscriptionId: data.id as string, withEmail: data.email as string };
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 D-P13 — distance, not a string
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ THE STRING CHECK ABOVE IS WHAT D-P13 FORBIDS: "The check reads distance from centre,
// NEVER ZIP EQUALITY." marketKey() compares a normalized "city|state", which gets both
// halves of the promise wrong. Two clinics a mile apart across a city line are two markets
// to it and one market in reality; two clinics forty miles apart in the same sprawling city
// are one market to it and two in reality.
//
// marketKey is kept because it is the stored shape on every existing medspa_subscriptions
// row and it is still a useful human label. It is no longer the test.

import { geocodeZip, zipCentroidsLoaded } from "@/lib/clients/geocode";
import { isInsideMarket, isUsableCenter, DEFAULT_MARKET_RADIUS_MI } from "@/lib/clients/normalize";

export interface HeldMarket {
  clientId: string;
  name: string;
}

/**
 * Is the ZIP somebody just typed inside a market a CLIENT already holds?
 *
 * The seat-holding list is billing_status in ('pilot','active') — D-P13 says pilots hold a
 * market exactly as paying clients do, and that list is the one provision.ts and
 * report-reminders.ts already use. Note it is a DIFFERENT list from
 * LIVE_SUBSCRIPTION_STATUSES above, which describes Stripe states on the med-spa funnel;
 * the two answer different questions and merging them would be wrong in both directions.
 *
 * Three outcomes, and the third is the one that matters:
 *   { held: HeldMarket }  the market is taken
 *   { held: null }        checked, and it is free
 *   { held: null, unchecked: reason }  COULD NOT CHECK
 *
 * Failing open on the third is deliberate — a missing ZIP must not stop somebody paying us,
 * which is the same trade the original string check documented. But it is never SILENT. A
 * market check that always passes and says nothing is worse than no market check, because
 * everyone believes it ran. The caller alerts on `unchecked`.
 */
export interface MarketLookup {
  held: HeldMarket | null;
  unchecked?: string;
}

export async function findHeldMarketForZip(zip: string): Promise<MarketLookup> {
  const point = await geocodeZip(zip).catch(() => null);

  if (!point) {
    const loaded = await zipCentroidsLoaded().catch(() => false);
    return {
      held: null,
      unchecked: loaded
        ? `ZIP ${zip} is not in zip_centroids`
        : "zip_centroids is empty — the ZIP-centroid dataset has never been loaded",
    };
  }

  const { data } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, market_center_lat, market_center_lng, market_radius_mi")
    .in("billing_status", ["pilot", "active"]);

  for (const c of data ?? []) {
    const lat = c.market_center_lat as number | null;
    const lng = c.market_center_lng as number | null;
    if (!isUsableCenter(lat, lng)) continue;

    const held = {
      lat: lat as number,
      lng: lng as number,
      radiusMi: (c.market_radius_mi as number | null) ?? DEFAULT_MARKET_RADIUS_MI,
    };

    if (isInsideMarket(point, held)) {
      return {
        held: {
          clientId: c.id as string,
          name: ((c.dba_name as string | null) || (c.legal_name as string)) ?? "another clinic",
        },
      };
    }
  }

  return { held: null };
}
