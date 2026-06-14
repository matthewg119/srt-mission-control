// Headline generation for the interactive Daily Creative Drop.
//
// After the operator uploads the generated picture into the drop thread, we read
// the image (Claude vision) plus the belief context and return 3 headline OPTIONS
// (hook/payoff pairs) tailored to what's actually in the photo. The operator picks
// one (1/2/3 reaction), then captions.ts writes the caption. Em dashes are stripped.

import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import type { Belief } from "@/lib/reel/beliefs";

export interface HeadlinePair {
  hook: string;
  payoff: string;
}

interface HeadlineResponse {
  options: HeadlinePair[];
}

function isHeadlineResponse(v: unknown): v is HeadlineResponse {
  if (typeof v !== "object" || v === null) return false;
  const options = (v as HeadlineResponse).options;
  return (
    Array.isArray(options) &&
    options.length > 0 &&
    options.every((p) => p && typeof p.hook === "string" && typeof p.payoff === "string")
  );
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

const SYSTEM = [
  "You write short on-screen text overlays for pest-control B-roll reels for an MCA brokerage (SRT Agency).",
  "You are shown the actual photo the operator will post, plus the belief it should install.",
  "Return 3 distinct overlay OPTIONS. Each option is a pair: a HOOK (top line, 6 words or fewer ideally, scroll-stopping) and a PAYOFF (the punch, lower third).",
  "The options should fit what is visibly happening in the photo and speak the business owner's inner monologue back to him, using the belief's own language.",
  "HARD RULES:",
  "- Never invent funding numbers, rates, terms, or guarantees. Only use facts present in the belief lines.",
  "- Never use em dashes or en dashes. Use commas, periods, or hyphens.",
  "- Keep each line tight enough to read on a 7 second clip.",
  "- The 3 options must be meaningfully different from each other.",
].join("\n");

/** Generate 3 headline options from the uploaded image + belief context. */
export async function generateHeadlinesFromImage(
  belief: Belief,
  image: ClaudeImageInput,
  count = 3
): Promise<HeadlinePair[]> {
  const user = [
    `Belief ${belief.number}: ${belief.title}`,
    "",
    "Belief caption lines (source of truth, do not add facts beyond these):",
    ...belief.lines.map((l, i) => `${i + 1}. ${l}`),
    "",
    `Look at the attached photo and return exactly ${count} distinct hook/payoff overlay options that fit it.`,
  ].join("\n");

  const { data } = await callClaudeJSON<HeadlineResponse>({
    model: model(),
    system: SYSTEM,
    user,
    images: [image],
    maxTokens: 1024,
    temperature: 0.6,
    schemaHint: '{ "options": [ { "hook": string, "payoff": string } ] }',
    validate: isHeadlineResponse,
  });

  return data.options.slice(0, count).map((p) => ({
    hook: stripEmDashes(p.hook).trim(),
    payoff: stripEmDashes(p.payoff).trim(),
  }));
}

/** Deterministic fallback if the vision call fails: derive options from raw lines. */
export function fallbackHeadlines(belief: Belief, count = 3): HeadlinePair[] {
  return belief.lines.slice(0, count).map((line) => {
    const clean = stripEmDashes(line.replace(/^Business owners:?\s*/i, "")).trim();
    const dot = clean.indexOf(". ");
    const hook = dot > 0 ? clean.slice(0, dot) : clean;
    const payoff = dot > 0 ? clean.slice(dot + 2).trim() : clean;
    return { hook: hook.trim(), payoff: payoff || hook.trim() };
  });
}
