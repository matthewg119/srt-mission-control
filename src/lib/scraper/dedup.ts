// The dedupe that runs at the DROP, before the workflow picker.
//
// The old lane deduped on email, against `outreach_prospects`, as check 3 of 7 inside filter.ts —
// which is to say only for workflow 1 and only after somebody had already reacted. Workflow 2
// deduped on nothing, so a company scored last week got a second DataForSEO SERP bought for it.
// This runs first, on every drop, against every key the file carries.
//
// ‼️ PURE. No Slack, no database, no network, exactly like filter.ts and for the same reason:
// `_probe-scraper-dedup.ts` can prove the two rails below offline. The known-key Sets are handed
// in, never queried.
//
// The match rule is DOMAIN or PHONE or EMAIL, any hit. Three independent keys rather than one
// composite, because a med-spa list carries a website and no email, an Apollo export carries an
// email and often no website, and an Outscraper pull carries a phone and both.

import { normalizeHost } from "@/lib/company-identity";
import { emailDomain } from "./rules";

/** Which key caught the row. Reported verbatim in duplicates.csv. */
export type DedupeMatch = "in_file" | "domain" | "phone" | "email" | "company_city";

/**
 * Hosts that identify a PLATFORM rather than a business.
 *
 * ‼️ THIS SET IS THE DIFFERENCE BETWEEN A DEDUPE AND A DELETION. Exports write `facebook.com`,
 * `instagram.com` and `business.site` into the website cell for every business that has no site of
 * its own. Keyed on those, the SECOND med spa on Facebook is dropped as a duplicate of the first
 * and never appears again, because the drop also writes the key to the ledger. Making the key null
 * instead lets the row fall through to phone and email, which actually identify it.
 *
 * ‼️ ONLY THE BARE APEX IS LISTED. On a builder host the subdomain IS the identity, so
 * `wixsite.com` is rejected and `glowbar.wixsite.com` is kept. Turning this into a suffix match
 * would delete every Wix clinic after the first.
 */
export const NON_IDENTIFYING_HOSTS: ReadonlySet<string> = new Set([
  "facebook.com", "m.facebook.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "yelp.com", "google.com", "sites.google.com", "business.site", "wixsite.com", "wix.com",
  "squarespace.com", "godaddysites.com", "weebly.com", "wordpress.com", "blogspot.com",
  "mystrikingly.com", "webflow.io", "square.site", "youtube.com", "tiktok.com", "booksy.com",
  "vagaro.com", "setmore.com", "schedulicity.com", "yahoo.com", "gmail.com",
]);

/** Which column holds each key. Any of them may be missing; a file with none dedupes to nothing. */
export interface DedupeColumns {
  company: string | null;
  city: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
}

export interface DedupeKeys {
  domain: string | null;
  phone: string | null;
  email: string | null;
  /** Only ever set when the other three are null. See `rowKeys`. */
  companyCity: string | null;
}

export interface KnownKeys {
  domain: ReadonlySet<string>;
  phone: ReadonlySet<string>;
  email: ReadonlySet<string>;
  companyCity: ReadonlySet<string>;
}

export interface DedupeRow {
  /** 0-based index into the parsed CSV. Preserved so the workflows can step over it in place. */
  rowIndex: number;
  raw: Record<string, string>;
  keys: DedupeKeys;
  company: string | null;
  city: string | null;
  website: string | null;
}

export interface DuplicateRow extends DedupeRow {
  matchedOn: DedupeMatch;
  /** The key that actually collided, so duplicates.csv says why rather than just that it did. */
  matchedValue: string;
}

/**
 * The website cell as a comparable host, or null when it identifies nobody.
 *
 * Reuses `normalizeHost` rather than writing a second domain normalizer: the audit engine, the
 * inbound-lead stack and this lane have to agree on what "the same site" means.
 */
export function domainKey(website: string | null | undefined): string | null {
  const host = normalizeHost(website);
  if (!host) return null;
  // A bare hostname or an IP literal is not a business site.
  if (!host.includes(".")) return null;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;
  if (NON_IDENTIFYING_HOSTS.has(host)) return null;
  return host;
}

/**
 * The last ten digits, never the string.
 *
 * ‼️ SAME DOCTRINE AS `contacts.phone_last10`. "(704) 555-0134", "+1 704-555-0134" and
 * "17045550134" are one number written three ways, and a string key matches none of them to each
 * other. Fewer than ten digits is not a phone number: a bare "555-0134" would otherwise collide
 * every seven-digit local listing in the file onto one lead.
 */
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  if (digits.length < 10) return null;
  const last10 = digits.slice(-10);
  // 0000000000 / 5555555555: placeholder cells, not numbers, and they collide everything.
  if (/^(\d)\1{9}$/.test(last10)) return null;
  return last10;
}

/** Lowercased address, but only when it is syntactically an address at all. */
export function emailKey(email: string | null | undefined): string | null {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return null;
  return emailDomain(addr) ? addr : null;
}

/**
 * The last-resort key: a normalized company name and its city.
 *
 * ‼️ THIS IS NOT `normalizeCompanyName`, AND THE DIFFERENCE IS DELIBERATE. That one strips generic
 * suffixes — spa, clinic, studio, center — because it answers "is this the same company under two
 * names". Here those words are often the ONLY thing separating two businesses on one street, so
 * "Glow Spa" and "Glow Clinic" in Charlotte must stay two rows. Punctuation and case come out;
 * nothing else does.
 *
 * ‼️ BOTH HALVES ARE REQUIRED. "Skin Bar" in Charlotte and "Skin Bar" in Miami are two businesses,
 * so a row with no city gets no key at all rather than a key that collides across the country.
 */
export function companyCityKey(
  company: string | null | undefined,
  city: string | null | undefined
): string | null {
  const name = (company ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  const where = (city ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (!name || !where) return null;
  return name + "|" + where;
}

/**
 * ‼️ `companyCity` IS COMPUTED ONLY WHEN THE OTHER THREE ARE NULL, structurally, not by ordering it
 * last. A name match is the weakest evidence this lane has: a chain with one domain and ten
 * locations would collide on it, and a franchise would collide with its own franchisor. It exists
 * for the rows that would otherwise carry NO key at all — an Outscraper company pull with a blank
 * website column, which is exactly the file this whole feature was asked for — where the choice is
 * not "name or something better", it is "name or never dedupe this list".
 */
/**
 * Is this cell a name that was cut off before it was exported?
 *
 * ‼️ THE ELLIPSIS IS IN THE DATA, NOT IN A DISPLAY. `leads (2).csv` was built from a screenshot of
 * an Apollo result grid, so the grid's visual truncation was captured as literal text: 71 of its
 * 115 company names ended in "..." while `leads (1).csv` had none. The dedupe still worked on the
 * short names and matched 85, but "Aloe Vera Medical Cente..." can never match the
 * "Aloe Vera Medical Center" already in the ledger, so 54 real repeats were reported as new.
 *
 * A truncated list is not a list this lane can dedupe, and the failure is SILENT and looks exactly
 * like a genuinely fresh pull. Naming it at the drop is the only place it is cheap to fix.
 */
export function looksTruncated(value: string | null | undefined): boolean {
  const s = (value ?? "").trimEnd();
  return s.endsWith("...") || s.endsWith("…");
}

/** How many of the file's company cells were cut off. Zero on a real export. */
export function countTruncatedNames(
  rows: Array<Record<string, string>>,
  companyColumn: string | null
): number {
  if (!companyColumn) return 0;
  let n = 0;
  for (const raw of rows) if (looksTruncated(raw[companyColumn])) n++;
  return n;
}

export function rowKeys(raw: Record<string, string>, cols: DedupeColumns): DedupeKeys {
  const domain = domainKey(cols.website ? raw[cols.website] : null);
  const phone = phoneKey(cols.phone ? raw[cols.phone] : null);
  const email = emailKey(cols.email ? raw[cols.email] : null);
  const companyCity =
    domain || phone || email
      ? null
      : companyCityKey(cols.company ? raw[cols.company] : null, cols.city ? raw[cols.city] : null);
  return { domain, phone, email, companyCity };
}

const KEY_ORDER = ["domain", "phone", "email", "companyCity"] as const;

/** The field name is camelCase; the ledger's key_type and the CSV's reason are snake_case. */
const MATCH_OF: Record<(typeof KEY_ORDER)[number], DedupeMatch> = {
  domain: "domain",
  phone: "phone",
  email: "email",
  companyCity: "company_city",
};

function cell(raw: Record<string, string>, column: string | null): string | null {
  if (!column) return null;
  return (raw[column] ?? "").trim() || null;
}

/**
 * Split a parsed file into the rows nobody has seen and the rows somebody has.
 *
 * The check order is in_file -> domain -> phone -> email, and the FIRST hit is what gets reported.
 * In-file first because it costs nothing. Domain before phone because a domain identifies exactly
 * one business while a phone can be a shared front desk or an answering service, so when a row
 * collides on both, the domain is the more honest thing to print.
 *
 * ‼️ A FRESH ROW CLAIMS ITS KEYS. Two rows in one file sharing a phone are one lead, and the first
 * occurrence survives, which is the rule `duplicate_in_file` has always followed in filter.ts.
 */
export function splitDuplicates(input: {
  rows: Array<Record<string, string>>;
  cols: DedupeColumns;
  known: KnownKeys;
}): { fresh: DedupeRow[]; dupes: DuplicateRow[]; keyless: number } {
  const { rows, cols, known } = input;

  const claimed = {
    domain: new Set<string>(),
    phone: new Set<string>(),
    email: new Set<string>(),
    companyCity: new Set<string>(),
  };

  const fresh: DedupeRow[] = [];
  const dupes: DuplicateRow[] = [];
  // Rows carrying no key of any kind. They can never be a duplicate and can never be recorded, so
  // they come back as new forever — which is worth SAYING rather than leaving to be discovered.
  let keyless = 0;

  rows.forEach((raw, rowIndex) => {
    const keys = rowKeys(raw, cols);
    const row: DedupeRow = {
      rowIndex,
      raw,
      keys,
      company: cell(raw, cols.company),
      city: cell(raw, cols.city),
      website: cell(raw, cols.website),
    };

    const inFile = KEY_ORDER.find((k) => keys[k] !== null && claimed[k].has(keys[k] as string));
    if (inFile) {
      dupes.push({ ...row, matchedOn: "in_file", matchedValue: keys[inFile] as string });
      return;
    }

    const prior = KEY_ORDER.find((k) => keys[k] !== null && known[k].has(keys[k] as string));
    if (prior) {
      dupes.push({ ...row, matchedOn: MATCH_OF[prior], matchedValue: keys[prior] as string });
      return;
    }

    let keyed = false;
    for (const k of KEY_ORDER) {
      const value = keys[k];
      if (value) {
        claimed[k].add(value);
        keyed = true;
      }
    }
    if (!keyed) keyless++;
    fresh.push(row);
  });

  return { fresh, dupes, keyless };
}

/**
 * Every distinct key in the file.
 *
 * The ledger is asked about THESE, never paged whole: `scraper_seen` grows with every drop forever,
 * while `knownProspectEmails` pages a table that is the follow-up operator's few thousand rows.
 */
export function allKeys(
  rows: Array<Record<string, string>>,
  cols: DedupeColumns
): { domain: string[]; phone: string[]; email: string[]; companyCity: string[] } {
  const sets = {
    domain: new Set<string>(),
    phone: new Set<string>(),
    email: new Set<string>(),
    companyCity: new Set<string>(),
  };
  for (const raw of rows) {
    const k = rowKeys(raw, cols);
    for (const key of KEY_ORDER) if (k[key]) sets[key].add(k[key] as string);
  }
  return {
    domain: [...sets.domain],
    phone: [...sets.phone],
    email: [...sets.email],
    companyCity: [...sets.companyCity],
  };
}
