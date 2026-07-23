// Website research step for the Audit Engine — fetches the homepage + a couple of
// likely inner pages and extracts everything the classifier needs to name the
// business type AND its city with high confidence, without ever asking the user.
// Reuses the existing UA-spoofed fetcher instead of adding a scraping dependency.

import { fetchText, textFromHtml } from "@/lib/medspa-owner-scrape";

const INNER_PATH_HINTS = ["about", "contact", "locations", "services", "location"];
const MAX_PAGES = 3; // homepage + up to 2 more
const TEXT_BUDGET_CHARS = 16000; // ~4K tokens

export interface ResearchedPage {
  url: string;
  text: string;
}

export interface SiteResearch {
  website: string;
  title: string | null;
  metaDescription: string | null;
  siteName: string | null;
  headings: string[];
  pages: ResearchedPage[];
  bodyText: string; // combined, budget-truncated
  schemaHints: Record<string, unknown>[]; // parsed LocalBusiness/Organization JSON-LD blocks
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
  const origin = new URL(website).origin;

  const homepageHtml = await fetchText(website);
  if (!homepageHtml) {
    throw new Error(`Could not fetch ${website} — site may be down or blocking automated requests.`);
  }

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

  return { website, title, metaDescription, siteName, headings, pages, bodyText, schemaHints };
}
