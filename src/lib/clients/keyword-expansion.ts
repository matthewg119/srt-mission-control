// The keyword step, the deterministic half: which categories an offer is said in, how a phrase is
// classified, scored and merged, what the card and the CSV say, and the grammar its thread takes.
//
// Matthew, 2026-09-11: "We need to find at least 200 keywords around the offer from variations on
// how it could potentially be said." And: "In what step are we going to select the keywords? I
// don't see it in any step and we need to select them, right?" This file is the part of that
// answer that can be proved without a model or a database. client-keywords.ts is the rest.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ A VARIATION A MODEL PROPOSED IS NOT EVIDENCE THAT ANYBODY SEARCHED IT.
//
// This repo's keyword doctrine (keyword-set.ts's header, phrase-quality.ts) is that rankings come
// from facts in the database and never from a model's opinion. The expansion is the first
// model-written input to keyword selection, so it is labelled and scored as what it is:
//
//   harvest    lifted off the pages the engines cited        full SCORE_TERMS
//   research   the deep research brief or its KEYWORDS block  full, volume only with a source URL
//   manual     typed by a person (`keywords add:`)           ranks like evidence: he said it
//   expansion  proposed by the model in this step            intent from its category, nothing else
//   measured   an expansion put to an engine (`keywords check`) expansion, plus the +15 gap term
//
// The sort is (tier, score): an expansion row never outranks an evidenced one, whatever its score,
// and where the two normalise to the same phrase the evidenced row wins and keeps the expansion's
// category. No DataForSEO volume, for the reason keyword-set.ts gives and Matthew accepted.
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ TWO USES, KEPT APART. Matthew's own list mixed phrases people TYPE OR ASK (page targets) with
// marketing lines ("5 new filler patients in 30 days", "30-day ChatGPT visibility sprint"). Every
// row carries `use`. Only a `query` may become a page's target keyword. A `hook` is stored, shown
// and exported for ads and the content engine, and NEVER a page target: draft-page.ts rule 4 bans
// outcome promises on pages and CLAUDE.md's pitch doctrine gates any guarantee to the ads tier.

import { hasBannedDash } from "@/lib/copy-guard";
import type { Audience } from "@/lib/concierge/magnets";
import { scoreCandidate } from "./artifacts/page-candidates";
import {
  DEBRIS_FAULTS,
  isAboutOffer,
  normalizePhrase,
  phraseFaults,
  tidyPhrase,
  type PhraseFault,
} from "./phrase-quality";

export type KeywordUse = "query" | "hook";
export type KeywordOrigin = "harvest" | "research" | "expansion" | "measured" | "manual";

/** The addendum's floor: this many query-shaped phrases after dedupe and the filter. */
export const KEYWORD_FLOOR = 200;

/** One pillar plus eight supports. The verifier refuses a set that cannot fill them. */
export const PLAN_KEYWORDS_NEEDED = 9;

/** How many queries the card prints. The CSV carries every row. */
export const CARD_TOP = 40;

/** A phrase an evidence row could not be placed in any category by. */
export const OTHER_CATEGORY = "other";

export interface CategorySpec {
  key: string;
  label: string;
  /** How many the expansion is asked for. The floor is the sum that must survive, not each one. */
  target: number;
  /** 0 to 3, the same ladder harvest.ts's commercialIntent uses. An expansion row's only term. */
  intent: number;
  /** The one category the pillar's keyword is chosen from. */
  naming?: boolean;
  /**
   * One of the four buying questions the supports are built on first: price, fears, comparisons,
   * how it works. Matthew, 2026-09-11: "make sure for the posts we focus on this questions: price,
   * fears, comparisons, how it works". selectOfferPlan fills the supports from these, two each,
   * before it reaches any other category.
   */
  focus?: boolean;
  /** What to write, said to the model. */
  shape: string;
  /** Examples to seed from. The owner seeds are Matthew's own list, 2026-09-11. */
  seeds: readonly string[];
  /**
   * How an EVIDENCE row (harvested, researched, typed) is placed in this category. Null for the
   * categories only the expansion writes into. Heuristic on purpose and documented as one: it
   * decides only which slot a harvested phrase competes for, never whether it is kept.
   */
  match: RegExp | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The two tables. DATA, NOT CODE BRANCHES: one expansion function takes the table for the
// audience, so a third audience is a third table rather than a third function.
// ─────────────────────────────────────────────────────────────────────────────

const PATIENT: readonly CategorySpec[] = [
  {
    key: "naming",
    label: "Naming variants",
    target: 25,
    intent: 2,
    naming: true,
    shape:
      "the treatment, its synonyms, the brand and product names customers use, common misspellings, " +
      "with and without the city",
    seeds: ["lip filler", "lip injections", "juvederm lips", "lip filer"],
    match: null,
  },
  {
    key: "local",
    label: "Near me, local, voice",
    target: 25,
    intent: 3,
    shape: "near me, the city and its neighbourhoods, open on a given day, said out loud to a phone",
    seeds: ["where can i get lip filler near me", "best lip filler in charlotte", "lip filler open saturday"],
    match: /\b(near me|nearby|closest|walk ?in|same day|open (today|now|late|on)|open (saturday|sunday))\b/,
  },
  {
    key: "price",
    label: "Price and financing",
    focus: true,
    target: 20,
    intent: 3,
    shape: "what it costs, per syringe or per unit, specials, payment plans, financing, memberships",
    seeds: ["how much is lip filler", "lip filler cost per syringe", "lip filler payment plan"],
    match: /\b(cost|costs|price|prices|pricing|how much|afford|affordable|financing|payment plans?|per syringe|per unit|specials?|membership|cheap)\b/,
  },
  {
    key: "fear",
    label: "Fear, safety, objections",
    focus: true,
    target: 25,
    intent: 1,
    shape: "pain, safety, side effects, what goes wrong, whether it can be undone",
    seeds: ["does lip filler hurt", "is lip filler safe", "lip filler gone wrong", "can lip filler be dissolved"],
    match: /\b(hurts?|painful|pain|safe|safety|risks?|dangerous|side effects?|gone wrong|went wrong|botched|dissolve[ds]?|scared|afraid|nervous|worried|regret|complications?|allergic)\b/,
  },
  {
    key: "comparison",
    label: "Comparison",
    target: 20,
    intent: 2,
    focus: true,
    shape: "this against the alternatives, brand against brand, where to have it done",
    seeds: ["lip flip vs filler", "juvederm vs restylane lips", "med spa vs dermatologist for filler"],
    match: /\b(vs|versus|compared?|comparison|difference between|better than|instead of)\b/,
  },
  {
    key: "process",
    label: "Process, what to expect, aftercare",
    focus: true,
    target: 20,
    intent: 1,
    shape: "the first appointment, how long it takes, swelling, recovery, aftercare",
    seeds: ["lip filler swelling day 2", "what to expect at first lip filler appointment", "lip filler aftercare"],
    match: /\b(swelling|swollen|recovery|downtime|aftercare|after care|what to expect|first appointment|prepare|healing|bruising|how long does it take)\b/,
  },
  {
    key: "candidacy",
    label: "Candidacy",
    target: 15,
    intent: 1,
    shape: "whether it suits them: age, skin, lips, first time, health conditions",
    seeds: ["am i a good candidate for lip filler", "lip filler at 40", "first time lip filler"],
    match: /\b(candidate|am i|too (old|young)|first time|at my age|in my (20s|30s|40s|50s|60s)|can i get|if i have)\b/,
  },
  {
    key: "results",
    label: "Results and longevity",
    target: 20,
    intent: 1,
    shape: "how long it lasts, before and after, looking natural, when it wears off",
    seeds: ["how long does lip filler last", "lip filler before and after", "natural looking lip filler"],
    match: /\b(last|lasts|longevity|results?|before and after|natural|wear off|wears off|permanent)\b/,
  },
  {
    key: "provider",
    label: "Choosing a provider",
    target: 20,
    intent: 2,
    shape: "who to trust with it: the best injector, how to choose, reviews, credentials",
    seeds: ["best lip filler injector", "how to choose a med spa for filler", "lip filler reviews"],
    match: /\b(best|top rated|choose|choosing|injectors?|provider|nurse injector|dermatologist|reviews?|credentials?|qualified|certified|licensed)\b/,
  },
  {
    key: "conversational",
    label: "Conversational AI prompts",
    target: 20,
    intent: 2,
    shape: "whole questions as people dictate them to ChatGPT or Siri, in their own rambling words",
    seeds: ["i want fuller lips but i'm scared they'll look fake, what should i ask for"],
    match: null,
  },
];

const OWNER: readonly CategorySpec[] = [
  {
    key: "direct_naming",
    label: "Direct offer naming",
    target: 30,
    intent: 3,
    naming: true,
    shape: "the offer named outright, every name the industry and the buyer use for it",
    seeds: [
      "AEO for med spas",
      "answer engine optimization med spa",
      "generative engine optimization",
      "LLM optimization aesthetic clinics",
      "ChatGPT SEO for med spas",
      "AI search optimization cosmetic clinic",
      "AI visibility audit med spa",
    ],
    match: null,
  },
  {
    key: "problem",
    label: "Problem and pain",
    target: 30,
    intent: 2,
    shape: "the problem in the owner's words: invisible to AI, losing patients to it, not recommended",
    seeds: [
      "why isn't my med spa on ChatGPT",
      "med spa not showing up in Perplexity",
      "ChatGPT not recommending my clinic",
      "losing patients to AI search",
    ],
    match: /\b(why (isn'?t|is not|doesn'?t|does not|don'?t|won'?t)|not showing|not recommend|invisible|missing from|losing|can'?t find|never mentions?|not mentioned)\b/,
  },
  {
    key: "outcome",
    label: "Outcome",
    target: 25,
    intent: 2,
    shape: "the result wanted, said as a search: recommended by ChatGPT, in AI Overviews, in AI answers",
    seeds: [
      "get my med spa recommended by ChatGPT",
      "show up in Google AI Overviews",
      "rank in AI answers",
      "med spa AI mentions",
    ],
    match: /\b(get (my|our)|show up|rank|ranking|recommended|appear|be found|cited|visible|visibility|ai overviews?)\b/,
  },
  {
    key: "vendor",
    label: "Vendor and buyer intent",
    target: 25,
    intent: 3,
    shape: "looking for somebody to do it: the best agency, a consultant, an expert to hire",
    seeds: [
      "best AEO agency for med spas",
      "AEO consultant",
      "hire an AI visibility expert",
      "med spa AI marketing agency",
    ],
    match: /\b(agency|agencies|consultants?|experts?|specialists?|hire|company|companies|firm|freelancer|who does|done for you)\b/,
  },
  {
    key: "price_roi",
    label: "Price and ROI",
    focus: true,
    target: 20,
    intent: 3,
    shape: "what it costs and whether it pays back",
    seeds: ["how much does AEO cost", "is AEO worth it for a med spa"],
    match: /\b(cost|costs|price|pricing|how much|worth it|roi|return on|afford|budget|retainer|per month)\b/,
  },
  {
    key: "comparison",
    label: "Comparison",
    target: 20,
    intent: 2,
    focus: true,
    shape: "this against SEO, against paid ads, against doing it in house",
    seeds: ["AEO vs SEO", "AEO agency vs doing it myself", "AEO vs paid ads"],
    match: /\b(vs|versus|compared?|difference between|better than|instead of|diy|do it myself|in house)\b/,
  },
  {
    key: "how_it_works",
    label: "How it works and timeline",
    focus: true,
    target: 20,
    intent: 1,
    shape: "what the work is and how long it takes to show",
    seeds: ["how long until ChatGPT mentions my clinic", "what does an AEO agency actually do"],
    match: /\b(how (does|do|long)|what does|what is|timeline|process|how it works|steps)\b/,
  },
  {
    key: "trust",
    label: "Trust and objections",
    focus: true,
    target: 20,
    intent: 1,
    shape: "the doubts: is it a scam, what happens if they leave, patient data",
    seeds: ["is AEO a scam", "will I lose my pages if I leave", "does AEO touch patient data"],
    match: /\b(scam|legit|trust|guarantee|contract|cancel|lock ?in|leave|patient data|hipaa|privacy|risk|safe)\b/,
  },
  {
    key: "treatment_specific",
    label: "Treatment-specific AEO",
    target: 15,
    intent: 2,
    shape: "the offer for one treatment line: filler clinics, Botox, laser hair removal, TRT clinics",
    seeds: ["AEO for filler clinics", "AEO for Botox", "AEO for laser hair removal", "AEO for TRT clinics"],
    match: /\b(filler|botox|laser|hair removal|trt|testosterone|injectables?|coolsculpting|microneedling|facials?|hydrafacial|weight loss|semaglutide)\b/,
  },
  {
    key: "conversational",
    label: "Conversational AI prompts",
    target: 15,
    intent: 2,
    shape: "what a clinic owner types into ChatGPT about being invisible, as a whole question",
    seeds: ["my med spa never comes up when people ask chatgpt for a recommendation, how do i fix that"],
    match: null,
  },
];

export const KEYWORD_CATEGORIES: Readonly<Record<Audience, readonly CategorySpec[]>> = {
  patient: PATIENT,
  owner: OWNER,
};

/** A category's label, including the evidence-only fallback. */
export function categoryLabel(categories: readonly CategorySpec[], key: string): string {
  if (key === OTHER_CATEGORY) return "Other, from the market";
  return categories.find((c) => c.key === key)?.label ?? key;
}

// ─────────────────────────────────────────────────────────────────────────────
// Query or hook
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The shapes of a marketing line, as opposed to something typed at a search box.
 *
 * ‼️ A HOOK HERE IS A PROMISE OR A PITCH, AND THE CHECK IS DETERMINISTIC ON PURPOSE. The model
 * labels `use` too, but a model that calls "5 new filler patients in 30 days" a query would put an
 * outcome promise on a page, which rule 4 of the drafter exists to stop. So either one saying hook
 * makes it a hook, and nothing can turn a hook-shaped line back into a query.
 */
const HOOK_SHAPES: readonly RegExp[] = [
  // "5 new filler patients", "20 more leads"
  /\b\d+\s+(?:[a-z]+\s+){0,2}(patients?|clients?|leads?|customers?|bookings?|appointments?|calls?|sales)\b/i,
  // "30-day ChatGPT visibility sprint"
  /\b\d+[- ]?(day|week|month)s?\s+(?:[a-z]+\s+){0,3}(sprint|program|programme|challenge|plan|system|blueprint|method)\b/i,
  // "... in 30 days": a result on a clock is a promise
  /\bin\s+\d+\s+(days?|weeks?|months?)\b/i,
  /\bguarantee[ds]?\b/i,
  // "your clinic isn't showing up on ChatGPT": said TO the owner, not by them
  /^your\s(?![^?]*\?\s*$)/i,
  /!\s*$/,
];

export function isHookShaped(phrase: string): boolean {
  const p = tidyPhrase(phrase);
  return HOOK_SHAPES.some((r) => r.test(p));
}

export function classifyUse(modelUse: string | null | undefined, phrase: string): KeywordUse {
  return modelUse === "hook" || isHookShaped(phrase) ? "hook" : "query";
}

/**
 * The faults that disqualify an expansion row.
 *
 * ‼️ NOT `too_short`, AND "lip filler" IS WHY. A naming variant is two words and is the most
 * commercial phrase in the set; the full rules were written for harvested questions. Same
 * reasoning as DEBRIS_FAULTS for the KEYWORDS block, plus the shape faults that still mean it is
 * not something anybody types: a sentence out of an article, a label, a fragment.
 */
const QUERY_FAULTS: readonly PhraseFault[] = [...DEBRIS_FAULTS, "too_long", "label", "nav_chrome", "fragment"];

/** Strip what a model wraps a phrase in, and what the scraper broke. Nothing else. */
export function cleanPhrase(raw: string): string {
  // Numbering first, then the wrapping: `3. "lip filler"` is a number in front of a quotation,
  // and stripping quotes first leaves the opening one stuck behind the number.
  return tidyPhrase(raw)
    .replace(/^\s*\d+[.)]\s+/, "")
    .replace(/^[\s"'“”‘’`*_-]+|[\s"'“”‘’`*_]+$/g, "")
    .trim();
}

/** Why this row cannot be kept, or null. */
export function keywordFault(phrase: string, use: KeywordUse): string | null {
  if (phrase.length < 2) return "empty";
  if (phrase.length > 160) return "too_long";
  if (hasBannedDash(phrase)) return "dash";
  const allowed = use === "query" ? QUERY_FAULTS : DEBRIS_FAULTS;
  const found = phraseFaults(phrase).find((f) => allowed.includes(f));
  return found ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classifying an evidence row, scoring, merging, ordering
// ─────────────────────────────────────────────────────────────────────────────

/** Which category an evidence row competes in. First match in table order; naming by vocabulary. */
export function classifyCategory(
  phrase: string,
  categories: readonly CategorySpec[],
  vocab: readonly string[]
): string {
  const p = normalizePhrase(phrase);
  for (const c of categories) {
    if (c.match && c.match.test(p)) return c.key;
  }
  const words = p.split(" ").filter(Boolean).length;
  const naming = categories.find((c) => c.naming);
  if (naming && words <= 5 && isAboutOffer(phrase, vocab)) return naming.key;
  const conversational = categories.find((c) => c.key === "conversational");
  if (conversational && words >= 8) return conversational.key;
  return OTHER_CATEGORY;
}

export interface KeywordCandidate {
  phrase: string;
  normalized: string;
  category: string;
  use: KeywordUse;
  origin: KeywordOrigin;
  /** From question_bank. Zero on an expansion row, which has no frequency by definition. */
  frequency: number;
  intent: number;
  objection: boolean;
  /** ‼️ TRI-STATE. null means no engine was asked. */
  currentlyNamed: boolean | null;
  sourceUrl: string | null;
  score: number;
}

/** 0 for what the market or a person said, 1 for what a model proposed. Sorted first. */
export function tierOf(origin: KeywordOrigin): 0 | 1 {
  return origin === "expansion" || origin === "measured" ? 1 : 0;
}

/**
 * The score, by provenance.
 *
 * ‼️ AN EXPANSION ROW GETS ITS CATEGORY'S INTENT AND NOTHING ELSE: no frequency term (nobody was
 * counted saying it), no objection term (the category is a guess about the phrase, not a reading
 * of it). A measured one adds the gap term when an engine was asked and did not name them, which
 * is the only fact about it anybody has established.
 */
/**
 * How much the visibility-gap term moves when a measurement lands.
 *
 * ‼️ IT IS A TRANSITION, NOT A MEASUREMENT, AND THE OLD CODE GOT THIS WRONG.
 * `keywords check` wrote `score + (mentioned === false ? 15 : 0)` every time it ran. Run it twice
 * on a phrase nobody names them for and the row carried +30, then +45 at day 60 and +60 at day 90,
 * until a fact that had not changed outranked everything in the set. The term describes a STATE
 * ("no engine names them for this"), so it goes on when a row becomes unnamed and comes off when it
 * stops being, and a re-test that measures the same answer moves nothing.
 *
 * 15 is SCORE_TERMS' "No engine names them for it" weight in page-candidates.ts, and it is the
 * largest term in the model, which is exactly why stacking it was worth catching.
 */
export function gapDelta(previous: boolean | null, next: boolean): number {
  return (next === false ? 15 : 0) - (previous === false ? 15 : 0);
}

export function scoreKeyword(
  row: Pick<KeywordCandidate, "origin" | "frequency" | "intent" | "objection" | "currentlyNamed">,
  categoryIntent: number
): number {
  switch (row.origin) {
    case "expansion":
      return scoreCandidate({ frequency: 0, intent: categoryIntent, objection: false, currentlyNamed: null, inOwnReviews: false });
    case "measured":
      return scoreCandidate({ frequency: 0, intent: categoryIntent, objection: false, currentlyNamed: row.currentlyNamed, inOwnReviews: false });
    case "manual":
      return scoreCandidate({
        frequency: 1,
        intent: Math.max(row.intent, categoryIntent),
        objection: row.objection,
        currentlyNamed: row.currentlyNamed,
        inOwnReviews: false,
      });
    default:
      return scoreCandidate({
        frequency: row.frequency,
        intent: row.intent,
        objection: row.objection,
        currentlyNamed: row.currentlyNamed,
        inOwnReviews: false,
      });
  }
}

const PRECEDENCE: Record<KeywordOrigin, number> = { manual: 3, harvest: 2, research: 2, measured: 1, expansion: 0 };

/**
 * One row per (phrase, use). Manual beats evidence beats a measured expansion beats a proposal.
 *
 * ‼️ THE EVIDENCED ROW WINS AND THE EXPANSION CONFIRMS IT. The winner keeps the loser's category
 * when its own is the fallback, and the measured answer when its own is unknown, because the two
 * rows know different things about one phrase. Not keyword-set.ts's "higher score wins": that rule
 * would let an expansion's category intent outrank the market having said it.
 */
export function mergeKeywords(rows: readonly KeywordCandidate[]): KeywordCandidate[] {
  const by = new Map<string, KeywordCandidate>();
  for (const r of rows) {
    const key = `${r.use}|${r.normalized}`;
    const e = by.get(key);
    if (!e) {
      by.set(key, r);
      continue;
    }
    const rWins =
      PRECEDENCE[r.origin] > PRECEDENCE[e.origin] ||
      (PRECEDENCE[r.origin] === PRECEDENCE[e.origin] && r.score > e.score);
    const [win, lose] = rWins ? [r, e] : [e, r];
    by.set(key, {
      ...win,
      category: win.category === OTHER_CATEGORY ? lose.category : win.category,
      currentlyNamed: win.currentlyNamed ?? lose.currentlyNamed,
      sourceUrl: win.sourceUrl ?? lose.sourceUrl,
    });
  }
  return [...by.values()];
}

/** Queries before hooks, evidence before proposals, then score. The order ranks are frozen in. */
export function compareKeywords(
  a: Pick<KeywordCandidate, "use" | "origin" | "score" | "phrase">,
  b: Pick<KeywordCandidate, "use" | "origin" | "score" | "phrase">
): number {
  if (a.use !== b.use) return a.use === "query" ? -1 : 1;
  const t = tierOf(a.origin) - tierOf(b.origin);
  if (t !== 0) return t;
  return b.score - a.score || a.phrase.localeCompare(b.phrase);
}

// ─────────────────────────────────────────────────────────────────────────────
// The verdict, pure, so the floor is proved without a database
// ─────────────────────────────────────────────────────────────────────────────

export interface KeywordTally {
  /** Query rows that are not dropped. */
  queries: number;
  approvedQueries: number;
  /** Approved queries that pass isAboutOffer. */
  relevantApproved: number;
}

export type KeywordVerdict =
  | { ok: true }
  | { ok: false; found: string; todo: string };

export function keywordVerdict(t: KeywordTally): KeywordVerdict {
  if (t.queries < KEYWORD_FLOOR) {
    return {
      ok: false,
      found: `${t.queries} query rows, and the floor is ${KEYWORD_FLOOR}`,
      todo: "`keywords more <category>` for the categories that came back short, or add your own with `keywords add:`.",
    };
  }
  if (t.approvedQueries === 0) {
    return {
      ok: false,
      found: `${t.queries} query rows, none approved`,
      todo: "Read the card and the CSV, drop what is wrong with `keywords drop 12`, then `keywords approve`.",
    };
  }
  if (t.relevantApproved < PLAN_KEYWORDS_NEEDED) {
    return {
      ok: false,
      found: `only ${t.relevantApproved} approved queries are about the offer, and a pillar plus eight supports needs ${PLAN_KEYWORDS_NEEDED}`,
      todo: "`keywords more <category>`, or add your own with `keywords add:`.",
    };
  }
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// The thread grammar
//
// ‼️ EXACT AND ANCHORED, for the reason the page studio records: this thread also takes free
// text, and anything that is not a command must fall through to it. "keywords matter less than
// people think" is a sentence. "keywords drop everything" is a sentence. Neither is a command.
// ─────────────────────────────────────────────────────────────────────────────

export const KEYWORDS_APPROVE = /^keywords\s+approve$/i;
export const KEYWORDS_DROP = /^keywords\s+drop\s+(\d{1,4}(?:\s*,\s*\d{1,4})*)$/i;
export const KEYWORDS_ADD = /^keywords\s+add\s*:\s*([\s\S]+)$/i;
export const KEYWORDS_MORE = /^keywords\s+more\s+(.+)$/i;

// ‼️ `keywords check` WAS HERE AND IS GONE (2026-09-12). It put the top twenty phrases to ChatGPT
// from this lane, with its own scoring and its own second engine caller. The approved queries now
// JOIN the tracked question set and the visibility audit measures them, which is what Matthew asked
// for: "use the results we got from the visibility audit from that profile specifically". The
// writeback is applyMeasurement in client-keywords.ts. `keywords check` is dictation now, and the
// probe asserts exactly that, so the grammar cannot quietly grow it back.

export type KeywordCommand =
  | { kind: "approve" }
  | { kind: "drop"; ranks: number[] }
  /** One phrase, or a pasted list: one per line, numbered or not. */
  | { kind: "add"; phrases: string[] }
  | { kind: "more"; category: CategorySpec };

/**
 * `keywords more price`, `keywords more naming`, `keywords more direct_naming`. A key, a label, or
 * one distinctive word of a label. Anything else is not a category and the line is dictation.
 */
export function resolveCategory(arg: string, categories: readonly CategorySpec[]): CategorySpec | null {
  const wanted = normalizePhrase(arg);
  if (!wanted) return null;
  for (const c of categories) {
    const key = c.key.replace(/_/g, " ");
    const label = normalizePhrase(c.label);
    if (wanted === key || wanted === label) return c;
  }
  if (!wanted.includes(" ") && wanted.length >= 4) {
    const hits = categories.filter((c) => normalizePhrase(c.label).split(" ").includes(wanted));
    if (hits.length === 1) return hits[0];
  }
  return null;
}

/** How many phrases one `keywords add:` takes. A list longer than this is a file, not a paste. */
export const ADD_MAX = 100;

/**
 * The phrases in a `keywords add:` body.
 *
 * ‼️ A PASTED LIST IS THE NORMAL CASE, NOT THE EDGE. Matthew's first real use was two numbered
 * lists of thirty with headings between them ("Mechanism-led (AEO / visibility angle)"). One per
 * line; when any line is numbered, ONLY the numbered lines are taken, so the headings are skipped
 * rather than added as keywords. A single line is one phrase, commas and all, because a comma is
 * something a real search phrase contains.
 */
export function addList(body: string): string[] {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const numbered = lines.filter((l) => /^\d+[.)]\s+/.test(l));
  const taken = (numbered.length ? numbered : lines).filter((l) => !/:\s*$/.test(l));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of taken) {
    const phrase = cleanPhrase(l);
    const key = normalizePhrase(phrase);
    if (!phrase || !key || seen.has(key)) continue;
    seen.add(key);
    out.push(phrase);
    if (out.length >= ADD_MAX) break;
  }
  return out;
}

export function parseKeywordCommand(raw: string, categories: readonly CategorySpec[]): KeywordCommand | null {
  const text = raw.trim().replace(/^[`*_]+|[`*_]+$/g, "").trim();
  if (KEYWORDS_APPROVE.test(text)) return { kind: "approve" };

  const drop = KEYWORDS_DROP.exec(text);
  if (drop) {
    const ranks = [...new Set(drop[1].split(",").map((n) => Number(n.trim())).filter((n) => n > 0))];
    return ranks.length ? { kind: "drop", ranks } : null;
  }

  const add = KEYWORDS_ADD.exec(text);
  if (add) {
    const phrases = addList(add[1]);
    return phrases.length ? { kind: "add", phrases } : null;
  }

  const more = KEYWORDS_MORE.exec(text);
  if (more) {
    const category = resolveCategory(more[1], categories);
    return category ? { kind: "more", category } : null;
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// What the model is told
// ─────────────────────────────────────────────────────────────────────────────

export interface ExpansionContext {
  clientName: string;
  treatment: string;
  terms: readonly string[];
  positioning: string | null;
  avatarLabel: string | null;
  /** The confirmed avatar's research brief, truncated. Absent is fine and said so. */
  research: string | null;
  /** Only when the business is local (patient audience with a city on the canonical NAP). */
  city: string | null;
  audience: Audience;
}

export const EXPANSION_SYSTEM = `You write the ways ONE offer is said by the people who buy it: what they type into Google, what they ask ChatGPT or Siri out loud, and, kept separate, the marketing lines written about it.

Every phrase is about THE OFFER named below. Not the business's other services, not the industry in general.

Every row has a use:
- "query": something a real person would type or say. A short search phrase and a whole spoken question both count. A common misspelling is a naming variant, so keep the ones people really make.
- "hook": an ad headline, an email subject line, a landing page line. Any promise of an outcome ("5 new filler patients in 30 days", a guarantee, a result on a deadline) is a hook and only ever a hook.

RULES, checked in code, and a row breaking one is thrown away:
- Write about the number asked for in each category. Do not repeat a phrase, and do not reword one trivially to make another.
- Lowercase unless a brand or product name needs capitals. No quotation marks around phrases. No numbering.
- NO em dashes, en dashes or double hyphens anywhere.
- Do not invent prices, statistics, the names of real nearby businesses, or claims about this business.
- When a city is given, use it in about a third of the naming and local phrases. When none is given, never add one.
- Most rows are queries. Write hooks only where the category invites them, and never more than a few per category.`;

export const EXPANSION_SCHEMA = `{ "rows": [ { "phrase": string, "category": string, "use": "query" | "hook" } ] }`;

export function expansionUser(
  ctx: ExpansionContext,
  asks: ReadonlyArray<{ category: CategorySpec; count: number }>,
  exclude: readonly string[] = []
): string {
  const lines: string[] = [
    `THE BUSINESS: ${ctx.clientName}`,
    `THE OFFER, which every phrase is about: ${ctx.treatment}`,
    ctx.terms.length
      ? `WHAT THEIR CUSTOMERS CALL IT, in the customers' own words: ${ctx.terms.join(", ")}`
      : "No customer terms were captured, so work from the offer's name and the usual names for it.",
    ctx.positioning ? `HOW THE BUSINESS WANTS TO BE KNOWN FOR IT: ${ctx.positioning}` : "",
    ctx.avatarLabel ? `WHO BUYS IT: ${ctx.avatarLabel}` : "",
    ctx.audience === "owner"
      ? "THE BUYER IS A BUSINESS OWNER buying a service for their business, not a patient."
      : "THE BUYER IS A CUSTOMER buying the treatment for themselves.",
    ctx.city ? `THE CITY: ${ctx.city}` : "NO CITY: this business is not local, so no phrase names a place.",
    "",
  ];

  if (ctx.research) {
    lines.push(
      "WHAT THE RESEARCH FOUND THIS BUYER SAYS, for wording only. Do not copy claims out of it:",
      ctx.research.slice(0, 6000),
      ""
    );
  }

  lines.push("THE CATEGORIES, with how many to write in each and what belongs there:");
  for (const { category, count } of asks) {
    lines.push(
      `- category "${category.key}" (${category.label}): about ${count}. ${category.shape}. ` +
        `Seed examples, do not repeat them: ${category.seeds.join("; ")}`
    );
  }

  if (exclude.length) {
    lines.push("", "ALREADY WRITTEN, do not repeat any of these:", ...exclude.slice(0, 400).map((p) => `- ${p}`));
  }

  lines.push("", `Return every row with its category key exactly as given above.`);
  return lines.filter((l, i, all) => !(l === "" && all[i - 1] === "")).join("\n");
}

// ─────────────────────────────────────────────────────────────────────────────
// The card and the CSV
// ─────────────────────────────────────────────────────────────────────────────

export interface StoredKeyword extends KeywordCandidate {
  id: string;
  rank: number | null;
  approved: boolean;
  dropped: boolean;
}

function csvCell(v: string | number | boolean | null): string {
  const s = v === null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Every row, the numbers `keywords drop` takes. For ads and the content engine as much as for him. */
export function keywordCsv(rows: readonly StoredKeyword[], categories: readonly CategorySpec[]): string {
  const header = ["rank", "phrase", "category", "use", "origin", "score", "currently_named", "approved", "dropped", "source_url"];
  const body = [...rows]
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9))
    .map((r) =>
      [
        r.rank,
        r.phrase,
        categoryLabel(categories, r.category),
        r.use,
        r.origin,
        Math.round(r.score * 100) / 100,
        r.currentlyNamed,
        r.approved,
        r.dropped,
        r.sourceUrl,
      ]
        .map(csvCell)
        .join(",")
    );
  return [header.join(","), ...body].join("\n") + "\n";
}

export interface KeywordCardContext {
  clientName: string;
  treatment: string;
  terms: readonly string[];
  audience: Audience;
  audienceConfirmed: boolean;
  city: string | null;
  vocab: readonly string[];
}

/** Rows that pass the relevance test, with the rule for model-written rows applied once. */
export function isRelevantKeyword(row: Pick<StoredKeyword, "phrase" | "origin">, vocab: readonly string[]): boolean {
  return isAboutOffer(row.phrase, vocab, { askedAboutOffer: row.origin !== "harvest" && row.origin !== "research" });
}

export function tallyKeywords(rows: readonly StoredKeyword[], vocab: readonly string[]): KeywordTally {
  const live = rows.filter((r) => !r.dropped && r.use === "query");
  const approved = live.filter((r) => r.approved);
  return {
    queries: live.length,
    approvedQueries: approved.length,
    relevantApproved: approved.filter((r) => isRelevantKeyword(r, vocab)).length,
  };
}

export function formatKeywordCard(
  ctx: KeywordCardContext,
  rows: readonly StoredKeyword[],
  categories: readonly CategorySpec[]
): string[] {
  const live = rows.filter((r) => !r.dropped);
  const queries = live.filter((r) => r.use === "query");
  const hooks = live.filter((r) => r.use === "hook");
  const tally = tallyKeywords(rows, ctx.vocab);
  const approved = tally.approvedQueries > 0;

  const byCategory = categories.map((c) => {
    const n = queries.filter((r) => r.category === c.key).length;
    return `${c.label} ${n}/${c.target}${n < c.target ? " _(short)_" : ""}`;
  });
  const other = queries.filter((r) => r.category === OTHER_CATEGORY).length;
  if (other) byCategory.push(`Other, from the market ${other}`);

  const origins: KeywordOrigin[] = ["harvest", "research", "manual", "measured", "expansion"];
  const byOrigin = origins
    .map((o) => [o, live.filter((r) => r.origin === o).length] as const)
    .filter(([, n]) => n > 0)
    .map(([o, n]) => `${n} ${o}${o === "expansion" ? " (a model's proposal, not evidence)" : ""}`);

  const lines: string[] = [
    `*The ways ${ctx.treatment} is said*, for ${ctx.clientName}.`,
    `Audience: ${ctx.audience}${ctx.audienceConfirmed ? "" : " (proposed from the vertical; confirmed on the concierge step)"}` +
      `${ctx.city ? `. City: ${ctx.city}` : ". Not local, so no city"}.`,
    ctx.terms.length
      ? `Their customers' words for it: ${ctx.terms.join(", ")}.`
      : "No customer terms were captured on the prep call, so relevance rests on the offer's name alone. `terms:` on the prep call step adds them.",
    "",
    `*${queries.length} queries* (the floor is ${KEYWORD_FLOOR}) and *${hooks.length} hooks*. ` +
      (approved
        ? `*Approved:* ${tally.approvedQueries} queries, ${tally.relevantApproved} of them about the offer (the plan needs ${PLAN_KEYWORDS_NEEDED}).`
        : "*Not approved yet.*"),
    `*By category:* ${byCategory.join(" · ")}`,
    `*By origin:* ${byOrigin.join(" · ")}`,
    "",
    `*The top ${Math.min(CARD_TOP, queries.length)} queries.* The number is the one \`keywords drop\` takes; the CSV has every row.`,
  ];

  const top = [...queries].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9)).slice(0, CARD_TOP);
  for (const r of top) {
    const gap = r.currentlyNamed === false ? " :dart:" : r.currentlyNamed === true ? " :white_check_mark:" : "";
    lines.push(
      `${String(r.rank ?? "?").padStart(3, " ")}. ${r.phrase}  _(${categoryLabel(categories, r.category)}, ${r.origin}, ${Math.round(r.score)})_${gap}`
    );
  }

  lines.push(
    "",
    "*In this thread:*",
    "  • `keywords approve` approves the query set as shown.",
    "  • `keywords drop 12` or `keywords drop 12, 15, 40` removes rows by number.",
    "  • `keywords add: <phrase>` adds your own. It ranks like evidence, because you said it.",
    "  • `keywords more <category>` writes more for one category, e.g. `keywords more price`.",
    `  • Measuring is not a command here. The approved queries JOIN the tracked question set, and the visibility audit asks them: at Day 0 for the archived run, then again at day 30, 60 and 90. Roughly $0.03 a question, and the Day 0 card states the count before anything is spent.`,
    "",
    "_Every `expansion` row was proposed by a model. That is not evidence anybody searched it, which is why those rows rank below anything the market or you said. Hooks are kept for ads and emails and never become a page's keyword._"
  );

  return lines;
}
