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

/** Second profile, used only on a retry. A WAF that fingerprinted the first one gets a
 *  different shape rather than the identical request it just refused. */
const USER_AGENT_ALT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

/**
 * Why the request carries more than a User-Agent: a Chrome UA arriving with NO `Accept`,
 * no `Accept-Language` and no `Sec-Fetch-*` is a textbook bot fingerprint — real Chrome
 * never sends that combination, so managed WordPress hosts and Cloudflare bot rules drop it
 * at the edge. Do NOT add `Accept-Encoding`: undici negotiates and decodes compression
 * itself, and a manual value makes it hand back bytes it will not decode.
 */
function browserHeaders(ua: string): Record<string, string> {
  const chrome = ua.includes("Chrome/");
  return {
    "User-Agent": ua,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    "Upgrade-Insecure-Requests": "1",
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-User": "?1",
    ...(chrome
      ? {
          "sec-ch-ua": '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        }
      : {}),
  };
}

export type FetchFailReason = "blocked" | "timeout" | "http_error" | "not_html" | "network";

export type FetchPageResult =
  | { ok: true; html: string; status: number; finalUrl: string }
  | { ok: false; status: number | null; reason: FetchFailReason; detail: string };

export interface FetchPageOptions {
  /** Default 6000 — a bulk-scrape budget. A single high-value fetch should raise it: heavy
   *  page builders (Elementor et al) are routinely slower than 6s to first byte, and giving
   *  up on one is indistinguishable downstream from being blocked. */
  timeoutMs?: number;
  /** Default 0, so bulk callers behave exactly as before. Retries wait before firing —
   *  an instant second request into a rate limiter is guaranteed to fail and then looks
   *  like confirmation of a block. Any retry also enables the www/apex variant attempt. */
  retries?: number;
}

const RETRY_DELAY_MS = 2500;

/** A Cloudflare-style interstitial commonly answers 200 with a challenge BODY, so status
 *  alone cannot detect it. These markers are what the challenge page actually contains. */
const CHALLENGE_MARKERS = [
  "__cf_chl",
  "cf-mitigated",
  "cf_chl_opt",
  "just a moment...",
  "attention required! | cloudflare",
  "checking your browser before accessing",
  "enable javascript and cookies to continue",
  "/cdn-cgi/challenge-platform",
];

function looksLikeChallenge(html: string): boolean {
  const head = html.slice(0, 4000).toLowerCase();
  return CHALLENGE_MARKERS.some((m) => head.includes(m));
}

/** Reject only what is definitely not a page. A missing content-type is ACCEPTED: plenty of
 *  small-business hosts omit it entirely, and the old `ct.includes("text/html")` rule threw
 *  away 200s carrying perfectly good markup. */
function isPageContentType(ct: string): boolean {
  if (!ct) return true;
  const v = ct.toLowerCase();
  if (v.includes("text/html") || v.includes("application/xhtml")) return true;
  return !/^(image|video|audio|font)\/|application\/(pdf|json|zip|octet-stream|x-|javascript)/.test(v);
}

/** Swap example.com <-> www.example.com. Returns null when the URL cannot be parsed. */
function hostVariant(url: string): string | null {
  try {
    const u = new URL(url);
    u.hostname = u.hostname.startsWith("www.") ? u.hostname.slice(4) : `www.${u.hostname}`;
    return u.toString();
  } catch {
    return null;
  }
}

function retryable(r: Extract<FetchPageResult, { ok: false }>): boolean {
  if (r.reason === "timeout" || r.reason === "network") return true;
  if (r.reason === "blocked") return true;
  return r.reason === "http_error" && (r.status === 429 || (r.status ?? 0) >= 500);
}

async function attempt(url: string, timeoutMs: number, ua: string): Promise<FetchPageResult> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: "follow", headers: browserHeaders(ua) });
    const status = res.status;
    if (!res.ok) {
      const blocked = status === 403 || status === 429 || status === 503;
      return {
        ok: false,
        status,
        reason: blocked ? "blocked" : "http_error",
        detail: `HTTP ${status} ${res.statusText}`.trim(),
      };
    }
    const ct = res.headers.get("content-type") || "";
    if (!isPageContentType(ct)) {
      return { ok: false, status, reason: "not_html", detail: `content-type ${ct}` };
    }
    const html = await res.text();
    if (looksLikeChallenge(html)) {
      return { ok: false, status, reason: "blocked", detail: `bot challenge page returned with HTTP ${status}` };
    }
    return { ok: true, html, status, finalUrl: res.url || url };
  } catch (e) {
    const err = e as Error;
    const aborted = err.name === "AbortError" || err.name === "TimeoutError";
    return {
      ok: false,
      status: null,
      reason: aborted ? "timeout" : "network",
      detail: aborted ? `no response within ${timeoutMs}ms` : err.message || "network error",
    };
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a page and say WHY it failed. The whole point of the result shape is that "blocked",
 * "timeout" and "network" are three different facts about a prospect's site, and collapsing
 * them into one null (which this used to do) produced a message accusing healthy sites of
 * walling off crawlers. Only `reason: "blocked"` is evidence of anything.
 */
export async function fetchPage(url: string, opts?: FetchPageOptions): Promise<FetchPageResult> {
  const timeoutMs = opts?.timeoutMs ?? TIMEOUT_MS;
  const retries = Math.max(0, opts?.retries ?? 0);

  let last = await attempt(url, timeoutMs, USER_AGENT);
  for (let i = 0; i < retries && !last.ok && retryable(last); i++) {
    await sleep(RETRY_DELAY_MS);
    last = await attempt(url, timeoutMs, i === 0 ? USER_AGENT_ALT : USER_AGENT);
  }
  if (last.ok) return last;

  // Some hosts serve only one of apex/www and answer the other with a redirect loop, a 403
  // or nothing at all. One extra request, and only on a lane that already opted into retries.
  if (retries > 0 && last.reason !== "not_html") {
    const alt = hostVariant(url);
    if (alt) {
      const altResult = await attempt(alt, timeoutMs, USER_AGENT);
      if (altResult.ok) return altResult;
    }
  }
  return last;
}

/** Back-compat wrapper: every bulk caller (owner scrape, email scrape) wants "the html or
 *  nothing" and none of them can act on a reason. Behaviour is unchanged for them. */
export async function fetchText(url: string): Promise<string | null> {
  const res = await fetchPage(url);
  return res.ok ? res.html : null;
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
