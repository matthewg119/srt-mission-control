// Caption generation for the interactive Daily Creative Drop.
//
// Runs LAST, after the operator picks a headline. Writes ONE Instagram caption that
// matches the chosen headline + belief, following the rules in
// src/data/reel/ig-caption-templates.ts. Em dashes are stripped (house rule).

import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { IG_CAPTION_TEMPLATES } from "@/data/reel/ig-caption-templates";
import { stripEmDashes } from "@/lib/reel/text";
import type { Belief } from "@/lib/reel/beliefs";
import type { HeadlinePair } from "@/lib/reel/headlines";

interface CaptionResponse {
  caption: string;
}

function isCaptionResponse(v: unknown): v is CaptionResponse {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as CaptionResponse).caption === "string" &&
    (v as CaptionResponse).caption.trim().length > 0
  );
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

const SYSTEM = [
  "You write Instagram captions for an MCA brokerage (SRT Agency), pest-control vertical.",
  "Write ONE caption that matches the chosen on-screen headline and the belief. Follow the supplied template file's style and rules exactly:",
  "- Lead with the reader's pain in the first two lines (stop the scroll).",
  "- Never start with the word 'We'. Start with the reader's situation.",
  "- Include a short benefit-first checklist block and an emotional closing line.",
  "- End with a tap/download CTA (not 'visit our website' or 'DM us').",
  "HARD RULES:",
  "- Never invent funding numbers, rates, terms, or guarantees. Only use claims/stats present in the template file.",
  "- Never use em dashes or en dashes. Use commas, periods, or hyphens.",
  "- Direct, empathetic, trusted-advisor tone, no fluff.",
].join("\n");

/** Write the single caption for a chosen headline (optionally informed by the image). */
export async function generateCaptionForHeadline(
  belief: Belief,
  headline: HeadlinePair,
  image?: ClaudeImageInput
): Promise<string> {
  const user = [
    "TEMPLATE FILE (style + rules + the only stats you may use):",
    IG_CAPTION_TEMPLATES,
    "",
    "----",
    `Belief ${belief.number}: ${belief.title}`,
    "",
    "Chosen on-screen headline:",
    `TOP: ${headline.hook}`,
    `BOTTOM: ${headline.payoff}`,
    "",
    "Write ONE caption that pairs with this headline.",
  ].join("\n");

  const { data } = await callClaudeJSON<CaptionResponse>({
    model: model(),
    system: SYSTEM,
    user,
    images: image ? [image] : undefined,
    maxTokens: 1024,
    temperature: 0.6,
    schemaHint: '{ "caption": string }',
    validate: isCaptionResponse,
  });

  return stripEmDashes(data.caption).trim();
}
