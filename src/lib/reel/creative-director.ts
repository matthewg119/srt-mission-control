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
import { COPY_ROLE_LIBRARY } from "@/config/workflows";
import type { Workflow, RenderSpec, RenderMode } from "@/config/workflows";

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
  const roles = (workflow.copy_structure ?? [])
    .map((r, i) => `${i + 1}. ${r.label}: ${r.guidance}`)
    .join("\n");
  const rules = (workflow.visual_rules ?? []).map((r) => `- ${r}`).join("\n");
  return [
    `WORKFLOW: ${workflow.name} (${workflow.category}${workflow.subcategory ? "/" + workflow.subcategory : ""}).`,
    workflow.description ? `WHAT THIS WORKFLOW IS: ${workflow.description}` : "",
    roles ? `COPY STRUCTURE (the labeled slots every line must serve, in order):\n${roles}` : "",
    scenes ? `SCENE SEQUENCE (the visual beats the copy sits on):\n${scenes}` : "",
    rules ? `WORKFLOW VISUAL RULES (the look this format must keep):\n${rules}` : "",
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

// =======================================================================================
// RICH COPY ENGINE (v3 Phase 1.5) — the real direct-response chain that lets Matthew pump
// 20+ videos/day per avatar: 30 headlines + reference block -> hookset -> captions/storyboards
// -> picture plan. All grounded in the avatar kit + headline swipe. Em-dash-free.
// =======================================================================================

const clean = (s: string) => stripEmDashes(String(s)).trim();

// ---- 30 direct-response headline options ----------------------------------------------

interface HeadlinesResult {
  headlines: string[];
}
function isHeadlines(v: unknown): v is HeadlinesResult {
  const p = v as HeadlinesResult;
  return typeof v === "object" && v !== null && Array.isArray(p.headlines) && p.headlines.every((h) => typeof h === "string");
}

/** ~30 direct-response headline/hook options in the customer's language to cherry-pick from. */
export async function generateHeadlineOptions(args: {
  vertical: Vertical;
  workflow?: Workflow;
  count?: number;
}): Promise<string[]> {
  const count = args.count ?? 30;
  const system = [
    `You are Vektor, the direct-response creative director for a ${args.vertical.business_descriptor}.`,
    `Write ${count} distinct on-screen HEADLINE options (the scroll-stopping line held on screen the`,
    "first few seconds). Vary the angles widely: fear/loss, shocking discovery, curiosity gap,",
    "us-vs-them, insider/forbidden, fast-easy result, relatable, authority, and POV framings. Each",
    "8 words or fewer, in the customer's language. These are a menu to cherry-pick and remix.",
    "",
    avatarBlock(args.vertical),
    "",
    workflowBlock(args.workflow),
    "",
    "HEADLINE SWIPE (patterns + words to draw on):",
    loadHeadlineSwipe(),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<HeadlinesResult>({
    model: model(),
    system,
    user: `Return JSON with ${count} headline options.`,
    maxTokens: 1600,
    temperature: 0.95,
    schemaHint: '{ "headlines": [string] }',
    validate: isHeadlines,
  });
  const seen = new Set<string>();
  return data.headlines
    .map(clean)
    .filter((h) => h && !seen.has(h.toLowerCase()) && seen.add(h.toLowerCase()))
    .slice(0, count);
}

// ---- Reference block: 3 fears / beliefs / desires / facts / fantasies / horror ---------

export interface CreativeReference {
  fears: string[];
  beliefs: string[];
  desires: string[];
  facts: string[];
  fantasies: string[];
  horror: string[];
}
function isCreativeReference(v: unknown): v is CreativeReference {
  const p = v as CreativeReference;
  return (
    typeof v === "object" &&
    v !== null &&
    ["fears", "beliefs", "desires", "facts", "fantasies", "horror"].every(
      (k) => Array.isArray((p as unknown as Record<string, unknown>)[k])
    )
  );
}

/** Raw story material from the avatar: 3 each of fears, beliefs, desires, random facts,
 *  fantasies, and horror stories. Matthew mixes these into the story he builds. */
export async function generateCreativeReference(vertical: Vertical): Promise<CreativeReference> {
  const system = [
    `You are Vektor, building story raw-material for a ${vertical.business_descriptor}.`,
    "From the avatar below, return exactly 3 each of: fears, beliefs, desires, random_facts",
    "(surprising true facts / stats about the problem the audience does not know), fantasies",
    "(the dream outcome), and horror_stories (short worst-case scenarios that already happened).",
    "Each item one sentence, in the customer's language, concrete and specific.",
    "",
    avatarBlock(vertical),
    "",
    "HARD RULES: never invent guarantees, prices, rates, or terms; only use facts implied by the",
    "avatar/offer; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<CreativeReference & { random_facts?: string[] }>({
    model: model(),
    system,
    user: "Return JSON with fears, beliefs, desires, random_facts, fantasies, horror_stories (3 each).",
    maxTokens: 1200,
    temperature: 0.85,
    schemaHint:
      '{ "fears": [string], "beliefs": [string], "desires": [string], "random_facts": [string], "fantasies": [string], "horror_stories": [string] }',
    validate: (v): v is CreativeReference & { random_facts?: string[] } => {
      const p = v as Record<string, unknown>;
      return typeof v === "object" && v !== null && Array.isArray(p.fears) && Array.isArray(p.desires);
    },
  });
  const three = (a?: unknown[]) => (Array.isArray(a) ? a.map((x) => clean(String(x))).filter(Boolean).slice(0, 3) : []);
  const raw = data as unknown as Record<string, unknown[]>;
  return {
    fears: three(raw.fears),
    beliefs: three(raw.beliefs),
    desires: three(raw.desires),
    facts: three(raw.random_facts ?? raw.facts),
    fantasies: three(raw.fantasies),
    horror: three(raw.horror_stories ?? raw.horror),
  };
}

// ---- Hook set: 5 verbal + 5 title (+5 POV-first when POV) -------------------------------

export interface HookSet {
  verbal: string[];
  title: string[];
  pov?: string[];
}
function isHookSet(v: unknown): v is HookSet {
  const p = v as HookSet;
  return typeof v === "object" && v !== null && Array.isArray(p.verbal) && Array.isArray(p.title);
}

/** Given the headline/idea Matthew is building on: 5 verbal (voiceover) hooks + 5 title hooks,
 *  plus 5 POV-first title hooks when the format is POV. */
export async function generateHookSet(args: {
  vertical: Vertical;
  chosenHeadline: string;
  isPov: boolean;
  workflow?: Workflow;
}): Promise<HookSet> {
  const system = [
    `You are Vektor, the creative director for a ${args.vertical.business_descriptor}.`,
    "Matthew is building a short video around the idea below. Return:",
    "- verbal: 5 spoken VOICEOVER opening hooks (how the first line is SAID, conversational).",
    "- title: 5 on-screen TITLE hooks (what is written on screen, 8 words or fewer).",
    args.isPov
      ? "- pov: 5 EXTRA title hooks, each explicitly a 'POV:' framing (POV-first)."
      : "(no pov array needed for this format)",
    "All in the customer's language, distinct angles.",
    "",
    avatarBlock(args.vertical),
    "",
    workflowBlock(args.workflow),
    "",
    "HEADLINE SWIPE:",
    loadHeadlineSwipe(),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<HookSet>({
    model: model(),
    system,
    user: [
      `The idea/headline: ${args.chosenHeadline}`,
      args.isPov
        ? "Return JSON: verbal (5), title (5), pov (5 POV-first)."
        : "Return JSON: verbal (5), title (5).",
    ].join("\n"),
    maxTokens: 900,
    temperature: 0.85,
    schemaHint: args.isPov
      ? '{ "verbal": [string], "title": [string], "pov": [string] }'
      : '{ "verbal": [string], "title": [string] }',
    validate: isHookSet,
  });
  const five = (a?: string[]) => (Array.isArray(a) ? a.map(clean).filter(Boolean).slice(0, 5) : []);
  return {
    verbal: five(data.verbal),
    title: five(data.title),
    pov: args.isPov ? five(data.pov) : undefined,
  };
}

// ---- 3 captions + 3 storyboard ideas ---------------------------------------------------

export interface CaptionsAndStoryboards {
  captions: string[];
  storyboards: string[];
}
function isCaptionsAndStoryboards(v: unknown): v is CaptionsAndStoryboards {
  const p = v as CaptionsAndStoryboards;
  return typeof v === "object" && v !== null && Array.isArray(p.captions) && Array.isArray(p.storyboards);
}

/** For the chosen hook: 3 Instagram captions + 3 storyboard ideas (each a short repeatable
 *  2-4 shot skeleton) to pick from. */
export async function generateCaptionsAndStoryboards(args: {
  vertical: Vertical;
  chosenHook: string;
  workflow?: Workflow;
}): Promise<CaptionsAndStoryboards> {
  const system = [
    `You are Vektor, the creative director for a ${args.vertical.business_descriptor}.`,
    "For the chosen hook, return:",
    "- captions: 3 Instagram caption options (2 to 4 sentences, first-person, quiet takeaway,",
    "  no hashtags, no emojis).",
    "- storyboards: 3 short storyboard ideas, each a repeatable 2 to 4 shot skeleton written as",
    "  'shot 1 -> shot 2 -> shot 3' (first-person POV where it fits), first shot an open-loop hook.",
    "",
    avatarBlock(args.vertical),
    "",
    workflowBlock(args.workflow),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<CaptionsAndStoryboards>({
    model: model(),
    system,
    user: [`Chosen hook: ${args.chosenHook}`, "Return JSON: captions (3), storyboards (3)."].join("\n"),
    maxTokens: 1100,
    temperature: 0.8,
    schemaHint: '{ "captions": [string], "storyboards": [string] }',
    validate: isCaptionsAndStoryboards,
  });
  const three = (a?: string[]) => (Array.isArray(a) ? a.map(clean).filter(Boolean).slice(0, 3) : []);
  return { captions: three(data.captions), storyboards: three(data.storyboards) };
}

// ---- The picture plan: scenes (image + animation prompts) + timed captions --------------

export interface PicturePlan {
  scenes: Array<{ role: string; image_prompt: string; animation_prompt: string }>;
  captions: Array<{ text: string; at_second: number }>;
}
function isPicturePlan(v: unknown): v is PicturePlan {
  const p = v as PicturePlan;
  return (
    typeof v === "object" &&
    v !== null &&
    Array.isArray(p.scenes) &&
    p.scenes.every((s) => s && typeof s.image_prompt === "string" && typeof s.animation_prompt === "string") &&
    Array.isArray(p.captions)
  );
}

/** Turn the chosen hook + caption + storyboard into the full picture: ordered scenes (each with
 *  an image prompt + animation prompt in the avatar's look) and on-screen captions timed to the
 *  second. Vektor maps the timing here (this replaces any CapCut step). */
export async function generatePicturePlan(args: {
  vertical: Vertical;
  chosenHook: string;
  chosenCaption: string;
  chosenStoryboard: string;
  clipSeconds?: number;
  workflow?: Workflow;
}): Promise<PicturePlan> {
  const clip = args.clipSeconds ?? 2;
  const system = [
    `You are Vektor, the creative director for a ${args.vertical.business_descriptor}.`,
    "Turn the chosen hook + caption + storyboard into a production-ready plan. Return:",
    "- scenes: the ordered shots (2 to 4). Each: role (the step), image_prompt (a photorealistic",
    `  first-frame still in this avatar's look, NO on-screen text), animation_prompt (one sentence,`,
    "  motion only).",
    `- captions: on-screen text timed to the second. The hook sits at second 0; place the rest on`,
    `  the scene cuts (each scene is about ${clip}s), each 10 words or fewer.`,
    "",
    "GLOBAL VISUAL STYLE (already applied downstream, keep in mind):",
    args.vertical.style_token,
    "",
    avatarBlock(args.vertical),
    "",
    workflowBlock(args.workflow),
    "",
    "HARD RULES: image_prompt has no text overlay; never invent guarantees/numbers/rates/terms;",
    "never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<PicturePlan>({
    model: model(),
    system,
    user: [
      `Hook (second 0): ${args.chosenHook}`,
      `Caption: ${args.chosenCaption}`,
      `Storyboard: ${args.chosenStoryboard}`,
      "Return JSON: scenes [{role, image_prompt, animation_prompt}], captions [{text, at_second}].",
    ].join("\n"),
    maxTokens: 1500,
    temperature: 0.7,
    schemaHint:
      '{ "scenes": [{ "role": string, "image_prompt": string, "animation_prompt": string }], "captions": [{ "text": string, "at_second": number }] }',
    validate: isPicturePlan,
  });

  const scenes = data.scenes
    .map((s) => ({
      role: clean(s.role || "shot"),
      image_prompt: clean(s.image_prompt),
      animation_prompt: clean(s.animation_prompt),
    }))
    .filter((s) => s.image_prompt)
    .slice(0, 5);
  const captions = [
    { text: clean(args.chosenHook), at_second: 0 },
    ...data.captions
      .filter((c) => typeof c.at_second === "number" && c.at_second > 0)
      .map((c) => ({ text: clean(c.text), at_second: c.at_second }))
      .filter((c) => c.text),
  ];
  return { scenes, captions };
}

// =======================================================================================
// WORKFLOW COPY STRUCTURE (v3) — fill a workflow's labeled copy boxes, re-slot a pasted block
// into them, and parse a pasted storyboard/timestamps into a RenderSpec.
// =======================================================================================

export interface StructuredCopyLine {
  key: string;
  label: string;
  text: string;
}
interface CopyLinesResult {
  lines: Array<{ key: string; text: string }>;
}
function isCopyLines(v: unknown): v is CopyLinesResult {
  const p = v as CopyLinesResult;
  return typeof v === "object" && v !== null && Array.isArray(p.lines) && p.lines.every((l) => l && typeof l.key === "string" && typeof l.text === "string");
}

function rolesBlock(workflow: Workflow): string {
  return (workflow.copy_structure ?? [])
    .map((r, i) => `${i + 1}. key="${r.key}" (${r.label}): ${r.guidance}`)
    .join("\n");
}

/** Fill each of the workflow's copy-structure roles with one line of copy in the avatar's voice,
 *  seeded by whatever copy Matthew already chose. Returns one line per role, in role order. */
export async function generateStructuredCopy(args: {
  vertical: Vertical;
  workflow: Workflow;
  seed?: { headline?: string; hook?: string; caption?: string; storyboard?: string };
}): Promise<StructuredCopyLine[]> {
  const roles = args.workflow.copy_structure ?? [];
  if (!roles.length) return [];
  const system = [
    `You are Vektor, the direct-response creative director for a ${args.vertical.business_descriptor}.`,
    `Write ONE short on-screen line for EACH labeled box below, in the customer's language. Return`,
    `exactly ${roles.length} lines, one per box, using the box "key". Keep each line tight (10 words`,
    "or fewer). The lines must read as one continuous piece of copy, box by box.",
    "",
    "COPY STRUCTURE (fill each box):",
    rolesBlock(args.workflow),
    "",
    avatarBlock(args.vertical),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<CopyLinesResult>({
    model: model(),
    system,
    user: [
      args.seed?.headline ? `Headline being built on: ${args.seed.headline}` : "",
      args.seed?.hook ? `Chosen hook: ${args.seed.hook}` : "",
      args.seed?.caption ? `Caption direction: ${args.seed.caption}` : "",
      args.seed?.storyboard ? `Storyboard: ${args.seed.storyboard}` : "",
      `Return JSON: lines, one per box, each { key, text }. Keys: ${roles.map((r) => r.key).join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 900,
    temperature: 0.85,
    schemaHint: '{ "lines": [{ "key": string, "text": string }] }',
    validate: isCopyLines,
  });

  const byKey = new Map(data.lines.map((l) => [l.key, clean(l.text)]));
  return roles.map((r) => ({ key: r.key, label: r.label, text: byKey.get(r.key) ?? "" }));
}

/** Re-slot a raw pasted copy block into the workflow's labeled boxes (the "turn my copy into
 *  structure" case). Returns one line per role, in role order (some may be empty if unmatched). */
export async function reslotCopyToStructure(args: {
  vertical: Vertical;
  workflow: Workflow;
  pastedBlock: string;
}): Promise<StructuredCopyLine[]> {
  const roles = args.workflow.copy_structure ?? [];
  if (!roles.length) return [];
  const system = [
    "You are Vektor. Map the operator's pasted copy onto the labeled boxes below. Assign each",
    "pasted line to the box it best fits, in order. Do NOT rewrite the lines; keep the operator's",
    "exact words. If there are more pasted lines than boxes, merge the closest ones; if fewer,",
    "leave the extra boxes empty.",
    "",
    "COPY STRUCTURE:",
    rolesBlock(args.workflow),
    "",
    "HARD RULES: keep the operator's wording; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<CopyLinesResult>({
    model: model(),
    system,
    user: [
      "Pasted copy:",
      args.pastedBlock,
      "",
      `Return JSON: lines, one per box, each { key, text }. Keys: ${roles.map((r) => r.key).join(", ")}.`,
    ].join("\n"),
    maxTokens: 900,
    temperature: 0.3,
    schemaHint: '{ "lines": [{ "key": string, "text": string }] }',
    validate: isCopyLines,
  });

  const byKey = new Map(data.lines.map((l) => [l.key, clean(l.text)]));
  return roles.map((r) => ({ key: r.key, label: r.label, text: byKey.get(r.key) ?? "" }));
}

// ---- Remixes: 16 narrative variations of the SAME workflow + audio + render combo -------
// After a video is built, the upsell: same structure, same song, same timings, a different
// narrative angle. Approving a remix re-renders with the same images (or regenerates
// creatives from the new copy on request).

export interface RemixAngle {
  key: string;
  label: string;
  guidance: string;
}

export const REMIX_ANGLES: RemixAngle[] = [
  { key: "propaganda", label: "Propaganda", guidance: "Relentless one-sided drumbeat: repeat the core claim like a movement slogan." },
  { key: "indoctrination", label: "Indoctrination", guidance: "Teach it as the obvious truth insiders already live by; the viewer is late to it." },
  { key: "direct_cta", label: "Direct call to action", guidance: "Every line pushes the click; urgent, imperative, zero fluff." },
  { key: "mini_story", label: "Mini story", guidance: "A tiny 3-act story: someone like the viewer, the turn, the outcome." },
  { key: "horror_story", label: "Horror story", guidance: "The worst case that actually happens when this is ignored; end on the way out." },
  { key: "testimonial", label: "Testimonial voice", guidance: "First-person as a customer/operator who lived it; concrete and plain." },
  { key: "myth_bust", label: "Myth bust", guidance: "Name the common belief, break it, replace it with what actually works." },
  { key: "us_vs_them", label: "Us vs them", guidance: "The scrappy owner against the big players/the old way; pick a side." },
  { key: "insider_secret", label: "Insider secret", guidance: "What the industry does not say out loud; whispered, forbidden knowledge." },
  { key: "stat_shock", label: "Stat shock", guidance: "Lead with the surprising number/fact pattern; let the implication land." },
  { key: "before_after", label: "Before / after", guidance: "Paint the before state, cut to the after state, the mechanism in between." },
  { key: "objection_kill", label: "Objection killer", guidance: "Voice the viewer's main objection, then dismantle it line by line." },
  { key: "seasonal_fomo", label: "Seasonal FOMO", guidance: "The window is open NOW and closing; what waiting costs this season." },
  { key: "authority_proof", label: "Authority / proof", guidance: "Calm expert certainty; speak from experience and results, not hype." },
  { key: "relatable_daily", label: "Relatable day-to-day", guidance: "The small daily moment every one of them recognizes; humor allowed." },
  { key: "dream_outcome", label: "Dream outcome", guidance: "Pure aspiration: the life/business after the problem is gone." },
];

/** One remix: fill the workflow's copy boxes in a specific narrative angle, keeping the same
 *  structure and roughly the same line lengths so the timings still fit. */
export async function generateRemixCopy(args: {
  vertical: Vertical;
  workflow: Workflow;
  angle: RemixAngle;
  baseCopy?: StructuredCopyLine[];
}): Promise<StructuredCopyLine[]> {
  const roles = args.workflow.copy_structure ?? [];
  if (!roles.length) return [];
  const system = [
    `You are Vektor, the direct-response creative director for a ${args.vertical.business_descriptor}.`,
    "This workflow already produced a video. Write a REMIX: the same labeled structure, the same",
    `timings, a different narrative. Angle: ${args.angle.label} - ${args.angle.guidance}`,
    "Write ONE short line per box (10 words or fewer, so it fits the same on-screen slot).",
    "The lines must read as one continuous piece of copy in the new angle.",
    "",
    "COPY STRUCTURE (fill each box):",
    (args.workflow.copy_structure ?? []).map((r, i) => `${i + 1}. key="${r.key}" (${r.label}): ${r.guidance}`).join("\n"),
    "",
    avatarBlock(args.vertical),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<CopyLinesResult>({
    model: model(),
    system,
    user: [
      args.baseCopy?.length
        ? ["The ORIGINAL video's copy (do not repeat it, vary the narrative):", ...args.baseCopy.map((l) => `- [${l.label}] ${l.text}`)].join("\n")
        : "",
      `Return JSON: lines, one per box, each { key, text }. Keys: ${roles.map((r) => r.key).join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 900,
    temperature: 0.9,
    schemaHint: '{ "lines": [{ "key": string, "text": string }] }',
    validate: isCopyLines,
  });
  const byKey = new Map(data.lines.map((l) => [l.key, clean(l.text)]));
  return roles.map((r) => ({ key: r.key, label: r.label, text: byKey.get(r.key) ?? "" }));
}

export interface RemixVariation {
  key: string;
  label: string;
  lines: StructuredCopyLine[];
}

/** All 16 remixes in ONE call: for each angle, a full set of lines for the workflow's boxes.
 *  Best-effort: angles the model misses are simply left out of the result. */
export async function generateAllRemixes(args: {
  vertical: Vertical;
  workflow: Workflow;
  baseCopy?: StructuredCopyLine[];
}): Promise<RemixVariation[]> {
  const roles = args.workflow.copy_structure ?? [];
  if (!roles.length) return [];
  interface AllRemixesResult {
    variations: Array<{ key: string; lines: Array<{ key: string; text: string }> }>;
  }
  const isAll = (v: unknown): v is AllRemixesResult => {
    const p = v as AllRemixesResult;
    return (
      typeof v === "object" &&
      v !== null &&
      Array.isArray(p.variations) &&
      p.variations.length > 0 &&
      p.variations.every((x) => x && typeof x.key === "string" && Array.isArray(x.lines))
    );
  };
  const system = [
    `You are Vektor, the direct-response creative director for a ${args.vertical.business_descriptor}.`,
    "This workflow already produced a video. Write 16 REMIX variations: the same labeled",
    "structure and timings, each in a different narrative angle. One short line per box",
    "(10 words or fewer). Each variation must read as one continuous piece of copy.",
    "",
    "THE 16 ANGLES (return one variation per angle, using its key):",
    REMIX_ANGLES.map((a) => `- key="${a.key}" (${a.label}): ${a.guidance}`).join("\n"),
    "",
    "COPY STRUCTURE (fill each box in every variation):",
    roles.map((r, i) => `${i + 1}. key="${r.key}" (${r.label}): ${r.guidance}`).join("\n"),
    "",
    avatarBlock(args.vertical),
    "",
    "HARD RULES: never invent guarantees, numbers, rates, or terms; never use em dashes.",
  ].join("\n");

  const { data } = await callClaudeJSON<AllRemixesResult>({
    model: model(),
    system,
    user: [
      args.baseCopy?.length
        ? ["The ORIGINAL video's copy (vary the narrative, do not repeat it):", ...args.baseCopy.map((l) => `- [${l.label}] ${l.text}`)].join("\n")
        : "",
      `Return JSON: variations, one per angle, each { key: <angle key>, lines: [{ key, text }] }.`,
      `Line keys: ${roles.map((r) => r.key).join(", ")}.`,
    ]
      .filter(Boolean)
      .join("\n"),
    maxTokens: 8000,
    temperature: 0.9,
    schemaHint: '{ "variations": [{ "key": string, "lines": [{ "key": string, "text": string }] }] }',
    validate: isAll,
  });

  const byAngle = new Map(data.variations.map((v) => [v.key, v.lines]));
  const out: RemixVariation[] = [];
  for (const angle of REMIX_ANGLES) {
    const raw = byAngle.get(angle.key);
    if (!raw) continue;
    const byKey = new Map(raw.map((l) => [l.key, clean(l.text)]));
    const lines = roles.map((r) => ({ key: r.key, label: r.label, text: byKey.get(r.key) ?? "" }));
    if (lines.some((l) => l.text)) out.push({ key: angle.key, label: angle.label, lines });
  }
  return out;
}

// ---- Productize: turn a pasted FINISHED copy block into a full repeatable workflow ------
// The point: the structure (roles + shots + timings + textbox positions + category) becomes a
// repeatable pattern, so the same audio/structure can carry different copy next time.

export interface ProductizedLine {
  key: string; // role key from COPY_ROLE_LIBRARY
  label: string;
  text: string; // the operator's EXACT line
  shot: number; // 1-based
  at_second: number;
  out_second: number;
  position: string; // upper_side | upper_middle | center | lower
}

export interface ProductizedWorkflow {
  name: string; // the repeatable pattern name, not this specific copy
  category: string; // pov | broll | reveal | before_after
  subcategory: string | null;
  duration_seconds: number;
  shots: Array<{ i: number; start: number; end: number }>;
  lines: ProductizedLine[];
}

const PRODUCTIZE_CATEGORIES = ["pov", "broll", "reveal", "before_after"];
const PRODUCTIZE_POSITIONS = ["upper_side", "upper_middle", "center", "lower"];

function isProductized(v: unknown): v is ProductizedWorkflow {
  const p = v as ProductizedWorkflow;
  return (
    typeof v === "object" &&
    v !== null &&
    typeof p.name === "string" &&
    Array.isArray(p.shots) &&
    p.shots.length > 0 &&
    p.shots.every((s) => s && typeof s.i === "number" && typeof s.start === "number" && typeof s.end === "number") &&
    Array.isArray(p.lines) &&
    p.lines.length > 0 &&
    p.lines.every(
      (l) =>
        l &&
        typeof l.key === "string" &&
        typeof l.text === "string" &&
        typeof l.shot === "number" &&
        typeof l.at_second === "number" &&
        typeof l.out_second === "number"
    )
  );
}

/** Productize a pasted finished copy block: label every line with a role from the shared
 *  vocabulary, group the lines into shots, time each line, place each textbox, and name the
 *  repeatable pattern + category. The operator's wording is preserved verbatim. */
export async function productizeCopyToWorkflow(args: {
  vertical: Vertical;
  pastedBlock: string;
  hook?: string;
}): Promise<ProductizedWorkflow | null> {
  const roleVocab = Object.entries(COPY_ROLE_LIBRARY)
    .map(([k, v]) => `key="${k}" (${v.label}): ${v.guidance}`)
    .join("\n");
  const system = [
    "You are Vektor. The operator pasted FINISHED on-screen copy for a short vertical video.",
    "Productize it into a repeatable workflow structure: label every line with a role, group the",
    "lines into shots, and time each line to the second. Do NOT rewrite any line; keep the",
    "operator's exact words.",
    "",
    "ROLE VOCABULARY (assign each pasted line the best-fitting key; keep the pasted order; use",
    "each key at most once):",
    roleVocab,
    "",
    "TIMING / LAYOUT RULES (the house pattern, like the reference edit: 3 clips at",
    "0-3.5s / 3.4-8.3s / 8.3-11.3s with 6 stacked texts):",
    "- 2 to 4 shots, each about 3 to 5 seconds; total 9 to 15 seconds.",
    "- Shots are contiguous: shot N+1 starts where shot N ends (within 0.2s).",
    "- Each line gets at_second / out_second inside its shot's slot. A line may pop in mid-shot",
    "  and usually holds until its shot ends.",
    "- position is one of: upper_side, upper_middle, center, lower. The first line (avatar/hook)",
    "  sits at the top of the 9:16 frame; later lines on the same shot stack downward.",
    "",
    "NAMING: return a short workflow name (6 words or fewer) describing the repeatable PATTERN,",
    "not this specific copy. category is one of: pov, broll, reveal, before_after. subcategory is",
    "one short lowercase word (or empty).",
    "",
    "HARD RULES: keep the operator's exact wording; never use em dashes.",
  ].join("\n");

  try {
    const { data } = await callClaudeJSON<ProductizedWorkflow>({
      model: model(),
      system,
      user: [
        args.hook ? `The lead hook: ${args.hook}` : "",
        "Pasted copy (one line per on-screen text):",
        args.pastedBlock,
        "",
        "Return JSON: { name, category, subcategory, duration_seconds, shots: [{ i, start, end }],",
        '  lines: [{ key, label, text, shot, at_second, out_second, position }] }.',
      ]
        .filter(Boolean)
        .join("\n"),
      maxTokens: 1600,
      temperature: 0.3,
      schemaHint:
        '{ "name": string, "category": string, "subcategory": string, "duration_seconds": number, "shots": [{ "i": number, "start": number, "end": number }], "lines": [{ "key": string, "label": string, "text": string, "shot": number, "at_second": number, "out_second": number, "position": string }] }',
      validate: isProductized,
    });

    const shots = data.shots
      .map((s) => ({ i: s.i, start: s.start, end: s.end }))
      .sort((a, b) => a.i - b.i);
    const shotIdx = new Set(shots.map((s) => s.i));
    const lines: ProductizedLine[] = data.lines
      .map((l) => ({
        key: l.key,
        label: clean(l.label || COPY_ROLE_LIBRARY[l.key]?.label || l.key),
        text: clean(l.text),
        shot: shotIdx.has(l.shot) ? l.shot : shots[0].i,
        at_second: l.at_second,
        out_second: l.out_second,
        position: PRODUCTIZE_POSITIONS.includes(l.position) ? l.position : "center",
      }))
      .filter((l) => l.text);
    if (!lines.length) return null;
    const category = PRODUCTIZE_CATEGORIES.includes(String(data.category)) ? String(data.category) : "broll";
    const duration = data.duration_seconds || Math.max(...shots.map((s) => s.end));
    return {
      name: clean(data.name).slice(0, 60) || "Untitled pattern",
      category,
      subcategory: data.subcategory ? clean(String(data.subcategory)).toLowerCase().replace(/\s+/g, "_").slice(0, 24) || null : null,
      duration_seconds: duration,
      shots,
      lines,
    };
  } catch (e) {
    console.error("[creative-director] productizeCopyToWorkflow failed:", (e as Error).message);
    return null;
  }
}

/** Parse a pasted storyboard / timestamp block (freeform, like "Video 1 / 0.0 to 3.5 s / TXT 1
 *  ...") into a RenderSpec. Best-effort NL parse; returns null if it cannot be read. */
export async function parseStoryboardToRenderSpec(args: {
  text: string;
  mode?: RenderMode;
  songRef?: string | null;
}): Promise<RenderSpec | null> {
  const system = [
    "You are Vektor. Parse the operator's pasted storyboard into a strict JSON render spec.",
    "A 'Video N' / 'Shot N' block is one shot with a start and end second. Each 'TXT/txt N' line",
    "is one on-screen text with its own in/out seconds (and an optional [ROLE] tag and position",
    "note in parentheses). Read the seconds exactly as written. Do not invent text or timings.",
    "",
    "Return JSON: { mode, duration_seconds, shots: [{ i, start, end }],",
    '  texts: [{ n, text, at_second, out_second, role, position }] }.',
    "role is the [TAG] lowercased if present; position is the parenthetical note if present.",
  ].join("\n");

  interface ParsedSpec {
    duration_seconds?: number;
    shots: Array<{ i: number; start: number; end: number }>;
    texts: Array<{ n?: number; text: string; at_second: number; out_second?: number; role?: string; position?: string }>;
  }
  const isParsed = (v: unknown): v is ParsedSpec => {
    const p = v as ParsedSpec;
    return typeof v === "object" && v !== null && Array.isArray(p.shots) && Array.isArray(p.texts);
  };

  try {
    const { data } = await callClaudeJSON<ParsedSpec>({
      model: model(),
      system,
      user: ["Storyboard:", args.text, "", "Return the JSON render spec."].join("\n"),
      maxTokens: 1200,
      temperature: 0.2,
      schemaHint:
        '{ "mode": string, "duration_seconds": number, "shots": [{ "i": number, "start": number, "end": number }], "texts": [{ "n": number, "text": string, "at_second": number, "out_second": number, "role": string, "position": string }] }',
      validate: isParsed,
    });
    if (!data.shots.length) return null;
    const duration = data.duration_seconds || Math.max(...data.shots.map((s) => s.end));
    return {
      mode: args.mode ?? "static_images",
      song_ref: args.songRef ?? null,
      duration_seconds: duration,
      shots: data.shots.map((s) => ({ i: s.i, start: s.start, end: s.end })),
      texts: data.texts.map((t, idx) => ({
        n: t.n ?? idx + 1,
        text: clean(t.text),
        at_second: t.at_second,
        out_second: t.out_second,
        role: t.role,
        position: t.position,
      })),
    };
  } catch (e) {
    console.error("[creative-director] parseStoryboardToRenderSpec failed:", (e as Error).message);
    return null;
  }
}
