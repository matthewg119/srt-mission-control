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

import { SERP_TRIAGE_RULE } from "./keyword-expansion";
import { normalizePhrase } from "./phrase-quality";
import { AWARENESS_STAGES, awarenessTarget, isAwarenessStage, type AwarenessStage } from "@/lib/audit-engine/awareness";

export { SERP_TRIAGE_RULE };

/** What the page showed. Every field tri-state: null is "could not tell", never "no". */
export interface SerpRead {
  aiOverview: boolean | null;
  aiOverviewAnswers: boolean | null;
  resultShape: ResultShape | null;
  topDomains: string[];
  forumRanks: boolean | null;
  clientRanks: boolean | null;
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

/** What follows from the reading. */
export type Verdict = "post" | "merge" | "service_page" | "unclear";
export const VERDICTS: readonly Verdict[] = ["post", "merge", "service_page", "unclear"];
export function isVerdict(v: unknown): v is Verdict {
  return typeof v === "string" && (VERDICTS as readonly string[]).includes(v);
}

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
}

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
  const ordered = [...rows].sort((a, b) => b.score - a.score || a.rank - b.rank || a.id.localeCompare(b.id));

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
