// B-roll suggestion drop - the daily lane for verticals wired with drop_mode
// "broll_suggestions". Each drop posts 3 ready-to-shoot B-roll ideas as text: the
// operator generates the still externally or films the napkin idea himself. Nothing
// renders here - this is a copy deck, not an intake job.
//
// WHAT CHANGED (the variety rebuild): this file used to hold three hardcoded mood
// buckets whose briefs enumerated the same dozen scenes, and it prepended
// `vertical.style_token` verbatim to every prompt. Every drop came back looking like
// the last one: same waiting room, same muted grade, same empty frame.
//
// Now the SHOT is dealt in code (src/config/shot-grammar.ts): subject, capture format,
// light, grade, framing and presence, none of them repeating against the recent history
// in `broll_drops`. The model only writes the one sentence of scene detail that sits
// inside that dealt constraint, plus the hook. The final image_prompt is ASSEMBLED here,
// so the axes cannot be flattened back into "cinematic muted 35mm" by a helpful model.
//
// Everything is grounded in the vertical's avatar / beliefs / offer and obeys the
// promise ban (never patients, appointments, or revenue; the mechanism is spoken as
// "showing up in ChatGPT," never "AEO"). See docs/clinic-broll-library.md.

import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeImageInput, type ClaudeModel } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { supabaseAdmin } from "@/lib/db";
import type { Vertical } from "@/config/verticals";
import { loadReferenceFrames } from "@/lib/reel/content-examples";
import {
  dealShots,
  renderShotBrief,
  shotGuards,
  shotKeys,
  shotLabel,
  grammarSize,
  type RecentShots,
  type ShotLane,
  type ShotSpec,
} from "@/config/shot-grammar";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// The narrative angles a drop can take. `lane` decides which half of the subject
// library the shot is dealt from: `owner` for the metaphors of an invisible business,
// `treatment` for the two angles that need the room itself (identity resonance, and
// the direct their-chair-is-full contrast). Angles rotate LRU like everything else,
// so the deck stopped being "invisible, machine, patient" three times a day.
interface Angle {
  key: string;
  name: string;
  lane: ShotLane;
  brief: string;
}

export const ANGLES: Angle[] = [
  {
    key: "invisible",
    name: "You are invisible",
    lane: "owner",
    brief: "the cost of not being in the answer: the business is running, the work is good, and nobody arrives.",
  },
  {
    key: "machine",
    name: "The machine decides",
    lane: "owner",
    brief: "the answer is being written somewhere else, by something that never asked her, and it names other people.",
  },
  {
    key: "intent",
    name: "The moment of intent",
    lane: "owner",
    brief: "a real person deciding right now, on a phone, somewhere in her city, without ever seeing her.",
  },
  {
    key: "money",
    name: "What the empty day costs",
    lane: "owner",
    brief: "the arithmetic of a slow week, told through the objects that carry the bill.",
  },
  {
    key: "competitor",
    name: "Their chair is full",
    lane: "treatment",
    brief: "the contrast: the same work, the same room, and the appointments landing somewhere else.",
  },
  {
    key: "burned",
    name: "The agencies you already fired",
    lane: "owner",
    brief: "what is left behind after paying for marketing that produced reports instead of patients.",
  },
  {
    key: "identity",
    name: "Why you opened it",
    lane: "treatment",
    brief: "the reason she left a stable paycheck, shot as the craft itself, quiet and unglamorous.",
  },
  {
    key: "window",
    name: "The window is closing",
    lane: "owner",
    brief: "position is cumulative and there is room for one business per market; the seat is still empty today.",
  },
];

// One B-roll idea in the deck. Cinematic ideas carry image_prompt + motion_prompt; the
// napkin idea carries sketch_script (the operator films it overhead). Both carry a
// voiceover_line so `vo` can render them.
export interface BrollIdea {
  bucket: string;
  belief: number;
  on_screen_hook: string;
  image_prompt?: string;
  motion_prompt?: string;
  sketch_script?: string;
  voiceover_line?: string;
  shot?: ShotSpec;
}

// What the model returns. It writes the words and ONE sentence of scene detail; it does
// not get to write the look - that is dealt and assembled here.
interface GenIdea {
  slot: number;
  belief: number;
  on_screen_hook: string;
  scene_detail?: string;
  motion_prompt?: string;
  sketch_script?: string;
  voiceover_line?: string;
}
interface BrollGen {
  ideas: GenIdea[];
}

function isBrollGen(v: unknown): v is BrollGen {
  if (typeof v !== "object" || v === null) return false;
  const ideas = (v as BrollGen).ideas;
  return (
    Array.isArray(ideas) &&
    ideas.length > 0 &&
    ideas.every((i) => i && typeof i.on_screen_hook === "string" && typeof i.belief === "number")
  );
}

// Beliefs a B-roll hook may open (per the master prompt: 1-5 and 7; belief 9 is warm-only).
const OPENABLE_BELIEFS = [1, 2, 3, 4, 5, 7];

async function recentHooks(channel: string): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from("broll_drops")
      .select("on_screen_hook")
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(9);
    return (data ?? [])
      .map((r) => (r as { on_screen_hook?: string }).on_screen_hook)
      .filter((h): h is string => typeof h === "string" && h.length > 0);
  } catch {
    return [];
  }
}

/**
 * Which angles ran most recently, newest first, so the drop can pick three that have
 * been cold the longest instead of the same three every time.
 */
async function recentAngles(channel: string): Promise<string[]> {
  try {
    const { data } = await supabaseAdmin
      .from("broll_drops")
      .select("bucket")
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(24);
    return (data ?? [])
      .map((r) => (r as { bucket?: string }).bucket)
      .filter((b): b is string => typeof b === "string" && b.length > 0);
  } catch {
    return [];
  }
}

/**
 * The recently-dealt axis values for this channel. Tolerates a DB without the
 * shot-grammar columns (migration not applied yet) by returning an empty history, in
 * which case the dealer just has nothing to avoid.
 */
async function recentShots(channel: string): Promise<RecentShots> {
  try {
    const { data, error } = await supabaseAdmin
      .from("broll_drops")
      .select("subject_key,capture_key,light_key,grade_key,framing_key,presence_key")
      .eq("channel", channel)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error || !Array.isArray(data)) {
      if (error) console.error("[broll] shot history unavailable (run the migration):", error.message);
      return {};
    }
    const col = (name: string) =>
      data
        .map((r) => (r as Record<string, unknown>)[name])
        .filter((v): v is string => typeof v === "string" && v.length > 0);
    return {
      subject: col("subject_key"),
      capture: col("capture_key"),
      light: col("light_key"),
      grade: col("grade_key"),
      framing: col("framing_key"),
      presence: col("presence_key"),
    };
  } catch {
    return {};
  }
}

async function logIdeas(channel: string, slot: string, ideas: BrollIdea[]): Promise<void> {
  const base = ideas.map((i) => ({
    channel,
    slot,
    bucket: i.bucket,
    belief_n: i.belief,
    format: i.bucket === "napkin" ? "napkin" : "cinematic",
    on_screen_hook: i.on_screen_hook,
  }));
  const withShots = base.map((row, n) => ({ ...row, ...(ideas[n].shot ? shotKeys(ideas[n].shot) : {}) }));
  try {
    const { error } = await supabaseAdmin.from("broll_drops").insert(withShots);
    if (!error) return;
    // The shot-grammar columns are additive; without them the insert still has to land
    // so hook/angle rotation keeps working.
    console.error("[broll] shot-column insert failed, retrying without it:", error.message);
    const { error: fallback } = await supabaseAdmin.from("broll_drops").insert(base);
    if (fallback) console.error("[broll] failed to log rotation:", fallback.message);
  } catch (e) {
    console.error("[broll] failed to log rotation:", (e as Error).message);
  }
}

export function buildSystem(vertical: Vertical, avoid: string[]): string {
  const beliefLines = vertical.beliefs
    .filter((b) => OPENABLE_BELIEFS.includes(b.n))
    .map((b) => `  ${b.n}. ${b.label ? `(${b.label}) ` : ""}${stripEmDashes(b.text)}`);
  const subjectRules = vertical.visual_rules ?? [];
  return [
    `You write short-form B-ROLL SHOT IDEAS for a ${vertical.business_descriptor}.`,
    "The narrative is always the same: when someone in her city asks AI (ChatGPT, Perplexity,",
    "Gemini) where to go, this local business is NOT in the answer - the national chains are.",
    "Each idea is one scene that makes a single point, plus a short on-screen hook the operator",
    "will lay over it.",
    "",
    "WHO you're speaking to:",
    stripEmDashes(vertical.avatar_summary),
    "",
    "The belief each hook may open (choose one per idea, from these only):",
    ...beliefLines,
    "",
    "The offer, for grounding (never quote it literally in a hook):",
    `  Problem: ${stripEmDashes(vertical.offer.ump)}`,
    `  Solution: ${stripEmDashes(vertical.offer.ums)}`,
    "",
    "HARD RULES (a violation kills the idea):",
    "- Never promise or imply patients, appointments, bookings, revenue, or growth. The only",
    "  claimable outcome is measurable, self-verifiable visibility in AI answers.",
    "- Never use the words AEO, GEO, or 'AI SEO'. Say it in the owner's language: 'showing up",
    "  in ChatGPT', 'when someone in your city asks AI where to go'.",
    "- On-screen hooks are 8 words or fewer. Cold, dry, operator register - no hype words",
    "  (revolutionary, game-changing, skyrocket, crush, unlock), no emojis.",
    "- Any number you use must be real and from this set only:",
    ...(vertical.approved_numbers ?? []).map((n) => `  ${stripEmDashes(n)}`),
    "",
    "THE SHOT IS ALREADY CHOSEN. Each slot below arrives with a fixed subject, capture format,",
    "light, grade, framing and presence. You do NOT get to change it, restate it, or make it",
    "cinematic. Do not write camera, lens, grade, mood or lighting words at all - they are",
    "already handled and repeating them is what made every past drop look identical.",
    "",
    "For CINEMATIC slots you return, per slot:",
    "- scene_detail: ONE sentence, under 30 words, adding concrete specifics to the given",
    "  subject so it carries the belief. Objects, wear, what is written or not written, what is",
    "  missing. No camera or lighting language. Never ask for readable words on paper or",
    "  screens: describe lettering as out of focus, too small to read, or turned away.",
    "- motion_prompt: ONE motion line for the animator, camera/subject motion only, under 20",
    "  words, no em dashes, no on-screen text.",
    "- voiceover_line: 12 to 22 words, spoken register, quiet threat not hype. Use [pause] where",
    "  the voice should breathe. The last word lands as the on-screen hook appears.",
    "",
    "For the NAPKIN slot - a bird's-eye shot of hands + paper + a Sharpie the operator films",
    "himself, no actors, no clinic. No dealt shot applies to it:",
    "- sketch_script: what the hand draws, step by step, to make ONE point visually in ~8",
    "  seconds (e.g. write '10 blue links' in a column, cross it all out with one stroke, draw",
    "  a single box beside it labeled '1 AI answer').",
    "- voiceover_line: one spoken sentence narrated over the drawing.",
    ...(subjectRules.length
      ? ["", "Standing subject rules for this avatar:", ...subjectRules.map((r) => `- ${stripEmDashes(r)}`)]
      : []),
    avoid.length
      ? `\nDo NOT repeat these recently-used hooks or their angle: ${avoid.map((h) => `"${h}"`).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Assemble the final prompt: dealt shot, then the model's detail, then the guards. */
function assemblePrompt(spec: ShotSpec, sceneDetail: string, vertical: Vertical): string {
  const detail = stripEmDashes(sceneDetail).trim();
  const withStop = detail && !/[.!?]$/.test(detail) ? `${detail}.` : detail;
  return [renderShotBrief(spec), withStop, shotGuards(vertical.image_negative)].filter(Boolean).join(" ");
}

function formatCard(vertical: Vertical, slot: string, ideas: BrollIdea[]): string {
  const lines: string[] = [
    `*B-roll drop (${slot})* for *${vertical.name}* - 3 ready-to-shoot ideas.`,
    "Generate the still from the prompt, then hand the motion line to the animator. The napkin one you shoot yourself: phone on a tripod pointing straight down, hands + a Sharpie.",
  ];
  ideas.forEach((idea, i) => {
    const angle = ANGLES.find((a) => a.key === idea.bucket);
    const bucketName = idea.bucket === "napkin" ? "Napkin explainer (film it yourself)" : angle?.name ?? idea.bucket;
    lines.push("");
    lines.push(`*${i + 1} · ${bucketName}*  ·  opens belief ${idea.belief}`);
    lines.push(`On-screen: *${idea.on_screen_hook}*`);
    if (idea.bucket === "napkin") {
      if (idea.sketch_script) lines.push(`Draw: ${idea.sketch_script}`);
    } else {
      if (idea.image_prompt) lines.push("```\n" + idea.image_prompt + "\n```");
      if (idea.motion_prompt) lines.push(`Motion: ${idea.motion_prompt}`);
      if (idea.shot) lines.push(`_Shot: ${shotLabel(idea.shot)}_`);
    }
    if (idea.voiceover_line) lines.push(`Say: "${idea.voiceover_line}"`);
  });
  lines.push("");
  lines.push(`_Reply \`vo\` to render the voiceovers. ${grammarSize().toLocaleString("en-US")} shot combinations in the grammar._`);
  return lines.join("\n");
}

/**
 * Pick `count` angles that have been cold the longest. `recent` is newest-first, so a HIGHER
 * index means the angle ran longer ago, and an angle that has never run sorts first.
 */
export function pickAngles(recent: string[], count: number): Angle[] {
  const coldness = (a: Angle) => {
    const i = recent.indexOf(a.key);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...ANGLES].sort((a, b) => coldness(b) - coldness(a)).slice(0, count);
}

/**
 * The 3x/day cron entry for drop_mode "broll_suggestions": post 3 B-roll ideas (with a
 * once-a-day napkin swap) to the channel. Text only - no render, no intake job.
 */
export async function runBrollSuggestionDrop(args: {
  channel: string;
  slot: string;
  vertical: Vertical;
}): Promise<{ ok: boolean; error?: string }> {
  const { channel, slot, vertical } = args;

  const [avoid, angleHistory, shotHistory] = await Promise.all([
    recentHooks(channel),
    recentAngles(channel),
    recentShots(channel),
  ]);

  // Real photos the operator has fed the library steer the scene detail. Empty until the
  // reference-ask cron has collected some, and harmless when empty.
  const frames = await loadReferenceFrames(vertical.id, { limit: 4 }).catch(() => []);

  let ideas: BrollIdea[];
  try {
    ideas = await buildIdeas({ vertical, slot, avoid, angleHistory, shotHistory, frames });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  if (!ideas.length) return { ok: false, error: "no ideas generated" };

  const posted = (await slack.postMessage(channel, formatCard(vertical, slot, ideas))) as { ts?: string };
  if (!posted?.ts) return { ok: false, error: "could not post the b-roll card" };

  await logIdeas(channel, slot, ideas);
  await rememberVoiceovers(channel, posted.ts, ideas);
  return { ok: true };
}

/**
 * Generate one drop's ideas: deal the shots, ask for the words, assemble the prompts.
 * Everything except Slack and the DB, so `scripts/_probe-clinic-prompts.ts` exercises the
 * exact production path without posting or logging.
 */
export async function buildIdeas(args: {
  vertical: Vertical;
  slot: string;
  avoid?: string[];
  angleHistory?: string[];
  shotHistory?: RecentShots;
  frames?: ClaudeImageInput[];
}): Promise<BrollIdea[]> {
  const { vertical, slot } = args;
  const avoid = args.avoid ?? [];
  const shotHistory = args.shotHistory ?? {};
  const frames = args.frames ?? [];

  // One drop a day (midday) turns idea #3 into the film-it-yourself napkin explainer.
  const useNapkin = slot === "midday";
  const cinematicCount = useNapkin ? 2 : 3;

  const angles = pickAngles(args.angleHistory ?? [], cinematicCount);
  const specs = dealShots({
    lane: "owner",
    count: cinematicCount,
    recent: shotHistory,
    lanes: angles.map((a) => a.lane),
  });

  const system = buildSystem(vertical, avoid);
  const user = [
    `Return exactly ${cinematicCount + (useNapkin ? 1 : 0)} ideas, one per slot below, in this order.`,
    "Pick a different belief for each; make the hooks feel distinct.",
    "",
    ...angles.map((a, i) =>
      [
        `Slot ${i + 1} - angle "${a.key}" (${a.name}): ${a.brief}`,
        `  The shot is fixed: ${renderShotBrief(specs[i])}`,
        "  Write scene_detail for THIS subject only. Do not propose a different subject.",
      ].join("\n")
    ),
    ...(useNapkin ? [`Slot ${cinematicCount + 1} - the NAPKIN explainer. sketch_script + voiceover_line only.`] : []),
    "Return JSON only.",
  ].join("\n");

  let gen: BrollGen;
  {
    const { data } = await callClaudeJSON<BrollGen>({
      model: model(),
      system,
      user,
      images: frames.length ? frames : undefined,
      maxTokens: 1800,
      temperature: 0.9,
      schemaHint:
        '{ "ideas": [{ "slot": number, "belief": number, "on_screen_hook": string, "scene_detail"?: string, "motion_prompt"?: string, "sketch_script"?: string, "voiceover_line"?: string }] }',
      validate: isBrollGen,
    });
    gen = data;
  }

  const ideas: BrollIdea[] = [];
  for (let i = 0; i < cinematicCount; i++) {
    const raw = gen.ideas[i];
    if (!raw) continue;
    ideas.push({
      bucket: angles[i].key,
      belief: OPENABLE_BELIEFS.includes(raw.belief) ? raw.belief : OPENABLE_BELIEFS[i % OPENABLE_BELIEFS.length],
      on_screen_hook: stripEmDashes(raw.on_screen_hook),
      image_prompt: assemblePrompt(specs[i], raw.scene_detail ?? "", vertical),
      motion_prompt: raw.motion_prompt ? stripEmDashes(raw.motion_prompt) : undefined,
      voiceover_line: raw.voiceover_line ? stripEmDashes(raw.voiceover_line) : undefined,
      shot: specs[i],
    });
  }
  if (useNapkin) {
    const raw = gen.ideas[cinematicCount];
    if (raw) {
      ideas.push({
        bucket: "napkin",
        belief: OPENABLE_BELIEFS.includes(raw.belief) ? raw.belief : OPENABLE_BELIEFS[0],
        on_screen_hook: stripEmDashes(raw.on_screen_hook),
        sketch_script: raw.sketch_script ? stripEmDashes(raw.sketch_script) : undefined,
        voiceover_line: raw.voiceover_line ? stripEmDashes(raw.voiceover_line) : undefined,
      });
    }
  }
  return ideas;
}

// ---- voiceover handoff -------------------------------------------------------------------

/**
 * Park the drop's voiceover lines on the posted message so a `vo` reply in that thread
 * can render them without re-running generation. Best-effort: a failure here only costs
 * the `vo` shortcut, not the drop.
 */
async function rememberVoiceovers(channel: string, threadTs: string, ideas: BrollIdea[]): Promise<void> {
  const lines = ideas.map((i) => i.voiceover_line).filter((l): l is string => Boolean(l));
  if (!lines.length) return;
  try {
    await supabaseAdmin.from("broll_voiceovers").insert({ channel, thread_ts: threadTs, lines });
  } catch (e) {
    console.error("[broll] could not park voiceover lines:", (e as Error).message);
  }
}

/** The parked voiceover lines for a drop thread, or [] when there are none. */
export async function loadVoiceoverLines(channel: string, threadTs: string): Promise<string[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("broll_voiceovers")
      .select("lines")
      .eq("channel", channel)
      .eq("thread_ts", threadTs)
      .maybeSingle();
    if (error || !data) return [];
    const lines = (data as { lines?: unknown }).lines;
    return Array.isArray(lines) ? lines.filter((l): l is string => typeof l === "string") : [];
  } catch {
    return [];
  }
}
