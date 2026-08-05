// The delivery email's rules, as pure functions.
//
// Every one of these could have been a line in the system prompt, and every one of them is here
// instead. Same precedent as looksLikeTranscript, enforceLinkPolicy, noDashes and marketFactsFor:
// this pipeline's repeated lesson is that a prose guard is not a guard. The delivery email is the
// single most checkable thing SRT sends (it names timestamps in a video the reader has, and
// figures from a report they can open), so a rule that only holds when the model feels like it is
// worse than no rule at all.
//
// Nothing in this file calls a model.

import { DELIVERY_BANNED_PROMISES } from "@/config/pitch";
import type { ReportView } from "./report-view";

// ── Rule 6: the money gap ───────────────────────────────────────────────────

export interface AbsentCompetitor {
  name: string;
  /** Prompts where this name came up AND the client did not. Ceiling is totalPrompts. */
  count: number;
}

/**
 * Competitors counted ONLY in the buyer questions the client is missing from.
 *
 * ‼️ THIS IS NOT `view.mostRecommended`, AND THE TWO MUST NOT BE RECONCILED. That one counts
 * audit_runs ROWS and never looks at whether the client appeared. It is the right number for
 * "who owns the answers", which is why email-assistant.ts renders it as "cited 6x", and it is
 * the WRONG number for the sentence this email is built on. (Before Perplexity was dropped the
 * two also differed in ceiling — 40 rows against 20 prompts. They no longer do, which makes them
 * easier than ever to conflate. Still don't.)
 *
 * "Allied Service Pro came up in 6 of the questions you're missing from" has to survive the
 * prospect opening the report and counting. So: prompt-level, deduped by prompt, and only over
 * prompts where `!appeared`. Branded prompts are excluded because a prompt naming the client is
 * not a question they lost.
 */
export function competitorsWhereAbsent(view: ReportView): AbsentCompetitor[] {
  const counts = new Map<string, { display: string; count: number }>();

  for (const p of view.prompts) {
    if (p.appeared || p.isBranded) continue;
    // `recommended` is already deduped per prompt across both engines by buildReportView, so a
    // name cannot be double-counted within one prompt.
    for (const rec of p.recommended) {
      if (rec.isClient) continue;
      const key = rec.name.trim().toLowerCase();
      if (!key) continue;
      const existing = counts.get(key);
      if (existing) existing.count += 1;
      else counts.set(key, { display: rec.name.trim(), count: 1 });
    }
  }

  return [...counts.values()]
    .map(({ display, count }) => ({ name: display, count }))
    .sort((a, b) => b.count - a.count);
}

// ── Rule 4: promises the audit cannot make ──────────────────────────────────

export interface PromiseHit {
  /** The matched text, as said. */
  phrase: string;
  /** What is wrong with it, for the flag. */
  detail: string;
  /** Nearest preceding timestamp, so the flag can say where in the video it was said. */
  at: string | null;
}

const LINE_STAMP_RE = /(\d{1,2}:\d{2}(?::\d{2})?)/;

/** The last timestamp at or before `index`, so a flag can point at the moment. */
function stampBefore(text: string, index: number): string | null {
  const stamps = [...text.slice(0, index).matchAll(/(\d{1,2}:\d{2}(?::\d{2})?)/g)];
  return stamps.length ? stamps[stamps.length - 1][1] : null;
}

/**
 * Every promise of customers, jobs, leads or revenue in a body of text.
 *
 * Run against the TRANSCRIPT, where a hit is only ever a flag: the video is recorded and already
 * watched, and refusing to write the email does not unsay it. Also run against the DRAFT, where a
 * hit is a rejection, because that one is still fixable.
 */
export function spokenPromises(text: string): PromiseHit[] {
  const hits: PromiseHit[] = [];
  const seen = new Set<string>();

  for (const { pattern, detail } of DELIVERY_BANNED_PROMISES) {
    // The config patterns are not global; clone with /g so every occurrence is found, not just
    // the first. Doing this here keeps the config readable as a list of shapes.
    const re = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, "")}g`);
    for (const m of text.matchAll(re)) {
      const phrase = m[0].trim();
      const key = phrase.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({ phrase, detail, at: stampBefore(text, m.index ?? 0) });
    }
  }
  return hits;
}

// ── Rule 5: every number comes from the report ──────────────────────────────

export interface NumberFacts {
  score: number;
  appeared: number;
  totalPrompts: number;
  /** The leading absent-competitor count, when there is one. */
  competitorCount: number | null;
}

export interface NumberConflict {
  /** What the video said. */
  said: string;
  /** What the report says. */
  actual: string;
  at: string | null;
}

/**
 * Where the recording and the report disagree on a figure.
 *
 * Deliberately narrow: only the three shapes that carry a claim ("N out of 100", "N of 20",
 * "N times"). A transcript is full of incidental numbers (prices, years, square footage) and
 * flagging those would bury the one conflict that matters. A miss here costs a flag; a false
 * positive would train him to ignore the section.
 */
export function numberConflicts(transcript: string, facts: NumberFacts): NumberConflict[] {
  const out: NumberConflict[] = [];

  for (const m of transcript.matchAll(/\b(\d{1,3})\s*(?:out of|\/)\s*100\b/gi)) {
    const said = parseInt(m[1], 10);
    if (said !== facts.score) {
      out.push({ said: `${said} out of 100`, actual: `${facts.score} out of 100`, at: stampBefore(transcript, m.index ?? 0) });
    }
  }

  for (const m of transcript.matchAll(/\b(\d{1,3})\s*(?:out of|of|\/)\s*(\d{1,3})\b/gi)) {
    const said = parseInt(m[1], 10);
    const total = parseInt(m[2], 10);
    if (total !== facts.totalPrompts) continue; // not a claim about the prompt set
    if (said !== facts.appeared) {
      out.push({
        said: `${said} of ${total}`,
        actual: `${facts.appeared} of ${facts.totalPrompts}`,
        at: stampBefore(transcript, m.index ?? 0),
      });
    }
  }

  if (facts.competitorCount !== null) {
    for (const m of transcript.matchAll(/\b(?:came up|comes up|appeared|appears|showed up)\s+(\d{1,3})\s*times?\b/gi)) {
      const said = parseInt(m[1], 10);
      if (said !== facts.competitorCount) {
        out.push({
          said: `came up ${said} times`,
          actual: `came up ${facts.competitorCount} times in the questions they are missing from`,
          at: stampBefore(transcript, m.index ?? 0),
        });
      }
    }
  }

  return out;
}

// ── Rule 3: the timestamps have to exist ────────────────────────────────────

/**
 * Keep a model-chosen timestamp only when it literally appears in the transcript.
 *
 * The model is asked to find the two moments by MEANING (where the score is shown, where the price
 * is covered) rather than by position, because a recording never lands on the beat sheet. That
 * freedom is exactly why the answer has to be checked: a plausible "2:47" that is not in the video
 * sends the prospect to the wrong place, and the entire premise of this email is that it is
 * checkable. Falls back to the nearest real stamp.
 */
export function verifyStamp(picked: string | null | undefined, stamps: string[], fallback: string | null): { stamp: string | null; invented: string | null } {
  const cleaned = (picked ?? "").trim().match(LINE_STAMP_RE)?.[1] ?? null;
  if (cleaned && stamps.includes(cleaned)) return { stamp: cleaned, invented: null };
  return { stamp: fallback, invented: cleaned };
}

// ── Rule 9: the reply phrase he actually used ───────────────────────────────

const REPLY_PHRASE_PATTERNS: RegExp[] = [
  /\breply\s+(?:back\s+)?(?:to\s+(?:the|that|this)\s+email\s+)?(?:with\s+)?["“']?((?:i'?m in|let'?s do it|lets do it|do it|yes|i'?m ready)[^"”'.,\n]*)["”']?/i,
  /\b(?:send|shoot)\s+(?:me\s+)?(?:that|the|an?)\s+email\s+(?:back\s+)?(?:with\s+)?["“']?((?:i'?m in|let'?s do it|lets do it)[^"”'.,\n]*)["”']?/i,
  /\bjust\s+say\s+["“']?((?:i'?m in|let'?s do it|lets do it)[^"”'.,\n]*)["”']?/i,
];

/**
 * Where the phrase ends when he did not put quotes around it.
 *
 * "reply I'm in and I'll send the invoice" is one sentence containing a two-word instruction. The
 * quoted form is bounded by its quotes; the unquoted form runs on into what happens next, and an
 * email telling someone to reply with "I'm in and I will send the link" is nonsense. Cut at the
 * first conjunction or new clause.
 */
const REPLY_TAIL_RE = /\s+(?:and|so|then|or|because|i'?ll|i will|we'?ll|we will|that'?s)\b.*$/i;

/**
 * What he actually told them to reply, or null.
 *
 * Null is a real answer and becomes a bracketed marker plus a flag, never a guess. Two different
 * recordings use "I'm in" and "let's do it", and an email telling them to reply with words the
 * video never said is a small, avoidable, credibility-costing mismatch.
 */
export function replyPhrase(transcript: string): string | null {
  for (const re of REPLY_PHRASE_PATTERNS) {
    const m = transcript.match(re);
    if (m?.[1]) {
      const phrase = m[1].replace(REPLY_TAIL_RE, "").trim().replace(/\s+/g, " ");
      if (phrase) return phrase;
    }
  }
  return null;
}

// ── Rule 2 ──────────────────────────────────────────────────────────────────

export function wordCount(body: string): number {
  return body.trim().split(/\s+/).filter(Boolean).length;
}
