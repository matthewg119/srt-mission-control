// Vektor Creative Director — the hook-first copy brain for avatar-based workflows.
//
// Decision (2026-07-03): copy is authored HOOK-FIRST. The director returns 5 hooks; the
// operator picks one; then it returns 3 bodies for that hook; then it lays out the full
// caption storyboard (on-screen text timed to the second, mapped across the workflow scenes)
// plus one Instagram caption. Everything speaks the customer's language, grounded in the
// avatar kit (beliefs/offer/gold_examples) and the headline swipe file.
//
// Reuses callClaudeJSON + the headline swipe + the avatar Vertical. No em dashes (house rule).

import { callClaudeJSON, type ClaudeModel, type ClaudeImageInput } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { loadHeadlineSwipe } from "@/data/reel/headline-swipe";
import type { Vertical } from "@/config/verticals";
import type { Workflow } from "@/config/workflows";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// ---- shared prompt scaffolding ---------------------------------------------------------

function avatarBlock(vertical: Vertical): string {
  const beliefs = (vertical.beliefs ?? []).map((b) => `- ${b.text}`).join("\n");
  const headlines = (vertical.offer?.headlines ?? [])
    .map((h) => `- ${h.title}${h.subtitle ? ` | ${h.subtitle}` : ""}`)
    .join("\n");
  return [
    `AVATAR: ${vertical.name} (${vertical.business_descriptor}). Wearer: ${vertical.wearer_role}.`,
    vertical.avatar_summary ? `WHO THEY ARE:\n${vertical.avatar_summary}` : "",
    beliefs ? `BUYING BELIEFS (their language):\n${beliefs}` : "",
    vertical.offer?.big_idea ? `BIG IDEA: ${vertical.offer.big_idea}` : "",
    headlines ? `PROVEN OFFER HEADLINES:\n${headlines}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

function workflowBlock(workflow?: Workflow): string {
  if (!workflow) return "";
  const scenes = workflow.scenes.map((s, i) => `${i + 1}. ${s.role}`).join("\n");
  return [
    `WORKFLOW: ${workflow.name} (${workflow.category}${workflow.subcategory ? "/" + workflow.subcategory : ""}).`,
    scenes ? `SCENE SEQUENCE (the visual beats the copy sits on):\n${scenes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// ---- Step A: 5 hooks -------------------------------------------------------------------

interface HookResult {
  hooks: string[];
}
function isHookResult(v: unknown): v is HookResult {
  const p = v as HookResult;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(p.hooks) &&
    p.hooks.length > 0 &&
    p.hooks.every((h) => typeof h === "string")
  );
}

/**
 * Step A of the hook-first flow: 5 on-screen hook/title options for this avatar + workflow.
 * Option 1 is always a "POV:" framing (brand default). Grounded in the headline swipe.
 */
export async function generateHooks(args: {
  vertical: Vertical;
  workflow?: Workflow;
  brief?: string; // optional operator note, e.g. a reference-video idea
  images?: ClaudeImageInput[];
}): Promise<string[]> {
  const system = [
    `You are Vektor, the creative director for a ${args.vertical.business_descriptor}.`,
    "You write the on-screen HOOK (the headline held on screen the first few seconds of a",
    "short first-person video). Return FIVE options. Option 1 MUST be a 'POV:' framing. The",
    "other four vary the angle: curiosity gap, shocking discovery, relatable, and authority.",
    "Each option is 8 words or fewer and speaks the customer's language.",
    "",
    avatarBlock(args.vertical),
    "",
    workflowBlock(args.workflow),
    "",
    "HEADLINE SWIPE (patterns + words to draw on):",
    loadHeadlineSwipe(),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
    "Match the voice of these gold examples:",
    JSON.stringify(args.vertical.gold_examples ?? [], null, 2),
  ].join("\n");

  const { data } = await callClaudeJSON<HookResult>({
    model: model(),
    system,
    user: [
      args.brief ? `Operator note: ${args.brief}` : "",
      "Return JSON with exactly 5 hooks, option 1 a 'POV:' framing.",
    ]
      .filter(Boolean)
      .join("\n"),
    images: args.images,
    maxTokens: 700,
    temperature: 0.85,
    schemaHint: '{ "hooks": [string] }',
    validate: isHookResult,
  });

  let hooks = data.hooks.map((h) => stripEmDashes(h).trim()).filter(Boolean);
  // Guarantee a POV framing at #1.
  if (!hooks.some((h) => /^pov\b/i.test(h))) hooks.unshift("POV: a regular day on the job");
  else if (!/^pov\b/i.test(hooks[0])) {
    const idx = hooks.findIndex((h) => /^pov\b/i.test(h));
    const [pov] = hooks.splice(idx, 1);
    hooks.unshift(pov);
  }
  hooks = hooks.slice(0, 5);
  while (hooks.length < 5) hooks.push(hooks[hooks.length - 1] ?? "POV: on the job");
  return hooks;
}

// ---- Step B: 3 bodies for the chosen hook ---------------------------------------------

interface BodyResult {
  bodies: string[];
}
function isBodyResult(v: unknown): v is BodyResult {
  const p = v as BodyResult;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(p.bodies) &&
    p.bodies.length > 0 &&
    p.bodies.every((b) => typeof b === "string")
  );
}

/**
 * Step B: given the chosen hook, 3 on-screen "body" lines (the second beat of text that pays
 * off / extends the hook). The operator picks one; it seeds the caption storyboard.
 */
export async function generateBodies(args: {
  vertical: Vertical;
  chosenHook: string;
  workflow?: Workflow;
}): Promise<string[]> {
  const system = [
    `You are Vektor, the creative director for a ${args.vertical.business_descriptor}.`,
    "The operator picked an on-screen HOOK. Write THREE 'body' lines: the second beat of",
    "on-screen text that pays off or extends the hook (each 10 words or fewer). Vary them:",
    "one curiosity/tease, one relatable, one authority/proof. Speak the customer's language.",
    "",
    avatarBlock(args.vertical),
    "",
    workflowBlock(args.workflow),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<BodyResult>({
    model: model(),
    system,
    user: [`Chosen hook: ${args.chosenHook}`, "Return JSON with exactly 3 bodies."].join("\n"),
    maxTokens: 500,
    temperature: 0.8,
    schemaHint: '{ "bodies": [string] }',
    validate: isBodyResult,
  });

  let bodies = data.bodies.map((b) => stripEmDashes(b).trim()).filter(Boolean).slice(0, 3);
  while (bodies.length < 3) bodies.push(bodies[bodies.length - 1] ?? "");
  return bodies;
}

// ---- Step C: full caption storyboard (text timed to the second) + IG caption -----------

export interface CaptionStoryboard {
  captions: Array<{ text: string; at_second: number }>;
  ig_caption: string;
}
function isCaptionStoryboard(v: unknown): v is CaptionStoryboard {
  const p = v as CaptionStoryboard;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof p.ig_caption === "string" &&
    Array.isArray(p.captions) &&
    p.captions.every(
      (c) => c && typeof c.text === "string" && typeof c.at_second === "number"
    )
  );
}

/**
 * Step C: lay out the whole on-screen caption storyboard (text + the SECOND it appears) across
 * the workflow's scenes, opening with the chosen hook, plus one Instagram caption. Scene count
 * and per-scene duration drive the timing so the text lands on the cuts / beat.
 */
export async function generateCaptionStoryboard(args: {
  vertical: Vertical;
  workflow: Workflow;
  chosenHook: string;
  chosenBody?: string;
}): Promise<CaptionStoryboard> {
  const clip = args.workflow.render_options.clip_seconds ?? 2;
  const cuts = args.workflow.scenes.map((s, i) => ({
    at_second: i * (s.duration_seconds ?? clip),
    role: s.role,
  }));
  const system = [
    `You are Vektor, the creative director for a ${args.vertical.business_descriptor}.`,
    "Lay out the on-screen text storyboard for a short first-person video. The hook is held",
    "from second 0. Then place short on-screen lines on the scene cuts listed below so the text",
    "lands on the beat. Keep each line 10 words or fewer. Then write ONE Instagram caption",
    "(2 to 4 sentences, first-person, ends on a quiet takeaway, no hashtags, no emojis).",
    "",
    avatarBlock(args.vertical),
    "",
    "SCENE CUTS (second -> what is on screen):",
    cuts.map((c) => `- ${c.at_second}s: ${c.role}`).join("\n"),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<CaptionStoryboard>({
    model: model(),
    system,
    user: [
      `Chosen hook (second 0): ${args.chosenHook}`,
      args.chosenBody ? `Chosen body line: ${args.chosenBody}` : "",
      "Return JSON: captions (each { text, at_second }) plus ig_caption.",
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 900,
    temperature: 0.7,
    schemaHint: '{ "captions": [{ "text": string, "at_second": number }], "ig_caption": string }',
    validate: isCaptionStoryboard,
  });

  // Always anchor the chosen hook at second 0, then the model's timed lines (em-dash-free).
  const captions = [
    { text: stripEmDashes(args.chosenHook).trim(), at_second: 0 },
    ...data.captions
      .filter((c) => c.at_second > 0)
      .map((c) => ({ text: stripEmDashes(c.text).trim(), at_second: c.at_second }))
      .filter((c) => c.text),
  ];
  return { captions, ig_caption: stripEmDashes(data.ig_caption).trim() };
}
