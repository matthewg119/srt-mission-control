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
export type DedupeMatch = "in_file" | "domain" | "phone" | "email";

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
}

export interface KnownKeys {
  domain: ReadonlySet<string>;
  phone: ReadonlySet<string>;
  email: ReadonlySet<string>;
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

export function rowKeys(raw: Record<string, string>, cols: DedupeColumns): DedupeKeys {
  return {
    domain: domainKey(cols.website ? raw[cols.website] : null),
    phone: phoneKey(cols.phone ? raw[cols.phone] : null),
    email: emailKey(cols.email ? raw[cols.email] : null),
  };
}

const KEY_ORDER = ["domain", "phone", "email"] as const;

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
}): { fresh: DedupeRow[]; dupes: DuplicateRow[] } {
  const { rows, cols, known } = input;

  const claimed = {
    domain: new Set<string>(),
    phone: new Set<string>(),
    email: new Set<string>(),
  };

  const fresh: DedupeRow[] = [];
  const dupes: DuplicateRow[] = [];

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
      dupes.push({ ...row, matchedOn: prior, matchedValue: keys[prior] as string });
      return;
    }

    if (keys.domain) claimed.domain.add(keys.domain);
    if (keys.phone) claimed.phone.add(keys.phone);
    if (keys.email) claimed.email.add(keys.email);
    fresh.push(row);
  });

  return { fresh, dupes };
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
): { domain: string[]; phone: string[]; email: string[] } {
  const domain = new Set<string>();
  const phone = new Set<string>();
  const email = new Set<string>();
  for (const raw of rows) {
    const k = rowKeys(raw, cols);
    if (k.domain) domain.add(k.domain);
    if (k.phone) phone.add(k.phone);
    if (k.email) email.add(k.email);
  }
  return { domain: [...domain], phone: [...phone], email: [...email] };
}
