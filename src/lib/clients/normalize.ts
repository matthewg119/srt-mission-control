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
// The hub subdomain
// ─────────────────────────────────────────────────────────────────────────────
//
// `clients.subdomain` has been written as a FULL HOST ("learn.clinic.com") and read as a
// LABEL ("learn") by two of its three consumers, which produced exactly the doubling the
// DNS code already warns about: the panel's Host box said `learn.clinic.com`, the
// registrar appended the domain to it, and the record saved as
// `learn.clinic.com.clinic.com`. The DNS ask draft told the client the same doubled name,
// and the resolver check then looked for a host nobody had created.
//
// chooseSubdomain() now stores the label. This still strips a trailing domain, because
// the rows written before that change are still in the database and a defensive read
// fixes them without a migration. subdomain_convention already carries the same value, so
// nothing is lost either way.

/** The label only: `learn`, never `learn.clinic.com`. Falls back to the convention. */
export function subdomainLabel(
  subdomain: string | null | undefined,
  domain: string | null | undefined
): string {
  const raw = (subdomain ?? "").trim().toLowerCase().replace(/\.$/, "");
  if (!raw) return "learn";

  const host = (domain ?? "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
  const stripped = host && raw.endsWith(`.${host}`) ? raw.slice(0, -(host.length + 1)) : raw;

  // A label still carrying a dot is a hostname we could not resolve against this domain
  // (a client whose `domain` column disagrees with the stored host). Take the first
  // segment rather than passing something through that a registrar will mangle.
  return stripped.split(".")[0] || "learn";
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone display
// ─────────────────────────────────────────────────────────────────────────────
//
// THE FAILURE THIS EXISTS TO STOP. Every funnel in the estate used to keep whatever the
// visitor typed, so "+13368332303", "13368332303" and "3368332303" were three different
// strings for one human. findContact() in lead-intake.ts dedupes on an EXACT string match
// against phone / mobile_phone, so that one person became three contacts, three Zoho leads
// and three Slack threads. The fix is not a better dedupe, it is never storing the three
// shapes in the first place.
//
// So the split is: this formats for HUMANS as they type, normalizePhone() in
// src/lib/medspa/validate.ts decides what is STORED, and what is stored is always E.164.
// Both run on the client and the server, which is why this lives here rather than in a
// server module: funnel-client.tsx imports it for live formatting and the save route
// imports it for display, exactly as slugify and normalizeAddress already work.

/**
 * Format US digits for display as they are typed: `(336) 833-2303`.
 *
 * A leading country code is ABSORBED, never duplicated and never left on screen: typing
 * or pasting "+1 336 833 2303", "13368332303" or "3368332303" all render identically.
 * That is the whole point, since a "+1" the user typed themselves is the single most
 * common way a number arrives in a shape nothing else matches.
 *
 * Partial input formats progressively so the field is readable mid-typing, and anything
 * past ten digits is dropped rather than shown, because there is nowhere for it to go in
 * a US number and silently accepting it is how a mistyped digit survives to the database.
 */
export function formatPhoneUS(input: string): string {
  let digits = input.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  // Mid-typing a pasted "+1..." can momentarily exceed 11, so trim the country code
  // whenever it is clearly present rather than only at exactly 11 characters.
  else if (digits.length > 10 && digits.startsWith("1")) digits = digits.slice(1);
  digits = digits.slice(0, 10);

  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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
// One clinic per market. Amendment A2 D-P13, confirmed 18 Aug 2026: a market is the circle
// of radius TEN MILES around the tenant's canonical address, and pilots hold a market
// exactly as paying clients do.
//
// ‼️ THE TEST IS POINT-IN-CIRCLE, NOT CIRCLE-OVERLAP, AND THE DIFFERENCE IS REAL.
// D-P13: the check "blocks when that point lies inside any held market" and "reads distance
// from centre, never ZIP equality". Circle-overlap (d < r1 + r2) flags two ten-mile markets
// whose centres are nineteen miles apart — neither clinic is inside the other's market, and
// refusing that sale is refusing a market we never sold. isInsideMarket is the honest test.
//
// marketsOverlap is kept below because it is still the right question for "do these two
// territories touch at all", which is a planning question rather than an exclusivity one.

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

/**
 * D-P13's actual test: is this POINT inside that HELD market?
 *
 * Used both ways round, and both are the same question. At pilot intake the point is the
 * new clinic's address and the circle is an existing client's market. At checkout the point
 * is the entered ZIP's centroid. Two ZIPs a mile apart are one market; one large ZIP with
 * two clinics nine miles apart is also one market — neither fact is expressible with a
 * string comparison, which is why D-P13 forbids ZIP equality.
 */
export function isInsideMarket(
  point: { lat: number; lng: number },
  market: MarketCircle
): boolean {
  return haversineMiles(point.lat, point.lng, market.lat, market.lng) < market.radiusMi;
}

/** A2 D-P13. Not a dial: changing it is an admin action that follows the agreement. */
export const DEFAULT_MARKET_RADIUS_MI = 10;

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
