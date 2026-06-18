// Variation generator for the SRT Reel Studio Slack flow.
//
// After the operator posts an image + a short copy/angle to #content-full, we read
// the image (Claude vision) and return 4 distinct FULL reel scripts in the locked
// Vargas/SRT format: a white audience LABEL, two colored HOOK lines, and a CTA pill.
// The operator then replies with the exact 4 boxes (or reacts 1-4 to take one as-is),
// and studio.ts renders the branded MP4. Em dashes are stripped (house rule).

import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";

// One reel script = the 4 boxes the engine renders (label + 2 hooks + cta).
export interface ReelScript {
  label: string;
  line1: string;
  line2: string;
  cta: string;
}

interface VariationsResponse {
  variations: ReelScript[];
}

function isReelScript(v: unknown): v is ReelScript {
  if (typeof v !== "object" || v === null) return false;
  const s = v as ReelScript;
  return (
    typeof s.label === "string" &&
    typeof s.line1 === "string" &&
    typeof s.line2 === "string" &&
    typeof s.cta === "string"
  );
}

function isVariationsResponse(v: unknown): v is VariationsResponse {
  if (typeof v !== "object" || v === null) return false;
  const arr = (v as VariationsResponse).variations;
  return Array.isArray(arr) && arr.length > 0 && arr.every(isReelScript);
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

export function cleanScript(s: ReelScript): ReelScript {
  return {
    label: stripEmDashes(s.label).trim(),
    line1: stripEmDashes(s.line1).trim(),
    line2: stripEmDashes(s.line2).trim(),
    cta: stripEmDashes(s.cta).trim(),
  };
}

const SYSTEM = [
  "You write on-screen text for pest-control B-roll reels for an MCA brokerage (SRT Agency).",
  "You are shown the actual photo the operator will post, plus their copy/angle for it.",
  "Return EXACTLY 4 distinct reel scripts. Each script has 4 text boxes in this locked format:",
  "- label: a short white audience call-out at the top (e.g. 'Business owners', 'Pest control owners'). 2 to 4 words.",
  "- line1: the HOOK, top colored box, scroll-stopping, ideally 7 words or fewer.",
  "- line2: the PAYOFF, the punch line under the hook.",
  "- cta: the closing pill. Keep it a tap/download CTA (e.g. 'Check out link in bio'). A trailing emoji is fine.",
  "Speak the owner's inner monologue back to him in his own language, and fit what is visibly in the photo.",
  "HARD RULES:",
  "- Never invent funding numbers, rates, terms, or guarantees.",
  "- Never use em dashes or en dashes. Use commas, periods, or hyphens.",
  "- Keep every box tight enough to read on a 5 second clip.",
  "- The 4 scripts must be meaningfully different from each other (different angles, not reworded twins).",
].join("\n");

/** Generate 4 full reel scripts from the uploaded image + the operator's copy/angle. */
export async function generateStudioVariations(args: {
  brief: string;
  image?: ClaudeImageInput;
  count?: number;
}): Promise<ReelScript[]> {
  const count = args.count ?? 4;
  const user = [
    "Operator's copy / angle for this image:",
    args.brief?.trim() ? args.brief.trim() : "(none given — infer the strongest angle from the photo)",
    "",
    `Look at the attached photo and return exactly ${count} distinct reel scripts (label, line1, line2, cta) that fit it.`,
  ].join("\n");

  const { data } = await callClaudeJSON<VariationsResponse>({
    model: model(),
    system: SYSTEM,
    user,
    images: args.image ? [args.image] : undefined,
    maxTokens: 1400,
    temperature: 0.7,
    schemaHint: '{ "variations": [ { "label": string, "line1": string, "line2": string, "cta": string } ] }',
    validate: isVariationsResponse,
  });

  return data.variations.slice(0, count).map(cleanScript);
}
