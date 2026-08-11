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
