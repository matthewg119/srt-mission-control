// One canonical (city, state) key, so an audit and a lead row can be compared at all.
//
// ‼️ THIS EXISTS BECAUSE THE TWO SIDES ARE WRITTEN DIFFERENTLY AND THE MISMATCH IS TOTAL.
// Measured on production before this file was written:
//
//   audit_reports.city    "Austin, TX"      city and postal code in one cell
//   trt_leads             "Austin" + "Texas"  city and state in two cells, spelled out
//
// A raw join on those two columns returns ZERO rows out of 2,671 leads, which reads exactly like
// "we have never audited a city any of our leads are in". After normalizing both sides it is 547.
// The entire competitor ammo feature was invisible behind a string format.
//
// ‼️ PURE, NO NETWORK, NO DATABASE. Same rule as scraper/geo.ts, rules.ts and score.ts: this owns
// one mechanical question so a probe can prove it offline with no key and no spend.
//
// ‼️ THE STATE LIST IS DUPLICATED FROM scraper/geo.ts ON PURPOSE. That file answers "is this row in
// the United States" and holds its names and codes as two separate unexported collections that
// happen to be in the same order. This file answers a different question, "which code does this
// spelled-out state mean", and needs the two PAIRED. Importing one and relying on the array order
// of the other would make a silent off-by-one rename every city in the country. A static list of
// fifty is cheaper to repeat than that failure is to find.

/** Spelled-out name to postal code, DC included. Lowercased keys. */
const STATE_BY_NAME: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", florida: "FL", georgia: "GA",
  hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN", iowa: "IA",
  kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND", ohio: "OH",
  oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
  "district of columbia": "DC",
};

const STATE_CODES = new Set(Object.values(STATE_BY_NAME));

export interface Place {
  /** Lowercased, punctuation folded. The join key. */
  city: string;
  /** Two-letter uppercase postal code, or null when the source never said. */
  state: string | null;
}

/** Lowercase, strip punctuation, collapse whitespace. The same shape on both sides of the join. */
function foldCity(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Resolve whatever a row calls a state into a postal code.
 *
 * Accepts "Texas", "texas", "TX" and "tx". Returns null for anything else rather than guessing,
 * because a wrong code here does not lose a row, it files a business under a city in the wrong
 * state and then names its competitors to a stranger.
 */
export function toStateCode(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && STATE_CODES.has(upper)) return upper;

  const folded = trimmed.toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();
  return STATE_BY_NAME[folded] ?? null;
}

/**
 * Parse an audit-style "City, ST" cell into a Place.
 *
 * ‼️ THE TRAILING SEGMENT IS ONLY READ AS A STATE IF IT RESOLVES TO ONE. "Washington, DC" gives
 * {washington, DC}, but a cell that happens to contain a comma for another reason keeps its whole
 * text as the city rather than losing the tail. Returns null for an empty or blank cell, which is
 * the honest answer for the 540 measured audit runs whose report has no city at all: those rows
 * cannot be placed on the map and must be dropped, never defaulted.
 */
export function parseCityCell(input: string | null | undefined): Place | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  const comma = trimmed.lastIndexOf(",");
  if (comma > 0) {
    const tail = toStateCode(trimmed.slice(comma + 1));
    if (tail) {
      const city = foldCity(trimmed.slice(0, comma));
      return city ? { city, state: tail } : null;
    }
  }

  const city = foldCity(trimmed);
  return city ? { city, state: null } : null;
}

/**
 * Build a Place from a lead-style pair of separate city and state cells.
 *
 * scraper_rows has a city and no state column at all, so a null state is normal here and is not an
 * error. It costs precision at match time, never correctness: placeKey() simply produces the
 * city-only key and a same-name city in another state will not be claimed as a match by
 * sameMarket().
 */
export function fromCityState(
  city: string | null | undefined,
  state: string | null | undefined
): Place | null {
  if (!city) return null;
  const folded = foldCity(city);
  if (!folded) return null;
  return { city: folded, state: toStateCode(state ?? null) };
}

/** Stable string key for grouping. "austin|TX", or "austin|" when the state is unknown. */
export function placeKey(place: Place): string {
  return `${place.city}|${place.state ?? ""}`;
}

/**
 * Do these two places name the same market?
 *
 * A missing state on EITHER side falls back to a city-only comparison rather than failing closed.
 * That is deliberate and it is the looser of the two available errors: scraper_rows genuinely has
 * no state column, so failing closed would discard every one of its rows, while the false-positive
 * case needs two same-named cities in different states AND one of the sources to have omitted the
 * state. Callers that cannot tolerate that should compare placeKey() directly.
 */
export function sameMarket(a: Place, b: Place): boolean {
  if (a.city !== b.city) return false;
  if (a.state && b.state) return a.state === b.state;
  return true;
}

/**
 * A place written the way a person writes it, for copy. "austin"+"TX" becomes "Austin, TX".
 *
 * The stored city is folded to lowercase so it can be joined on, which makes it unusable in a
 * sentence as it stands. Title-casing here rather than storing a second display column keeps one
 * copy of the city and no chance of the two disagreeing. Small words inside a name stay lowercase
 * so "isle of palms" does not become "Isle Of Palms".
 */
const LOWER_IN_NAME = new Set(["of", "the", "on", "at", "in", "de", "la", "las", "los", "and"]);

export function displayPlace(place: Place): string {
  const city = place.city
    .split(" ")
    .map((word, i) =>
      i > 0 && LOWER_IN_NAME.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)
    )
    .join(" ");
  return place.state ? `${city}, ${place.state}` : city;
}
