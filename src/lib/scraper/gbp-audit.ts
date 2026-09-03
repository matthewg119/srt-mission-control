// Have they done the Google Business Profile work.
//
// The SECOND score in workflow B of the scraper lane, and it answers a different question from
// `score.ts`. `dominance_score` measures the OUTCOME: is this business visible right now.
// `optimization_score` measures the INPUT: did anybody fill the profile in. They come apart
// constantly, which is the whole reason for two numbers: a new clinic with a perfect profile is
// optimized and invisible, and a fifteen-year-old spa with 2,000 reviews and an empty profile is
// the reverse. One blended number answers neither question.
//
// ‼️ THIS FILE IS PURE AND MAKES NO NETWORK CALLS AND MUST NOT START. Same split as score.ts,
// rules.ts and filter.ts: dataforseo.ts owns the fetching, lane.ts owns the crawling, this owns the
// arithmetic, and that is what lets `_probe-gbp-audit.ts` prove the weights with no API key and no
// spend.
//
// ‼️ THIS SCORE IS NEVER THE SORT KEY. `sortForCutoff` and the rank column read `dominance_score`
// and nothing else. The file is sorted to decide who gets DELETED, and that question is "are they
// already winning", which is dominance alone. This one is a COLUMN beside it.

import type { SerpPayload } from "./score";
import { flattenSerpItems, SCORE_KEY_ORDER, sortForCutoff } from "./score";

// ── the components ──────────────────────────────────────────────────────────────────────────────

/** One weighted signal. `attempted` is whether we could LOOK, not whether we FOUND anything. */
export interface OptimizationComponent {
  weight: number;
  attempted: boolean;
  earned: number;
  note: string;
}

export type OptimizationKey =
  | "primary_category"
  | "additional_categories"
  | "description_keywords"
  | "photos"
  | "services"
  | "landing_page";

export interface OptimizationResult {
  /** 0-100, or null when NOTHING could be measured. Null is retried, never stored as 0. */
  score: number | null;
  components: Record<OptimizationKey, OptimizationComponent>;
  /** e.g. "4 of 6". Printed in the CSV so a number can be read with its own confidence. */
  measured: string;
}

export const OPTIMIZATION_WEIGHTS: Record<OptimizationKey, number> = {
  primary_category: 15,
  additional_categories: 20,
  description_keywords: 15,
  photos: 15,
  services: 15,
  landing_page: 20,
};

/** Fixed order. The CSV columns, the summary and the gap tie-break all read it, so they cannot drift. */
export const OPTIMIZATION_KEY_ORDER: OptimizationKey[] = [
  "primary_category",
  "additional_categories",
  "description_keywords",
  "photos",
  "services",
  "landing_page",
];

export const OPTIMIZATION_COMPONENT_COUNT = OPTIMIZATION_KEY_ORDER.length;

/** Plain English gaps, for the summary. "additional_categories" means nothing to anyone reading it cold. */
export const OPTIMIZATION_LABEL: Record<OptimizationKey, string> = {
  primary_category: "no primary category set",
  additional_categories: "too few additional categories",
  description_keywords: "description is thin on the category and the city",
  photos: "too few photos",
  services: "too few services described with their keywords",
  landing_page: "landing page title and h1 are thin on the category and city",
};

// -- the ceilings, where a component stops paying ------------------------------------------------
//
// ‼️ THESE ARE CEILINGS, NOT THRESHOLDS, AND THE DIFFERENCE IS THE WHOLE POINT OF THIS REWRITE.
// Every one of them used to be a pass mark: 4 additional categories earned the full 20 and 3 earned
// zero, 5 photos earned the full 15 and 4 earned zero. Matthew's rule is "the more they have, the
// higher they score", so a component now pays `min(1, have / ceiling)` of its weight and a business
// with 9 photos is no longer indistinguishable from one with none.
//
// The numbers he named are the TARGETS and they sit inside these ceilings: 4-5 secondary categories,
// 5-10 photos, 3 described services. Full marks land at the top of each range, so hitting the target
// is most of the points and beating it is the rest.
const FULL_ADDITIONAL_CATEGORIES = 5;
const FULL_PHOTOS = 10;
const FULL_SERVICE_POINTS = 5;

/**
 * A described service with the category in its text is worth a full point; one with a description
 * that never names what it is is worth half.
 *
 * "3 service descriptions with proper keywords, the more descriptions with more keywords the higher
 * score" is two axes in one sentence, and this is how they combine without needing two components.
 */
const SERVICE_KEYWORD_POINT = 1;
const SERVICE_BARE_POINT = 0.5;

/**
 * How far below full a component has to fall before the batch summary calls it a GAP.
 *
 * ‼️ A GRADUATED SCORE NEEDS THIS AND A PASS/FAIL ONE DID NOT. `countGaps` used to ask
 * `earned < weight`, which was exactly "did they fail the threshold". Asked of a graduated
 * component the same question means "is this anything short of perfect", so 9-photos-out-of-10
 * would be reported down the phone as a photo gap. The line this feeds writes the campaign, so it
 * has to mean a real hole.
 */
const GAP_FRACTION = 0.6;

/**
 * Three things a task_get cannot see, printed in the thread so their absence is never mistaken for
 * a low score. They have NO WEIGHT and NO DENOMINATOR and they are not components.
 *
 * ‼️ DO NOT INVENT A PROXY FOR ANY OF THEM. Google strips EXIF on upload, so photo geotagging is
 * visible only to whoever owns the profile; "quality" is a judgement and not an observation; and a
 * plan to post four times next month is a PLAN, not a state. They belong on the delivery checklist
 * as work SRT does for the client, which is why the card says so out loud.
 */
export const UNVERIFIABLE: string[] = [
  "location data in the photos. Google strips EXIF on upload, so only the profile owner can see it",
  "photo quality. A count is not a judgement",
  "whether anyone plans to keep posting. That is a plan, not a state",
];

// ── the profile payload, only the parts this file reads ─────────────────────────────────────────
//
// Typed loosely on purpose, the same reason `SerpItem` is: DataForSEO returns a wide business_data
// object and adds fields over time, and a strict interface over their whole response would fail to
// compile on a shape change this file does not care about.

export interface GbpProfile {
  [key: string]: unknown;
}

/** What the SERP already gave us, extracted during the scoring sweep. Free, no extra call. */
export interface GbpSerpFacts {
  /** The exact-profile key for the my_business_info lookup. */
  cid: string | null;
  /** The fallback key when there is no cid. */
  placeId: string | null;
  category: string | null;
  city: string | null;
  description: string | null;
  /** The landing page, and the ONLY url this lane is allowed to crawl. */
  url: string | null;
  /**
   * WHICH block the cid was read off.
   *
   * ‼️ RECORDED RATHER THAN DISCARDED, because the two are not equally strong. A knowledge_graph is
   * Google asserting that this query is about this ONE entity. A local_pack is a ranked list of
   * candidates, so rank 1 is Google's best answer rather than its only answer. Storing which one
   * answered is what makes a bad match traceable afterwards instead of a mystery.
   */
  cidSource: "knowledge_graph" | "local_pack" | null;
}

/**
 * What the crawler found.
 *
 * ‼️ `null` AND `{ crawled: false }` ARE DIFFERENT ANSWERS and both leave the denominator. Null is
 * "we never looked" (no url came off the profile). False is "we looked and the site refused". They
 * print different notes so the CSV says which, the same split `MxVerdict` draws and the same one
 * `CRAWL_BLOCK_LINE` draws in the audit engine.
 */
export interface LandingPageFacts {
  crawled: boolean;
  title: string | null;
  h1: string | null;
}

export interface OptimizationInput {
  serp: GbpSerpFacts | null;
  /** Null means the profile task did not come back. It never means "the profile was empty". */
  profile: GbpProfile | null;
  page: LandingPageFacts | null;
  /** The city column of the source CSV. Used only when neither the profile nor the SERP carried one. */
  fallbackCity?: string | null;
}

// ── small pure helpers ──────────────────────────────────────────────────────────────────────────

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > 0 ? t : null;
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
 * Read the first key that yields something, in the order given.
 *
 * ‼️ THIS IS THE `RATING_TYPES` PRECEDENT AND IT IS THE ONLY DEFENCE AGAINST A GUESSED FIELD NAME.
 * The live proof is already in CLAUDE.md: reading only `knowledge_graph` for a rating scored a
 * national chain at 23/100 because the numbers were in a `google_reviews` block one key over.
 * Widening WHERE we look is the fix; loosening what counts as measured is the bug.
 */
export function pick<T>(obj: unknown, keys: string[], read: (v: unknown) => T | null): T | null {
  if (!obj || typeof obj !== "object") return null;
  const record = obj as Record<string, unknown>;
  for (const key of keys) {
    const value = read(record[key]);
    if (value !== null) return value;
  }
  return null;
}

// ── the mechanical keyword rule ─────────────────────────────────────────────────────────────────
//
// ‼️ "KEYWORD RICH" IS MECHANICAL OR IT IS NOT A CHECK. No model call, no judgement. A prose guard
// is not a guard, the same rule `looksLikeCallNotes` and the cutoff grammar are held to. If this
// proves too crude the fix is a BETTER MECHANICAL RULE, never an LLM scoring the copy: a model
// grading marketing prose returns a different answer on the same description twice in a row, and
// this number goes on a card somebody reads down the phone.

/** Words that carry no category or place meaning, so their presence proves nothing. */
export const STOPWORDS = new Set([
  "the", "and", "for", "our", "your", "you", "with", "from", "near", "best", "top", "new", "all",
  "more", "home", "page", "official", "website", "site", "welcome", "inc", "llc", "corp",
  "company", "that", "this", "are", "was", "has", "have", "been", "will", "can", "get", "out",
]);

/**
 * Category words so generic that matching on them alone proves nothing about the copy.
 *
 * Only consulted when a category has at least one NON-generic word beside them: "Service Center" is
 * entirely generic and still has to be matchable on something, or its component would be
 * permanently unmeasurable for every business Google files under it.
 */
export const GENERIC_CATEGORY_TOKENS = new Set([
  "service", "center", "centre", "shop", "store", "business", "company", "group", "studio",
]);

/**
 * Tokenize for comparison.
 *
 * Every non-alphanumeric becomes a space, so "med-spa" is two tokens and "Dr. Kim's" is "dr kim".
 * The trailing-s strip is applied to BOTH sides, so it is symmetric: "spas" equals "spa" and
 * "wellness" is untouched because it ends in a double s.
 */
export function tokenize(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .map(singularize);
}

function singularize(token: string): string {
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Every content token of the primary category string. Nothing more, nothing inferred. */
export function categoryTokens(category: string | null | undefined): string[] {
  return tokenize(category);
}

/**
 * The city tokens.
 *
 * Trimmed at the first comma, so "Charlotte, NC" is "Charlotte" and a state abbreviation is never
 * required: the abbreviation almost never appears in a page title, and demanding it would fail
 * every business in the batch on a technicality.
 */
export function cityTokens(city: string | null | undefined): string[] {
  const head = (city ?? "").split(",")[0];
  return tokenize(head);
}

/**
 * Does this text carry the category.
 *
 * AT LEAST ONE non-generic token, not all of them. Requiring all fails "Medical Spa" against a
 * description that says "med spa", which is the same business described the way its customers say
 * it.
 *
 * ‼️ THIS IS THE LOOSE DIRECTION, DELIBERATELY, AND IT IS THE INVERSE OF score.ts. That file decides
 * who gets DELETED from a list, so it must never flatter. This one decides what gets SAID on a
 * call: a false negative costs a real gap being missed and a false positive costs one beat somebody
 * skips. Do not "fix" this to match score.ts.
 */
export function containsCategory(text: string | null | undefined, category: string[]): boolean {
  if (category.length === 0) return false;
  const words = new Set(tokenize(text));
  if (words.size === 0) return false;
  const specific = category.filter((t) => !GENERIC_CATEGORY_TOKENS.has(t));
  const needles = specific.length > 0 ? specific : category;
  return needles.some((t) => words.has(t));
}

/**
 * HOW MUCH of the category this text carries, rather than whether it carries any.
 *
 * ‼️ THE BOOLEAN `containsCategory` STAYS AND IS STILL THE LOOSE DIRECTION. This is the graduated
 * reading of the same question, for the components Matthew asked to grade by richness: "the more
 * keywords the higher score". One token still earns something, all of them earn everything, and the
 * two functions agree at the edges — `hit > 0` is exactly `containsCategory`, which is what stops
 * them drifting into two different opinions about the same copy.
 *
 * Generic tokens are excluded the same way and for the same reason, with the same fallback when a
 * category is generic all the way through ("Service Center"), or such a business would be scored
 * against a needle list of length zero.
 */
export function categoryCoverage(
  text: string | null | undefined,
  category: string[]
): { hit: number; total: number } {
  if (category.length === 0) return { hit: 0, total: 0 };
  const specific = category.filter((t) => !GENERIC_CATEGORY_TOKENS.has(t));
  const needles = specific.length > 0 ? specific : category;
  const words = new Set(tokenize(text));
  if (words.size === 0) return { hit: 0, total: needles.length };
  return { hit: needles.filter((t) => words.has(t)).length, total: needles.length };
}

/** `min(1, have / ceiling)` of a weight, rounded. The one curve every graduated component uses. */
function graded(weight: number, have: number, ceiling: number): number {
  if (ceiling <= 0) return 0;
  return Math.round(weight * Math.min(1, Math.max(0, have) / ceiling));
}

/**
 * Does this text carry the city.
 *
 * EVERY token, unlike the category: "Winston Salem" needs both halves, or a page mentioning Salem
 * in Oregon would pass for a business in North Carolina.
 */
export function containsCity(text: string | null | undefined, city: string[]): boolean {
  if (city.length === 0) return false;
  const words = new Set(tokenize(text));
  if (words.size === 0) return false;
  return city.every((t) => words.has(t));
}

// ── reading the SERP we already paid for ────────────────────────────────────────────────────────

/**
 * The Google-written description on a knowledge_graph is prefixed "From {business name}: ".
 *
 * ‼️ THE PREFIX IS STRIPPED BEFORE ANY KEYWORD CHECK, and this is not tidiness. A business named
 * "Charlotte Med Spa" would otherwise satisfy BOTH the category test and the city test out of its
 * own name in a prefix GOOGLE wrote, and every such business would score a false 15 on a component
 * measuring whether the OWNER wrote a keyword-bearing description.
 */
export function stripDescriptionPrefix(description: string | null): string | null {
  if (!description) return null;
  return str(description.replace(/^\s*From\s+[^:]{1,80}:\s*/i, ""));
}

/**
 * Split a knowledge_graph subtitle into a category and a city.
 *
 * Live shape, measured on "Skin Bar MedSpa Charlotte": "Medical spa in Matthews, North Carolina".
 * The category is what comes before " in " and the city is the first comma-delimited part of what
 * comes after. A subtitle with no " in " yields a category and no city rather than guessing which
 * half is which.
 *
 * ‼️ THE SPLIT IS ON THE LAST " in ", NOT THE FIRST. Google files real businesses under categories
 * that contain the word: "Walk in clinic in Charlotte, NC" read non-greedily gives the category
 * "Walk" and the city "clinic in Charlotte", and both halves are then wrong for every component
 * that reads them.
 */
export function splitSubtitle(subtitle: string | null): {
  category: string | null;
  city: string | null;
} {
  const text = str(subtitle);
  if (!text) return { category: null, city: null };
  const m = /^(.*)\s+in\s+(.+)$/i.exec(text);
  if (!m) return { category: text, city: null };
  return { category: str(m[1]), city: str(m[2].split(",")[0]) };
}

/**
 * Everything the my_business_info call would have told us that the SERP already did, for free.
 *
 * Called during the SCORING sweep, on the payload that sweep already holds. No extra call and no
 * extra cost, which is the whole reason three of the six components are free.
 */
export function extractGbpSerpFacts(
  payload: SerpPayload,
  about: { company?: string | null; city?: string | null } = {}
): GbpSerpFacts {
  const all = flattenSerpItems(payload.items);
  const kg = all.find((item) => item.type === "knowledge_graph") ?? null;
  const reviews = all.find((item) => item.type === "google_reviews") ?? null;

  // ── the strong path: a knowledge_graph ────────────────────────────────────────────────────────
  // Google asserting that this query is about this one entity, and it carries everything: the cid,
  // the category and city in `subtitle`, the owner-written description, and the landing page.
  if (str(kg?.cid)) {
    const { category, city } = splitSubtitle(str(kg?.subtitle));
    return {
      cid: str(kg?.cid),
      placeId: str(reviews?.place_id) ?? str(kg?.place_id),
      category,
      city,
      description: stripDescriptionPrefix(str(kg?.description)),
      url: str(kg?.url),
      cidSource: "knowledge_graph",
    };
  }

  // ── the fallback: the top local_pack entry ────────────────────────────────────────────────────
  //
  // ‼️ MEASURED ON THE FIRST LIVE CALL: A BRAND-NAME QUERY OFTEN RETURNS NO knowledge_graph AT ALL.
  // "Skin Bar MedSpa Charlotte, NC" came back with three `local_pack` items and no knowledge_graph,
  // so reading only the knowledge_graph left the whole optimization audit unmeasured for a business
  // whose cid was sitting right there. That is the `google_reviews` failure exactly, one block type
  // over: the tri-state was right, the data was there, and the lookup was too narrow.
  //
  // ‼️ AND THE SAME RESPONSE CARRIES THE TRAP THIS FEATURE IS WRITTEN AGAINST. Rank 1 was "The Skin
  // Bar QC" in Matthews NC, the right business. Rank 2 was "Skin Bar MedSpa" in Westminster
  // COLORADO, a different company whose title is a BETTER string match for the name queried. So
  // picking the local_pack whose title looks most like the company name picks the wrong state,
  // silently, on the exact query that motivated this feature.
  //
  // The rule is therefore: take GOOGLE'S OWN RANK 1, never the best title match. Google resolved a
  // query that carried the city; we would be re-resolving it on the name alone and doing it worse.
  const packs = all
    .filter((item) => item.type === "local_pack" && str(item.cid))
    .sort((a, b) => (a.rank_group ?? 999) - (b.rank_group ?? 999));
  const top = packs[0] ?? null;

  // One mechanical guard, and it is deliberately weak: it only rejects a local pack that has nothing
  // to do with the business asked for. City tokens are removed from the company name first, or
  // "Charlotte Med Spa" would match "Charlotte Dermatology" on the city alone.
  if (top && shareANameToken(about.company, top.title, about.city)) {
    return {
      cid: str(top.cid),
      placeId: str(reviews?.place_id),
      // ‼️ A local_pack CARRIES NO CATEGORY AND NO OWNER DESCRIPTION, and its `description` field is
      // NOT one. The live value was "5+ years in business - Matthews, NC \nClosed - Opens 9 AM Tue",
      // which is Google's operational blurb. Scoring it as the GBP description would be a proxy for
      // something Google did not expose here: it never contains a category, so every business found
      // this way would report "names the city, not the category" as a finding about their copy.
      // Both stay null and the PROFILE call, which is authoritative anyway, supplies them.
      category: null,
      city: null,
      description: null,
      url: str(top.url),
      cidSource: "local_pack",
    };
  }

  return {
    cid: null,
    placeId: str(reviews?.place_id),
    category: null,
    city: null,
    description: null,
    url: null,
    cidSource: null,
  };
}

/**
 * Do a company name and a result title have any real word in common.
 *
 * City tokens are stripped from the company name before comparing, because a business named after
 * its city would otherwise match every other business in that city on the place name alone.
 */
export function shareANameToken(
  company: string | null | undefined,
  title: string | null | undefined,
  city: string | null | undefined
): boolean {
  const cityWords = new Set(cityTokens(city));
  const name = tokenize(company).filter((t) => !cityWords.has(t));
  if (name.length === 0) return false;
  const words = new Set(tokenize(title));
  return name.some((t) => words.has(t));
}

/**
 * The keyword for an exact profile lookup.
 *
 * ‼️ BY cid, NEVER BY COMPANY NAME. A name search silently returns a DIFFERENT business with a
 * similar name in a nearby city and then scores somebody else's profile against this lead. That is
 * the one failure in this feature that is invisible and wrong at the same time: nothing errors,
 * every column fills in, and the card is about the wrong company. A row with neither key gets NO
 * TASK AT ALL and its profile components stay unmeasured. Never guess.
 */
export function buildProfileKeyword(facts: GbpSerpFacts | null): string | null {
  if (!facts) return null;
  if (facts.cid) return "cid:" + facts.cid;
  if (facts.placeId) return "place_id:" + facts.placeId;
  return null;
}

// ── reading the profile, defensively ────────────────────────────────────────────────────────────

export function readPrimaryCategory(profile: GbpProfile | null): string | null {
  const direct = pick(profile, ["category", "primary_category", "category_name"], str);
  if (direct) return direct;
  // Some shapes carry an array instead, of strings or of {name}/{title} objects.
  return readCategoryList(profile, ["categories", "category_list"])[0] ?? null;
}

export function readAdditionalCategories(profile: GbpProfile | null): string[] {
  const direct = readCategoryList(profile, [
    "additional_categories",
    "additional_categories_names",
    "secondary_categories",
  ]);
  if (direct.length > 0) return direct;
  // Some shapes put every category in one array. Drop whichever one is acting as the primary rather
  // than counting it twice.
  const all = readCategoryList(profile, ["categories", "category_list"]);
  const primary = pick(profile, ["category", "primary_category", "category_name"], str);
  if (primary) return all.filter((c) => c.toLowerCase() !== primary.toLowerCase());
  return all.slice(1);
}

function readCategoryList(profile: GbpProfile | null, keys: string[]): string[] {
  const raw = pick(profile, keys, (v) => (Array.isArray(v) ? v : null));
  if (!raw) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const s = str(entry);
      if (s) out.push(s);
      continue;
    }
    const name = pick(entry, ["name", "title", "category"], str);
    if (name) out.push(name);
  }
  return out;
}

/**
 * The owner-written GBP description.
 *
 * ‼️ `snippet` IS NOT A DESCRIPTION AND MUST NEVER BE IN THIS LIST. On the live profile it held
 * "101 E Matthews St #200, Matthews, NC 28105", which is the ADDRESS. A profile with no
 * `description` would then have had its address scored as its description, and an address always
 * contains the city and never the category, so every such business would report
 * "description names the city, not the category" as a finding about copy that does not exist.
 *
 * This is the limit of the widen-where-you-look rule: widen across spellings of the SAME fact, never
 * into a field that means something else. A wrong key that returns nothing costs one unmeasured
 * component; a wrong key that returns the wrong thing manufactures a finding.
 */
export function readDescription(profile: GbpProfile | null): string | null {
  return pick(profile, ["description", "profile_description", "about"], str);
}

export function readTotalPhotos(profile: GbpProfile | null): number | null {
  return pick(profile, ["total_photos", "photos_count", "total_photos_count"], num);
}

export interface GbpService {
  name: string;
  snippet: string | null;
}

/**
 * The services list, normalized.
 *
 * ‼️ AN ABSENT KEY AND AN EMPTY ARRAY ARE DIFFERENT ANSWERS, and the caller depends on it. Absent
 * means the lookup did not find the field, so the component is UNMEASURED; an empty array means the
 * profile really does list no services, which is a measured zero and a real finding. Returning `[]`
 * for both would turn a possible field-name miss into a batch-wide "no services" claim, which is
 * the `google_reviews` bug run forwards.
 */
export function readServices(profile: GbpProfile | null): GbpService[] | null {
  const raw = pick(profile, ["services", "service_items", "products_and_services"], (v) =>
    Array.isArray(v) ? v : null
  );
  if (!raw) return null;
  const out: GbpService[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      const s = str(entry);
      if (s) out.push({ name: s, snippet: null });
      continue;
    }
    const name = pick(entry, ["title", "name", "service"], str);
    if (!name) continue;
    out.push({ name, snippet: pick(entry, ["description", "snippet", "text"], str) });
  }
  return out;
}

/** The landing page url as the PROFILE gives it. Preferred over the SERP's, same rule as category. */
export function readProfileUrl(profile: GbpProfile | null): string | null {
  return pick(profile, ["url", "website", "site_url"], str);
}

export function readProfileCity(profile: GbpProfile | null): string | null {
  const info = pick(profile, ["address_info", "address_details"], (v) =>
    v && typeof v === "object" ? (v as Record<string, unknown>) : null
  );
  return pick(info, ["city", "locality", "town"], str);
}

// ── the landing page ────────────────────────────────────────────────────────────────────────────

export function extractTitle(html: string | null | undefined): string | null {
  if (!html) return null;
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? cleanMarkup(m[1]) : null;
}

/**
 * The FIRST h1, on its own.
 *
 * Not reusable from site-research.ts's `headings`, which merges h1/h2/h3 into one array with no tag
 * on each entry, and the h1 specifically is what this component is about.
 */
export function extractFirstH1(html: string | null | undefined): string | null {
  if (!html) return null;
  const m = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return m ? cleanMarkup(m[1]) : null;
}

function cleanMarkup(fragment: string): string | null {
  return str(
    fragment
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
  );
}

// ── the score ───────────────────────────────────────────────────────────────────────────────────

function component(
  weight: number,
  attempted: boolean,
  earned: number,
  note: string
): OptimizationComponent {
  return { weight, attempted, earned, note };
}

/** Every unmeasured note begins with the same three words, so the CSV reads at a glance. */
function unmeasured(weight: number, why: string): OptimizationComponent {
  return component(weight, false, 0, "not measured: " + why);
}

/**
 * Keep a note readable in a spreadsheet cell at default width.
 *
 * ASCII only, deliberately. These strings are written into a CSV that gets opened in Excel, and a
 * single-character ellipsis is one more thing to go wrong in an encoding somebody else picks.
 */
function clip(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 3) + "...";
}

/**
 * Score one business on how well its Google Business Profile is filled in.
 *
 * ‼️ A COMPONENT THAT COULD NOT BE MEASURED LEAVES THE DENOMINATOR. IT DOES NOT SCORE ZERO. The
 * result is `earned / attempted` rescaled to 0-100, never `earned / 100`. Same doctrine and same
 * arithmetic as `scoreSerp`.
 *
 * ‼️ EACH SCORE KEEPS ITS OWN DENOMINATOR. Nothing here is merged with dominance. A business whose
 * profile call failed has a null optimization_score and a completely untouched dominance_score.
 * `presenceScore` combines the two AFTERWARDS, over one denominator, without either of them
 * changing.
 *
 * ‼️ FIVE OF THE SIX ARE GRADUATED AS OF 2026-08-29, AND THEY USED TO BE PASS MARKS. Matthew's
 * rule, in his words: more categories, more keywords, more photos, more described services, more of
 * the title and h1 filled in, all score higher. A threshold answers "did they clear the bar" and he
 * is not sorting a list to find who cleared a bar, he is skimming the best-configured profiles off
 * the top. `primary_category` is the one that stays boolean, because a business has one primary
 * category or it has none and there is no "more" to have.
 */
export function scoreOptimization(input: OptimizationInput): OptimizationResult {
  const W = OPTIMIZATION_WEIGHTS;
  const serp = input.serp;
  const profile = input.profile;
  const sawProfile = profile !== null;
  // ‼️ ONLY A knowledge_graph OR THE PROFILE CAN ANSWER "WHAT CATEGORY IS THIS BUSINESS". A
  // local_pack carries a cid, a title, a url and a rating and NO category, so a cid that came from
  // one is not evidence that the category could be looked at. Treating it as evidence would record
  // "no primary category set" as a measured zero about a business nobody had asked about the
  // category of, which is the denominator rule failing from the inside.
  const sawCategorySource = serp !== null && serp.cidSource === "knowledge_graph";

  // The profile is authoritative and the SERP is the fallback. Two sources for one fact means fewer
  // unmeasured rows, and the one that came from the profile itself wins.
  const category = (sawProfile ? readPrimaryCategory(profile) : null) ?? serp?.category ?? null;
  const description = (sawProfile ? readDescription(profile) : null) ?? serp?.description ?? null;
  const city =
    (sawProfile ? readProfileCity(profile) : null) ?? serp?.city ?? str(input.fallbackCity) ?? null;

  const catTokens = categoryTokens(category);
  const cityToks = cityTokens(city);

  // 1. A primary category at all. Attempted the moment either source came back, because present or
  //    absent is then a real readable answer about the profile.
  const primary =
    !sawCategorySource && !sawProfile
      ? unmeasured(W.primary_category, "no knowledge graph and no profile")
      : component(
          W.primary_category,
          true,
          category ? W.primary_category : 0,
          category ? "category: " + clip(category, 40) : "no primary category set"
        );

  // 2. Additional categories. Only the profile carries these and a SERP never does, so no profile is
  //    a failure to LOOK rather than a finding about them.
  const additional = !sawProfile
    ? unmeasured(W.additional_categories, "no profile match")
    : (() => {
        const list = readAdditionalCategories(profile);
        return component(
          W.additional_categories,
          true,
          graded(W.additional_categories, list.length, FULL_ADDITIONAL_CATEGORIES),
          list.length === 0
            ? "no additional categories"
            : list.length + " additional categor" + (list.length === 1 ? "y" : "ies") +
              (list.length >= FULL_ADDITIONAL_CATEGORIES
                ? ", full marks"
                : ", " + FULL_ADDITIONAL_CATEGORIES + " for full marks")
        );
      })();

  // 3. A description that names the category and the city.
  //
  //    ‼️ THE CATEGORY AND THE CITY ARE PART OF `attempted`, NOT PART OF THE TEST. The rule is "does
  //    the description contain them", and with nothing to look for the check cannot be RUN. Scoring
  //    it zero would record "they wrote a bad description" when what actually happened is that we
  //    could not read their category. Same denominator rule, one level down.
  const descriptionComponent = !description
    ? unmeasured(
        W.description_keywords,
        sawProfile ? "no description on the profile" : "no description found"
      )
    : catTokens.length === 0
      ? unmeasured(W.description_keywords, "no category to look for")
      : cityToks.length === 0
        ? unmeasured(W.description_keywords, "no city to look for")
        : (() => {
            // ‼️ GRADUATED ON HOW MUCH OF THE CATEGORY IT CARRIES, PLUS THE CITY AS ONE MORE
            // KEYWORD. "Keyword rich, the more keywords the higher score" cannot be a boolean, and
            // the old one was: a description saying "medical spa in Ashland" and one saying "spa"
            // scored the same 15. The city stays worth exactly one keyword rather than half the
            // component, because a category is usually two or three words and pricing the city at
            // half would make naming the town worth more than describing the business.
            const cover = categoryCoverage(description, catTokens);
            const hasCity = containsCity(description, cityToks);
            const hit = cover.hit + (hasCity ? 1 : 0);
            const total = cover.total + 1;
            return component(
              W.description_keywords,
              true,
              graded(W.description_keywords, hit, total),
              hit === 0
                ? "description names neither category nor city"
                : hit + " of " + total + " keywords: " +
                  (cover.hit > 0 ? cover.hit + " category" : "no category") +
                  ", " + (hasCity ? "city" : "no city")
            );
          })();

  // 4. Photos.
  //
  //    ‼️ `knowledge_graph_images_item.count` IS NOT A PHOTO COUNT AND IS NOT READ ANYWHERE. It is
  //    how many images the search card happened to render, measured at 3 on a live business whose
  //    real count is unknown, so using it would mark a business with 200 photos as failing this.
  //    `total_photos` off the profile is the only source, and without it this is unmeasured.
  const totalPhotos = sawProfile ? readTotalPhotos(profile) : null;
  const photos =
    totalPhotos === null
      ? unmeasured(W.photos, sawProfile ? "no photo count on the profile" : "no profile match")
      : component(
          W.photos,
          true,
          graded(W.photos, totalPhotos, FULL_PHOTOS),
          totalPhotos + (totalPhotos === 1 ? " photo" : " photos") +
            (totalPhotos >= FULL_PHOTOS ? ", full marks" : ", " + FULL_PHOTOS + " for full marks")
        );

  // 5. Services carrying a description. An empty array IS a measured zero: the profile came back and
  //    listed none, which is a real finding. An absent field is unmeasured, see `readServices`.
  const serviceList = sawProfile ? readServices(profile) : null;
  const services =
    serviceList === null
      ? unmeasured(W.services, sawProfile ? "no services field on the profile" : "no profile match")
      : (() => {
          // ‼️ TWO AXES IN ONE COMPONENT, WHICH IS WHAT WAS ASKED FOR: how many services carry a
          // description, and whether those descriptions say what the service IS. A described
          // service naming the category is worth a full point and a bare one is worth half, so
          // "33 services listed and none described" and "3 described with the keywords in them"
          // stop landing on the same number.
          //
          // ‼️ WITH NO CATEGORY KNOWN, EVERY DESCRIBED SERVICE IS WORTH A FULL POINT. Halving them
          // would charge the business for a lookup WE could not make, which is the denominator rule
          // arriving one level down: we cannot read the keywords, so we do not grade the keywords.
          const describedList = serviceList.filter((x) => (x.snippet ?? "").trim().length > 0);
          const canReadKeywords = catTokens.length > 0;
          const keyworded = canReadKeywords
            ? describedList.filter((x) => containsCategory(x.snippet, catTokens)).length
            : 0;
          const points = canReadKeywords
            ? keyworded * SERVICE_KEYWORD_POINT +
              (describedList.length - keyworded) * SERVICE_BARE_POINT
            : describedList.length * SERVICE_KEYWORD_POINT;
          return component(
            W.services,
            true,
            graded(W.services, points, FULL_SERVICE_POINTS),
            serviceList.length === 0
              ? "no services listed"
              : describedList.length + " of " + serviceList.length + " described" +
                (canReadKeywords ? ", " + keyworded + " with the category in them" : "")
          );
        })();

  // 6. The landing page names the category and the city, in the title AND the h1.
  //
  //    ‼️ A SITE THAT REFUSES THE CRAWL IS UNMEASURED, NEVER FAILED. Same rule the audit engine holds
  //    with CRAWL_BLOCK_LINE: a refused request is a fact about our request, not about them.
  const landing = !input.page
    ? unmeasured(W.landing_page, "no landing page on the profile")
    : !input.page.crawled
      ? unmeasured(W.landing_page, "site would not load")
      : catTokens.length === 0
        ? unmeasured(W.landing_page, "no category to look for")
        : cityToks.length === 0
          ? unmeasured(W.landing_page, "no city to look for")
          : (() => {
              // ‼️ FOUR CHECKS, GRADUATED, RATHER THAN ONE ALL-OR-NOTHING. Matthew asked for this
              // to be "extra score" for having the category and city in the title tag AND the h1,
              // and the four are what that sentence actually contains. A page whose title is right
              // and whose h1 forgot the city used to score zero, identically to a page that names
              // neither anywhere — which reported a business that had done three quarters of the
              // work as having done none of it.
              const checks = [
                containsCategory(input.page.title, catTokens),
                containsCity(input.page.title, cityToks),
                containsCategory(input.page.h1, catTokens),
                containsCity(input.page.h1, cityToks),
              ];
              const hit = checks.filter(Boolean).length;
              // Short labels, because the whole note goes in a spreadsheet cell beside five others
              // and "category in title, city in title, category in h1, city in h1" is 62 characters
              // on its own. The probe caps a note at 60.
              const LABELS = ["title cat", "title city", "h1 cat", "h1 city"];
              const present = LABELS.filter((_, i) => checks[i]);
              return component(
                W.landing_page,
                true,
                graded(W.landing_page, hit, checks.length),
                hit === 0
                  ? "neither title nor h1 names the category or city"
                  : hit + " of 4: " + present.join(", ")
              );
            })();

  const components: Record<OptimizationKey, OptimizationComponent> = {
    primary_category: primary,
    additional_categories: additional,
    description_keywords: descriptionComponent,
    photos,
    services,
    landing_page: landing,
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
  if (attempted === 0) {
    return { score: null, components, measured: "0 of " + OPTIMIZATION_COMPONENT_COUNT };
  }

  return {
    score: Math.round((earned / attempted) * 100),
    components,
    measured: ran + " of " + OPTIMIZATION_COMPONENT_COUNT,
  };
}

// ── the gap across a batch ──────────────────────────────────────────────────────────────────────

export interface GapCount {
  key: OptimizationKey;
  /** How many measured rows failed this component. */
  missing: number;
  /** How many rows this component could be measured on at all. */
  measured: number;
}

/**
 * Which component is most often missing across a batch. That line writes the campaign.
 *
 * ‼️ THE DENOMINATOR IS ATTEMPTED ROWS, NOT BATCH SIZE. "118 of 140" has to mean "of the profiles we
 * could look at", or the headline number quietly becomes a statement about how many lookups failed
 * rather than about the businesses. Ties break on OPTIMIZATION_KEY_ORDER so two identical batches
 * print the same list, the same tie-break `formatBreakdown` uses on JUNK_REASON_ORDER.
 */
export function countGaps(
  results: Array<{ components: Record<string, OptimizationComponent> }>
): GapCount[] {
  const out: GapCount[] = [];
  for (const key of OPTIMIZATION_KEY_ORDER) {
    let missing = 0;
    let measured = 0;
    for (const result of results) {
      const c = result.components[key];
      if (!c || !c.attempted) continue;
      measured++;
      // ‼️ A GAP IS A REAL HOLE, NOT "ANYTHING SHORT OF PERFECT". `earned < weight` was exactly the
      // right question while these were pass marks and is the wrong one now they are graduated: it
      // would report a business with 9 photos out of a 10 ceiling as having a photo gap, on the one
      // line of the summary that gets read down a phone.
      if (c.earned < c.weight * GAP_FRACTION) missing++;
    }
    out.push({ key, missing, measured });
  }
  return out.sort((a, b) => {
    if (b.missing !== a.missing) return b.missing - a.missing;
    return OPTIMIZATION_KEY_ORDER.indexOf(a.key) - OPTIMIZATION_KEY_ORDER.indexOf(b.key);
  });
}

/**
 * Re-read a stored `optimization_components` blob.
 *
 * Unknown keys and malformed entries are DROPPED rather than defaulted, the same reason
 * `coerceBatch` drops a visual it cannot read: a component invented at read time would be counted
 * in the batch gap tally as if it had been measured.
 */
export function readStoredComponents(
  stored: Record<string, unknown> | null | undefined
): Record<string, OptimizationComponent> {
  return readComponentBlob(stored, OPTIMIZATION_KEY_ORDER);
}

/** The same read over `score_components`, whose keys are the six dominance ones. */
export function readStoredScoreComponents(
  stored: Record<string, unknown> | null | undefined
): Record<string, OptimizationComponent> {
  return readComponentBlob(stored, SCORE_KEY_ORDER);
}

/**
 * Walk a stored components blob by an EXPLICIT key list.
 *
 * The list is not optional and `Object.keys` is not used, for two reasons that both cost money:
 * both blobs are written with an extra `measured` STRING alongside the components, which is not a
 * component and would be counted as one; and a key invented at read time would enter the presence
 * denominator as if something had been measured.
 */
function readComponentBlob(
  stored: Record<string, unknown> | null | undefined,
  keys: readonly string[]
): Record<string, OptimizationComponent> {
  const out: Record<string, OptimizationComponent> = {};
  if (!stored) return out;
  for (const key of keys) {
    const raw = stored[key];
    if (!raw || typeof raw !== "object") continue;
    const c = raw as Record<string, unknown>;
    const weight = num(c.weight);
    const earned = num(c.earned);
    if (weight === null || earned === null || typeof c.attempted !== "boolean") continue;
    out[key] = { weight, attempted: c.attempted, earned, note: str(c.note) ?? "" };
  }
  return out;
}

// -- presence: ONE number, over both scores ------------------------------------------------------

/** Six dominance components plus six optimization ones. */
export const PRESENCE_COMPONENT_COUNT = SCORE_KEY_ORDER.length + OPTIMIZATION_KEY_ORDER.length;

export interface PresenceResult {
  /** 0-100, or null when NOT ONE of the twelve could be measured. */
  score: number | null;
  /** e.g. "9 of 12". Printed in the CSV so the number can be read with its own confidence. */
  measured: string;
  /** How many of the twelve ran. Zero is exactly the null case. */
  attempted: number;
  /**
   * `score_components.reviews.earned`, 0 to 25, carried out for the sort tie-break.
   *
   * ‼️ IT SATURATES AT 500 REVIEWS, which is where the `reviews` component itself tops out. Two
   * businesses with 600 and 6,000 Google reviews tie-break identically, and that is a ceiling this
   * proxy INHERITS rather than a bug in the sort. If a finer tie-break is ever wanted the fix is to
   * carry the raw review count out of `scoreSerp`, never to raise the ceiling on a component whose
   * weight was chosen for scoring rather than for ordering.
   */
  reviewsEarned: number;
}

/**
 * ONE presence score across both audits, computed from the two stored component blobs.
 *
 * ‼️ IT IS ONE `earned / attempted` OVER TWELVE COMPONENTS. IT IS NOT THE AVERAGE OF THE TWO
 * SCORES, and that difference is the entire reason it is allowed to exist beside a file that spends
 * four sections saying the two numbers must not be blended. An average needs a value for BOTH
 * halves, so every row whose profile lookup failed would need one INVENTED: as a zero, which says
 * "their profile is empty" about a profile nobody read, or as the other score, which says nothing
 * at all. A single denominator needs no such value. A row that could be measured on twelve
 * components is scored out of twelve, a row that could be measured on six is scored out of six, and
 * neither is flattered nor punished for what could not be looked at. It is the SAME denominator
 * rule `scoreSerp` and `scoreOptimization` each already apply, applied ONCE over the union instead
 * of twice over the halves.
 *
 * ‼️ COMPUTED IN MEMORY, WITH NO COLUMN OF ITS OWN AND NO MIGRATION. There is nowhere for a stored
 * presence value to drift away from the parts it claims to summarise, because there is no stored
 * value. Do not add one.
 */
export function presenceScore(
  dominance: Record<string, unknown> | null | undefined,
  optimization: Record<string, unknown> | null | undefined
): PresenceResult {
  const dom = readComponentBlob(dominance, SCORE_KEY_ORDER);
  const opt = readComponentBlob(optimization, OPTIMIZATION_KEY_ORDER);

  let attemptedWeight = 0;
  let earned = 0;
  let ran = 0;
  for (const c of [...Object.values(dom), ...Object.values(opt)]) {
    if (!c.attempted) continue;
    ran++;
    attemptedWeight += c.weight;
    earned += c.earned;
  }

  const reviews = dom.reviews;
  const reviewsEarned = reviews && reviews.attempted ? reviews.earned : 0;

  // Not one of the twelve could be measured. Null, never zero: the row gets a BLANK rank, sits at
  // the end of the file, is left out of every percentage, and STAYS IN THE KEPT PILE.
  if (attemptedWeight === 0) {
    return {
      score: null,
      measured: "0 of " + PRESENCE_COMPONENT_COUNT,
      attempted: 0,
      reviewsEarned,
    };
  }

  return {
    score: Math.round((earned / attemptedWeight) * 100),
    measured: ran + " of " + PRESENCE_COMPONENT_COUNT,
    attempted: ran,
    reviewsEarned,
  };
}

/** What the sort needs off a row: the key, then the two tie-breaks, in that order. */
export interface PresenceRank {
  presence: number | null;
  /** `score_components.reviews.earned`. Google reviews, the first tie-break. */
  reviewsEarned: number;
  /** Dominance, the second. */
  dominance: number | null;
}

/**
 * scored.csv order: most presence FIRST, unmeasured last.
 *
 * ‼️ THE DIRECTION RULE IS STILL `sortForCutoff` AND IS NOT RE-IMPLEMENTED HERE. This only
 * PRE-SORTS by the tie-breaks and hands the array over. `Array.prototype.sort` is required to be
 * stable, so rows that tie on presence come out in tie-break order and there is still exactly one
 * place in the lane that decides descending-with-unmeasured-last. Do not inline it.
 *
 * ‼️ THE TIE-BREAK IS GOOGLE REVIEWS FIRST, DOMINANCE SECOND. Presence is a ratio over a variable
 * denominator, so a row measured on two components lands on a round number constantly and ties are
 * ordinary rather than exotic. Reviews are the closest thing on the row to "how big is this
 * business really", which is the question the top of the file is being read to answer.
 */
export function sortByPresence<T>(rows: T[], read: (row: T) => PresenceRank): T[] {
  const tied = [...rows].sort((a, b) => {
    const x = read(a);
    const y = read(b);
    if (x.reviewsEarned !== y.reviewsEarned) return y.reviewsEarned - x.reviewsEarned;
    // An unmeasured dominance sorts below any measured one, the same direction as everything else.
    return (y.dominance ?? -1) - (x.dominance ?? -1);
  });
  return sortForCutoff(tied, (row) => read(row).presence);
}
