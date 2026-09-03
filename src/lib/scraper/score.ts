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

/**
 * Fixed order. `presenceScore` reads it to walk a stored `score_components` blob, the same job
 * `OPTIMIZATION_KEY_ORDER` does on the other side, so the two halves of the presence denominator
 * are enumerated from one list each rather than from `Object.keys` of whatever was stored.
 */
export const SCORE_KEY_ORDER: ScoreComponentKey[] = [
  "knowledge_graph",
  "reviews",
  "rating",
  "own_domain",
  "directories",
  "instagram",
];

export const COMPONENT_COUNT = SCORE_KEY_ORDER.length;

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
  /** `google_reviews` carries the count here rather than inside `rating`. */
  reviews_count?: number | string | null;
  /**
   * The three fields `gbp-audit.ts` reads off a knowledge_graph. Nothing in THIS file reads them:
   * the dominance score is deliberately unchanged, and these ride along so the optimization audit
   * costs no extra call. `subtitle` is "Medical spa in Matthews, North Carolina"; `cid` is the
   * exact-profile key for my_business_info.
   */
  subtitle?: string | null;
  cid?: string | null;
  place_id?: string | null;
  items?: SerpItem[] | null;
}

/**
 * Where a Google rating can live, best first.
 *
 * ‼️ `google_reviews` IS ON THIS LIST BECAUSE LEAVING IT OFF SCORED A NATIONAL CHAIN AT 23/100.
 * Measured on the first live SERP: "Ideal Image Charlotte" came back with a `knowledge_graph` that
 * carried no rating and a separate `google_reviews` item that carried all of it. Reading only the
 * knowledge_graph found a profile with no numbers on it, which this file correctly treats as a
 * MEASURED ZERO, so 35 points of review and rating weight were scored as real zeros instead of
 * being read. The business then looked invisible and would have gone straight into the scrape pile.
 *
 * That is the denominator rule failing from the inside: the tri-state was right, the data was
 * there, and the lookup was too narrow. Widening WHERE we look is the fix; loosening what counts as
 * measured would have been the bug.
 */
const RATING_TYPES = ["knowledge_graph", "google_reviews", "local_pack", "local_pack_element"];

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
export function flattenSerpItems(items: SerpItem[] | null | undefined): SerpItem[] {
  const out: SerpItem[] = [];
  for (const item of items ?? []) {
    out.push(item);
    if (item.items) out.push(...flattenSerpItems(item.items));
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
  const all = flattenSerpItems(items);

  const organic = all
    .filter((item) => item.type === "organic")
    .sort((a, b) => (a.rank_group ?? 999) - (b.rank_group ?? 999));
  const knowledgeGraph = all.find((item) => item.type === "knowledge_graph") ?? null;

  // The block carrying the numbers, preferring one that actually HAS numbers. A profile block with
  // nothing on it is still a real answer (Google knows them and shows nothing), so it is kept as
  // the fallback rather than discarded: that is a measured zero, not a failure to look.
  const ratingHolder =
    RATING_TYPES.map((t) =>
      all.find(
        (item) =>
          item.type === t &&
          (num(item.rating?.value) !== null ||
            num(item.rating?.votes_count) !== null ||
            num(item.reviews_count) !== null)
      )
    ).find(Boolean) ??
    all.find((item) => RATING_TYPES.includes(item.type ?? "")) ??
    null;

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
  const ratingBlock = ratingHolder ? ratingHolder.rating ?? null : null;
  // `knowledge_graph` puts the count inside `rating`; `google_reviews` puts it alongside. Both are
  // the same fact and neither spelling may be the only one read.
  const votes = num(ratingBlock?.votes_count) ?? num(ratingHolder?.reviews_count);
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
  /**
   * The dominance score. Still a real axis (`score > 60` cuts on it) and still a visible column, it
   * is simply no longer what the file is SORTED by. See `presence`.
   */
  score: number | null;
  /**
   * The GBP optimization score, read only by the `optimization > 70` cuts. A visible column, never
   * the sort key.
   *
   * ‼️ OPTIONAL, AND undefined READS THE SAME AS null: unmeasured, and an unmeasured row is never
   * dropped. Same rule every axis here applies, and it means a caller that only ever cuts on one
   * axis does not have to carry the fields it does not use.
   */
  optimization?: number | null;
  /**
   * ONE number over both scores, and THE SORT KEY as of 2026-08-28.
   *
   * ‼️ IT IS NOT AN AVERAGE OF THE OTHER TWO, and that distinction is the only reason it is
   * allowed to exist. It is a single `earned / attempted` over all TWELVE components, so a row
   * measured on six of them is scored out of six and no value has to be invented for the half that
   * could not be looked at. Averaging two scores would force exactly that invention.
   * `presenceScore` in `gbp-audit.ts` computes it from the two stored component blobs, so the
   * number can never contradict its own parts. Same optional/undefined rule as `optimization`.
   */
  presence?: number | null;
}

export type CutoffIntent =
  // The prefix forms. They cut the TOP OF THE FILE, and the top of the file is presence.
  | { kind: "drop_first"; n: number }
  | { kind: "drop_top_pct"; pct: number }
  | { kind: "keep_bottom_pct"; pct: number }
  | { kind: "keep_n"; n: number }
  // The predicate forms. Each NAMES its own column and cuts on that column alone.
  | { kind: "drop_presence_above"; score: number }
  | { kind: "drop_above_score"; score: number }
  | { kind: "drop_optimization_above"; score: number }
  | { kind: "drop_optimization_below"; score: number };

/**
 * The grammar, as it is printed back on a refusal. One string, so the parser and the help text
 * cannot drift apart the way a prose list beside a regex always eventually does.
 */
export const CUTOFF_GRAMMAR = [
  "the file is sorted by PRESENCE, most first, so these four cut off the top of it:",
  "`drop the first 10`   drop the top 10 rows, the 10 with the most presence",
  "`drop 10`             the same thing",
  "`top 20%`             drop the 20 percent with the most presence",
  "`bottom 30%`          keep the 30 percent with the least presence",
  "`keep 120`            keep the 120 with the least presence",
  "",
  "and these name their own column, wherever those rows sit in the file:",
  "`presence > 70`       drop everything ABOVE 70 on presence",
  "`presence < 40`       KEEP everything below 40 on presence",
  "`score > 60`          drop everything ABOVE 60 on dominance",
  "`score < 40`          KEEP everything below 40 on dominance",
  "`optimization > 70`   drop everything ABOVE 70 on optimization",
  "`optimization < 40`   drop everything BELOW 40 on optimization",
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

  // The PRESENCE axis, which is the one the file is sorted by. Its two forms read the same way the
  // dominance forms always have: `>` drops above, `<` keeps below. That pairing is deliberate -
  // presence took over dominance's job as the survive/delete axis, so it inherits its grammar too.
  if ((m = /\b(?:presence|visibility)\s*(?:>|above|over)\s*(\d+)/.exec(text))) {
    return { kind: "drop_presence_above", score: Number(m[1]) };
  }
  if ((m = /\b(?:presence|visibility)\s*(?:<|under|below)\s*(\d+)/.exec(text))) {
    return { kind: "drop_presence_above", score: Number(m[1]) - 1 };
  }

  // ‼️ THE OPTIMIZATION AXIS IS READ FIRST, AND BOTH OF ITS FORMS ARE "DROP", WHICH IS THE OPPOSITE
  // OF HOW THE DOMINANCE AXIS READS ITS `<` FORM. `score < 40` means KEEP below 40 (it is the same
  // cut said from the other end, see just below). `optimization < 40` means DROP below 40. That is
  // deliberate and it is Matthew's grammar: on dominance he is choosing who survives, and on
  // optimization he is skimming off a band there is nothing to sell to, from either end. It is also
  // exactly why the echo card has to NAME THE AXIS AND THE DIRECTION in words. Do not harmonize
  // them and do not "correct" one to match the other: a reader who guesses wrong here deletes the
  // wrong half of a list.
  if ((m = /\boptimi[sz]ation\s*(?:>|above|over)\s*(\d+)/.exec(text))) {
    return { kind: "drop_optimization_above", score: Number(m[1]) };
  }
  if ((m = /\boptimi[sz]ation\s*(?:<|under|below)\s*(\d+)/.exec(text))) {
    return { kind: "drop_optimization_below", score: Number(m[1]) };
  }

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
  /**
   * Which number this cut was made on.
   *
   * ‼️ THE ECHO CARD MUST PRINT IT, ON EVERY FORM INCLUDING THE PREFIX ONES. THREE numbers now sit
   * in one file. "Dropping 34 rows" is the same sentence for all three and means three different
   * things, so the axis is carried on the PLAN rather than re-derived from the spoken text, which a
   * reword would break.
   */
  axis: "presence" | "dominance" | "optimization";
  /**
   * Whether the dropped pile is the HEAD of the file or rows scattered through it.
   *
   * ‼️ CARRIED, NOT RE-DERIVED. The echo card says "rows 1 to N" for one shape and "scattered
   * through the file" for the other, and those two sentences are a lie about each other. Working it
   * out again in the formatter, from the spoken text or by comparing the piles, is a second place
   * for the answer to live and therefore a place for it to disagree.
   */
  shape: "prefix" | "predicate";
  /** The dropped rows, in file order. */
  dropped: ScoredRow[];
  /** Everything else, in file order, including every unmeasured row. */
  kept: ScoredRow[];
  /**
   * How many kept rows carry no score ON THE CUT AXIS. Printed on the echo card, never hidden.
   * Counted on the axis the cut was made on, or "not measured" would name a different column from
   * the one that just deleted rows.
   */
  keptUnmeasured: number;
  /** The score range of the dropped pile, for the echo. Null when nothing measured was dropped. */
  droppedHigh: number | null;
  droppedLow: number | null;
}

/** Which column each intent reads. One list, so the plan and the echo cannot disagree. */
function axisOf(intent: CutoffIntent): CutoffPlan["axis"] {
  switch (intent.kind) {
    case "drop_above_score":
      return "dominance";
    case "drop_optimization_above":
    case "drop_optimization_below":
      return "optimization";
    default:
      return "presence";
  }
}

/**
 * The value an intent cuts on, for one row.
 *
 * ‼️ ON `presence`, AND ONLY ON `presence`, `undefined` AND `null` MEAN DIFFERENT THINGS. `null` is
 * "presence was computed and not one of the twelve components could be measured", which is
 * unmeasured and is never dropped. `undefined` is "this caller does not carry presence at all",
 * which is a caller written before the axis existed, and for it the top of the file is still
 * dominance - so it falls back to `score` rather than reading every row as unmeasured and cutting
 * nothing. `optimization` keeps the simpler rule, where both read as unmeasured, because no caller
 * ever sorted by it.
 *
 * The lane always passes `presence` explicitly, as `number | null`, so it never takes the fallback.
 */
function valueOn(row: ScoredRow, axis: CutoffPlan["axis"]): number | null {
  if (axis === "dominance") return row.score;
  if (axis === "optimization") return row.optimization ?? null;
  return row.presence === undefined ? row.score : row.presence;
}

/**
 * Turn an intent into an exact split of an already-sorted list.
 *
 * ‼️ `rows` MUST ALREADY BE IN scored.csv ORDER (`sortByPresence`). This takes the order as given
 * rather than re-sorting, so the pile it describes is byte for byte the pile he read.
 *
 * ‼️ A PERCENTAGE IS A PERCENTAGE OF THE MEASURED ROWS. Counting the unmeasured into a "top 20%"
 * would make the cut depend on how many lookups happened to fail, which is not a fact about any
 * business on the list.
 *
 * ‼️ THE UNMEASURED ALWAYS LAND IN THE KEPT PILE, ON EVERY AXIS. Scraping a company unnecessarily
 * costs one Apollo credit; discarding one loses a lead. The count is stated on the echo card rather
 * than buried.
 */
export function applyCutoff(rows: ScoredRow[], intent: CutoffIntent): CutoffPlan {
  const axis = axisOf(intent);

  // ‼️ EVERY `>` / `<` FORM IS A PREDICATE, NOT A PREFIX, AND `score > 60` HAD TO JOIN THEM WHEN
  // PRESENCE BECAME THE SORT KEY. It used to count the matching rows and slice that many off the
  // front, which was correct only because the file was sorted by the very column it named. The file
  // is now sorted by PRESENCE, so the rows scoring above 60 on dominance are scattered through it
  // and a slice would have silently deleted a contiguous block of the wrong businesses - the same
  // failure shape the optimization axis was written against, arriving through a form that used to
  // be safe. Both piles keep file order, so the survivor list still reads in the order he saw.
  if (
    intent.kind === "drop_presence_above" ||
    intent.kind === "drop_above_score" ||
    intent.kind === "drop_optimization_above" ||
    intent.kind === "drop_optimization_below"
  ) {
    const below = intent.kind === "drop_optimization_below";
    const hits = (r: ScoredRow): boolean => {
      const value = valueOn(r, axis);
      // Unmeasured is never dropped, on any axis. Nobody entered that contest.
      if (value === null) return false;
      return below ? value < intent.score : value > intent.score;
    };
    const dropped = rows.filter(hits);
    const kept = rows.filter((r) => !hits(r));
    const droppedScores = dropped
      .map((r) => valueOn(r, axis))
      .filter((s): s is number => s !== null);
    return {
      axis,
      shape: "predicate",
      dropped,
      kept,
      keptUnmeasured: kept.filter((r) => valueOn(r, axis) === null).length,
      droppedHigh: droppedScores.length ? Math.max(...droppedScores) : null,
      droppedLow: droppedScores.length ? Math.min(...droppedScores) : null,
    };
  }

  // The prefix forms, which cut the top of the file. That is the presence axis, because that is
  // what the file is sorted by; see `sortByPresence`.
  const measured = rows.filter((r) => valueOn(r, axis) !== null);

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
  }

  // Only ever cut into the measured head of the file. Clamping here is what stops "drop 5000" on a
  // 240-row list from taking the unmeasured tail with it.
  dropCount = Math.max(0, Math.min(dropCount, measured.length));

  const dropped = rows.slice(0, dropCount);
  const kept = rows.slice(dropCount);
  const droppedScores = dropped
    .map((r) => valueOn(r, axis))
    .filter((s): s is number => s !== null);

  return {
    axis,
    shape: "prefix",
    dropped,
    kept,
    keptUnmeasured: kept.filter((r) => valueOn(r, axis) === null).length,
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
