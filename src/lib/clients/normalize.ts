// Pure helpers for client records. No node: builtins, no imports — the intake funnel's
// client components and the server routes import the SAME functions, exactly as
// src/lib/medspa/validate.ts does. If a normalizer lived only on the server, the field
// would show one thing while it was typed and store another, which is precisely the
// kind of drift a canonical NAP cannot survive.

/** URL-safe, lowercase, collision-resistant-enough for six clients. */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// ─────────────────────────────────────────────────────────────────────────────
// Address normalization
// ─────────────────────────────────────────────────────────────────────────────
//
// The canonical NAP is the whole product's spine: every directory, every citation and
// the GBP listing are made to match it, and a NAP sweep compares found values against
// it character by character. "Suite 200" and "Ste 200" are the same address to a human
// and two different addresses to that comparison, so the form is not allowed to accept
// both.
//
// USPS abbreviations, applied to whole words only. Deliberately short: this normalizes
// the handful of tokens that actually vary between two people typing one address. It
// is not a parser, it does not reorder, and it never invents a component that was not
// typed.

const STREET_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bstreet\b/gi, "St"],
  [/\bavenue\b/gi, "Ave"],
  [/\bboulevard\b/gi, "Blvd"],
  [/\bdrive\b/gi, "Dr"],
  [/\broad\b/gi, "Rd"],
  [/\blane\b/gi, "Ln"],
  [/\bcourt\b/gi, "Ct"],
  [/\bplace\b/gi, "Pl"],
  [/\bparkway\b/gi, "Pkwy"],
  [/\bhighway\b/gi, "Hwy"],
  [/\bterrace\b/gi, "Ter"],
  [/\bcircle\b/gi, "Cir"],
  [/\bsuite\b/gi, "Ste"],
  [/\bunit\b/gi, "Unit"],
  [/\bbuilding\b/gi, "Bldg"],
  [/\bfloor\b/gi, "Fl"],
  [/\bnorth\b/gi, "N"],
  [/\bsouth\b/gi, "S"],
  [/\beast\b/gi, "E"],
  [/\bwest\b/gi, "W"],
  [/\bnortheast\b/gi, "NE"],
  [/\bnorthwest\b/gi, "NW"],
  [/\bsoutheast\b/gi, "SE"],
  [/\bsouthwest\b/gi, "SW"],
];

/**
 * Trailing punctuation goes, whitespace collapses, "#" becomes "Ste" so that
 * "#200" and "Suite 200" converge, and the known abbreviations are applied.
 */
export function normalizeAddress(input: string): string {
  let out = input.trim().replace(/\s+/g, " ").replace(/[.,]+$/g, "");
  out = out.replace(/#\s*/g, "Ste ");
  for (const [pattern, replacement] of STREET_ABBREVIATIONS) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s+/g, " ").trim();
}

/** Two-letter, uppercase. Anything longer is left alone for a human to fix. */
export function normalizeState(input: string): string {
  const trimmed = input.trim();
  return trimmed.length === 2 ? trimmed.toUpperCase() : trimmed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Market overlap
// ─────────────────────────────────────────────────────────────────────────────
//
// One clinic per market, enforced as a radius around a hand-entered center.
//
// This FLAGS. It never blocks, matching findMarketConflict() in
// src/lib/medspa/market.ts: "one clinic per market" is a promise a human adjudicates,
// and a provisioning function that refused to run because two radii grazed each other
// would be wrong more often than it was right.

const EARTH_RADIUS_MI = 3958.8;

export interface MarketCircle {
  lat: number;
  lng: number;
  radiusMi: number;
}

export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Circles overlap when their centers are closer than the sum of their radii. */
export function marketsOverlap(a: MarketCircle, b: MarketCircle): boolean {
  return haversineMiles(a.lat, a.lng, b.lat, b.lng) < a.radiusMi + b.radiusMi;
}

/** Valid Earth coordinates, and not the 0,0 that an empty form produces. */
export function isUsableCenter(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}
