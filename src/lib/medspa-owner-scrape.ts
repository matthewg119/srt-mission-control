// Best-effort owner-name scraper for med-spa leads. Google Maps / Outscraper has
// NO personal owner name, so this fetches the spa's website (homepage, then a few
// likely About/Team paths) and pulls a plausible "First Last" near owner / founder
// / CEO / medical-director cues. It is heuristic and hit-or-miss by design — many
// spas never name an owner. Bounded concurrency + short timeout so a batch of 500
// stays reasonable. Used by scripts/run-medspa.ts and scripts/enrich-medspa-owners.ts.

const TIMEOUT_MS = 6000;
const ABOUT_PATHS = ["", "/about", "/about-us", "/our-team", "/team", "/meet-the-team", "/staff"];

const NAME = "(?:Dr\\.?\\s+)?([A-Z][a-z]+(?:\\s+[A-Z]\\.)?\\s+[A-Z][a-z]+)";

// A cue that names an OWNER is worth more than one that names a role an employee can hold.
// "Medical Director" is the title of a hired physician at least as often as it is the founder's,
// and it was the single biggest source of wrong answers in the 60 site sample.
const STRONG_CUES = "owner|founder|co-?founder|owned by|founded by";
const WEAK_CUES = "CEO|medical director";
const ANY_CUE = `${STRONG_CUES}|${WEAK_CUES}`;

/**
 * Where the name sits relative to its cue, and which capture group holds which half.
 *
 * ‼️ `g` IS LOAD BEARING, NOT TIDINESS. `String.match` without it returns only the FIRST match, so
 * a page reading "Medical Director Jane Roe ... Owner John Smith" yielded Jane Roe, failed the
 * shape test, and John Smith was never seen. The junk did not merely get discarded, it SUPPRESSED
 * the real answer. That is why precision was 12%, and why fixing it should raise RECALL too.
 */
interface CueRule {
  re: RegExp;
  cueGroup: number;
  nameGroup: number;
}
const CUE_RULES: CueRule[] = [
  { re: new RegExp(`(${ANY_CUE})[^.<>]{0,40}?${NAME}`, "gi"), cueGroup: 1, nameGroup: 2 },
  // String.raw so the \s survives: inside a PLAIN template literal `\s` is an invalid escape and
  // collapses to a bare "s", which quietly turns this into a match on the letter s.
  { re: new RegExp(String.raw`${NAME}[^.<>]{0,25}?,?\s*(${ANY_CUE})`, "gi"), cueGroup: 2, nameGroup: 1 },
];

/**
 * Words that prove a capture is a TITLE or a nav label rather than a person.
 *
 * ‼️ MATCHED PER WHOLE TOKEN, NEVER AS A SUBSTRING. "Newman" has to survive "new" and "Andrawis"
 * has to survive "and", so a substring test would reject two of the seven names this scraper got
 * RIGHT. Every entry below was returned as an owner name by the matcher this replaces: the 60 site
 * sample produced `Nurse Practitioner`, `Medical Director`, `Lead Physician`, `Aesthetic Nurse`,
 * `Policy Refund` and `Button James`, and med_spa_leads.owner_name still holds `Join Our`,
 * `Learn More` and `Vision Empower` from the same code.
 */
const TITLE_TOKENS = new Set([
  // Clinical titles.
  "nurse", "practitioner", "director", "physician", "surgeon", "doctor", "md", "rn", "np", "pa",
  "aesthetic", "aesthetics", "aesthetician", "esthetician", "injector", "provider", "clinician",
  "lead", "senior", "chief", "head",
  // Business titles.
  "owner", "founder", "cofounder", "ceo", "president", "manager", "coordinator", "specialist",
  "assistant", "receptionist", "consultant", "staff", "team", "member",
  // Page furniture that matches "Titlecase Titlecase" and carries a cue nearby by accident.
  "policy", "refund", "privacy", "terms", "button", "learn", "read", "book", "booking", "schedule",
  "contact", "our", "your", "meet", "more", "now", "here", "home", "about", "view", "click", "call",
  "send", "submit", "welcome", "appointment", "appointments", "consultation", "service", "services",
  "treatment", "treatments", "gallery", "review", "reviews", "before", "after", "free", "join",
  "vision", "empower", "follow", "share", "search", "menu", "close", "open", "next", "back",
  "story", "speaker", "personal", "registered", "vascular", "interventional", "medical", "illness",
  // Treatments and brand words. A capitalised treatment beside a cue reads as "Titlecase Titlecase"
  // and cannot be a surname: measured on the frozen sample, these produced `Chemical Peels`,
  // `Amazing Hydrafacial` and `Illness Breast`.
  "amazing", "chemical", "peel", "peels", "botox", "filler", "fillers", "laser", "facial",
  "hydrafacial", "microneedling", "coolsculpting", "injectable", "injectables", "dermal",
  "wrinkle", "wrinkles", "skincare", "medspa", "wellness", "breast", "body", "skin",
]);

/**
 * A capture whose two halves are the same word is a nav artefact, not a person.
 *
 * med_spa_leads still holds `Marianne Marianne` from the pre-fix scraper, which is what a repeated
 * heading looks like after the tags are stripped. No blocklist can enumerate this, so it is a rule.
 */
function isRepeatedToken(name: string): boolean {
  const t = name.split(/\s+/).map((x) => x.replace(/\.$/, "").toLowerCase());
  return t.length >= 2 && t[0] === t[t.length - 1];
}

/** The shape a person's name takes, re-tested after capture. */
const NAME_SHAPE = /^[A-Z][a-z]+(\s+[A-Z]\.)?\s+[A-Z][a-z]+$/;

/** A strong cue, on an About page, with a Dr. prefix. Nothing beats it, so the crawl may stop. */
export const NAME_SCORE_CEILING = 4;

export interface NameCandidate {
  name: string;
  /** Higher is better. See scoreName. */
  score: number;
  /** The cue that introduced it, lowercased, for the card and for the probe. */
  cue: string;
  /** The path it was found on, "" for the homepage. */
  path: string;
  /** How many distinct pages carried it. A nav label is on all of them. */
  pages: number;
}

/** True when any whole token of the capture is a title or a nav word. */
export function looksLikeTitle(name: string): boolean {
  if (isRepeatedToken(name)) return true;
  return name
    .split(/\s+/)
    .map((t) => t.replace(/\.$/, "").toLowerCase())
    .some((t) => TITLE_TOKENS.has(t));
}

function scoreName(cue: string, path: string, hadDoctorPrefix: boolean): number {
  let score = new RegExp(`^(?:${STRONG_CUES})$`, "i").test(cue) ? 2 : 1;
  // An owner blurb on /about or /our-team is a deliberate statement about who runs the place. The
  // same words on the homepage are as likely to be a caption under a stock photo.
  if (path) score += 1;
  if (hadDoctorPrefix) score += 1;
  return score;
}

/**
 * Every plausible owner name on ONE page, scored. Pure, so the offline probe owns it.
 *
 * Both cue rules run over the whole page instead of stopping at the first hit, because the two say
 * different things ("Owner: John Smith" and "John Smith, Owner") and either can appear further down
 * the page than a title that matched earlier.
 */
export function collectNames(text: string, path: string): NameCandidate[] {
  const out: NameCandidate[] = [];
  for (const rule of CUE_RULES) {
    for (const m of text.matchAll(rule.re)) {
      const raw = (m[rule.nameGroup] ?? "").trim();
      const cue = (m[rule.cueGroup] ?? "").trim().toLowerCase();
      if (!raw || !cue) continue;
      if (!NAME_SHAPE.test(raw)) continue;
      if (looksLikeTitle(raw)) continue;
      out.push({ name: raw, score: scoreName(cue, path, /\bDr\.?\s/.test(m[0])), cue, path, pages: 1 });
    }
  }
  return out;
}

/**
 * The best name out of everything every page offered, or null.
 *
 * Candidates merge by name and keep their best score. The page count is a TIE BREAK rather than a
 * subtraction: a nav label appears on every page, but so does a real owner named in a site footer,
 * and a raw per-page penalty would rank junk carrying one strong cue above them. Breaking a tie
 * only fires when the cues were equally good, which is precisely when "this one is on fewer pages"
 * is the only thing left to say.
 */
export function pickOwnerName(candidates: NameCandidate[]): string | null {
  const merged = new Map<string, NameCandidate>();
  for (const c of candidates) {
    const existing = merged.get(c.name);
    if (!existing) {
      merged.set(c.name, { ...c });
      continue;
    }
    existing.pages += 1;
    if (c.score > existing.score) {
      existing.score = c.score;
      existing.cue = c.cue;
      existing.path = c.path;
    }
  }
  const ranked = [...merged.values()].sort(
    (a, b) => b.score - a.score || a.pages - b.pages || a.name.length - b.name.length
  );
  return ranked.length ? ranked[0].name : null;
}

/** The best score any candidate in the list reached, or 0 for an empty list. */
export function bestNameScore(candidates: NameCandidate[]): number {
  return candidates.reduce((best, c) => (c.score > best ? c.score : best), 0);
}


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

export interface OwnerScrapeOptions {
  /** Stop dispatching new pages once Date.now() passes this. Already-started fetches finish. */
  deadline?: number;
  /** Hard cap on pages fetched for one site. Defaults to every ABOUT_PATHS entry. */
  maxPages?: number;
}

/**
 * Scrape one website for an owner name. Returns null if nothing plausible was found.
 *
 * ‼️ IT READS EVERY PAGE IT IS ALLOWED TO, RATHER THAN RETURNING ON THE FIRST HIT. The old loop
 * stopped at the first page that produced any name at all, so a weak homepage caption beat the
 * founder's bio on /our-team and the better answer was never fetched. Only a ceiling score, which
 * nothing can outrank, ends the walk early.
 *
 * ‼️ THAT MAKES THE WORST CASE SLOWER, WHICH IS WHY THE BUDGET IS A PARAMETER. Seven paths at a
 * 6000 ms timeout is 42 seconds for one dead site, against a 240 second shared tick budget in
 * scraper-tick. The caller that runs inside a tick has to pass `deadline`.
 */
export async function scrapeOwnerName(
  website: string,
  opts: OwnerScrapeOptions = {}
): Promise<string | null> {
  const base = website.startsWith("http") ? website : `https://${website}`;
  let origin: string;
  try {
    origin = new URL(base).origin;
  } catch {
    return null;
  }

  const paths = ABOUT_PATHS.slice(0, opts.maxPages ?? ABOUT_PATHS.length);
  const found: NameCandidate[] = [];

  // Homepage first (most owner blurbs live there), then the About family.
  for (const path of paths) {
    if (opts.deadline !== undefined && Date.now() >= opts.deadline) break;
    const html = await fetchText(path ? `${origin}${path}` : base);
    if (!html) continue;
    found.push(...collectNames(textFromHtml(html), path));
    if (bestNameScore(found) >= NAME_SCORE_CEILING) break;
  }

  return pickOwnerName(found);
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
