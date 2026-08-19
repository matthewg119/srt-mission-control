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

/** Find up to `limit` distinct inner-page URLs worth fetching, based on nav/footer hrefs. */
function findInnerPaths(html: string, origin: string, limit: number): string[] {
  const hrefs = [...html.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => m[1]);
  const seen = new Set<string>();
  const found: string[] = [];

  for (const href of hrefs) {
    if (found.length >= limit) break;
    const lower = href.toLowerCase();
    if (!INNER_PATH_HINTS.some((hint) => lower.includes(hint))) continue;

    let abs: string;
    try {
      abs = new URL(href, origin).toString();
    } catch {
      continue;
    }
    if (new URL(abs).origin !== origin) continue; // stay on-site
    if (seen.has(abs)) continue;
    seen.add(abs);
    found.push(abs);
  }

  return found;
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
