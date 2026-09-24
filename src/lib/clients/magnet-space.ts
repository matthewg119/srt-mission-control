// Is there anything left to give away on this keyword?
//
// ‼️ A SEPARATE CALL FROM THE SCREENSHOT READ, AND THAT SEPARATION IS THE WHOLE DESIGN. serp-read.ts
// transcribes: it reports what is on a screen and is forbidden from deciding what any of it means.
// This file JUDGES, which is a different job, and putting both in one call would mean a model that
// had just been told "do not decide what it means" was being asked to decide what it means. The
// stored row records which of the two produced each field (magnet_by), so an observation and an
// opinion can never be mistaken for one another later.
//
// ‼️ IT RUNS ONLY WHERE IT CHANGES AN OUTCOME. The magnet test decides the fate of a keyword nobody
// will click but that we could be named for. A keyword with a healthy click score is a page either
// way, so asking a model about it would be spending a call to learn nothing. shouldAskMagnet() is
// that gate and it is a pure function, so the probe can prove the call is not made on rows where its
// answer is irrelevant.
//
// ‼️ A FAILED CALL IS NOT "THERE IS NOTHING HERE". It returns null and stores magnet_by null, which
// routeFrom reads as a third state: the card asks for `magnet N:` rather than routing the keyword
// off the board because Anthropic was busy for four seconds. An outage that silently deletes work is
// the failure this whole lane keeps finding, and it is cheap to refuse to build another one.

import { callClaudeJSON, camelizeKeys } from "@/lib/claude-calls";
import { hasBannedDash } from "@/lib/copy-guard";
import { SCORE_FLOOR, type SerpRead, type Verdict } from "./keyword-strategy-rules";

/** Haiku. It is one judgement about one query against a magnet list somebody already wrote. */
const MODEL = "claude-haiku-4-5-20251001" as const;

export interface MagnetRead {
  /** 0..5. How much room is left for something worth an email address. */
  magnetSpace: number | null;
  /** One line naming what we would actually hand over, or null when there is nothing. */
  magnetIdea: string | null;
  /** The phrasing we should aim the page at, if the searched words are not the best target. */
  rewrittenTarget: string | null;
  /** Why, in one line, for the card. */
  why: string;
}

/** The client's side of the question. Everything here already exists at step 12. */
export interface MagnetContext {
  clientName: string;
  vertical: string | null;
  avatar: string | null;
  offerName: string | null;
  outcome: string | null;
  /** The magnets already on file, so the answer prefers reusing one over inventing a fifth. */
  existingMagnets: string[];
}

const FAILED: MagnetRead = { magnetSpace: null, magnetIdea: null, rewrittenTarget: null, why: "" };

/**
 * Is this a row whose fate the magnet test actually decides?
 *
 * ‼️ PURE, AND THE PROBE PINS IT. A keyword people click is a page whatever the magnet answer is, and
 * a keyword with no citation value is gone whatever the magnet answer is. Only the middle case, no
 * clicks but a real chance of being named, turns on whether there is something left to hand over.
 * Calling the model on all twenty-five would cost four times as much to learn nothing about
 * eighteen of them.
 */
export function shouldAskMagnet(s: {
  verdict: Verdict;
  clickValue: number | null;
  citationValue: number | null;
}): boolean {
  if (s.verdict === "unclear") return false;
  const click = s.clickValue ?? 0;
  const cite = s.citationValue ?? 0;
  return click < SCORE_FLOOR && cite >= SCORE_FLOOR;
}

export async function readMagnetSpace(args: {
  phrase: string;
  read: SerpRead;
  ctx: MagnetContext;
}): Promise<MagnetRead> {
  const { phrase, read, ctx } = args;

  // What the SERP showed, in the reader's own vocabulary. Facts in, judgement out.
  const facts = [
    read.aiOverview === true ? "There is an AI Overview on the page." : "There is no AI Overview.",
    read.aiOverviewSatisfies !== null
      ? `It resolves the search about ${read.aiOverviewSatisfies} out of 5.`
      : "",
    read.resultShape ? `The first screen is mostly ${read.resultShape}.` : "",
    read.paaQuestions.length ? `People also ask: ${read.paaQuestions.join(" | ")}` : "",
    read.vocabulary.length ? `Words the results use: ${read.vocabulary.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const { data } = await callClaudeJSON<MagnetRead>({
      model: MODEL,
      system: [
        `You are helping ${ctx.clientName} decide whether one search is worth building anything for.`,
        ctx.avatar ? `The person searching is: ${ctx.avatar}.` : "",
        ctx.offerName ? `What ${ctx.clientName} sells: ${ctx.offerName}.` : "",
        ctx.outcome ? `The outcome promised: ${ctx.outcome}.` : "",
        ctx.existingMagnets.length
          ? `Lead magnets already built: ${ctx.existingMagnets.join(" | ")}. Prefer one of these where it genuinely fits; a fifth magnet nobody asked for is worse than reusing the right one.`
          : "",
        "",
        "THE SITUATION. Google now answers a lot of searches on the results page, so nobody clicks through. That is fine for us when the answer names the business, because being named IS the product. What it is NOT fine for is a search where the answer is given away in full and we have nothing left to trade for an email address. Those searches are skipped.",
        "",
        "SO THE ONE QUESTION IS: is there anything left to hand over here?",
        "",
        "magnetSpace, 0 to 5:",
        "  0  the answer is a fact, it is fully given on the results page, and there is nothing a person would swap an email for",
        "  3  there is a real deliverable here, though the search itself is mostly answered",
        "  5  the thing being searched for IS a deliverable: a script, a checklist, a calculator, a template, a form",
        "",
        "magnetIdea: one line naming what we would ACTUALLY hand over. It has to be a real artifact somebody could open: a front desk script, a pricing calculator, a consent checklist, a printable. Never a promise, never an article, never 'a guide to X'. Return null when there is genuinely nothing, and return null rather than inventing something thin. A null here means we skip the keyword, which is a fine outcome and often the right one.",
        "",
        "rewrittenTarget: if the searched words are not what the page should be aimed at, give the phrasing it should use instead. Null when the search is already the right target.",
        "",
        "why: one short line, for a person deciding. Plain words.",
        "",
        "‼️ Never use an em dash, an en dash or a double hyphen anywhere in your answer.",
      ]
        .filter(Boolean)
        .join("\n"),
      user: [
        `The search: "${phrase}"`,
        "",
        "What is on the results page for it:",
        facts || "Nothing was legible.",
        "",
        "Is there anything left to hand over here?",
      ].join("\n"),
      maxTokens: 400,
      temperature: 0,
      schemaHint:
        '{ "magnetSpace": number, "magnetIdea": string|null, "rewrittenTarget": string|null, "why": string }',
    });

    const raw = camelizeKeys(data) as Partial<MagnetRead>;

    const idea = cleanLine(raw.magnetIdea, 160);
    return {
      magnetSpace:
        typeof raw.magnetSpace === "number" && Number.isFinite(raw.magnetSpace)
          ? Math.max(0, Math.min(5, Math.round(raw.magnetSpace)))
          : null,
      // ‼️ A HIGH SPACE WITH NO IDEA IS NOT A HIGH SPACE. The number is only ever a claim about the
      // idea beside it, and routeFrom refuses to reroute a keyword on a score with nothing named, so
      // letting the two disagree here would produce an answer block nobody could write.
      magnetIdea: idea,
      rewrittenTarget: cleanLine(raw.rewrittenTarget, 120),
      why: cleanLine(raw.why, 200) ?? "",
    };
  } catch (e) {
    console.error("[clients/magnet-space] read failed:", (e as Error).message);
    return FAILED;
  }
}

/**
 * One line, trimmed, or null.
 *
 * ‼️ A BANNED DASH IS DROPPED RATHER THAN REWRITTEN. This text goes straight onto a card and, when
 * it is approved, into a page brief. The house rule has no exceptions and a silent repair would let
 * a model keep writing them, so the field comes back null and the card asks for `magnet N:`.
 */
function cleanLine(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\s+/g, " ");
  if (!s || /^(null|none|n\/a)$/i.test(s)) return null;
  if (hasBannedDash(s)) return null;
  return s.slice(0, max);
}
