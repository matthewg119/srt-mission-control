// Free, self-hosted email scraper for lead websites. Fetches each clinic's public pages (homepage
// plus contact/about/team paths) and extracts published emails: mailto: links, plain-text and
// JSON-LD addresses, cheap "[at]/[dot]" de-obfuscation, and Cloudflare email-protection decoding.
// Candidates are junk-filtered and ranked by `emailTier` below, owner first.
//
// No paid enrichment and no API keys, just fetch plus regex, the same approach as the open-source
// extract-emails tools. Shares fetchText/textFromHtml with the med-spa owner scraper.
//
// ‼️ THE ONLY IMPORTER IS src/lib/scraper/enrich.ts, WHICH LOADS IT LAZILY. The header used to name
// scripts/enrich-trt-emails.ts and /api/cron/enrich-trt-emails; neither path exists, and
// `enrichEmails` at the bottom of this file has no callers at all. Corrected 2026-09-25 rather than
// left to mislead the next reader into thinking a change here has a blast radius it does not have.

import {
  NAME_SCORE_CEILING,
  bestNameScore,
  collectNames,
  fetchText,
  pickOwnerName,
  textFromHtml,
  type NameCandidate,
} from "@/lib/medspa-owner-scrape";
// The lane's wider role list. Imported rather than re-spelled: the two lists disagree, and
// emailTier below needs to know about BOTH kinds of role address to rank them apart. rules.ts
// imports only a type and a data file, so there is no cycle.
import { ROLE_PATTERN } from "@/lib/scraper/rules";

const CONTACT_PATHS = ["", "/contact", "/contact-us", "/about", "/about-us", "/team", "/staff"];

// Sites that are JS shells or aggregators — fetching them wastes the timeout budget.
const SKIP_SITE_DOMAINS = [
  "facebook.com", "instagram.com", "linktr.ee", "business.site", "google.com",
  "yelp.com", "linkedin.com", "tiktok.com", "youtube.com",
];

// Free webmail — allowed as a fallback pick (tier 3), never treated as "same domain".
const WEBMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com", "icloud.com",
  "me.com", "live.com", "msn.com", "comcast.net", "att.net", "verizon.net", "sbcglobal.net",
  "protonmail.com", "proton.me", "ymail.com", "googlemail.com", "mac.com", "mail.com",
]);

// Placeholder / infrastructure domains that regex-scraping HTML always surfaces.
const JUNK_DOMAINS = new Set([
  "example.com", "example.org", "example.net", "email.com", "domain.com",
  "yourdomain.com", "mysite.com", "yoursite.com", "test.com", "company.com",
  "godaddy.com", "secureserver.net", "squarespace.com", "duda.co", "webs.com",
]);
const JUNK_DOMAIN_SUFFIXES = [".wixpress.com", ".sentry.io", ".wordpress.com", ".sentry-cdn.com"];

const JUNK_LOCAL_PARTS = new Set([
  "noreply", "no-reply", "donotreply", "do-not-reply", "mailer-daemon", "postmaster",
  "abuse", "privacy", "dmca", "example", "user", "username", "name", "email", "test",
  "webmaster", "hostmaster",
]);

// Monitored front-office inboxes — the best outreach targets.
const ROLE_LOCAL_PARTS = new Set([
  "info", "contact", "hello", "office", "frontdesk", "admin", "appointments",
  "support", "hi", "team", "care", "reception", "scheduling", "clinic", "help",
]);

// srcset ghosts (logo@2x.png) and asset paths that match the email regex.
const ASSET_EXT_RE = /\.(png|jpe?g|gif|webp|svg|css|js|woff2?|ttf|eot|ico|mp4|pdf)$/i;

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g;

export interface EmailCandidate {
  email: string;
  viaMailto: boolean;
  path: string;
  count: number;
}

export interface EmailScrapeTarget {
  website?: string | null;
  email?: string | null;
  email_source?: string | null;
}

function localPartOf(email: string): string {
  return email.slice(0, email.indexOf("@"));
}

function domainOf(email: string): string {
  return email.slice(email.lastIndexOf("@") + 1).toLowerCase();
}

/** Registrable domain, roughly: last two labels ("www.clinic.com" -> "clinic.com"). */
function registrableDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, "").split(".");
  return labels.length <= 2 ? labels.join(".") : labels.slice(-2).join(".");
}

/** Decode Cloudflare /cdn-cgi/l/email-protection#<hex> payloads (single-byte XOR). */
function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2 !== 0) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) {
    out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  }
  return out.includes("@") ? out : null;
}

/** "info [at] clinic [dot] com" + numeric entities -> scannable text. */
function deobfuscate(text: string): string {
  return text
    .replace(/&#0*64;/g, "@")
    .replace(/&#0*46;/g, ".")
    .replace(/\s*[\[({]\s*at\s*[\])}]\s*/gi, "@")
    .replace(/\s*[\[({]\s*dot\s*[\])}]\s*/gi, ".");
}

function cleanEmail(raw: string): string {
  return raw.trim().replace(/[.,;:)\]}>]+$/, "").toLowerCase();
}

function isJunk(email: string): boolean {
  if (email.length > 60) return true;
  const local = localPartOf(email);
  const domain = domainOf(email);
  if (!local || local.length > 40) return true;
  if (JUNK_LOCAL_PARTS.has(local)) return true;
  if (/^[a-f0-9]{16,}$/i.test(local)) return true; // Sentry DSN keys / asset hashes
  if (ASSET_EXT_RE.test(email)) return true; // logo@2x.png etc.
  if (JUNK_DOMAINS.has(domain)) return true;
  if (JUNK_DOMAIN_SUFFIXES.some((s) => domain.endsWith(s))) return true;
  if (!/\.[a-z]{2,}$/i.test(domain)) return true;
  return false;
}

/** Pull every plausible email out of one page's raw HTML. */
export function extractEmails(html: string): { email: string; viaMailto: boolean }[] {
  const seen = new Map<string, { email: string; viaMailto: boolean }>();
  const add = (raw: string, viaMailto: boolean) => {
    const email = cleanEmail(raw);
    if (!email.includes("@") || isJunk(email)) return;
    const existing = seen.get(email);
    if (existing) existing.viaMailto = existing.viaMailto || viaMailto;
    else seen.set(email, { email, viaMailto });
  };

  // 1. mailto: hrefs — strongest signal. URL-decode (%40) and split comma lists.
  for (const m of html.matchAll(/mailto:([^"'?>\s]+)/gi)) {
    let decoded = m[1];
    try { decoded = decodeURIComponent(m[1]); } catch { /* keep raw */ }
    for (const part of decoded.split(",")) add(part, true);
  }

  // 2. Cloudflare email-protection (data-cfemail attr + /cdn-cgi/l/email-protection#hex).
  for (const m of html.matchAll(/data-cfemail="([0-9a-f]+)"/gi)) {
    const decoded = decodeCfEmail(m[1]);
    if (decoded) add(decoded, true);
  }
  for (const m of html.matchAll(/email-protection#([0-9a-f]+)/gi)) {
    const decoded = decodeCfEmail(m[1]);
    if (decoded) add(decoded, true);
  }

  // 3. Regex over raw HTML (catches JSON-LD "email": "...") and de-obfuscated text.
  for (const m of html.matchAll(EMAIL_RE)) add(m[0], false);
  for (const m of deobfuscate(textFromHtml(html)).matchAll(EMAIL_RE)) add(m[0], false);

  return Array.from(seen.values());
}

/**
 * Which band a candidate falls in. Lower wins. Exported so the early exit in `scrapeEmail` and the
 * offline probe read the SAME rule this function states.
 *
 * ‼️ THE TIERS ARE SIX BANDS, NOT A SWAP OF THE OLD TWO, AND THE REASON IS THAT THE TWO ROLE LISTS
 * DISAGREE. `ROLE_LOCAL_PARTS` here holds 15 front-office words; `ROLE_PATTERN` in scraper/rules.ts
 * holds 22 and they are not nested. `careers`, `hr`, `billing`, `marketing`, `webmaster` and
 * `noreply` are roles to rules.ts and NOT to this file. So simply preferring "same-domain non-role"
 * over "same-domain role" would have promoted `careers@clinic.com` and `hr@clinic.com` above
 * `info@clinic.com`: every clinic with a careers page would get its hiring inbox mailed. Splitting
 * role into a FRONT office band above info@'s peers and a BACK office band below them is what makes
 * owner-first safe.
 *
 * ‼️ AND THE ABSENCE OF A ROLE WORD IS NOT EVIDENCE OF A PERSON. Measured on 60 live med spa sites
 * 2026-09-25: the same-domain non-role addresses were overwhelmingly business inboxes
 * (`highpointmedspa@`, `zenfuldaymedspa@`), and exactly one, `marina@mmaestheticss.com`, was a
 * person. So tier 1 needs a POSITIVE signal, and without one a candidate lands at tier 3, BELOW
 * info@, which is the behaviour this file already had and the safe default to keep.
 */
export const EMAIL_TIER = {
  /** A named human on the clinic's own domain. Confirmed by ownerName, or shaped like first.last. */
  OWNER: 1,
  /** A monitored front desk inbox on their domain. A single-location clinic reads this one itself. */
  FRONT_OFFICE: 2,
  /** Same domain, nothing to say about it. Usually the business's own name as a mailbox. */
  SAME_DOMAIN: 3,
  /** Same domain, but hiring / billing / bounces. Deliberately below the front desk. */
  BACK_OFFICE: 4,
  /** The clinic runs on gmail. */
  WEBMAIL: 5,
  /** A parent med group's role address, seen via mailto only. */
  OTHER_DOMAIN_ROLE: 6,
  /** Web-agency footer credits and the like. */
  REJECT: 99,
} as const;

/** Front desk, per THIS file's list. The addresses a clinic owner actually reads. */
function isFrontOfficeRole(local: string): boolean {
  return ROLE_LOCAL_PARTS.has(local);
}

/** A role account by the lane's wider definition, which includes hiring, billing and bounces. */
function isAnyRole(local: string): boolean {
  return ROLE_LOCAL_PARTS.has(local) || ROLE_PATTERN.test(local + "@");
}

/**
 * The mailbox is the business wearing a mailbox, not a person: `zenfuldaymedspa@zenfulday.com`.
 * Compared both ways because the brand is sometimes the longer string and sometimes the shorter.
 */
function looksLikeBusinessInbox(local: string, siteDomain: string): boolean {
  const brand = siteDomain.split(".")[0].replace(/[^a-z0-9]/g, "");
  const l = local.replace(/[^a-z0-9]/g, "");
  if (!brand || !l) return false;
  return l.includes(brand) || brand.includes(l);
}

/** Tokens of a person's name, lowercased, letters only. */
function nameTokens(ownerName: string): string[] {
  return ownerName
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z]/g, ""))
    .filter((t) => t.length > 1);
}

/**
 * Is this local part a named human?
 *
 * A confirmed owner name is the strong answer and the only one worth tier 1 on its own. Failing
 * that, `first.last` shaped local parts are person-shaped by convention. Anything else is not
 * claimed to be a person.
 */
export function looksLikePerson(local: string, siteDomain: string, ownerName?: string | null): boolean {
  if (looksLikeBusinessInbox(local, siteDomain)) return false;
  if (isAnyRole(local)) return false;

  const flat = local.replace(/[^a-z]/g, "");
  if (ownerName) {
    const tokens = nameTokens(ownerName);
    const first = tokens[0];
    const last = tokens.length > 1 ? tokens[tokens.length - 1] : "";
    if (first && flat === first) return true;
    if (last && flat === last) return true;
    if (first && last) {
      if (flat === first + last || flat === last + first) return true;
      if (flat === first[0] + last || flat === first + last[0]) return true;
      if (flat.includes(first) && flat.includes(last)) return true;
    }
  }

  // first.last / first_last / first-last, both halves alphabetic and long enough to be names.
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => /^[a-z]{2,}$/.test(p))) return true;

  return false;
}

export function emailTier(
  c: EmailCandidate,
  siteDomain: string,
  ownerName?: string | null
): number {
  const domain = domainOf(c.email);
  const local = localPartOf(c.email);
  if (registrableDomain(domain) === siteDomain) {
    if (looksLikePerson(local, siteDomain, ownerName)) return EMAIL_TIER.OWNER;
    if (isFrontOfficeRole(local)) return EMAIL_TIER.FRONT_OFFICE;
    if (isAnyRole(local)) return EMAIL_TIER.BACK_OFFICE;
    return EMAIL_TIER.SAME_DOMAIN;
  }
  if (WEBMAIL_DOMAINS.has(domain)) return EMAIL_TIER.WEBMAIL;
  if (isAnyRole(local) && c.viaMailto) return EMAIL_TIER.OTHER_DOMAIN_ROLE;
  return EMAIL_TIER.REJECT;
}

/** The best tier anything in the pool reached. REJECT when the pool holds nothing usable. */
export function bestEmailTier(
  candidates: Iterable<EmailCandidate>,
  siteDomain: string,
  ownerName?: string | null
): number {
  let best: number = EMAIL_TIER.REJECT;
  for (const c of candidates) {
    const tier = emailTier(c, siteDomain, ownerName);
    if (tier < best) best = tier;
  }
  return best;
}

/**
 * Rank candidates for a site and return the best, or null.
 *
 * Tie-break within a band: occurrence count desc, mailto first, shortest.
 */
export function pickBestEmail(
  candidates: EmailCandidate[],
  siteDomain: string,
  ownerName?: string | null
): { email: string; source: string } | null {
  const ranked = candidates
    .map((c) => ({ c, tier: emailTier(c, siteDomain, ownerName) }))
    .filter((r) => r.tier < EMAIL_TIER.REJECT)
    .sort((a, b) =>
      a.tier - b.tier ||
      b.c.count - a.c.count ||
      Number(b.c.viaMailto) - Number(a.c.viaMailto) ||
      a.c.email.length - b.c.email.length
    );

  if (!ranked.length) return null;
  const best = ranked[0].c;
  return { email: best.email, source: `scrape:${best.path || "/"}${best.viaMailto ? ":mailto" : ""}` };
}

/**
 * The ordered union of the email paths and the owner-name paths.
 *
 * Five of the fourteen URLs the two old passes fetched were identical, with no HTTP cache anywhere,
 * so a site was downloaded twice to answer two questions about the same bytes.
 */
const CRAWL_PATHS = [
  "", "/contact", "/contact-us", "/about", "/about-us", "/our-team", "/team", "/meet-the-team", "/staff",
];

export interface SiteCrawl {
  /** The best owner name found, or the hint passed in if the pages offered nothing better. */
  ownerName: string | null;
  email: string | null;
  source: string | null;
  /** Pages actually requested, whether or not they answered. */
  pagesFetched: number;
  /** Every request failed. Distinguishes "a site with nothing on it" from "a site we cannot read". */
  blocked: boolean;
  /** Stopped on the page budget or the deadline rather than because it was finished. */
  truncated: boolean;
}

export interface CrawlOptions {
  /** Stop before fetching another page once Date.now() passes this. */
  deadline?: number;
  /** Hard cap on pages for one site. Defaults to every CRAWL_PATHS entry. */
  maxPages?: number;
  /** A name the caller already has, from the file or a previous pass. */
  ownerName?: string | null;
}

/**
 * One pass over a site that answers BOTH questions: who owns it, and where to write.
 *
 * ‼️ THIS IS A TICK SAFETY FIX BEFORE IT IS AN EFFICIENCY ONE. The two old passes fetched up to 14
 * URLs at a 6000 ms timeout, so one dead site could burn 84 seconds, and sweepEnrich checks its
 * deadline per LEAD rather than per page. Three dead sites in a row ate a whole 240 second cron
 * tick and the batch made no progress. Hence `deadline` and `maxPages`, both honoured BETWEEN pages.
 *
 * ‼️ THE NAME AND THE ADDRESS ARE COLLECTED TOGETHER BUT USED SEPARATELY. The name is an INPUT to
 * the enrichment waterfall (the permutation rung cannot permute without it) and it must be stored
 * even when the site yields no address at all, so it cannot be folded into a Provider rung that
 * returns null on "no email found".
 */
export async function crawlSite(website: string, opts: CrawlOptions = {}): Promise<SiteCrawl> {
  const out: SiteCrawl = {
    ownerName: opts.ownerName ?? null,
    email: null,
    source: null,
    pagesFetched: 0,
    blocked: false,
    truncated: false,
  };

  // Outscraper websites often carry encoded tracking junk ("...%3Futm_source%3D...") that 404s when
  // fetched verbatim. Decode, then drop the query entirely.
  const raw = website.replace(/%3F/gi, "?").replace(/%26/gi, "&").replace(/%3D/gi, "=");
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  let base: string;
  let origin: string;
  let siteDomain: string;
  try {
    const url = new URL(withProto);
    origin = url.origin;
    base = origin + url.pathname; // the stored page (a franchise location, say) minus the query
    siteDomain = registrableDomain(url.hostname);
  } catch {
    return out;
  }
  if (SKIP_SITE_DOMAINS.some((d) => siteDomain === d)) return out;

  const paths = CRAWL_PATHS.slice(0, opts.maxPages ?? CRAWL_PATHS.length);
  const pool = new Map<string, EmailCandidate>();
  const names: NameCandidate[] = [];
  let reached = 0;

  let finished = false;
  for (const path of paths) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    out.pagesFetched++;
    const html = await fetchText(path ? `${origin}${path}` : base);
    if (!html) continue;
    reached++;

    for (const found of extractEmails(html)) {
      const existing = pool.get(found.email);
      if (existing) {
        existing.count++;
        existing.viaMailto = existing.viaMailto || found.viaMailto;
      } else {
        pool.set(found.email, { ...found, path, count: 1 });
      }
    }
    names.push(...collectNames(textFromHtml(html), path));

    // ‼️ THE STOP CONDITION IS A CONJUNCTION, AND BOTH HALVES ARE DERIVED. Either question alone
    // finishing is not a reason to stop asking the other, which is precisely the bug the two
    // separate passes had: each stopped on its own first answer and neither saw the other's pages.
    const bestName = pickOwnerName(names) ?? opts.ownerName ?? null;
    const haveOwnerEmail = bestEmailTier(pool.values(), siteDomain, bestName) === EMAIL_TIER.OWNER;
    if (haveOwnerEmail && bestNameScore(names) >= NAME_SCORE_CEILING) {
      finished = true;
      break;
    }
  }

  // Either a budget cut it short, or it ran out of paths without both answers in hand. Both mean
  // "there may be more on this site", which is what the caller needs to know.
  out.truncated = !finished && out.pagesFetched < CRAWL_PATHS.length;
  out.blocked = reached === 0;
  out.ownerName = pickOwnerName(names) ?? opts.ownerName ?? null;
  const picked = pickBestEmail([...pool.values()], siteDomain, out.ownerName);
  out.email = picked?.email ?? null;
  out.source = picked?.source ?? null;
  return out;
}

/**
 * Crawl one site's contact paths and return the best published email, or null.
 *
 * `ownerName`, when the caller already has one, is what lets `emailTier` promote a named human to
 * tier 1. Without it a same-domain non-role address stays at tier 3, below info@.
 */
export async function scrapeEmail(
  website: string,
  ownerName?: string | null
): Promise<{ email: string; source: string } | null> {
  const pass = await crawlSite(website, { ownerName });
  return pass.email ? { email: pass.email, source: pass.source ?? "scrape" } : null;
}

/**
 * Back-fill email/email_source in place for rows that lack one but have a website,
 * with bounded concurrency. Each row is a distinct clinic domain and per-site path
 * fetches are serial, so no per-domain throttle is needed; the origin cache below
 * dedupes the odd multi-location chain sharing one website. Mutates rows and
 * returns the rows actually scanned (so callers only stamp email_checked_at on
 * those). deadlineMs (epoch) stops dispatching new sites past the cutoff (for
 * the 60s cron budget) — already-dispatched ones finish, the rest stay unscanned.
 */
export async function enrichEmails<T extends EmailScrapeTarget>(
  rows: T[],
  opts: {
    concurrency?: number;
    onProgress?: (done: number, total: number) => void;
    deadlineMs?: number;
  } = {}
): Promise<{ found: number; scanned: T[] }> {
  const targets = rows.filter((r) => !r.email && r.website);
  const concurrency = opts.concurrency ?? 6;
  const cache = new Map<string, Promise<{ email: string; source: string } | null>>();
  const scanned: T[] = [];
  let found = 0;
  let done = 0;

  const scrapeCached = (website: string) => {
    const key = website.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
    let p = cache.get(key);
    if (!p) {
      p = scrapeEmail(website);
      cache.set(key, p);
    }
    return p;
  };

  for (let i = 0; i < targets.length; i += concurrency) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) break;
    const batch = targets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        const hit = await scrapeCached(row.website as string);
        if (hit) {
          row.email = hit.email;
          row.email_source = hit.source;
          found++;
        }
        done++;
        opts.onProgress?.(done, targets.length);
      })
    );
    scanned.push(...batch);
  }
  return { found, scanned };
}
