// Best-effort owner-name scraper for med-spa leads. Google Maps / Outscraper has
// NO personal owner name, so this fetches the spa's website (homepage, then a few
// likely About/Team paths) and pulls a plausible "First Last" near owner / founder
// / CEO / medical-director cues. It is heuristic and hit-or-miss by design — many
// spas never name an owner. Bounded concurrency + short timeout so a batch of 500
// stays reasonable. Used by scripts/run-medspa.ts and scripts/enrich-medspa-owners.ts.

const TIMEOUT_MS = 6000;
const ABOUT_PATHS = ["", "/about", "/about-us", "/our-team", "/team", "/meet-the-team", "/staff"];

const NAME = "(?:Dr\\.?\\s+)?([A-Z][a-z]+(?:\\s+[A-Z]\\.)?\\s+[A-Z][a-z]+)";
const CUE_PATTERNS = [
  new RegExp(`(?:owner|founder|co-?founder|owned by|founded by|CEO|medical director)[^.<>]{0,40}?${NAME}`, "i"),
  new RegExp(`${NAME}[^.<>]{0,25}?(?:,?\\s*(?:owner|founder|co-?founder|CEO|medical director))`, "i"),
];

/** Strip tags + collapse whitespace so cues and names sit on the same line. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

// Full Chrome UA — a bare "Mozilla/5.0" trips more WAF rules (403s) on small-business sites.
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

export async function fetchText(url: string): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": USER_AGENT } });
    clearTimeout(t);
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") || "";
    if (!ct.includes("text/html")) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function findName(text: string): string | null {
  for (const re of CUE_PATTERNS) {
    const m = text.match(re);
    if (m && m[1]) {
      const name = m[1].trim();
      // Reject obvious non-names (all-caps headings, single tokens slipped through).
      if (/^[A-Z][a-z]+(\s+[A-Z]\.)?\s+[A-Z][a-z]+$/.test(name)) return name;
    }
  }
  return null;
}

/** Scrape one website for an owner name. Returns null if nothing plausible found. */
export async function scrapeOwnerName(website: string): Promise<string | null> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return null;
  }
  // Homepage first (most owner blurbs live there); then a couple of About paths.
  for (const path of ABOUT_PATHS) {
    const html = await fetchText(path ? `${origin}${path}` : base);
    if (!html) continue;
    const name = findName(textFromHtml(html));
    if (name) return name;
  }
  return null;
}

export interface OwnerScrapeTarget {
  website?: string | null;
  owner_name?: string | null;
}

/**
 * Back-fill owner_name in place for rows that lack it but have a website, with
 * bounded concurrency. Mutates each row's owner_name and returns how many were found.
 */
export async function enrichOwners<T extends OwnerScrapeTarget>(
  rows: T[],
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {}
): Promise<number> {
  const targets = rows.filter((r) => !r.owner_name && r.website);
  const concurrency = opts.concurrency ?? 6;
  let found = 0;
  let done = 0;
  for (let i = 0; i < targets.length; i += concurrency) {
    const batch = targets.slice(i, i + concurrency);
    await Promise.all(
      batch.map(async (row) => {
        const name = await scrapeOwnerName(row.website as string);
        if (name) {
          row.owner_name = name;
          found++;
        }
        done++;
        opts.onProgress?.(done, targets.length);
      })
    );
  }
  return found;
}
