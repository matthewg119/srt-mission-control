// The keyword strategy, as rules: what a SERP means, which phrases are one subject, and what the
// card says. PURE. No database, no model, no Slack.
//
// ‼️ THE MODEL READS THE SCREEN AND THIS FILE DECIDES WHAT IT MEANS. screenshot-read.ts sets the
// doctrine: "IT TRANSCRIBES. IT DOES NOT IDENTIFY." A vision model asked for a verdict returns a
// verdict, confidently, from a screenshot it half saw. A vision model asked what is on the page
// returns four observable facts, and verdictFrom() turns them into a decision that can be re-derived
// later, argued with, and changed without re-reading anybody's screenshot.
//
// ‼️ THE TRIAGE RULE IS SERP_TRIAGE_RULE IN keyword-expansion.ts AND IS QUOTED, NEVER RESTATED. This
// file is that sentence compiled. A probe asserts the two still agree.

import { AEO_ROUTING_RULE, SERP_TRIAGE_RULE } from "./keyword-expansion";
import { normalizePhrase } from "./phrase-quality";
import { AWARENESS_STAGES, awarenessTarget, isAwarenessStage, type AwarenessStage } from "@/lib/audit-engine/awareness";

export { AEO_ROUTING_RULE, SERP_TRIAGE_RULE };

/** What the page showed. Every field tri-state: null is "could not tell", never "no". */
export interface SerpRead {
  aiOverview: boolean | null;
  aiOverviewAnswers: boolean | null;
  resultShape: ResultShape | null;
  topDomains: string[];
  forumRanks: boolean | null;
  clientRanks: boolean | null;
  /**
   * 0..5, how completely the AI Overview resolved the search on its own.
   *
   * The finer-grained form of aiOverviewAnswers, and what clickValue is mostly computed from. null
   * whenever aiOverview is not true: "how completely does it answer" is meaningless with no box on
   * the screen, the same reason aiOverviewAnswers is nulled in serp-read.ts.
   */
  aiOverviewSatisfies: number | null;
  localPack: boolean | null;
  paaPresent: boolean | null;
  /** Sponsored results above the first organic one. null is "could not tell", 0 is "none". */
  adsAboveFold: number | null;
  /**
   * The "People also ask" questions, as written.
   *
   * ‼️ THE ONE PLACE THIS LANE TAKES WORDS OFF SOMEBODY ELSE'S RESULTS PAGE, AND IT TAKES ONLY
   * SEARCHES. A PAA entry is a query, the same class of object as the phrase being looked at, and
   * queries are what this whole step is made of. It is not a headline, a snippet or a sentence from
   * anybody's page, and there is no field for those. Capped in serp-read.ts, in code.
   */
  paaQuestions: string[];
  /**
   * Which words the results themselves use for this subject: "tox" against "Botox", the unit a price
   * is quoted in. Terms, never a phrase. Shape, not content.
   */
  vocabulary: string[];
  /** One short phrase naming what was on screen. Never a paragraph. */
  evidence: string;
  /** 0..1. Below MIN_LEGIBLE the reading is not trusted whatever it says. */
  confidence: number;
}

export type ResultShape = "articles" | "listings" | "products" | "mixed";
export const RESULT_SHAPES: readonly ResultShape[] = ["articles", "listings", "products", "mixed"];
export function isResultShape(v: unknown): v is ResultShape {
  return typeof v === "string" && (RESULT_SHAPES as readonly string[]).includes(v);
}

/** What follows from the reading. What the SERP IS. */
export type Verdict = "post" | "merge" | "service_page" | "unclear";
export const VERDICTS: readonly Verdict[] = ["post", "merge", "service_page", "unclear"];
export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

/**
 * What we DO about it. A SEPARATE AXIS FROM `Verdict`, and the names say which is which.
 *
 * ‼️ THREE QUESTIONS, THREE VOCABULARIES, AND NO THIRD ONE INVENTED. `Verdict` says what the SERP
 * IS. `Route` says what we do. `RecommendedAsset` says what we build. The brief called this one
 * "verdict" as well, which collided with the stored column of that name; it is named for what it
 * actually answers instead.
 *
 * 'keep'     it earns its own page, in whatever shape the verdict says
 * 'reroute'  nobody will click it, but we can be named in the answer AND there is something to give
 *            away. An answer block on the hub, or a tool page when the giveaway IS the asset.
 * 'skip'     nobody will click it, we could be named, and there is nothing left to hand over. The
 *            case this whole stage exists to catch, and the one every keyword tool throws away.
 * 'drop'     no clicks and no citation value either. Nothing here.
 */
export type Route = "keep" | "reroute" | "skip" | "drop";
export const ROUTES: readonly Route[] = ["keep", "reroute", "skip", "drop"];
export function isRoute(v: unknown): v is Route {
  return typeof v === "string" && (ROUTES as readonly string[]).includes(v);
}

/** What we BUILD. */
export type RecommendedAsset =
  | "service_page"
  | "answer_block"
  | "pillar"
  | "cluster_post"
  | "tool_page"
  | "gbp_offsite"
  | "none";
export const RECOMMENDED_ASSETS: readonly RecommendedAsset[] = [
  "service_page",
  "answer_block",
  "pillar",
  "cluster_post",
  "tool_page",
  "gbp_offsite",
  "none",
];
export function isRecommendedAsset(v: unknown): v is RecommendedAsset {
  return typeof v === "string" && (RECOMMENDED_ASSETS as readonly string[]).includes(v);
}

export type DominantIntent = "informational" | "commercial" | "transactional" | "local" | "tool";
export const DOMINANT_INTENTS: readonly DominantIntent[] = [
  "informational",
  "commercial",
  "transactional",
  "local",
  "tool",
];

export type DominantPageType = "blog" | "service_page" | "price_page" | "booking" | "directory" | "tool";
export const DOMINANT_PAGE_TYPES: readonly DominantPageType[] = [
  "blog",
  "service_page",
  "price_page",
  "booking",
  "directory",
  "tool",
];

/**
 * How legible a screenshot has to be before its reading is used.
 *
 * ‼️ THE SAME ARGUMENT screenshot-read.ts MAKES. A model that squinted at a compressed screenshot
 * still returns well-formed JSON, and well-formed JSON from a guess is indistinguishable from a
 * reading unless something refuses it. Below this the verdict is `unclear` whatever the fields say.
 */
export const MIN_LEGIBLE = 0.5;

/**
 * The triage rule, as code.
 *
 * ‼️ A NULL READING IS `unclear`, NEVER `post`. This is the whole reason the fields are tri-state.
 * `post` is the busiest outcome, so defaulting to it means every unreadable screenshot silently
 * becomes a page nobody checked, and the failure is invisible: the plan looks complete. The same
 * doctrine as client_keywords.currently_named, whose own comment says null means no engine was
 * asked, which is not the same as not named.
 *
 * Order matters. The AI Overview test runs FIRST because the rule's own first sentence does: a
 * phrase Google already answers in full is a merge even when articles rank under it, because those
 * articles are below an answer the searcher has already read.
 */
export function verdictFrom(read: Pick<SerpRead, "aiOverview" | "aiOverviewAnswers" | "resultShape" | "confidence">): Verdict {
  if (typeof read.confidence === "number" && read.confidence < MIN_LEGIBLE) return "unclear";

  // "If the AI Overview fully answers it, merge that keyword into a bigger post."
  if (read.aiOverviewAnswers === true) return "merge";

  // "If the page is all local listings or software products, make a service page instead of a post."
  if (read.resultShape === "listings" || read.resultShape === "products") return "service_page";

  if (read.resultShape === "articles") {
    // An AI Overview that did NOT fully answer it still leaves a post worth writing. An AI Overview
    // we could not judge does not, because the one thing that would change the answer is unknown.
    return read.aiOverviewAnswers === null && read.aiOverview === true ? "unclear" : "post";
  }

  // 'mixed' and null both mean the shape did not decide. Neither is a post by default.
  return "unclear";
}

/** What the verdict means, in words, for the card. */
export function verdictLine(v: Verdict): string {
  switch (v) {
    case "post":
      return "Articles rank, so this is a post worth writing.";
    case "merge":
      return "The AI Overview answers it in full, so it belongs under a bigger post.";
    case "service_page":
      return "The first screen is listings or software, so this is a service page, not a post.";
    case "unclear":
      return "The read could not decide. Check it again, or say so with `keywords serp N: post`.";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// The two scores, and the route
//
// ‼️ THE CHANGE THAT MATTERS MOST IS HERE, AND IT IS ONE SCORE BECOMING TWO. The standard advice is
// to drop a keyword the AI Overview answers in full, because nobody clicks it. That is correct for a
// site that earns from ad impressions and WRONG for an agency selling appointments: if an engine
// names the clinic while answering "how long does Botox last", that is the product working. The
// query a publisher drops is the query we most want to own.
//
// So a reading carries a click score AND a citation score, and neither one decides alone. What
// decides the no-click ones is whether anything is left to trade for an email.
//
// ‼️ PURE FUNCTIONS OF THE READ, WHICH IS WHY THEY CAN BE ARGUED WITH. A stored reading can be
// re-scored months later without re-reading anybody's screenshot, the way
// scripts/_rescore-optimization.ts already re-scores the scraper. A model returning "click value 4"
// would be a number nobody could re-derive.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The line between low and high, on all three scores.
 *
 * ‼️ UNPROVEN. It decides what gets skipped, and it is a guess until it has been run against a real
 * client's shortlist. One constant so there is one thing to change, rather than a 3 sprinkled
 * through routeFrom where nobody would find all of them.
 */
export const SCORE_FLOOR = 3;

/**
 * Will a human land on the page?
 *
 * Reads down from 5. An AI Overview that resolves the search is the biggest deduction there is, and
 * a local pack or a wall of ads takes the rest: both push the first organic result off the screen.
 */
export function clickValueFrom(
  read: Pick<SerpRead, "aiOverview" | "aiOverviewSatisfies" | "aiOverviewAnswers" | "resultShape" | "localPack" | "adsAboveFold">
): number {
  let score = 5;

  // The AI Overview, at whatever resolution we have it. aiOverviewSatisfies is the finer reading;
  // aiOverviewAnswers is the coarse one an older row or a typed verdict carries.
  if (typeof read.aiOverviewSatisfies === "number") {
    score -= read.aiOverviewSatisfies;
  } else if (read.aiOverviewAnswers === true) {
    score -= 4;
  } else if (read.aiOverview === true) {
    score -= 1;
  }

  // A map pack owns the top of a local search, and the organic results sit under it.
  if (read.localPack === true) score -= 1;
  // Three or more sponsored results above the first organic one is a page somebody paid to own.
  if (typeof read.adsAboveFold === "number" && read.adsAboveFold >= 3) score -= 1;

  // Products and listings are not read, they are chosen between, so a written page competes badly.
  if (read.resultShape === "products") score -= 1;

  return clamp05(score);
}

/**
 * Can the client get NAMED in the AI answer for this?
 *
 * Reads up from 1, and the AI Overview is evidence FOR rather than against: a query Google chose to
 * answer with a generated summary is a query the engines are already answering, which is the surface
 * this product sells. The mirror image of clickValueFrom, on purpose.
 *
 * ‼️ IT DOES NOT ASK WHETHER THE CLIENT IS CURRENTLY NAMED, AND MUST NOT. That is a measurement, it
 * belongs to the visibility audit, and applyMeasurement in client-keywords.ts already writes it onto
 * the keyword. Asking a second lane the same question is how two numbers about one fact start
 * disagreeing. This scores the OPPORTUNITY: is there an answer here to be named in.
 */
export function citationValueFrom(
  read: Pick<SerpRead, "aiOverview" | "aiOverviewSatisfies" | "aiOverviewAnswers" | "resultShape" | "localPack" | "paaPresent" | "forumRanks">
): number {
  let score = 1;

  if (read.aiOverview === true) score += 2;
  if (typeof read.aiOverviewSatisfies === "number" && read.aiOverviewSatisfies >= 4) score += 1;
  else if (read.aiOverviewAnswers === true) score += 1;

  // "People also ask" is Google publishing the question set for this subject. Every one of those is
  // a place an answer block can sit.
  if (read.paaPresent === true) score += 1;

  // A forum ranking is the strongest citation signal on the page: the engines are reaching for
  // somebody's lived answer because no business wrote a good one. That gap is the opening.
  if (read.forumRanks === true) score += 1;

  // A local pack means the engines are answering "who near me", which is the naming question itself.
  if (read.localPack === true) score += 1;

  return clamp05(score);
}

/** What the first screen is really asking for. */
export function intentFrom(
  read: Pick<SerpRead, "resultShape" | "localPack">
): DominantIntent | null {
  if (read.localPack === true) return "local";
  if (read.resultShape === "listings") return "local";
  if (read.resultShape === "products") return "tool";
  if (read.resultShape === "articles") return "informational";
  return null;
}

/** What kind of page is winning it. */
export function pageTypeFrom(read: Pick<SerpRead, "resultShape" | "localPack">): DominantPageType | null {
  if (read.resultShape === "listings") return "directory";
  if (read.resultShape === "products") return "tool";
  if (read.resultShape === "articles") return "blog";
  if (read.localPack === true) return "directory";
  return null;
}

function clamp05(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, Math.round(n)));
}

/**
 * THE ROUTING TABLE. What the two scores and the magnet test decide, together.
 *
 * ‼️ LOW CLICK PLUS HIGH CITATION IS NEVER A DROP, AND THAT IS THE WHOLE POINT. It is REROUTED to an
 * answer block when there is somewhere left to put a lead magnet, and SKIPPED when there is not.
 * Dropping it on the click score alone is the mistake every keyword tool makes.
 *
 * ‼️ AND CITATION VALUE ON ITS OWN DOES NOT SAVE A KEYWORD. Matthew amended his own rule to add this
 * on 2026-09-23: if the AI Overview hands over the entire answer and there is no idea and no space
 * for a magnet, the keyword is skipped. What saves it is having something left to hand over.
 *
 * ‼️ AN UNKNOWN MAGNET SPACE IS NOT A SKIP. null means the judgement never ran, which is a different
 * fact from "there is nothing here", and routing an outage to the same outcome as a decision is how
 * a failed model call quietly deletes work. It returns `skip` with a reason that asks for the magnet
 * rather than claiming one was looked for, and the card prints that reason.
 */
export function routeFrom(s: {
  verdict: Verdict;
  clickValue: number | null;
  citationValue: number | null;
  magnetSpace: number | null;
  magnetIdea: string | null;
  magnetBy: "model" | "person" | null;
}): { route: Route; asset: RecommendedAsset; why: string } {
  // An unreadable SERP decides nothing. It is the deadlock case, and the card says so out loud.
  if (s.verdict === "unclear") {
    return { route: "skip", asset: "none", why: "The picture did not read, so nothing has been decided yet." };
  }

  const click = s.clickValue ?? 0;
  const cite = s.citationValue ?? 0;

  // A page worth writing is a page worth writing. The verdict picks its shape.
  if (click >= SCORE_FLOOR) {
    if (s.verdict === "service_page") {
      return { route: "keep", asset: "service_page", why: "The first screen is listings or software, and people still click it." };
    }
    return {
      route: "keep",
      asset: s.verdict === "merge" ? "cluster_post" : "pillar",
      why: "People click these results, so this earns a page of its own.",
    };
  }

  // Below the click floor, the citation score decides whether there is anything here at all.
  if (cite < SCORE_FLOOR) {
    return { route: "drop", asset: "none", why: "Nobody clicks it and there is no answer here to be named in." };
  }

  // Low click, high citation. The magnet test is now the whole decision.
  if (s.magnetSpace === null && !s.magnetIdea) {
    return {
      route: "skip",
      asset: "none",
      why:
        s.magnetBy === null
          ? "Nobody will click it but we could be named. The magnet check has not run, so type `magnet N:` or skip it."
          : "Nobody will click it but we could be named, and no magnet has been named yet.",
    };
  }

  const space = s.magnetSpace ?? 0;
  if (space < SCORE_FLOOR || !s.magnetIdea) {
    return {
      route: "skip",
      asset: "none",
      why: "The answer is given away in full and there is nothing left to hand over, so there is no business left in it.",
    };
  }

  // ‼️ THE CASE THIS STAGE EXISTS TO CATCH. A magnet worth 5 is not a section inside a post, it is
  // the thing somebody searched for: a script, a checklist, a calculator. That gets its own page.
  if (space >= 5) {
    return { route: "reroute", asset: "tool_page", why: "The giveaway IS what they are searching for, so it is a tool page rather than a post." };
  }

  return {
    route: "reroute",
    asset: "answer_block",
    why: "Nobody will click it, but we can be named in the answer and there is a magnet to trade for the email.",
  };
}

/** What a route means, in words, for the card. */
export function routeLine(route: Route, asset: RecommendedAsset): string {
  switch (route) {
    case "keep":
      return asset === "service_page" ? "service page" : asset === "cluster_post" ? "post under a pillar" : "pillar page";
    case "reroute":
      return asset === "tool_page" ? "tool page" : "answer block on the hub";
    case "skip":
      return "SKIP";
    case "drop":
      return "drop";
  }
}

/**
 * A typed verdict outranks a vision one of the same age.
 *
 * ‼️ A PERSON IS NOT A LEGIBILITY SCORE. Somebody who looked at the page and typed the answer has
 * read something no screenshot captured: the rest of the scroll, the ads, what the page felt like.
 * Ranking the two by recency alone would let a re-run of the vision pass quietly overwrite a
 * correction a human made ten minutes earlier, which is how people stop correcting things.
 */
export function bestVerdict<T extends { source: "vision" | "typed"; createdAt: string; verdict: Verdict }>(
  rows: readonly T[]
): T | null {
  if (!rows.length) return null;
  const typed = rows.filter((r) => r.source === "typed");
  const pool = typed.length ? typed : rows;
  return [...pool].sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

/**
 * IS THE PICTURE ON FILE? The predicate the whole gate rests on.
 *
 * ‼️ A DIFFERENT QUESTION FROM bestVerdict, AND THAT IS THE RECONCILIATION. Matthew asked which of
 * the two rules should give way: bestVerdict ranks a typed verdict ABOVE a vision one, and the gate
 * says a screenshot is required. Neither gives way, because they answer different questions.
 *
 *   bestVerdict  "which reading do I TRUST?"      A person who looked at the page beats a model
 *                                                 that half saw it. Unchanged, and now finally
 *                                                 wired: it had no production caller at all.
 *   pictured     "is the PICTURE on file?"        A person asserting a conclusion is not a person's
 *                                                 screenshot. A typed verdict routes a keyword and
 *                                                 never unblocks it.
 *
 * So a cluster whose keywords are typed-only cannot be approved, and the card shows that as its own
 * state rather than as "unchecked".
 *
 * ‼️ BOTH HALVES ARE LOAD BEARING. `source === "vision"` without `docId` is a screenshot that was
 * read and then lost, which is not evidence anybody can go back and look at, and that is the entire
 * point of the gate: not that a model saw a picture, but that the picture is still there.
 */
export function pictured(reads: readonly { source: "vision" | "typed"; docId: string | null }[]): boolean {
  return reads.some((r) => r.source === "vision" && r.docId !== null);
}

/**
 * One stored reading, as the loader hands it around.
 *
 * Structurally what bestVerdict and pictured each want, so both can take the same list and neither
 * needs the database. Declared here rather than in keyword-strategy.ts so the probe can build one
 * without a Supabase client.
 */
export interface SerpReadRow {
  source: "vision" | "typed";
  createdAt: string;
  verdict: Verdict;
  docId: string | null;
  evidence: string | null;
  clickValue: number | null;
  citationValue: number | null;
  route: Route | null;
  recommendedAsset: RecommendedAsset | null;
  magnetSpace: number | null;
  magnetIdea: string | null;
  magnetBy: "model" | "person" | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// The shortlist
// ─────────────────────────────────────────────────────────────────────────────

/** How many finalists get a SERP check. Matthew's number, 2026-09-23: "the ~25 finalists only". */
export const SHORTLIST_SIZE = 25;

/** At most this many finalists from one category, so one bucket cannot take the whole list. */
export const SHORTLIST_PER_CATEGORY = 4;

export interface Finalist {
  id: string;
  phrase: string;
  normalized: string;
  category: string;
  score: number;
  rank: number;
  awarenessStage: AwarenessStage | null;
  verdict: Verdict | null;
  intent: "post" | "service_page" | "merged" | null;
  mergedInto: string | null;

  // ── What the latest reading said, for the card and the gate ──────────────
  //
  // ‼️ `pictured` IS READ BY THE GATE AND NOT BY clusterFinalists, DELIBERATELY. Clustering is about
  // SUBJECTS: which phrases are one question. Whether the evidence is on file is a different
  // question, asked at the three write points, and mixing them would mean a missing screenshot
  // silently re-shaped the strategy instead of visibly blocking it.
  pictured: boolean;
  route: Route | null;
  clickValue: number | null;
  citationValue: number | null;
  magnetSpace: number | null;
  magnetIdea: string | null;
  magnetBy: "model" | "person" | null;
  recommendedAsset: RecommendedAsset | null;
  /** The reader's own words about what it saw, so a block can say WHY it is blocked. */
  readEvidence: string | null;
  /** The screenshot, for the contact sheet. Null when the only reading was typed. */
  docId: string | null;
  /** The Slack file id of that screenshot, so the card can show the picture you already posted. */
  slackFileId: string | null;
}

/**
 * Would a person type this into Google?
 *
 * ‼️ keywordFault() DOES NOT ANSWER THIS, AND I CHECKED. Run against SRT's 376 approved queries it
 * keeps every one of these: "If a client can book without commitment, your schedule is at risk.",
 * "Get a Free Audit Book a Strategy Call Ready to grow your practice?", "How much does this cost?".
 * That function was built to catch EXTRACTION DEBRIS (urls, citation markers, markup, nav chrome) and
 * it is right about all of those. A grammatical English sentence is not debris; it is simply not a
 * search, and nothing had ever needed to tell the difference before something started spending a
 * screenshot on each one.
 *
 * Three tests, each one a shape rather than a judgement:
 *
 *  1. IT ENDS IN A FULL STOP. Nobody types a sentence-final period into a search box. A question mark
 *     is fine, because people do type questions.
 *  2. ITS QUOTE MARKS DO NOT BALANCE. That is an extraction that took half of somebody's quotation.
 *  3. IT POINTS AT SOMETHING IT DOES NOT NAME. "How much does this cost?" and "What is included in
 *     the appointment?" are real questions a buyer asks out loud, and they belong in question_bank,
 *     which is where they came from. As a SEARCH they name nothing: the subject is in the room, not
 *     in the phrase, so the page would be aimed at "this".
 *
 * ‼️ IT FILTERS THE SHORTLIST, NOT THE KEYWORD SET. Those rows stay approved and stay in the set:
 * they are the buying questions the concierge and the page angles are built from, and dropping them
 * would break lanes that legitimately want them. The only thing this decides is which phrases are
 * worth a SERP check, because googling "how much does this cost" tells nobody anything.
 */
export function searchable(phrase: string): boolean {
  const p = phrase.trim();
  if (!p) return false;

  // 1. A statement, not a search.
  if (/[.](\s|$)/.test(p.slice(-2))) return false;

  // 2. Half a quotation.
  const straight = (p.match(/"/g) ?? []).length;
  const curlyOpen = (p.match(/[“‘]/g) ?? []).length;
  const curlyClose = (p.match(/[”’]/g) ?? []).length;
  if (straight % 2 !== 0) return false;
  // An apostrophe is a closing curly quote too, so only an unmatched OPENING one is a fault.
  if (curlyOpen > curlyClose) return false;

  // 3. It points at something it does not name.
  return !POINTS_AT_NOTHING.test(p);
}

/**
 * Deictics: words that stand in for a subject the phrase never gives.
 *
 * ‼️ ANCHORED TO THE WHOLE PHRASE, NOT A BARE WORD MATCH. "this" appears legitimately inside plenty
 * of real searches ("is this covered by insurance" is one somebody types). What makes a phrase
 * unsearchable is that the deictic is the ONLY subject in it, which in practice is the shapes below:
 * a question whose object is "this", "it", "they", or a bare definite noun with no qualifier.
 */
const POINTS_AT_NOTHING =
  /^(how much|how long|how many|what|when|where|why|who|which|is|are|does|do|can|will)\b[^?]*\b(this|that|these|those|it|they|them|my front desk|the(\s+\w+)?\s+(appointment|process|service|package|session))\b/i;

/**
 * The ~25 subjects worth googling, from the approved query set.
 *
 * ‼️ SUBJECTS, NOT PHRASES, WHICH IS WHY IT DEDUPES BEFORE IT CAPS. SRT approves 376 queries and
 * dozens of them are one subject said five ways. Screenshotting all five wastes four screenshots and
 * produces four readings of the same page. Two phrases whose content words are a subset of each
 * other's are one subject, and the higher-scoring one represents it.
 *
 * ‼️ PURE AND DETERMINISTIC. The same rows give the same shortlist twice, which is what lets the
 * card's numbers be typed at: `keywords serp 12` has to mean the same row tomorrow.
 */
export function shortlistOf(rows: readonly Finalist[]): Finalist[] {
  // ‼️ UNSEARCHABLE ROWS ARE DROPPED BEFORE THE CAP, NOT AFTER. Filtering afterwards would spend
  // slots on sentences and hand back a list of eighteen when twenty-five were asked for.
  const ordered = [...rows]
    .filter((r) => searchable(r.phrase))
    .sort((a, b) => b.score - a.score || a.rank - b.rank || a.id.localeCompare(b.id));

  const kept: Finalist[] = [];
  const perCategory = new Map<string, number>();

  for (const row of ordered) {
    if (kept.some((k) => sameSubject(k.normalized, row.normalized))) continue;
    const n = perCategory.get(row.category) ?? 0;
    if (n >= SHORTLIST_PER_CATEGORY) continue;
    kept.push(row);
    perCategory.set(row.category, n + 1);
    if (kept.length >= SHORTLIST_SIZE) break;
  }

  return kept;
}

/**
 * Two phrases are one subject when one's content words contain the other's.
 *
 * ‼️ CONTAINMENT, NOT SIMILARITY, AND NOT SYNONYMY. "botox cost" and "how much does botox cost" are
 * one subject; "botox cost" and "botox aftercare" are not, and no amount of overlap scoring makes
 * that call safely. Synonymy is a judgement a person or an approved keyword row makes, never a
 * string comparison: sales-letter.ts records the same refusal, that "stemming, synonyms or word
 * order would be a claim that two different sentences are the same".
 */
export function sameSubject(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (!wa.length || !wb.length) return false;
  const [small, large] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  return small.every((w) => large.includes(w));
}

const NOISE = new Set([
  "the", "a", "an", "of", "in", "on", "at", "to", "for", "and", "or", "is", "it", "my", "me", "i",
  "how", "what", "why", "when", "where", "which", "who", "does", "do", "did", "much", "many", "near",
  "best", "get", "you", "your", "with", "be", "am", "are", "can",
]);

function contentWords(phrase: string): string[] {
  return normalizePhrase(phrase)
    .split(" ")
    .filter((w) => w.length > 1 && !NOISE.has(w));
}

// ─────────────────────────────────────────────────────────────────────────────
// The clusters
// ─────────────────────────────────────────────────────────────────────────────

export interface ProposedCluster {
  label: string;
  pillarId: string;
  memberIds: string[];
  awarenessEntry: AwarenessStage | null;
  awarenessTarget: AwarenessStage | null;
  pageKind: "post" | "service_page";
  rationale: string;
}

/**
 * Group the checked finalists into umbrellas.
 *
 * ‼️ THE VERDICT DOES THE GROUPING, NOT A MODEL. A `merge` verdict means "this belongs under a
 * bigger post", and the bigger post is the highest-scoring checked subject that shares content words
 * with it. A `service_page` verdict is always its own cluster, because a service page is not a post
 * and folding one under a post would produce a page that is neither.
 *
 * ‼️ AN UNCHECKED FINALIST IS NOT PLACED. It is returned by unplaced() and printed on the card as
 * still needing a look. Placing it on a guess is how a plan comes to contain pages nobody chose.
 */
export function clusterFinalists(rows: readonly Finalist[]): { clusters: ProposedCluster[]; unplaced: Finalist[] } {
  const checked = rows.filter((r) => r.verdict && r.verdict !== "unclear");
  const unplaced = rows.filter((r) => !r.verdict || r.verdict === "unclear");

  const ordered = [...checked].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const clusters: ProposedCluster[] = [];
  const taken = new Set<string>();

  for (const row of ordered) {
    if (taken.has(row.id)) continue;
    if (row.verdict === "merge") continue; // placed under a pillar below, never a pillar itself

    taken.add(row.id);
    const members: Finalist[] = [];
    if (row.verdict !== "service_page") {
      for (const other of ordered) {
        if (taken.has(other.id) || other.verdict !== "merge") continue;
        if (!sameSubject(row.normalized, other.normalized)) continue;
        taken.add(other.id);
        members.push(other);
      }
    }

    const entry = row.awarenessStage;
    clusters.push({
      label: row.phrase,
      pillarId: row.id,
      memberIds: members.map((m) => m.id),
      awarenessEntry: entry,
      awarenessTarget: entry && isAwarenessStage(entry) ? awarenessTarget(entry) : null,
      pageKind: row.verdict === "service_page" ? "service_page" : "post",
      rationale: verdictLine(row.verdict as Verdict),
    });
  }

  // A `merge` row that matched no pillar is a real finding, not a rounding error: it says the bigger
  // post it belongs under was never shortlisted. It goes back on the unplaced list so somebody sees.
  const orphanMerges = ordered.filter((r) => r.verdict === "merge" && !taken.has(r.id));

  return { clusters, unplaced: [...unplaced, ...orphanMerges] };
}

/** Why one keyword is not usable yet. Three states, because they send a person three places. */
export type BlockReason = "no_reading" | "typed_only" | "unreadable";

export interface ClusterGate {
  cluster: ProposedCluster;
  /** Keyword ids with a screenshot on file. */
  ready: string[];
  /** Keyword ids without one, and why each. */
  blocked: Array<{ id: string; phrase: string; reason: BlockReason }>;
  /** A cluster whose PILLAR has no picture cannot be written at all, never mind approved. */
  pillarBlocked: boolean;
}

/**
 * Which clusters may be written, and exactly which keywords are holding the rest up.
 *
 * ‼️ PURE, SO THE REFUSAL AND THE CARD CANNOT DISAGREE. The gate refuses using this and the contact
 * sheet is drawn from this, so the list of names in the refusal is the same list of rows with a
 * question mark beside them. Two implementations of "what is missing" would drift within a week and
 * the drift would look like the gate being flaky.
 *
 * ‼️ THREE BLOCK REASONS AND NOT ONE, because "nobody has looked at this yet", "somebody typed the
 * answer without posting the picture" and "a picture was posted and could not be read" send a person
 * to three different actions. Collapsing them into "missing" is how a gate becomes something nobody
 * can act on: the same argument page-gate.ts makes for never_run against stale against blocked.
 */
export function gateClusters(
  clusters: readonly ProposedCluster[],
  byId: ReadonlyMap<string, Finalist>
): ClusterGate[] {
  return clusters.map((cluster) => {
    const ids = [cluster.pillarId, ...cluster.memberIds];
    const ready: string[] = [];
    const blocked: ClusterGate["blocked"] = [];

    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      if (row.pictured) {
        ready.push(id);
        continue;
      }
      blocked.push({ id, phrase: row.phrase, reason: blockReason(row) });
    }

    return {
      cluster,
      ready,
      blocked,
      pillarBlocked: blocked.some((b) => b.id === cluster.pillarId),
    };
  });
}

function blockReason(row: Finalist): BlockReason {
  // A picture WAS posted and the read failed. recordSerpScreenshot stores that row precisely so this
  // case is distinguishable from "nobody looked", which is the deadlock the gate would otherwise
  // create: one blurry screenshot becoming a permanent block with no visible cause.
  if (row.docId) return "unreadable";
  if (row.verdict) return "typed_only";
  return "no_reading";
}

/** What each block reason means, and what to do about it. The card prints these verbatim. */
export function blockLine(reason: BlockReason): string {
  switch (reason) {
    case "no_reading":
      return "no picture yet";
    case "typed_only":
      return "typed, no picture on file";
    case "unreadable":
      return "the picture did not read, shoot it again";
  }
}

/** The awareness rung, in the words AWARENESS_STAGES uses, so there is no second vocabulary. */
export function stageName(stage: AwarenessStage | null): string {
  if (!stage) return "unknown";
  return AWARENESS_STAGES.find((s) => s.stage === stage)?.name ?? "unknown";
}

// ─────────────────────────────────────────────────────────────────────────────
// The grammar
//
// ‼️ NAMESPACED UNDER `strategy`, AND THAT IS NOT COSMETIC. `pillar:` and `supports` already exist as
// step 21 verbs in anchor-ladder.ts, and a bare `pillar 4` typed in step 12's thread would be a
// command the wrong step owns. One prefix removes the ambiguity entirely.
// ─────────────────────────────────────────────────────────────────────────────

export const STRATEGY = /^\s*[`*_]*strategy[`*_]*\s*$/i;
export const STRATEGY_APPROVE = /^\s*[`*_]*strategy\s+approve[`*_]*\s*$/i;
export const STRATEGY_NEW = /^\s*[`*_]*strategy\s+new[`*_]*\s*$/i;
export const STRATEGY_MERGE = /^\s*[`*_]*strategy\s+merge\s+(\d{1,3})\s+under\s+(\d{1,3})[`*_]*\s*$/i;
export const STRATEGY_PILLAR = /^\s*[`*_]*strategy\s+pillar\s+(\d{1,3})[`*_]*\s*$/i;
export const STRATEGY_KIND = /^\s*[`*_]*strategy\s+(service|post)\s+(\d{1,3})[`*_]*\s*$/i;

/** `keywords shortlist`, and the SERP verdict forms. */
export const KEYWORDS_SHORTLIST = /^\s*[`*_]*keywords\s+shortlist[`*_]*\s*$/i;
export const KEYWORDS_SERP = /^\s*[`*_]*keywords\s+serp\s+(\d{1,3})[`*_]*\s*$/i;
export const KEYWORDS_SERP_TYPED =
  /^\s*[`*_]*keywords\s+serp\s+(\d{1,3})\s*:\s*(post|merge|service|service[_ ]page|unclear)[`*_]*\s*$/i;

/** `serp cards`: draw or redraw the contact sheet for every cluster. */
export const SERP_CARDS = /^\s*[`*_]*serp\s+cards[`*_]*\s*$/i;

/**
 * `magnet 7: the front desk script` and `magnet 7: none`.
 *
 * ‼️ `none` IS A DECISION AND NOT AN EMPTY VALUE, which is why it is a word somebody types rather
 * than a field left blank. Under a high ai_overview_satisfies a null magnet routes the keyword to
 * SKIP, so "there is nothing to give away here" has to be sayable OUT LOUD and attributable to a
 * person. A blank means the check never ran, and those are different facts.
 */
export const MAGNET_SET = /^\s*[`*_]*magnet\s+(\d{1,3})\s*:\s*(.{1,200}?)[`*_]*\s*$/i;

export type StrategyCommand =
  | { kind: "show" }
  | { kind: "approve" }
  | { kind: "new" }
  | { kind: "merge"; from: number; under: number }
  | { kind: "pillar"; n: number }
  | { kind: "kind"; n: number; pageKind: "post" | "service_page" };

/** Exact forms only: "the strategy is working" is dictation and must reach the assistant. */
export function parseStrategyCommand(raw: string): StrategyCommand | null {
  const text = raw.trim();
  if (STRATEGY_APPROVE.test(text)) return { kind: "approve" };
  if (STRATEGY_NEW.test(text)) return { kind: "new" };

  const merge = STRATEGY_MERGE.exec(text);
  if (merge) {
    const from = Number(merge[1]);
    const under = Number(merge[2]);
    // A row merged under itself is a typo, never an instruction. Refusing keeps the cycle check
    // in the writer from ever being the thing that catches it.
    return from > 0 && under > 0 && from !== under ? { kind: "merge", from, under } : null;
  }

  const pillar = STRATEGY_PILLAR.exec(text);
  if (pillar) return Number(pillar[1]) > 0 ? { kind: "pillar", n: Number(pillar[1]) } : null;

  const kind = STRATEGY_KIND.exec(text);
  if (kind) {
    const n = Number(kind[2]);
    return n > 0 ? { kind: "kind", n, pageKind: /^service/i.test(kind[1]) ? "service_page" : "post" } : null;
  }

  if (STRATEGY.test(text)) return { kind: "show" };
  return null;
}

/** The typed verdict words, mapped onto the stored ones. */
export function typedVerdict(word: string): Verdict | null {
  const w = word.trim().toLowerCase().replace(/[_\s]+/g, "_");
  if (w === "post") return "post";
  if (w === "merge") return "merge";
  if (w === "service" || w === "service_page") return "service_page";
  if (w === "unclear") return "unclear";
  return null;
}
