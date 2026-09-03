// The cheap half of the cold-list filter: everything decidable from the string itself.
//
// Ported from Matthew's apollo_prefilter.py. The ORDER in filter.ts is the script's order and is
// load-bearing for cost, not for correctness: every check here is free and the MX lookup is not, so
// a role account or a disposable domain must be rejected before anything resolves DNS for it.
//
// ‼️ THIS FILE MAKES NO NETWORK CALLS AND MUST NOT START. It is the half the probe can exercise
// offline, which is what makes "is the port faithful to the Python" a question that can be answered
// without a resolver, a Slack token or a database.

import { DISPOSABLE_DOMAINS } from "@/data/disposable-domains";

/** Every reason a row can be dropped. Written to `scraper_rows.reason` and to junk.csv. */
export type JunkReason =
  | "no_email"
  | "duplicate_in_file"
  // Caught by the drop's dedupe (dedup.ts) against `scraper_seen`, before the picker. The row is
  // carried into the workflow rather than sliced out of the file so its row_index stays honest.
  | "duplicate_prior_batch"
  | "already_in_crm"
  | "bad_syntax"
  | "role_account"
  | "disposable_domain"
  | "no_mx";

/**
 * Role accounts, ported VERBATIM from the Python's ROLE_PATTERN.
 *
 * Anchored at the start and terminated by `@`, so it matches the whole local part and never a
 * substring: `sales@` is a role account, `salesian@` and `jsales@` are people.
 */
export const ROLE_PATTERN =
  /^(info|admin|sales|contact|support|hello|team|marketing|noreply|no-reply|billing|hr|jobs|careers|help|office|webmaster|postmaster|abuse|feedback|enquiries|inquiries)@/i;

/** The header names an Apollo export has actually used, best first. Matched case-insensitively. */
const EMAIL_HEADER_CANDIDATES = ["email", "primary email", "email address", "work email"];

/**
 * The company, city and website columns, for the scoring workflow.
 *
 * Company is REQUIRED there the way email is required for filtering: there is nothing to search for
 * without it. City and website are OPTIONAL, and their absence is a *not measured* signal in
 * `score.ts` rather than a zero, which is why a miss here is never an error on those two.
 *
 * `website` deliberately does NOT accept a bare `url`: an Apollo export uses that header for the
 * LinkedIn profile URL, and scoring "does their own domain rank #1" against a linkedin.com address
 * measures nothing while looking like it measured something.
 */
const COMPANY_HEADER_CANDIDATES = ["company", "company name", "business", "business name", "name", "organization", "account name"];
const CITY_HEADER_CANDIDATES = ["city", "company city", "business city", "location", "town"];
const WEBSITE_HEADER_CANDIDATES = ["website", "company website", "website url", "domain", "company domain", "web site"];
/**
 * The state column, for the United States filter in `geo.ts`.
 *
 * A miss is NOT an error and must never become one. Plenty of exports carry the state inside the
 * city cell ("Charlotte, NC") and nothing else, which `locationVerdict` reads perfectly well; a
 * required state column would refuse those files outright.
 */
const STATE_HEADER_CANDIDATES = ["state", "company state", "business state", "region", "province", "state/province", "state or province"];
/**
 * The phone column, for the drop's dedupe key.
 *
 * A miss is never an error: plenty of exports carry no phone at all, and a row with no phone simply
 * dedupes on its domain or its address instead. The business line comes before the personal one,
 * because two contacts at one clinic share the clinic's number and that is exactly the collision
 * worth catching.
 */
const PHONE_HEADER_CANDIDATES = [
  "phone", "phone number", "company phone", "business phone", "primary phone",
  "work direct phone", "corporate phone", "telephone", "tel", "mobile phone", "mobile",
];

/**
 * Which column holds a given field.
 *
 * The Python hardcoded `"email"` and told you to edit the constant. Apollo exports it as `Email`,
 * so the script's own default was wrong for its own stated input and every first run died on
 * "Column 'email' not in CSV". Case-insensitive with fallbacks, and a miss returns null so the
 * caller can NAME THE HEADERS IT FOUND rather than throwing a message nobody can act on.
 */
function resolveColumn(headers: string[], candidates: string[]): string | null {
  const byLower = new Map<string, string>();
  for (const h of headers) {
    const key = h.trim().toLowerCase();
    if (!byLower.has(key)) byLower.set(key, h);
  }
  for (const candidate of candidates) {
    const hit = byLower.get(candidate);
    if (hit) return hit;
  }
  return null;
}

export function resolveEmailColumn(headers: string[]): string | null {
  return resolveColumn(headers, EMAIL_HEADER_CANDIDATES);
}

export function resolveCompanyColumn(headers: string[]): string | null {
  return resolveColumn(headers, COMPANY_HEADER_CANDIDATES);
}

export function resolveCityColumn(headers: string[]): string | null {
  return resolveColumn(headers, CITY_HEADER_CANDIDATES);
}

export function resolveWebsiteColumn(headers: string[]): string | null {
  return resolveColumn(headers, WEBSITE_HEADER_CANDIDATES);
}

export function resolveStateColumn(headers: string[]): string | null {
  return resolveColumn(headers, STATE_HEADER_CANDIDATES);
}

export function resolvePhoneColumn(headers: string[]): string | null {
  return resolveColumn(headers, PHONE_HEADER_CANDIDATES);
}

const LOCAL_PART = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$/;

/**
 * Syntax, replacing the `email-validator` dependency.
 *
 * Returns the lowercased domain on success and null on failure, so a caller gets the one thing it
 * needs next (the domain, for the disposable and MX checks) without parsing the address twice.
 *
 * ‼️ NO IDNA. A non-ASCII domain is rejected as bad_syntax rather than punycoded, which is a real
 * behaviour difference from the Python and is stated here rather than discovered. It is the right
 * call for a US B2B Apollo pull and the wrong one for a list that is not: if that day comes, the
 * fix is a punycode pass here, NOT loosening the label check.
 */
export function emailDomain(email: string): string | null {
  if (email.length > 254) return null;

  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return null;

  const local = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase();

  if (local.length > 64) return null;
  // Quoted local parts ("john doe"@x.com) are legal and are never a real Apollo row. Rejecting
  // them keeps the check simple and cannot cost a lead.
  if (!LOCAL_PART.test(local)) return null;

  if (domain.length > 253) return null;
  const labels = domain.split(".");
  // A bare hostname is not a deliverable business address.
  if (labels.length < 2) return null;
  for (const label of labels) {
    if (label.length === 0 || label.length > 63) return null;
    if (!DOMAIN_LABEL.test(label)) return null;
  }
  // The TLD carries no digits and no hyphens. This is what rejects an IP-literal domain.
  const tld = labels[labels.length - 1];
  if (tld.length < 2 || !/^[A-Za-z]+$/.test(tld)) return null;

  return domain;
}

export function isRoleAccount(email: string): boolean {
  return ROLE_PATTERN.test(email);
}

export function isDisposableDomain(domain: string): boolean {
  return DISPOSABLE_DOMAINS.has(domain);
}

/** Human-readable order for the junk breakdown, so two runs print their reasons the same way. */
export const JUNK_REASON_ORDER: JunkReason[] = [
  "no_email",
  "duplicate_in_file",
  "duplicate_prior_batch",
  "already_in_crm",
  "bad_syntax",
  "role_account",
  "disposable_domain",
  "no_mx",
];
