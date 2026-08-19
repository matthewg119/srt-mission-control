// Is the listing on that platform the same business as the one on the client record?
//
// Runner v3 section 6: "Normalization — pure functions, unit tested". Everything here is pure
// and takes no database, because the whole file is one judgement call applied consistently, and
// a judgement call you cannot test on paper is one you will argue about on a call.
//
// ‼️ COMPARE NORMALIZED. REPORT RAW. ALWAYS.
// The comparison has to see through "Ste 200" versus "Suite 200". The client-facing document
// has to show exactly what is live on the internet today, because the whole point of section 2
// is "your address appears three different ways across seven platforms". Normalizing before
// storage would delete the finding in order to compute it.

import { normalizeState } from "./normalize";

// ─────────────────────────────────────────────────────────────────────────────
// Address
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Both directions, because directories disagree with each other rather than with a standard.
 * Expanded to the long form so "St", "St." and "Street" all land on one string.
 */
const STREET_WORDS: Array<[RegExp, string]> = [
  [/\bst\b\.?/gi, "street"],
  [/\bste\b\.?/gi, "suite"],
  [/\bapt\b\.?/gi, "suite"],
  [/\bunit\b/gi, "suite"],
  [/#/g, "suite "],
  [/\bave\b\.?/gi, "avenue"],
  [/\bav\b\.?/gi, "avenue"],
  [/\bblvd\b\.?/gi, "boulevard"],
  [/\bdr\b\.?/gi, "drive"],
  [/\brd\b\.?/gi, "road"],
  [/\bln\b\.?/gi, "lane"],
  [/\bct\b\.?/gi, "court"],
  [/\bpl\b\.?/gi, "place"],
  [/\bpkwy\b\.?/gi, "parkway"],
  [/\bhwy\b\.?/gi, "highway"],
  [/\bcir\b\.?/gi, "circle"],
  [/\btrl\b\.?/gi, "trail"],
  [/\bter\b\.?/gi, "terrace"],
  [/\bn\b\.?/gi, "north"],
  [/\bs\b\.?/gi, "south"],
  [/\be\b\.?/gi, "east"],
  [/\bw\b\.?/gi, "west"],
  [/\bne\b\.?/gi, "northeast"],
  [/\bnw\b\.?/gi, "northwest"],
  [/\bse\b\.?/gi, "southeast"],
  [/\bsw\b\.?/gi, "southwest"],
];

export function normalizeAddressForCompare(input: string | null | undefined): string {
  if (!input) return "";
  let out = input.toLowerCase();
  // Punctuation first: "1200 W. Market St., Ste 200" has to lose the dots before \b matching
  // can see the abbreviations reliably.
  out = out.replace(/[.,]/g, " ");
  for (const [pattern, replacement] of STREET_WORDS) out = out.replace(pattern, replacement);
  return out.replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Business name
// ─────────────────────────────────────────────────────────────────────────────

const ENTITY_SUFFIX = /\b(l\.?l\.?c\.?|inc\.?|incorporated|corp\.?|corporation|co\.?|ltd\.?|p\.?l\.?l\.?c\.?|p\.?a\.?)\b/gi;

export interface NameComparison {
  /** Identical once case and punctuation are gone. */
  exact: boolean;
  /** Identical once the entity suffix is ALSO gone. */
  withoutSuffix: boolean;
  /**
   * ‼️ A REAL FINDING, NOT NOISE TO NORMALIZE AWAY. Runner v3 section 6: compare "BOTH with and
   * without, and report which matched. Presence/absence is a real finding."
   *
   * "Acme Med Spa" on Google and "Acme Med Spa LLC" on Yelp is exactly the inconsistency the
   * engines struggle to resolve into one business, which is the entire argument of findings
   * section 2. Silently treating them as equal would delete the thing we are being paid to
   * find.
   */
  suffixDiffers: boolean;
}

export function normalizeNameForCompare(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripEntitySuffix(input: string): string {
  return input.replace(ENTITY_SUFFIX, " ").replace(/\s+/g, " ").trim();
}

export function compareNames(
  canonical: string | null | undefined,
  listed: string | null | undefined
): NameComparison {
  const a = normalizeNameForCompare(canonical);
  const b = normalizeNameForCompare(listed);
  const aBare = stripEntitySuffix(a);
  const bBare = stripEntitySuffix(b);

  return {
    exact: a === b && a.length > 0,
    withoutSuffix: aBare === bBare && aBare.length > 0,
    suffixDiffers: aBare === bBare && a !== b,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phone
// ─────────────────────────────────────────────────────────────────────────────

/**
 * To E.164 for comparison only.
 *
 * Falls back to the last ten digits rather than giving up, because directories print
 * "(336) 555-0142 ext 2" and "1-336-555-0142" and both are the same phone. This never STORES
 * anything — normalizeLeadPhone in src/lib/phone.ts is the one door for storage and stays so.
 */
export function normalizePhoneForCompare(input: string | null | undefined): string {
  if (!input) return "";

  // ‼️ THE EXTENSION COMES OFF FIRST, AND IT HAS TO.
  // Directories print "(336) 555-0142 ext 2". An extension's digits sit at the END, so the
  // obvious "take the last ten digits" rule silently slides the window and turns 3365550142
  // into 3655501422 — a different, plausible-looking phone number that would be reported to a
  // client as a mismatch on a listing that is actually correct. Caught by the unit test the
  // first time this ran.
  // "x204" has no word boundary after the x, so \bx\b misses it; "\sx(?=\s*\d)" catches the
  // bare-x form while requiring whitespace before it, so a name like "Onyx" is never split.
  const withoutExt = input.split(/\b(?:ext|extn|extension)\b|\sx(?=\s*\d)/i)[0];
  const digits = withoutExt.replace(/\D/g, "");
  if (!digits) return "";

  // A leading US country code is the ONLY case where trimming is safe, so it is the only case
  // that trims. Anything else is returned whole rather than guessed at.
  if (digits.length === 11 && digits.startsWith("1")) return `+1${digits.slice(1)}`;
  if (digits.length === 10) return `+1${digits}`;
  return `+${digits}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The verdict
// ─────────────────────────────────────────────────────────────────────────────

export type PresenceStatus = "match" | "mismatch" | "duplicate" | "missing" | "not_checked";

export interface Canonical {
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
}

export interface Listed {
  name: string | null;
  address: string | null;
  phone: string | null;
}

export interface FieldDiff {
  field: "name" | "address" | "phone";
  canonical: string;
  listed: string;
  note?: string;
}

export interface ComparisonResult {
  status: PresenceStatus;
  diffs: FieldDiff[];
}

export function canonicalAddress(c: Canonical): string {
  return [c.addressLine1, c.addressLine2, c.city, c.state, c.postalCode]
    .filter(Boolean)
    .join(", ");
}

/**
 * Compare one listing against the canonical record.
 *
 * Returns 'missing' only when there is genuinely no listing to compare. A caller that has not
 * looked yet must pass nothing at all and leave the row at 'not_checked' — this function is
 * never the thing that decides a platform was checked.
 */
export function compareListing(canonical: Canonical, listed: Listed | null): ComparisonResult {
  if (!listed) return { status: "missing", diffs: [] };

  const diffs: FieldDiff[] = [];

  const names = compareNames(canonical.name, listed.name);
  if (!names.exact) {
    if (names.suffixDiffers) {
      diffs.push({
        field: "name",
        canonical: canonical.name,
        listed: listed.name ?? "",
        note: "same name, different entity suffix",
      });
    } else if (!names.withoutSuffix) {
      diffs.push({ field: "name", canonical: canonical.name, listed: listed.name ?? "" });
    }
  }

  const canonAddr = canonicalAddress(canonical);
  if (normalizeAddressForCompare(canonAddr) !== normalizeAddressForCompare(listed.address)) {
    diffs.push({ field: "address", canonical: canonAddr, listed: listed.address ?? "" });
  }

  if (normalizePhoneForCompare(canonical.phone) !== normalizePhoneForCompare(listed.phone)) {
    diffs.push({ field: "phone", canonical: canonical.phone ?? "", listed: listed.phone ?? "" });
  }

  return { status: diffs.length === 0 ? "match" : "mismatch", diffs };
}

/** The canonical block as it is read aloud on the call, field by field. */
export function canonicalLine(c: Canonical): string {
  const state = normalizeState(c.state ?? "") || c.state || "";
  return [c.name, canonicalAddress({ ...c, state }), c.phone].filter(Boolean).join(" · ");
}
