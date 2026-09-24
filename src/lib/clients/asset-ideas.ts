// What would we BUILD to win this search?
//
// ‼️ A SEPARATE CALL FROM THE SCREENSHOT READ, for the reason magnet-space.ts is: serp-read.ts
// transcribes and is forbidden from deciding what anything means, so asking it in the same breath
// what we should build would be asking a model that had just been told not to decide, to decide. The
// stored row records asset_ideas_by, so an observation and an opinion can never be mistaken for one
// another later.
//
// ‼️ IT IS A DIFFERENT QUESTION FROM magnet-space.ts, AND THE TWO MUST NOT BE MERGED. That one asks
// "is there anything left to trade for an email address". This one asks "could we build the thing
// that WINS this results page". A front desk script scores high on both. A pricing calculator scores
// high here and low there, because the number it gives away is the whole of what it had. If they
// turn out to be the same number once there is real data, delete one on the evidence rather than
// assuming it now.
//
// ‼️ IT RUNS ONLY WHERE IT CHANGES AN OUTCOME. An explanation has nothing to open, so there is
// nothing to build and a call would buy nothing. shouldAskAssets() is that gate and it is pure, so
// the probe can prove the call is not made on rows where the answer is irrelevant.
//
// ‼️ AN EMPTY LIST UNDER by='model' IS "WE LOOKED AND THERE IS NOTHING", AND A NULL by IS NOT THAT.
// A failed call returns by null, which the card reads as a third state and asks again, rather than
// telling somebody there is nothing worth building because Anthropic was busy for four seconds.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { SCORE_FLOOR, type AnswerShape, type SerpRead, type Verdict } from "./keyword-strategy-rules";
import type { MagnetContext } from "./magnet-space";

/** Haiku. One judgement about one results page, against a magnet list somebody already wrote. */
const MODEL = "claude-haiku-4-5-20251001" as const;

/**
 * What KIND of thing it is, named by what opening it is like.
 *
 * ‼️ EVERY ONE OF THESE IS A THING WITH A DOOR ON IT. There is deliberately no 'guide', no 'article'
 * and no 'post' in this list, because the whole rule this file enforces is that an idea has to name
 * something somebody could OPEN. The absence is the enforcement.
 */
export type AssetKind = "tool" | "template" | "calculator" | "checklist" | "script" | "teardown";
export const ASSET_KINDS: readonly AssetKind[] = [
  "tool",
  "template",
  "calculator",
  "checklist",
  "script",
  "teardown",
];
export function isAssetKind(v: unknown): v is AssetKind {
  return typeof v === "string" && (ASSET_KINDS as readonly string[]).includes(v);
}

export interface AssetIdea {
  kind: AssetKind;
  /** What it would be called on the page. The name of a thing, never a promise or a benefit line. */
  title: string;
  /** One line naming what is on the results page that this beats. For the person deciding. */
  why: string;
}

export interface AssetIdeasRead {
  ideas: AssetIdea[];
  /**
   * 'model' when the call answered, EVEN WITH AN EMPTY LIST: that is "we looked and there is
   * nothing". null means it never ran or it failed, which is a different fact.
   */
  by: "model" | null;
}

/** Three is what fits on a card somebody reads in a thread of twenty-five of them. */
export const MAX_ASSET_IDEAS = 3;

const FAILED: AssetIdeasRead = { ideas: [], by: null };

/**
 * Is this a row where three buildable ideas change what anybody does?
 *
 * ‼️ PURE, AND THE PROBE PINS IT, the same way shouldAskMagnet is pinned. A fact is an explanation:
 * there is no thing on the screen, so there is no thing to build a better version of, and calling a
 * model on all twenty-five would cost four times as much to learn nothing about most of them.
 *
 * A null shape is excluded for a different reason from a fact: nobody has looked yet. Spending a call
 * on an unreadable screenshot would produce three ideas about a page nobody has seen.
 */
export function shouldAskAssets(s: {
  verdict: Verdict;
  answerShape: AnswerShape | null;
  assetFit: number;
}): boolean {
  // Nothing has been decided about this page at all; the card is already asking for a better picture.
  if (s.verdict === "unclear") return false;
  // Nothing legible, so nothing to build FROM. Not the same as "there is nothing here".
  if (s.answerShape === null) return false;
  // An explanation is not a deliverable, which is the whole rule this lane was built on.
  if (s.answerShape === "fact") return false;
  return s.assetFit >= SCORE_FLOOR;
}

export async function readAssetIdeas(args: {
  phrase: string;
  read: SerpRead;
  shape: AnswerShape;
  fit: number;
  ctx: MagnetContext;
}): Promise<AssetIdeasRead> {
  const { phrase, read, shape, fit, ctx } = args;

  // What the SERP showed, in the reader's own vocabulary. Facts in, judgement out.
  const facts = [
    read.hasScript === true ? "There are words on the screen somebody is meant to say or send." : "",
    read.hasSteps === true ? "There is an ordered list of things to do." : "",
    read.hasChecklist === true ? "There is a checklist, a form or something printable." : "",
    read.videosRank === true ? "Videos rank for it." : "",
    read.aiOverview === true ? "There is an AI Overview on the page." : "There is no AI Overview.",
    read.aiOverviewSatisfies !== null
      ? `It resolves the search about ${read.aiOverviewSatisfies} out of 5.`
      : "",
    read.resultShape ? `The first screen is mostly ${read.resultShape}.` : "",
    read.forumRanks === true ? "A forum ranks on the first screen." : "",
    read.paaQuestions.length ? `People also ask: ${read.paaQuestions.join(" | ")}` : "",
    read.vocabulary.length ? `Words the results use: ${read.vocabulary.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { data } = await callClaudeJSON<{ ideas: unknown }>({
      model: MODEL,
      system: [
        `You are helping ${ctx.clientName} decide what to BUILD for one search.`,
        ctx.avatar ? `The person searching is: ${ctx.avatar}.` : "",
        ctx.offerName ? `What ${ctx.clientName} sells: ${ctx.offerName}.` : "",
        ctx.outcome ? `The outcome promised: ${ctx.outcome}.` : "",
        ctx.existingMagnets.length
          ? `Things already built: ${ctx.existingMagnets.join(" | ")}. Prefer one of these where it genuinely fits. A fifth thing nobody asked for is worse than reusing the right one.`
          : "",
        "",
        `THE SITUATION. This search has a DELIVERABLE on its results page, not just an explanation: ${shape === "mixed" ? "partly, alongside something else being asked" : "clearly"}. That is why you are being asked at all. Google is already handing people a thin version of the thing. The job is to name the better version.`,
        "",
        `Give up to ${MAX_ASSET_IDEAS} ideas.`,
        "",
        "‼️ EVERY IDEA MUST NAME A THING SOMEBODY COULD OPEN. A file, a page, a tool, a form, a printable, a set of words to say.",
        "  REFUSED:  'a guide to asking for reviews'. That is an article about a subject.",
        "  ACCEPTED: 'a live AI front desk trainer that scores your ask'. That is a thing with a door on it.",
        "  REFUSED:  'tips for getting more reviews'. ACCEPTED: 'the 20 minute post visit text, three versions'.",
        "If you cannot name the thing, give fewer ideas. Two real ones beat three with a guide in the middle, and none at all is a fine answer.",
        "",
        `kind is one of: ${ASSET_KINDS.join(", ")}. Pick the one that says what opening it is like. There is no 'guide' and no 'article' on that list on purpose.`,
        "title: what it would be called on the page. Not a sentence, not a promise, not a benefit line.",
        "why: one short line naming what is on the results page that this beats.",
        "",
        "‼️ Never use an em dash, an en dash or a double hyphen anywhere in your answer.",
      ]
        .filter(Boolean)
        .join("\n"),
      user: [
        `The search: "${phrase}"`,
        `How much of a thing is already visible on the page: ${fit} out of 5.`,
        "",
        "What is on the results page for it:",
        facts || "Nothing was legible.",
        "",
        "What would we build?",
      ].join("\n"),
      maxTokens: 600,
      temperature: 0,
      schemaHint: '{ "ideas": [ { "kind": string, "title": string, "why": string } ] }',
    });

    const raw = camelizeKeys(data) as { ideas?: unknown };
    const rows = Array.isArray(raw.ideas) ? raw.ideas : [];

    const out: AssetIdea[] = [];
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const rec = row as Record<string, unknown>;
      if (!isAssetKind(rec.kind)) continue;

      const title = cleanLine(rec.title, 90);
      const why = cleanLine(rec.why, 160);
      // ‼️ A ROW MISSING EITHER IS DROPPED WHOLE, never half stored. A titled idea with no reason is
      // something nobody can argue with, and a reason with no title is not an idea at all.
      if (!title || !why) continue;

      if (out.some((existing) => existing.title.toLowerCase() === title.toLowerCase())) continue;
      out.push({ kind: rec.kind, title, why });
      // The cap is in code and not only in the prompt, for the reason serp-read.ts writes down: a
      // prompt is a request and a cap is a guarantee.
      if (out.length >= MAX_ASSET_IDEAS) break;
    }

    // ‼️ by: "model" EVEN WHEN out IS EMPTY. The call answered and the answer was "nothing worth
    // building", which is a real finding and reads differently on the card from a call that failed.
    return { ideas: out, by: "model" };
  } catch (e) {
    console.error("[clients/asset-ideas] read failed:", (e as Error).message);
    return FAILED;
  }
}

/**
 * One line, trimmed, or null.
 *
 * ‼️ A BANNED DASH IS DROPPED RATHER THAN REWRITTEN, exactly as magnet-space.ts drops one. This text
 * goes onto a card and from there into a page brief, the house rule has no exceptions, and a silent
 * repair would let a model keep writing them.
 */
function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  if (!s || /^(null|none|n\/a)$/i.test(s)) return null;
  if (hasBannedDash(s)) return null;
  return s.slice(0, max);
}
