// Website research step for the Audit Engine — fetches the homepage + a couple of
// likely inner pages and extracts everything the classifier needs to name the
// business type AND its city with high confidence, without ever asking the user.
// Reuses the existing UA-spoofed fetcher instead of adding a scraping dependency.

import { fetchPage, fetchText, textFromHtml } from "@/lib/medspa-owner-scrape";
import type { CrawlBlock, ResearchSource } from "./types";

const INNER_PATH_HINTS = ["about", "contact", "locations", "services", "location"];
const MAX_PAGES = 3; // homepage + up to 2 more
const TEXT_BUDGET_CHARS = 16000; // ~4K tokens

/** One audit is one page fetch we actually care about, not one of a 500-site batch, so it gets
 *  a real budget. The 6s default was the direct cause of a healthy Elementor site being
 *  reported to Matthew as "may be down or blocking automated requests". */
const HOMEPAGE_TIMEOUT_MS = 20000;
const HOMEPAGE_RETRIES = 1;

/** Below this much visible text we cannot honestly say what the business does, so the 20
 *  questions would be generic. A JS-rendered shell whose server HTML is nav-only lands here. */
const THIN_TEXT_CHARS = 600;

/** Carries the observed cause so the pipeline can decide between "fall back to search" and
 *  "there is nothing here to audit" — the old bare Error made every failure look the same. */
export class SiteFetchError extends Error {
  readonly block: CrawlBlock;
  constructor(block: CrawlBlock, message: string) {
    super(message);
    this.name = "SiteFetchError";
    this.block = block;
  }
}

/** True when the pages were readable but say too little to classify the business from.
 *  Mechanical on purpose: a judgment call here would be a second thing to argue with. */
export function isThinResearch(research: SiteResearch): boolean {
  if (research.bodyText.trim().length >= THIN_TEXT_CHARS) return false;
  return research.headings.length === 0 && research.schemaHints.length === 0;
}

export interface ResearchedPage {
  url: string;
  text: string;
}

export interface SiteResearch {
  /** NULL on a declared run (no website exists at all). Everything that reads this must handle
   *  it: robots.txt cannot be fetched, and the classifier is told the business has no site. */
  website: string | null;
  title: string | null;
  metaDescription: string | null;
  siteName: string | null;
  headings: string[];
  pages: ResearchedPage[];
  bodyText: string; // combined, budget-truncated
  schemaHints: Record<string, unknown>[]; // parsed LocalBusiness/Organization JSON-LD blocks
  /** Raw homepage markup. Kept so site-signals.ts can look for things the text
   *  extraction throws away (copyright year, viewport meta, tel: links) without
   *  re-fetching the page. Not given to the classifier — that reads bodyText. */
  homepageHtml: string;
  /** Where this research came from. "site" is the only value that permits a claim about
   *  their pages — see AuditReportRow.research_source. */
  source: ResearchSource;
  /** What the fetcher observed, when it could not read the page. Null on a clean fetch. */
  blocked: CrawlBlock | null;
}

function normalizeUrl(input: string): string {
  return input.startsWith("http") ? input : `https://${input}`;
}

function extractTag(html: string, re: RegExp): string | null {
  const m = html.match(re);
  return m?.[1]?.trim() || null;
}

function extractHeadings(html: string): string[] {
  const matches = [...html.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)];
  return matches
    .map((m) => textFromHtml(m[1]).trim())
    .filter(Boolean)
    .slice(0, 20);
}

/** Extract schema.org JSON-LD blocks (LocalBusiness/Organization) — the highest-confidence city signal. */
function extractSchemaHints(html: string): Record<string, unknown>[] {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const hints: Record<string, unknown>[] = [];
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block[1].trim());
      const items = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of items) {
        const type = String((item as Record<string, unknown>)?.["@type"] ?? "");
        if (/LocalBusiness|Organization|.*Business$/i.test(type)) {
          hints.push(item as Record<string, unknown>);
        }
      }
    } catch {
      // Malformed JSON-LD is common on small-business sites — ignore and move on.
    }
  }
  return hints;
}

/**
 * One href, resolved and judged, or null.
 *
 * ‼️ THE ONE URL RULE, SHARED BY BOTH READERS BELOW. `findInnerPaths` scans every href on the
 * page and `discoverNavSections` scans anchors for their text; those are legitimately different
 * extractions, but "is this a same-origin page worth fetching" must be answered in one place, or
 * the audit and the replica end up disagreeing about what counts as part of somebody's site.
 *
 * mailto: and tel: need no rule of their own: their origin is never the site's origin.
 */
function sameOriginUrl(href: string, origin: string): string | null {
  let abs: string;
  try {
    abs = new URL(href, origin).toString();
  } catch {
    return null;
  }
  if (new URL(abs).origin !== origin) return null; // stay on-site
  // A file is not a page. Fetching one costs a request and yields no readable text.
  if (/\.(pdf|zip|docx?|xlsx?|pptx?|jpe?g|png|gif|svg|webp|avif|mp4|mp3|wav|ico|css|js|xml|json)$/i.test(
      new URL(abs).pathname)) {
    return null;
  }
  return abs;
}

/** Find up to `limit` distinct inner-page URLs worth fetching, based on nav/footer hrefs. */
function findInnerPaths(html: string, origin: string, limit: number): string[] {
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const found: string[] = [];

  for (const href of hrefs) {
    if (found.length >= limit) break;
    const lower = href.toLowerCase();
    if (!INNER_PATH_HINTS.some((hint) => lower.includes(hint))) continue;

    const abs = sameOriginUrl(href, origin);
    if (!abs || seen.has(abs)) continue;
    seen.add(abs);
    found.push(abs);
  }

  return found;
}

/**
 * The handful of HTML entities that actually turn up in a navigation label.
 *
 * ‼️ HERE RATHER THAN IN textFromHtml, WHICH DECODES ONLY &nbsp;. That function feeds the audit
 * classifier, where a stray "&amp;" costs nothing because a model reads straight through it.
 * A nav label is different: it is rendered VERBATIM on the site replica, on a screen the client
 * is looking at, and "Botox &amp; Fillers" in their own menu is the kind of detail that makes
 * the whole artifact look broken. Widening textFromHtml would change what the audit lane sees
 * for no benefit it asked for.
 *
 * Named entities only, plus numeric escapes. Not a general HTML decoder and not trying to be:
 * the output is React text content, never markup, so an entity we miss renders as itself.
 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "-",
    mdash: "-",
    rsquo: "'",
    lsquo: "'",
    rdquo: '"',
    ldquo: '"',
    hellip: "...",
  };

  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : whole;
    }
    return named[body.toLowerCase()] ?? whole;
  });
}

/** One page of their site, as their own navigation names it. */
export interface NavSection {
  url: string;
  /** The anchor text, which is what makes a replica recognisable to the person who wrote it. */
  label: string;
  /** Their own path with its slashes intact. The homepage is the empty string. */
  path: string;
  order: number;
}

/**
 * The sections of a site, read off its own navigation.
 *
 * ‼️ IT READS ANCHORS RATHER THAN HREFS, AND THAT IS THE DIFFERENCE FROM findInnerPaths. The
 * label is the payload here: a replica is recognisable because it carries the words the owner
 * chose for their own menu, not because it guessed that a URL containing "about" is the about
 * page. So a bare `<link>` or a scripted href, which findInnerPaths would happily take, is not a
 * section: nothing named it.
 *
 * ‼️ IT DOES NOT FOLLOW ANYTHING. One document in, a bounded list out. A crawler that walked
 * from here would be the rehost this whole lane exists to refuse; see the header of
 * src/lib/clients/site-replica.ts.
 *
 * Document order is kept, because a site's nav is already ordered by how its owner ranks it.
 */
export function discoverNavSections(html: string, origin: string, limit: number): NavSection[] {
  const anchors = [...html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const seen = new Set<string>();
  const out: NavSection[] = [];

  for (const [, href, inner] of anchors) {
    if (out.length >= limit) break;

    const abs = sameOriginUrl(href, origin);
    if (!abs) continue;

    const path = new URL(abs).pathname.replace(/^\/+|\/+$/g, "");
    // The homepage is fetched by the caller and is not a section of itself.
    if (!path) continue;
    if (seen.has(path)) continue;

    // An anchor wrapping a logo or an icon has no text. It names nothing, so it is not a
    // section: a replica page titled "" is worse than one page fewer.
    // ‼️ DASHES NORMALISED AFTER DECODING, AND IT IS A CONSISTENCY FIX, NOT A STYLE ONE. The
    // named map turns &mdash; into a hyphen, so leaving &#8212; to decode into a real em dash
    // would render the SAME label two different ways depending on how their CMS happened to
    // encode it. The repo-wide no-em-dash rule agrees with the direction; this is the reason it
    // is done here rather than left to hasBannedDash, which guards drafted copy and not a label
    // taken verbatim off somebody else's menu.
    const label = decodeEntities(textFromHtml(inner))
      .replace(/[–—]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    if (!label || label.length > 60) continue;

    seen.add(path);
    out.push({ url: abs, label, path, order: out.length });
  }

  return out;
}

export async function researchWebsite(websiteInput: string): Promise<SiteResearch> {
  const website = normalizeUrl(websiteInput);

  // ‼️ This parse used to be unguarded, and it is the whole reason `/audit JBR CRANE SERVICES,
  // LLC` answered "Couldn't fetch JBR CRANE SERVICES, LLC: Invalid URL". A business name became
  // `https://JBR CRANE SERVICES, LLC`, `new URL` threw a bare TypeError, and the pipeline's
  // catch reported the message of an error that was never about fetching anything.
  //
  // The parser upstream makes that specific case unreachable now, but the guard stays: a raw
  // TypeError here is caught by a handler that assumes a fetch failure, so anything malformed
  // arriving from anywhere would be reported as a network problem. A SiteFetchError says what
  // actually happened and carries the tri-state block every downstream reader expects.
  let origin: string;
  try {
    origin = new URL(website).origin;
  } catch {
    throw new SiteFetchError(
      {
        reason: "network",
        status: null,
        detail: "url_unparseable",
        checked_at: new Date().toISOString(),
        engines_cited_site: null,
      },
      `${websiteInput} is not a usable web address.`
    );
  }

  const res = await fetchPage(website, { timeoutMs: HOMEPAGE_TIMEOUT_MS, retries: HOMEPAGE_RETRIES });
  if (!res.ok) {
    // Say what actually happened. "Blocked" is a fact about THEM; every other reason is a fact
    // about US, and the two used to print the same sentence.
    const block: CrawlBlock = {
      reason: res.reason,
      status: res.status,
      detail: res.detail,
      checked_at: new Date().toISOString(),
      engines_cited_site: null,
    };
    throw new SiteFetchError(block, `Could not read ${website} — ${describeFailure(res.reason, res.detail)}.`);
  }
  const homepageHtml = res.html;

  const title = extractTag(homepageHtml, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDescription = extractTag(
    homepageHtml,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i
  );
  const siteName = extractTag(
    homepageHtml,
    /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']*)["']/i
  );
  const headings = extractHeadings(homepageHtml);
  const schemaHints = extractSchemaHints(homepageHtml);

  const pages: ResearchedPage[] = [{ url: website, text: textFromHtml(homepageHtml) }];

  const innerPaths = findInnerPaths(homepageHtml, origin, MAX_PAGES - 1);
  for (const url of innerPaths) {
    const html = await fetchText(url);
    if (!html) continue;
    pages.push({ url, text: textFromHtml(html) });
    schemaHints.push(...extractSchemaHints(html));
  }

  const combined = pages.map((p) => p.text).join("\n\n");
  const bodyText = combined.slice(0, TEXT_BUDGET_CHARS);

  return {
    website,
    title,
    metaDescription,
    siteName,
    headings,
    pages,
    bodyText,
    schemaHints,
    homepageHtml,
    source: "site",
    blocked: null,
  };
}

/** Plain English for the Slack line, one sentence, no hedging in either direction. */
export function describeFailure(reason: CrawlBlock["reason"], detail: string): string {
  switch (reason) {
    case "blocked":
      return `the site refused an automated request (${detail})`;
    case "timeout":
      return `the site did not respond in time (${detail}), which is our limit, not their fault`;
    case "network":
      return `we could not reach the host at all (${detail})`;
    case "not_html":
      return `the URL did not return a web page (${detail})`;
    default:
      return `the site returned an error (${detail})`;
  }
}
