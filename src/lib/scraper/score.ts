// How dominant is this business already, and where do we cut the list.
//
// Workflow B of the scraper lane. A company list with no contacts yet is scored on how strong its
// existing SEO/AEO presence is, so the businesses that are already winning can be thrown away and
// Apollo credits only get spent on the invisible ones.
//
// ‼️ THIS FILE IS PURE AND MAKES NO NETWORK CALLS AND MUST NOT START. Same split as rules.ts and
// filter.ts: dataforseo.ts owns the fetching, this owns the arithmetic, and that is what lets
// `_probe-score.ts` prove the weights with no API key and no spend. This score decides who gets
// deleted from a list, so it has to be provable offline.

/** One weighted signal. `attempted` is whether we could LOOK, not whether we FOUND anything. */
export interface ScoreComponent {
  weight: number;
  attempted: boolean;
  earned: number;
  note: string;
}

export type ScoreComponentKey =
  | "knowledge_graph"
  | "reviews"
  | "rating"
  | "own_domain"
  | "directories"
  | "instagram";

export interface ScoreResult {
  /** 0-100, or null when NOTHING could be measured. Null is retried, never stored as 0. */
  score: number | null;
  components: Record<ScoreComponentKey, ScoreComponent>;
  /** e.g. "5 of 6". Printed in the CSV so a number can be read with its own confidence. */
  measured: string;
}

export const COMPONENT_WEIGHTS: Record<ScoreComponentKey, number> = {
  knowledge_graph: 20,
  reviews: 25,
  rating: 10,
  own_domain: 15,
  directories: 30,
  instagram: 15,
};

export const COMPONENT_COUNT = Object.keys(COMPONENT_WEIGHTS).length;

/** Reviews normalize against this. 500 or more is as dominant as this one signal gets. */
const REVIEW_CEILING = 500;

/** At or above this earns the full weight. Below it earns nothing, which is a real finding. */
const GOOD_RATING = 4.0;

/** 3 points each, capped by the component weight, so ten citations and twenty are one answer. */
const DIRECTORY_POINTS = 3;

/**
 * Directory and aggregator hosts. A business the engines can only describe through somebody
 * else's page still has a presence, and that presence is what this component measures.
 *
 * Matched on the suffix of the hostname, so `www.yelp.com` and `m.yelp.com` both count and
 * `notyelp.com` does not.
 */
const DIRECTORY_HOSTS = [
  "yelp.com",
  "bbb.org",
  "yellowpages.com",
  "healthgrades.com",
  "realself.com",
  "mapquest.com",
  "angi.com",
  "thumbtack.com",
  "manta.com",
  "chamberofcommerce.com",
  "birdeye.com",
  "nextdoor.com",
  "tripadvisor.com",
  "vagaro.com",
  "booksy.com",
  "zocdoc.com",
  "groupon.com",
  "citysearch.com",
  "superpages.com",
  "foursquare.com",
];

// ── the SERP payload, only the parts this file reads ────────────────────────────────────────────
//
// Typed loosely on purpose. DataForSEO returns 40+ item types and adds more over time; a strict
// interface over their whole response would fail to compile on a shape change this file does not
// care about.

export interface SerpItem {
  type?: string;
  rank_group?: number;
  rank_absolute?: number;
  domain?: string;
  url?: string;
  title?: string;
  description?: string;
  snippet?: string;
  rating?: { value?: number | string | null; votes_count?: number | string | null } | null;
  items?: SerpItem[] | null;
}

export interface SerpPayload {
  items?: SerpItem[] | null;
}

export interface ScoreInput {
  company: string;
  /** The business's own site, when the source list carried one. Null makes own_domain UNMEASURED. */
  website?: string | null;
}

// ── small pure helpers ──────────────────────────────────────────────────────────────────────────

function hostOf(url: string | undefined | null): string {
  if (!url) return "";
  try {
    return new URL(url.includes("://") ? url : "https://" + url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

/** Strip a leading www./m. so two spellings of one host compare equal. */
function bareHost(host: string): string {
  return host.replace(/^(www|m|mobile)\./, "");
}

function isDirectoryHost(host: string): boolean {
  const bare = bareHost(host);
  return DIRECTORY_HOSTS.some((d) => bare === d || bare.endsWith("." + d));
}

/**
 * Every item on the SERP, depth first, because local_pack and its friends nest their entries under
 * `items` and a top-level-only pass misses every rating in the local block.
 *
 * Returns a flat array rather than taking a visitor: a callback that assigns to outer `let`s is not
 * tracked by TypeScript's control-flow analysis, so those variables narrow to `never` at the read
 * and the compiler stops checking the very fields this file exists to read.
 */
function flatten(items: SerpItem[] | null | undefined): SerpItem[] {
  const out: SerpItem[] = [];
  for (const item of items ?? []) {
    out.push(item);
    if (item.items) out.push(...flatten(item.items));
  }
  return out;
}

function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * A follower count out of a search snippet: "12.3K followers", "1,204 Followers", "2.1M followers".
 *
 * ‼️ RETURNS NULL RATHER THAN A GUESS, AND THE NULL IS THE WHOLE POINT. A snippet that mentions
 * Instagram without a parseable count leaves the instagram component UNMEASURED, which takes its 15
 * points out of the denominator. Inventing a number here would put a fabricated figure into the one
 * column this entire list is sorted and cut by.
 */
export function parseFollowerCount(text: string | undefined | null): number | null {
  if (!text) return null;
  // Case-insensitive: Google renders the snippet "1,204 Followers" as often as "12.3K followers",
  // and a capital F silently returning null would mark a real profile as unmeasured.
  const m = /(\d[\d.,]*)\s*([km])?\s*follower/i.exec(text);
  if (!m) return null;
  const base = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(base)) return null;
  const suffix = (m[2] ?? "").toLowerCase();
  const scale = suffix === "k" ? 1000 : suffix === "m" ? 1000000 : 1;
  return Math.round(base * scale);
}

/**
 * Does this result belong to the business itself.
 *
 * Host comparison only. A title match would be far looser and this decides a 15-point component:
 * "Radiance Med Spa | Charlotte" appears on a competitor's comparison page too.
 */
function isOwnDomain(website: string, host: string): boolean {
  const own = bareHost(hostOf(website));
  if (!own || !host) return false;
  const bare = bareHost(host);
  return bare === own || bare.endsWith("." + own) || own.endsWith("." + bare);
}

// ── the query ───────────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ NO VERTICAL IS HARDCODED HERE OR ANYWHERE BELOW IT. `"{company} med spa {city}"` bakes one
 * vertical into a lane that is otherwise vertical-agnostic, and the next vertical then scores
 * SILENTLY WRONG instead of failing. The audit engine holds the same line.
 *
 * This neutral fallback is not merely the safe default, it is the more CORRECT query: four of the
 * six components are brand-name signals, and adding a category term is exactly what makes "own
 * domain ranks #1 for its own name" stop meaning anything.
 */
export const NEUTRAL_SCORE_QUERY = "{company} {city}";

export function buildScoreQuery(
  template: string | null | undefined,
  vars: { company: string; city?: string | null }
): string {
  const shape = (template ?? "").trim() || NEUTRAL_SCORE_QUERY;
  return shape
    .replace(/\{company\}/gi, vars.company ?? "")
    .replace(/\{city\}/gi, vars.city ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

/** A caption is only a template when it actually carries the token that gets filled. */
export function captionTemplate(caption: string | null | undefined): string | null {
  const text = (caption ?? "").trim();
  if (!text) return null;
  return /\{company\}/i.test(text) ? text : null;
}

// ── the score ───────────────────────────────────────────────────────────────────────────────────

function component(weight: number, attempted: boolean, earned: number, note: string): ScoreComponent {
  return { weight, attempted, earned, note };
}

/**
 * Score one SERP.
 *
 * ‼️ A COMPONENT THAT COULD NOT BE MEASURED LEAVES THE DENOMINATOR. IT DOES NOT SCORE ZERO.
 * The result is `earned / attempted` rescaled to 0-100, never `earned / 100`. If unmeasured weights
 * simply vanished from a fixed total, a business nobody could measure would rank as LESS DOMINANT
 * than one that was, and this number is what the whole file is sorted by to decide who gets
 * deleted. Same doctrine as the MxVerdict tri-state in mx.ts and site_signals in the audit engine:
 * an absent answer from a lookup that did not happen is never stored as a finding.
 */
export function scoreSerp(payload: SerpPayload, input: ScoreInput): ScoreResult {
  const items = payload.items ?? [];
  const sawAnySerp = items.length > 0;
  const all = flatten(items);

  const organic = all
    .filter((item) => item.type === "organic")
    .sort((a, b) => (a.rank_group ?? 999) - (b.rank_group ?? 999));
  const knowledgeGraph = all.find((item) => item.type === "knowledge_graph") ?? null;
  const localPack =
    all.find((item) => item.type === "local_pack" || item.type === "local_pack_element") ?? null;

  // 1. Knowledge graph. Attempted whenever a SERP came back at all: present or absent is a real,
  //    readable answer, and absent is the strongest single invisibility signal Google hands over.
  const kg = component(
    COMPONENT_WEIGHTS.knowledge_graph,
    sawAnySerp,
    knowledgeGraph ? COMPONENT_WEIGHTS.knowledge_graph : 0,
    !sawAnySerp
      ? "not measured: no SERP returned"
      : knowledgeGraph
        ? "knowledge graph present"
        : "no knowledge graph"
  );

  // 2 and 3. Reviews and rating, off whichever block carries them.
  //
  // ‼️ THE SPLIT THAT MATTERS: a knowledge_graph or local_pack that EXISTS but carries no rating is
  // a MEASURED zero, because Google knows this business and has nothing to show for it. Neither
  // block appearing at all is a failure to look, so both components leave the denominator.
  const ratingHolder: SerpItem | null = knowledgeGraph ?? localPack;
  const ratingBlock = ratingHolder ? ratingHolder.rating ?? null : null;
  const votes = num(ratingBlock?.votes_count);
  const ratingValue = num(ratingBlock?.value);

  const reviews = ratingHolder
    ? component(
        COMPONENT_WEIGHTS.reviews,
        true,
        Math.round(
          COMPONENT_WEIGHTS.reviews * Math.min(1, Math.max(0, (votes ?? 0) / REVIEW_CEILING))
        ),
        votes === null ? "profile found, no review count on it" : votes + " reviews"
      )
    : component(COMPONENT_WEIGHTS.reviews, false, 0, "not measured: no profile block on the SERP");

  const rating = ratingHolder
    ? ratingValue === null
      ? component(COMPONENT_WEIGHTS.rating, true, 0, "profile found, no rating on it")
      : component(
          COMPONENT_WEIGHTS.rating,
          true,
          ratingValue >= GOOD_RATING ? COMPONENT_WEIGHTS.rating : 0,
          "rated " + ratingValue
        )
    : component(COMPONENT_WEIGHTS.rating, false, 0, "not measured: no profile block on the SERP");

  // 4. Own domain at #1 for its own name.
  //
  // ‼️ NO WEBSITE MAKES THIS UNMEASURED, NOT FAILED. A company list that never carried a website
  // column has not lost this contest, nobody entered it.
  const website = (input.website ?? "").trim();
  const topOrganic = organic[0];
  const own = !website
    ? component(COMPONENT_WEIGHTS.own_domain, false, 0, "not measured: no website on the row")
    : !sawAnySerp
      ? component(COMPONENT_WEIGHTS.own_domain, false, 0, "not measured: no SERP returned")
      : component(
          COMPONENT_WEIGHTS.own_domain,
          true,
          topOrganic && isOwnDomain(website, hostOf(topOrganic.url ?? topOrganic.domain))
            ? COMPONENT_WEIGHTS.own_domain
            : 0,
          topOrganic
            ? "#1 organic is " + (hostOf(topOrganic.url ?? topOrganic.domain) || "unknown")
            : "no organic results"
        );

  // 5. Directory citations in the top 10, counted once per HOST, so a site with three Yelp pages in
  //    the results is one citation rather than three.
  const directoryHosts = new Set<string>();
  for (const item of organic.slice(0, 10)) {
    const host = hostOf(item.url ?? item.domain);
    if (host && isDirectoryHost(host)) directoryHosts.add(bareHost(host));
  }
  const directories = organic.length
    ? component(
        COMPONENT_WEIGHTS.directories,
        true,
        Math.min(COMPONENT_WEIGHTS.directories, directoryHosts.size * DIRECTORY_POINTS),
        directoryHosts.size + " directory citations in the top 10"
      )
    : component(COMPONENT_WEIGHTS.directories, false, 0, "not measured: no organic results");

  // 6. Instagram in the top 5.
  //
  // ‼️ TWO DIFFERENT ANSWERS THAT MUST NOT COLLAPSE INTO ONE. No Instagram profile in the top 5 is
  // a MEASURED absence and earns zero, because that is a real finding about their presence. A
  // profile that IS there whose follower count will not parse is UNMEASURED and leaves the
  // denominator, because we know they have one and cannot say how big it is. Guessing that number
  // is the failure this whole file is written against.
  const igItem = organic
    .slice(0, 5)
    .find((item) => bareHost(hostOf(item.url ?? item.domain)) === "instagram.com");
  const followers = igItem
    ? parseFollowerCount([igItem.description, igItem.snippet, igItem.title].filter(Boolean).join(" "))
    : null;

  const instagram = !organic.length
    ? component(COMPONENT_WEIGHTS.instagram, false, 0, "not measured: no organic results")
    : !igItem
      ? component(COMPONENT_WEIGHTS.instagram, true, 0, "no Instagram profile in the top 5")
      : followers === null
        ? component(
            COMPONENT_WEIGHTS.instagram,
            false,
            0,
            "not measured: Instagram profile found, follower count would not parse"
          )
        : component(
            COMPONENT_WEIGHTS.instagram,
            true,
            COMPONENT_WEIGHTS.instagram,
            followers + " followers"
          );

  const components: Record<ScoreComponentKey, ScoreComponent> = {
    knowledge_graph: kg,
    reviews,
    rating,
    own_domain: own,
    directories,
    instagram,
  };

  let attempted = 0;
  let earned = 0;
  let ran = 0;
  for (const c of Object.values(components)) {
    if (!c.attempted) continue;
    ran++;
    attempted += c.weight;
    earned += c.earned;
  }

  // Nothing could be measured at all. Null, not zero, and the next tick asks again.
  if (attempted === 0) return { score: null, components, measured: "0 of " + COMPONENT_COUNT };

  return {
    score: Math.round((earned / attempted) * 100),
    components,
    measured: ran + " of " + COMPONENT_COUNT,
  };
}

// ── the cutoff ──────────────────────────────────────────────────────────────────────────────────

/** A row as the cutoff sees it. Minimal, so the grammar can be proved without a batch or a DB. */
export interface ScoredRow {
  id: string;
  company: string | null;
  score: number | null;
}

export type CutoffIntent =
  | { kind: "drop_first"; n: number }
  | { kind: "drop_top_pct"; pct: number }
  | { kind: "keep_bottom_pct"; pct: number }
  | { kind: "drop_above_score"; score: number }
  | { kind: "keep_n"; n: number };

/**
 * The grammar, as it is printed back on a refusal. One string, so the parser and the help text
 * cannot drift apart the way a prose list beside a regex always eventually does.
 */
export const CUTOFF_GRAMMAR = [
  "`drop the first 10`   drop the top 10 rows of the file, the 10 most dominant",
  "`drop 10`             the same thing",
  "`top 20%`             drop the 20 percent most dominant",
  "`bottom 30%`          keep the 30 percent least dominant",
  "`score > 60`          drop everything scoring above 60",
  "`keep 120`            keep the 120 least dominant",
].join("\n");

/**
 * Read a cutoff out of free text.
 *
 * ‼️ PURE, MECHANICAL, AND IT REFUSES RATHER THAN GUESSING. No model decides which leads get
 * deleted. Same reasoning as `looksLikeCallNotes` being a character count rather than a judgement:
 * a prose guard is not a guard. An unrecognised phrase costs one retyped message, which is a much
 * cheaper mistake than a confident misreading of "give me the rest".
 *
 * The file is sorted DESCENDING, so "the first N" and the rows he is looking at are the same thing.
 * That ordering is what makes this grammar safe; see `sortForCutoff`.
 */
export function parseCutoff(input: string): CutoffIntent | null {
  const text = input.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return null;

  let m: RegExpExecArray | null;

  // Percentages first: "drop the top 20%" also matches the bare-number branch below, and the
  // percentage is the more specific reading of it.
  if ((m = /\btop\s+(\d+)\s*%/.exec(text))) return { kind: "drop_top_pct", pct: Number(m[1]) };
  if ((m = /\bbottom\s+(\d+)\s*%/.exec(text))) return { kind: "keep_bottom_pct", pct: Number(m[1]) };

  // "score > 60", "score above 60", "score over 60"
  if ((m = /\bscore\s*(?:>|above|over)\s*(\d+)/.exec(text))) {
    return { kind: "drop_above_score", score: Number(m[1]) };
  }
  // "score < 40" is the same cut said from the other end: keep below 40 is drop above 39.
  if ((m = /\bscore\s*(?:<|under|below)\s*(\d+)/.exec(text))) {
    return { kind: "drop_above_score", score: Number(m[1]) - 1 };
  }

  // "drop the first 10", "drop first 10", "cut the first 10", bare "first 10"
  if ((m = /\b(?:drop|cut|remove|take|kill)?\s*(?:the\s+)?first\s+(\d+)/.exec(text))) {
    return { kind: "drop_first", n: Number(m[1]) };
  }
  // "drop 10", "cut 10". Guarded against a trailing % so "drop 20%" is not read as 20 rows.
  if ((m = /\b(?:drop|cut|remove|kill)\s+(?:the\s+)?(\d+)\b(?!\s*%)/.exec(text))) {
    return { kind: "drop_first", n: Number(m[1]) };
  }

  if ((m = /\bkeep\s+(?:the\s+)?(\d+)\b(?!\s*%)/.exec(text))) {
    return { kind: "keep_n", n: Number(m[1]) };
  }

  return null;
}

export interface CutoffPlan {
  /** The most dominant rows, in file order. */
  dropped: ScoredRow[];
  /** Everything else, in file order, including every unmeasured row. */
  kept: ScoredRow[];
  /** How many kept rows carry no score. Printed on the echo card, never hidden. */
  keptUnmeasured: number;
  /** The score range of the dropped pile, for the echo. Null when nothing measured was dropped. */
  droppedHigh: number | null;
  droppedLow: number | null;
}

/**
 * Turn an intent into an exact split of an already-sorted list.
 *
 * ‼️ `rows` MUST ALREADY BE IN scored.csv ORDER (`sortForCutoff`). This takes the order as given
 * rather than re-sorting, so the pile it describes is byte for byte the pile he read.
 *
 * ‼️ A PERCENTAGE IS A PERCENTAGE OF THE MEASURED ROWS. Counting the unmeasured into a "top 20%"
 * would make the cut depend on how many lookups happened to fail, which is not a fact about any
 * business on the list.
 *
 * ‼️ THE UNMEASURED ALWAYS LAND IN THE KEPT PILE. Scraping a company unnecessarily costs one Apollo
 * credit; discarding one loses a lead. The count is stated on the echo card rather than buried.
 */
export function applyCutoff(rows: ScoredRow[], intent: CutoffIntent): CutoffPlan {
  const measured = rows.filter((r) => r.score !== null);

  let dropCount: number;
  switch (intent.kind) {
    case "drop_first":
      dropCount = intent.n;
      break;
    case "drop_top_pct":
      dropCount = Math.round((measured.length * intent.pct) / 100);
      break;
    case "keep_bottom_pct":
      dropCount = measured.length - Math.round((measured.length * intent.pct) / 100);
      break;
    case "keep_n":
      dropCount = rows.length - intent.n;
      break;
    case "drop_above_score":
      dropCount = measured.filter((r) => (r.score as number) > intent.score).length;
      break;
  }

  // Only ever cut into the measured head of the file. Clamping here is what stops "drop 5000" on a
  // 240-row list from taking the unmeasured tail with it.
  dropCount = Math.max(0, Math.min(dropCount, measured.length));

  const dropped = rows.slice(0, dropCount);
  const kept = rows.slice(dropCount);
  const droppedScores = dropped.map((r) => r.score).filter((s): s is number => s !== null);

  return {
    dropped,
    kept,
    keptUnmeasured: kept.filter((r) => r.score === null).length,
    droppedHigh: droppedScores.length ? Math.max(...droppedScores) : null,
    droppedLow: droppedScores.length ? Math.min(...droppedScores) : null,
  };
}

/**
 * Sort into scored.csv order: most dominant first, unmeasured last.
 *
 * ‼️ DESCENDING IS LOAD-BEARING AND IS NOT A PRESENTATION CHOICE. Ascending, "drop the first 10"
 * and the file disagree about what "first" means, and getting that backwards deletes exactly the
 * invisible businesses this lane exists to find. Descending, the instruction and the row order are
 * the same thing, so the parser and the thing he is looking at cannot disagree. Do not flip this
 * for readability.
 */
export function sortForCutoff<T>(rows: T[], scoreOf: (row: T) => number | null): T[] {
  return [...rows].sort((a, b) => {
    const x = scoreOf(a);
    const y = scoreOf(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return y - x;
  });
}
