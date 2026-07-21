// Free, self-hosted email scraper for lead websites (TRT vertical first).
// Fetches each clinic's public pages (homepage + contact/about/team paths) and
// extracts published emails: mailto: links, plain-text/JSON-LD addresses, cheap
// "[at]/[dot]" de-obfuscation, and Cloudflare email-protection decoding. Candidates
// are junk-filtered and ranked (same-domain role address first, personal webmail
// allowed as fallback — many single-location clinics run on gmail).
//
// No paid enrichment, no API keys — plain fetch + regex, same approach as the
// open-source extract-emails tools. Shares fetchText/textFromHtml with the
// med-spa owner scraper. Used by scripts/enrich-trt-emails.ts and
// /api/cron/enrich-trt-emails.

import { fetchText, textFromHtml } from "@/lib/medspa-owner-scrape";

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
 * Rank candidates for a site. Tier order:
 *   1. same-domain role address (info@clinic.com)
 *   2. same-domain anything (drsmith@clinic.com)
 *   3. personal webmail (clinic runs on gmail)
 *   4. other-domain role address seen via mailto: (parent med group)
 *   Rejected: other-domain non-mailto (web-agency footer credits).
 * Tie-break within a tier: occurrence count desc, mailto first, shortest.
 */
export function pickBestEmail(
  candidates: EmailCandidate[],
  siteDomain: string
): { email: string; source: string } | null {
  const tierOf = (c: EmailCandidate): number => {
    const domain = domainOf(c.email);
    const sameDomain = registrableDomain(domain) === siteDomain;
    const isRole = ROLE_LOCAL_PARTS.has(localPartOf(c.email));
    if (sameDomain) return isRole ? 1 : 2;
    if (WEBMAIL_DOMAINS.has(domain)) return 3;
    if (isRole && c.viaMailto) return 4;
    return 99;
  };

  const ranked = candidates
    .map((c) => ({ c, tier: tierOf(c) }))
    .filter((r) => r.tier < 99)
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

/** Crawl one site's contact paths and return the best published email, or null. */
export async function scrapeEmail(website: string): Promise<{ email: string; source: string } | null> {
  // Outscraper websites often carry encoded tracking junk ("...%3Futm_source%3D...")
  // that 404s when fetched verbatim — decode, then drop the query entirely.
  const raw = website.replace(/%3F/gi, "?").replace(/%26/gi, "&").replace(/%3D/gi, "=");
  const withProto = raw.startsWith("http") ? raw : `https://${raw}`;
  let base: string;
  let origin: string;
  let siteDomain: string;
  try {
    const url = new URL(withProto);
    origin = url.origin;
    base = origin + url.pathname; // stored page (e.g. a franchise location) minus query
    siteDomain = registrableDomain(url.hostname);
  } catch {
    return null;
  }
  if (SKIP_SITE_DOMAINS.some((d) => siteDomain === d)) return null;

  const pool = new Map<string, EmailCandidate>();
  for (const path of CONTACT_PATHS) {
    const html = await fetchText(path ? `${origin}${path}` : base);
    if (!html) continue;
    for (const found of extractEmails(html)) {
      const existing = pool.get(found.email);
      if (existing) {
        existing.count++;
        existing.viaMailto = existing.viaMailto || found.viaMailto;
      } else {
        pool.set(found.email, { ...found, path, count: 1 });
      }
    }
    // Early-exit only on a tier-1 hit (same-domain role address) — for anything
    // weaker the /contact page may still hold a better address than the homepage.
    const hasTier1 = Array.from(pool.values()).some(
      (c) => registrableDomain(domainOf(c.email)) === siteDomain && ROLE_LOCAL_PARTS.has(localPartOf(c.email))
    );
    if (hasTier1) break;
  }

  return pickBestEmail(Array.from(pool.values()), siteDomain);
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
