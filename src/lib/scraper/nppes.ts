// The owner's name from the federal NPI registry, free, for clinics whose own website never says it.
//
// ‼️ THIS IS A NAME SOURCE, NOT AN EMAIL RUNG, AND THE DISTINCTION DECIDES WHERE IT GOES. Every entry
// in PROVIDERS returns an EnrichHit, which requires an `email`. NPPES has no email and never will. It
// answers the question one step earlier: WHO runs this clinic. `ownerName` is an INPUT the permutation
// rung searches on, which enrich.ts already states ("a permutation rung cannot permute without it"),
// so this runs in the enrich sweep between the site crawl and the waterfall.
//
// ‼️ AND IT IS AIMED AT A MEASURED GAP RATHER THAN A GUESS. The 500-record Dallas pull on 2026-09-28:
// 101 qualified companies, 25 owner names found (25%), 54 companies yielding an address (53%). Of the
// 47 that produced nothing, roughly 45 had no owner name at all. Permutation fired on TWO companies in
// the whole run, because the 23 others with a name had already given up an address on their site. The
// bottleneck is not turning a name into an address; it is getting the name.
//
// NPPES is the right free source for THIS vertical specifically: a med spa that injects anything is
// operating under a licensed clinician, and every licensed clinician in the United States is in the
// registry by law. It is a public CMS API with no key, no account and no quota published.
//
// ‼️ IT REFUSES RATHER THAN GUESSES, AND THE REASON IS THE SAME ONE geocode.ts GIVES. A wrong owner
// name is worse than no owner name: it is permuted into six addresses, uploaded to MillionVerifier,
// and any that pass get mailed to a stranger with the wrong person's name in the greeting. So a match
// has to be exact or strong on the business name, and `weak` is thrown away.

import { getOrFetch, cacheKeyOf } from "@/lib/data/dataset-cache";

/** Who the registry says is behind a clinic. */
export interface NppesOwner {
  firstName: string;
  lastName: string;
  /** The organisation NPPES matched, so a card can show what was matched against. */
  organizationName: string;
  npi: string;
  /** "MD", "NP", "PA-C" and so on, when the registry carries one. */
  credential: string | null;
  confidence: "exact" | "strong";
}

/** A registered officer does not change often, and a wrong cache is cheap to wait out. */
const NPPES_TTL_DAYS = 180;

/**
 * Suffixes that are legal form rather than identity.
 *
 * ‼️ STRIPPED BEFORE COMPARING, BECAUSE THE TWO SOURCES SPELL THEM DIFFERENTLY BY CONVENTION. Google
 * carries the trading name ("Glow Bar Med Spa") and NPPES carries the registered entity ("GLOW BAR
 * MED SPA LLC"). Comparing those raw gives a miss on a business that matched perfectly.
 */
const LEGAL_SUFFIXES = [
  "llc", "l l c", "inc", "incorporated", "pllc", "plc", "pa", "pc", "corp", "corporation",
  "ltd", "limited", "co", "company", "lp", "llp", "dba", "the",
];

/**
 * A business name reduced to the part that identifies it.
 *
 * ‼️ PURE, SO THE PROBE OWNS IT. This decides whether a name is attached to a clinic, which is the one
 * thing here that can put the wrong person into an email greeting.
 */
export function normalizeOrgName(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[&]/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const words = base.split(" ").filter((w) => w && !LEGAL_SUFFIXES.includes(w));
  return words.join(" ");
}

/**
 * How well two business names agree.
 *
 * ‼️ CONTAINMENT NEEDS EIGHT CHARACTERS, AND THE BOUND IS THE WHOLE SAFETY OF IT. Without a floor,
 * "spa" is contained in every clinic in the country and every lookup returns the first stranger in the
 * city. Eight is the same order of magnitude dedup.ts settled on for its own containment rail (ten),
 * and it is deliberately not a similarity score: a number between 0 and 1 invites somebody to nudge
 * the threshold until coverage looks better, which is how a name gets attached to the wrong clinic.
 */
export function matchConfidence(pulled: string, registered: string): "exact" | "strong" | "weak" {
  const a = normalizeOrgName(pulled);
  const b = normalizeOrgName(registered);
  if (!a || !b) return "weak";
  if (a === b) return "exact";
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length >= 8 && longer.includes(shorter)) return "strong";
  return "weak";
}

/** Title Case, because the registry shouts everything and a greeting should not. */
export function titleCaseName(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface NppesApiResult {
  number?: number | string;
  basic?: {
    organization_name?: string;
    authorized_official_first_name?: string;
    authorized_official_last_name?: string;
    authorized_official_credential?: string;
    first_name?: string;
    last_name?: string;
    credential?: string;
  };
}

/**
 * Pick the best owner out of what the registry returned, or null.
 *
 * ‼️ PURE AND SEPARATE FROM THE FETCH, so every rule below is provable with no network. The registry
 * returns two shapes and only one of them carries an owner:
 *
 *   type 2, an ORGANISATION, carries `authorized_official_*`, which is the officer who registered the
 *     clinic. That is the person this whole rung exists to find.
 *   type 1, an INDIVIDUAL, carries `first_name` / `last_name` and no organisation name, so it cannot
 *     be matched against a business name at all and is skipped rather than guessed at.
 */
export function pickOwner(results: readonly NppesApiResult[], businessName: string): NppesOwner | null {
  let best: NppesOwner | null = null;

  for (const r of results) {
    const basic = r.basic ?? {};
    const org = (basic.organization_name ?? "").trim();
    const first = (basic.authorized_official_first_name ?? "").trim();
    const last = (basic.authorized_official_last_name ?? "").trim();
    // No organisation to match against, or no officer named: nothing this rung can safely use.
    if (!org || !first || !last) continue;

    const confidence = matchConfidence(businessName, org);
    if (confidence === "weak") continue;

    const owner: NppesOwner = {
      firstName: titleCaseName(first),
      lastName: titleCaseName(last),
      organizationName: org,
      npi: String(r.number ?? ""),
      credential: (basic.authorized_official_credential ?? "").trim() || null,
      confidence,
    };
    // An exact name match wins outright; otherwise the first strong one stands.
    if (confidence === "exact") return owner;
    if (!best) best = owner;
  }

  return best;
}

/**
 * Ask the registry who runs this clinic, or null.
 *
 * ‼️ NULL IS A REFUSAL, NOT A DEFAULT, exactly as geocodeMetro's is. A clinic with no NPI is an
 * ordinary outcome here: plenty of skin care and facial businesses employ no licensed clinician, which
 * is a fact about the business rather than a failure of the lookup.
 *
 * ‼️ CACHED FOR HALF A YEAR, WHICH IS ALSO THE RATE LIMIT. CMS publishes no quota, so the polite thing
 * and the cheap thing agree: one lookup per clinic for six months. getOrFetch records a zero cost, so
 * this rung shows up on the spend ledger as free rather than as absent.
 */
export async function lookupOwner(args: {
  businessName: string;
  city: string | null;
  state: string | null;
}): Promise<NppesOwner | null> {
  const name = args.businessName.trim();
  if (!name) return null;

  try {
    const { payload } = await getOrFetch<NppesOwner | null>({
      clientId: null,
      kind: "nppes.owner",
      cacheKey: cacheKeyOf({
        name: normalizeOrgName(name),
        city: (args.city ?? "").toLowerCase().trim(),
        state: (args.state ?? "").toUpperCase().trim(),
      }),
      ttlDays: NPPES_TTL_DAYS,
      provider: "cms nppes npi registry",
      params: { name, city: args.city, state: args.state },
      fetch: async () => ({ payload: await query(name, args.city, args.state), costUsd: 0 }),
    });
    return payload ?? null;
  } catch {
    // A registry that could not be reached is not a licence to guess a name.
    return null;
  }
}

/** Two-letter postal code, which is the only shape the registry's `state` parameter takes. */
function stateParam(state: string | null): string | null {
  const s = (state ?? "").trim();
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return null;
}

async function query(businessName: string, city: string | null, state: string | null): Promise<NppesOwner | null> {
  const normalized = normalizeOrgName(businessName);
  if (!normalized) return null;

  const params = new URLSearchParams({
    version: "2.1",
    enumeration_type: "NPI-2", // Organisations only: an individual NPI carries no business name.
    limit: "20",
    // ‼️ A TRAILING WILDCARD, BECAUSE THE REGISTERED NAME IS USUALLY THE TRADING NAME PLUS A SUFFIX.
    // "Glow Bar Med Spa" is registered as "GLOW BAR MED SPA LLC". Without this the exact-match
    // endpoint misses the majority of real matches. The result is still put through matchConfidence,
    // so the wildcard widens what is CONSIDERED and never what is accepted.
    organization_name: normalized + "*",
  });
  const st = stateParam(state);
  if (st) params.set("state", st);
  if (city && city.trim()) params.set("city", city.trim());

  const res = await fetch("https://npiregistry.cms.hhs.gov/api/?" + params.toString(), {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) return null;

  const body = (await res.json()) as { results?: NppesApiResult[]; Errors?: unknown };
  // The registry answers 200 with an `Errors` array for a malformed query rather than a 4xx, so the
  // status code proves nothing here. Same shape of trap as DataForSEO's silently ignored location_name.
  if (!Array.isArray(body.results)) return null;

  return pickOwner(body.results, businessName);
}
