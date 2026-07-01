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
import type { Vertical } from "@/config/verticals";
import type { CopyStyle } from "@/config/format-registry";
import { buildBugRevealCopySystem } from "@/config/bug-reveal-style";

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

// ---- Unified hook copy (the standardized CAPTION stage for the pipeline) --------------
//
// Every single-image format's CAPTION stage returns the SAME shape: exactly 5 on-screen
// title options (option #1 is always a "POV:" framing), one Instagram caption, one
// animation prompt, and optionally an after-image prompt (before_after_edit formats). This
// replaces the per-format copy calls (generateBugRevealCopy = 5 titles + caption;
// generatePovConcept = 6 titles + 3 captions) with one consistent contract.

export interface HookCopy {
  options: string[]; // exactly 5 on-screen titles; options[0] is the POV default
  caption: string;
  animation_prompt: string;
  after_image_prompt?: string;
}

function isHookCopy(v: unknown): v is HookCopy {
  if (typeof v !== "object" || v === null) return false;
  const c = v as HookCopy;
  return (
    typeof c.caption === "string" &&
    typeof c.animation_prompt === "string" &&
    Array.isArray(c.options) &&
    c.options.length > 0 &&
    c.options.every((t) => typeof t === "string")
  );
}

/** The system prompt for the CAPTION stage, selected by the format's copy voice. */
export function buildHookCopySystem(
  copyStyle: CopyStyle,
  vertical: Vertical,
  rulesText?: string,
  animationSpec?: string
): string {
  // owner_growth reuses the exact bug-reveal owner voice so that format keeps parity.
  if (copyStyle === "owner_growth") {
    return buildBugRevealCopySystem(vertical.business_descriptor, rulesText);
  }

  // pov_hook: candid first-person WTF-hook personal account (the POV drop voice), standardized
  // to 5 title options + one caption + animation (+ after-image prompt when asked).
  const guidance = rulesText && rulesText.trim() ? ["", rulesText.trim(), ""] : [];
  return [
    `You are the content engine for a ${vertical.business_descriptor}. You write copy for a`,
    "short first-person video styled like real Ray-Ban Meta smart-glasses footage: we see the",
    `${vertical.wearer_role}'s own gloved hands performing the task. The scene is a scroll-`,
    "stopping WTF hook (a gross discovery, a swarm, an animal). Treat the first frame as a",
    "'wait, what is that' moment.",
    "",
    "GLOBAL VISUAL STYLE (already applied to the image, keep it in mind):",
    vertical.style_token,
    "",
    "Return:",
    "- options: exactly FIVE on-screen title options, each 8 words or fewer. Option #1 MUST be a",
    "  'POV:' framing (e.g. 'POV: a regular Tuesday as a pest control tech'). The other four vary",
    "  the angle (curiosity tease, relatable, authority, shock).",
    "- caption: 2 to 4 sentences, first-person, conversational, ends on a quiet takeaway. No",
    "  hashtags, no emojis.",
    `- animation_prompt: ONE sentence, motion only (head/camera movement + the hands' action).${
      animationSpec ? " " + animationSpec : ""
    }`,
    ...(guidance.length ? guidance : []),
    "HARD RULES: never invent guarantees, numbers, rates, or terms you were not given; never use",
    "em dashes or en dashes; use commas, periods, or hyphens.",
    "",
    "Match the quality and style of these gold examples:",
    JSON.stringify(vertical.gold_examples, null, 2),
  ].join("\n");
}

/**
 * The standardized CAPTION stage: scene + format voice -> 5 options (POV #1) + caption +
 * animation prompt (+ after-image prompt when withAfterFrame). One call, one shape, every
 * single-image format.
 */
export async function generateHookCopy(args: {
  scene: string;
  system: string;
  withAfterFrame: boolean;
  povFallback?: string; // used only if the model somehow returns no POV option
}): Promise<HookCopy> {
  const schemaHint = args.withAfterFrame
    ? '{ "options": [string], "caption": string, "animation_prompt": string, "after_image_prompt": string }'
    : '{ "options": [string], "caption": string, "animation_prompt": string }';

  const { data } = await callClaudeJSON<HookCopy>({
    model: model(),
    system: args.system,
    user: [
      `The scene shows: ${args.scene}`,
      args.withAfterFrame
        ? "The reel sprays that spot and the pests pour out. Return the copy as JSON."
        : "Return the copy as JSON.",
      "Remember: exactly 5 title options, option #1 is a 'POV:' framing.",
    ].join("\n"),
    maxTokens: 1200,
    temperature: 0.8,
    schemaHint,
    validate: isHookCopy,
  });

  // Standardize to exactly 5 options; guarantee a POV framing at #1.
  let options = data.options.map((t) => stripEmDashes(t).trim()).filter(Boolean);
  if (!options.some((o) => /^pov\b/i.test(o))) {
    options.unshift(args.povFallback?.trim() || "POV: a regular day on the job");
  } else if (!/^pov\b/i.test(options[0])) {
    const idx = options.findIndex((o) => /^pov\b/i.test(o));
    const [pov] = options.splice(idx, 1);
    options.unshift(pov);
  }
  options = options.slice(0, 5);
  while (options.length < 5) options.push(options[options.length - 1] ?? "POV: on the job");

  return {
    options,
    caption: stripEmDashes(data.caption).trim(),
    animation_prompt: stripEmDashes(data.animation_prompt).trim(),
    after_image_prompt: data.after_image_prompt
      ? stripEmDashes(data.after_image_prompt).trim()
      : undefined,
  };
}

/**
 * Write ONE Instagram caption that pairs with a full SRT Reel Studio script
 * (label + 2 hooks + cta). Used by the #content-full studio flow. Same template
 * + house rules as generateCaptionForHeadline; no belief context is required.
 */
export async function generateCaptionForScript(
  script: { label: string; line1: string; line2: string; cta: string },
  image?: ClaudeImageInput
): Promise<string> {
  const user = [
    "TEMPLATE FILE (style + rules + the only stats you may use):",
    IG_CAPTION_TEMPLATES,
    "",
    "----",
    "The reel's on-screen text boxes (the caption must pair with these):",
    `LABEL: ${script.label}`,
    `HOOK: ${script.line1}`,
    `PAYOFF: ${script.line2}`,
    `CTA: ${script.cta}`,
    "",
    "Write ONE Instagram caption that pairs with this reel.",
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
