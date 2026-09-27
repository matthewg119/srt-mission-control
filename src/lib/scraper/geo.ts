// Is this row in the United States, decided from the file rather than from the search.
//
// ‼️ THIS FILE IS PURE AND MAKES NO NETWORK CALLS AND MUST NOT START. Same split as rules.ts,
// filter.ts, score.ts and gbp-audit.ts: this owns one mechanical question, so `_probe-gbp-audit.ts`
// can prove it with no API key and no spend. This decision DELETES ROWS BEFORE THEY ARE EVER
// PRICED, so it has to be provable offline.
//
// ‼️ IT IS DECIDED ON THE `state` / `city` CELLS OF THE DROPPED FILE, NEVER ON THE SERP. Those are
// two different questions and conflating them gets both wrong in both directions: a business with
// no Google profile at all can still be in Florida, and a business with a perfect profile can be in
// Prague. The search result answers "is Google showing them", which is what `score.ts` is for.
//
// ‼️ AND IT IS A LIST OF STATES, NOT A MODEL. Same rule `looksLikeCallNotes` and the cutoff grammar
// are held to. A model asked "is this city American" answers differently on the same city twice in
// a row, and a wrong answer here does not produce a bad score, it produces a MISSING ROW.

/** The 50 states, DC included, lowercased. Spaces are matched loosely so "new  york" still reads. */
const STATE_NAMES = [
  "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware",
  "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky",
  "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi",
  "missouri", "montana", "nebraska", "nevada", "new hampshire", "new jersey", "new mexico",
  "new york", "north carolina", "north dakota", "ohio", "oklahoma", "oregon", "pennsylvania",
  "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
  "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia",
];

/**
 * The postal codes, DC included, in the SAME ORDER as STATE_NAMES.
 *
 * ‼️ "WA" WAS MISSING UNTIL 2026-09-27, AND IT DELETED EVERY WASHINGTON ROW. This list is read by
 * `hasStateCode`, and a code that is absent makes `locationVerdict` return `not_us`, not `unknown`:
 * Seattle, Spokane, Tacoma and Bellevue were classified as foreign and dropped from every list built
 * from a file that wrote the state as an abbreviation. Exactly the failure this file's header names,
 * "a wrong answer here does not produce a bad score, it produces a MISSING ROW", and it went unnoticed
 * because a deleted row leaves nothing behind to look at.
 *
 * Found by asserting this list and STATE_NAMES are the same length, which is now done below. The
 * order matters for the same reason: CODE_TO_STATE pairs them positionally.
 */
const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS",
  "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY",
  "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV",
  "WI", "WY", "DC",
]);

/**
 * Postal code to full state name, for the vendors that want the name spelled out.
 *
 * ‼️ DERIVED FROM THE TWO LISTS ABOVE, NOT TYPED OUT A THIRD TIME. Both are already in the same
 * order, DC last, which is what makes this safe; the assertion below is what keeps it safe if either
 * list is edited. A hand-written third copy is how "Missouri" and "Mississippi" end up swapped in one
 * file and right in the other two.
 */
const CODE_TO_STATE: ReadonlyMap<string, string> = new Map(
  [...STATE_CODES].map((code, i) => [code, STATE_NAMES[i]])
);

// The two lists have to stay aligned, and a mismatch is a bug in this file rather than bad input.
if (CODE_TO_STATE.size !== STATE_NAMES.length || CODE_TO_STATE.get("TX") !== "texas") {
  throw new Error("geo.ts: STATE_CODES and STATE_NAMES have drifted out of alignment");
}

/**
 * "Dallas TX" or "Dallas, Texas" into the full state name, or null when no state was given.
 *
 * Title Case, because the vendors that take a name want it that way and the lists here are lowercase.
 */
export function stateNameFrom(text: string): string | null {
  const cleaned = text.trim();
  if (!cleaned) return null;

  const words = cleaned.replace(/,/g, " ").split(/\s+/).filter(Boolean);
  const last = words[words.length - 1] ?? "";
  const byCode = CODE_TO_STATE.get(last.toUpperCase());
  if (byCode) return titleCase(byCode);

  // A full name, possibly two words ("New York"), at the end of the string.
  const low = cleaned.toLowerCase();
  const named = STATE_NAMES.filter((n) => low.endsWith(n)).sort((a, b) => b.length - a.length)[0];
  return named ? titleCase(named) : null;
}

/** "Dallas TX" into "Dallas", the part that is not the state. */
export function cityNameFrom(text: string): string | null {
  const cleaned = text.trim().replace(/,/g, " ").replace(/\s+/g, " ");
  if (!cleaned) return null;
  const state = stateNameFrom(cleaned);
  if (!state) return cleaned;
  const low = cleaned.toLowerCase();
  const tail = low.endsWith(state.toLowerCase()) ? state.length : (cleaned.split(" ").pop() ?? "").length;
  const city = cleaned.slice(0, cleaned.length - tail).trim();
  return city || null;
}

function titleCase(s: string): string {
  return s.replace(/(^| )([a-z])/g, (_m, pre, ch) => pre + ch.toUpperCase());
}

/**
 * A state NAME anywhere in the text, on word boundaries.
 *
 * Boundaries matter: "Virginia" must not match inside "West Virginia" in a way that changes the
 * verdict (it does not, both are states), but "Indiana" must not be found inside "Indianapolis" and
 * report a state that was never written.
 */
function hasStateName(text: string): boolean {
  const low = " " + text.toLowerCase().replace(/[^a-z]+/g, " ").trim() + " ";
  return STATE_NAMES.some((name) => low.includes(" " + name + " "));
}

/**
 * A postal CODE, and it is read STRICTLY: two uppercase letters that are either the whole cell or
 * the segment after the last comma.
 *
 * ‼️ THE STRICTNESS IS NOT FUSSINESS, IT WAS MEASURED. A loose "is any two-letter token a state
 * code" pass read "Al Ain" (Abu Dhabi) as ALABAMA and kept a UAE clinic in the American pile. A
 * two-letter word is far too common in a place name to be evidence on its own; a comma-suffixed
 * uppercase pair is how an export actually writes a state, so that is the only shape accepted.
 * Lowercase "ca" in "Boca" is the same trap one step further along.
 */
function hasStateCode(text: string): boolean {
  const trimmed = text.trim();
  if (STATE_CODES.has(trimmed)) return true;
  const parts = trimmed.split(",");
  if (parts.length < 2) return false;
  return STATE_CODES.has(parts[parts.length - 1].trim());
}

function namesAState(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return hasStateCode(t) || hasStateName(t);
}

/**
 * Three answers, not two.
 *
 * ‼️ `not_us` AND `unknown` ARE DIFFERENT ANSWERS AND MUST NOT COLLAPSE. `not_us` is "the file told
 * us where this business is and it is not in a state": Riga, Prague, Dubai. `unknown` is "the file
 * carried no city and no state at all", which is a fact about the EXPORT, not about the business.
 * Deleting on `unknown` would be deleting on an empty cell, which is the exact failure `MxVerdict`,
 * `site_signals` and every "not measured" note in this lane exist to prevent. An `unknown` row is
 * KEPT and its names are printed in the thread, because the safe direction is the same one the
 * cutoff already takes: scraping a company unnecessarily costs one Apollo credit, deleting one
 * loses a lead.
 */
export type LocationVerdict = "us" | "not_us" | "unknown";

export interface LocationCells {
  state?: string | null;
  city?: string | null;
}

/**
 * Where is this row, as far as the dropped file is willing to say.
 *
 * Both cells are read, because an export that has no `state` column at all still writes
 * "Charlotte, NC" into `city`, and an export that has one still leaves it blank for foreign rows.
 *
 * ‼️ THE ONE WAY THIS CAN BE WRONG is a genuinely American row whose export left the state cell
 * blank and wrote a bare city: "Charlotte" alone names no state, so it reads `not_us` and is
 * deleted. That is why the lane PRINTS THE NAMES of everything it drops into the thread instead of
 * only the count. The list is the mitigation; do not remove it and leave a bare number.
 */
export function locationVerdict(cells: LocationCells): LocationVerdict {
  const state = (cells.state ?? "").trim();
  const city = (cells.city ?? "").trim();
  if (namesAState(state) || namesAState(city)) return "us";
  if (!state && !city) return "unknown";
  return "not_us";
}

/** Everything the file said about where a row is, for the thread. Empty cells read as a dash. */
export function describeLocation(cells: LocationCells): string {
  const parts = [(cells.city ?? "").trim(), (cells.state ?? "").trim()].filter(Boolean);
  return parts.length ? parts.join(", ") : "no location";
}
