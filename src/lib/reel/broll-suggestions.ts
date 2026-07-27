// B-roll suggestion drop — the daily lane for verticals wired with drop_mode
// "broll_suggestions" (today: trt_clinic_ai). Instead of the reel_prompts path (LRU
// workflow -> 9 image prompts -> render), each drop posts 3 ready-to-shoot CINEMATIC
// B-roll ideas as text: the operator generates the video externally (Higgsfield /
// Seedance) or films the napkin idea himself. Nothing renders here — this is a copy
// deck, not an intake job.
//
// The 3 ideas spread across the avatar's three narrative "mood buckets" and, once a day
// (the midday slot), one is swapped for a bird's-eye napkin-explainer the operator shoots
// with a phone overhead + a Sharpie. Everything is grounded in the vertical's avatar /
// beliefs / offer and obeys the promise ban (never patients, appointments, or revenue;
// the mechanism is spoken as "showing up in ChatGPT," never "AEO"). See
// docs/clinic-broll-library.md for the buckets + napkin few-shot.

import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { stripEmDashes } from "@/lib/reel/text";
import { supabaseAdmin } from "@/lib/db";
import type { Vertical } from "@/config/verticals";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// The narrative mood buckets. `key` is stored for rotation; `name` labels the Slack card;
// `brief` steers the image prompt. Order matters: every drop leads invisible -> machine,
// then patient (or napkin on the midday slot).
const BUCKETS: Record<string, { name: string; brief: string }> = {
  invisible: {
    name: "\"You're invisible\" consequence",
    brief:
      "the cost of not being in the answer, shot as an empty place: rows of empty waiting-room chairs with dust turning in afternoon light; a dated telephone silent on an unattended front desk; an exam room lit and ready with nobody in it; a stack of printed SEO reports going soft under a cold monitor glow. Stillness and missed opportunity, nobody in frame.",
  },
  machine: {
    name: "\"The machine decides\" abstraction",
    brief:
      "the AI making the choice: glowing answer text streaming across a dark screen with one clinic name lit brighter than the rest; a directory of clinics as floating cards in dark space, most dim and grey, one lighting up and rising forward; an LED grid where a single dot is lit; a web of string connecting printed index cards, one card face-up and blank. Clean, futuristic, cinematic, the local clinic is the one that stays dark.",
  },
  patient: {
    name: "Patient-side wrapper",
    brief:
      "the moment of intent, shot through the objects rather than the person: a phone in a windshield mount at a stoplight showing a search, wet street blurred beyond the glass; a phone face-up on an empty waiting-room chair with the screen lit; a chat interface glowing outside a darkened clinic storefront at night. The device and the room tell it, no one holds anything.",
  },
};

// One B-roll idea in the deck. Cinematic ideas carry image_prompt + motion_prompt; the
// napkin idea carries sketch_script + voiceover_line (the operator films it overhead).
interface BrollIdea {
  bucket: string;
  belief: number;
  on_screen_hook: string;
  image_prompt?: string;
  motion_prompt?: string;
  sketch_script?: string;
  voiceover_line?: string;
}
interface BrollGen {
  ideas: BrollIdea[];
}

function isBrollGen(v: unknown): v is BrollGen {
  if (typeof v !== "object" || v === null) return false;
  const ideas = (v as BrollGen).ideas;
  return (
    Array.isArray(ideas) &&
    ideas.length > 0 &&
    ideas.every(
      (i) =>
        i &&
        typeof i.bucket === "string" &&
        typeof i.on_screen_hook === "string" &&
        typeof i.belief === "number"
    )
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

async function logIdeas(channel: string, slot: string, ideas: BrollIdea[]): Promise<void> {
  try {
    await supabaseAdmin.from("broll_drops").insert(
      ideas.map((i) => ({
        channel,
        slot,
        bucket: i.bucket,
        belief_n: i.belief,
        format: i.bucket === "napkin" ? "napkin" : "cinematic",
        on_screen_hook: i.on_screen_hook,
      }))
    );
  } catch (e) {
    console.error("[broll] failed to log rotation:", (e as Error).message);
  }
}

export function buildSystem(vertical: Vertical, avoid: string[]): string {
  const beliefLines = vertical.beliefs
    .filter((b) => OPENABLE_BELIEFS.includes(b.n))
    .map((b) => `  ${b.n}. ${b.label ? `(${b.label}) ` : ""}${stripEmDashes(b.text)}`);
  // The avatar's subject law (what may be in the shot) vs style_token (how it looks).
  const subjectRules = vertical.visual_rules ?? [];
  const negativeTail = vertical.image_negative ? `${stripEmDashes(vertical.image_negative)} ` : "";
  return [
    `You write short-form B-ROLL SHOT IDEAS for a ${vertical.business_descriptor}.`,
    "The narrative is always the same: when a man in his city asks AI (ChatGPT, Perplexity,",
    "Gemini) where to get treated, this local clinic is NOT in the answer — national $99/month",
    "telehealth brands are. Each idea is one scene that makes a single point, plus a short",
    "on-screen hook the operator will lay over it.",
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
    "  in ChatGPT', 'when a man in your city asks AI where to get treated'.",
    "- On-screen hooks are 8 words or fewer. Cold, dry, operator register — no hype words",
    "  (revolutionary, game-changing, skyrocket, crush, unlock), no emojis.",
    "- Any number you use must be real and from this set only: 45% (vs 6% a year ago) use AI",
    "  for local recommendations; 230 million health questions a week on ChatGPT; only 1.2% of",
    "  local businesses appear in ChatGPT (vs 35.9% in Google's local pack); ~85% of AI",
    "  citations are off-site; $99/month telehealth vs $169+ local; ~$876M raised by Ro; one",
    "  clinic per market; the 2005 Google Maps window (42% click the local pack).",
    "",
    ...(subjectRules.length
      ? [
          "SUBJECT RULES for every CINEMATIC image_prompt (a violation kills the idea):",
          ...subjectRules.map((r) => `- ${stripEmDashes(r)}`),
          "",
        ]
      : []),
    "For CINEMATIC ideas (buckets invisible / machine / patient):",
    "- image_prompt: one vivid still-image prompt obeying the SUBJECT RULES, in this exact",
    "  order: the look verbatim, then the scene, then the closing guards. Nothing after them.",
    `  Look (open with this, word for word): ${stripEmDashes(vertical.style_token)}`,
    `  Close with (word for word): ${negativeTail}no on-screen text, logos, or watermarks in the image, 9:16 vertical.`,
    "- motion_prompt: ONE Seedance motion line, camera/subject motion only, under 20 words, no",
    "  em dashes, no on-screen text.",
    "",
    "For the NAPKIN idea (bucket 'napkin') — a bird's-eye shot of hands + paper + a Sharpie the",
    "operator films himself, no actors, no clinic. The SUBJECT RULES above do NOT apply to it:",
    "it is live footage the operator shoots, not a generated image, and his hands are the point:",
    "- sketch_script: what the hand draws, step by step, to make ONE point visually in ~8",
    "  seconds (e.g. write '10 blue links' in a column, cross it all out with one stroke, draw",
    "  a single box beside it labeled '1 AI answer').",
    "- voiceover_line: one spoken sentence narrated over the drawing.",
    avoid.length
      ? `\nDo NOT repeat these recently-used hooks or their angle: ${avoid.map((h) => `"${h}"`).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatCard(vertical: Vertical, slot: string, ideas: BrollIdea[]): string {
  const lines: string[] = [
    `*B-roll drop (${slot})* for *${vertical.name}* — 3 ready-to-shoot ideas.`,
    "Drop a cinematic prompt into Higgsfield/Seedance. The napkin one you shoot yourself: phone on a tripod pointing straight down, hands + a Sharpie.",
  ];
  ideas.forEach((idea, i) => {
    const bucketName = idea.bucket === "napkin" ? "Napkin explainer (film it yourself)" : BUCKETS[idea.bucket]?.name ?? idea.bucket;
    lines.push("");
    lines.push(`*${i + 1} · ${bucketName}*  ·  opens belief ${idea.belief}`);
    lines.push(`On-screen: *${idea.on_screen_hook}*`);
    if (idea.bucket === "napkin") {
      if (idea.sketch_script) lines.push(`Draw: ${idea.sketch_script}`);
      if (idea.voiceover_line) lines.push(`Say: "${idea.voiceover_line}"`);
    } else {
      if (idea.image_prompt) lines.push("```\n" + idea.image_prompt + "\n```");
      if (idea.motion_prompt) lines.push(`Motion: ${idea.motion_prompt}`);
    }
  });
  return lines.join("\n");
}

/**
 * The 3x/day cron entry for drop_mode "broll_suggestions": post 3 cinematic B-roll ideas
 * (with a once-a-day napkin swap) to the channel. Text only — no render, no intake job.
 */
export async function runBrollSuggestionDrop(args: {
  channel: string;
  slot: string;
  vertical: Vertical;
}): Promise<{ ok: boolean; error?: string }> {
  const { channel, slot, vertical } = args;

  // One drop a day (midday) turns idea #3 into the film-it-yourself napkin explainer.
  const useNapkin = slot === "midday";
  const plan = [
    { bucket: "invisible" },
    { bucket: "machine" },
    { bucket: useNapkin ? "napkin" : "patient" },
  ];

  const avoid = await recentHooks(channel);
  const system = buildSystem(vertical, avoid);
  const user = [
    "Return exactly 3 ideas, one per slot below, in this order. Use the given bucket for each;",
    "pick a different belief for each; make the three hooks feel distinct.",
    // Each bucket's authored subject direction. This used to be dropped on the floor (only
    // the bucket key was sent), which is why the model kept inventing people as subjects.
    ...plan.map((p, i) => {
      const brief = BUCKETS[p.bucket]?.brief;
      return `Slot ${i + 1}: bucket "${p.bucket}".${brief ? ` Shoot ${brief}` : ""}`;
    }),
    "Return JSON only.",
  ].join("\n");

  let gen: BrollGen;
  try {
    const { data } = await callClaudeJSON<BrollGen>({
      model: model(),
      system,
      user,
      maxTokens: 1600,
      temperature: 0.9,
      schemaHint:
        '{ "ideas": [{ "bucket": string, "belief": number, "on_screen_hook": string, "image_prompt"?: string, "motion_prompt"?: string, "sketch_script"?: string, "voiceover_line"?: string }] }',
      validate: isBrollGen,
    });
    gen = data;
  } catch (e) {
    return { ok: false, error: `broll generation failed: ${(e as Error).message}` };
  }

  // Trust the planned bucket order over the model's echo, and drop em dashes everywhere.
  const ideas: BrollIdea[] = gen.ideas.slice(0, 3).map((idea, i) => ({
    ...idea,
    bucket: plan[i]?.bucket ?? idea.bucket,
    belief: OPENABLE_BELIEFS.includes(idea.belief) ? idea.belief : OPENABLE_BELIEFS[i % OPENABLE_BELIEFS.length],
    on_screen_hook: stripEmDashes(idea.on_screen_hook),
    image_prompt: idea.image_prompt ? stripEmDashes(idea.image_prompt) : undefined,
    motion_prompt: idea.motion_prompt ? stripEmDashes(idea.motion_prompt) : undefined,
    sketch_script: idea.sketch_script ? stripEmDashes(idea.sketch_script) : undefined,
    voiceover_line: idea.voiceover_line ? stripEmDashes(idea.voiceover_line) : undefined,
  }));
  if (!ideas.length) return { ok: false, error: "no ideas generated" };

  const posted = (await slack.postMessage(channel, formatCard(vertical, slot, ideas))) as { ts?: string };
  if (!posted?.ts) return { ok: false, error: "could not post the b-roll card" };

  await logIdeas(channel, slot, ideas);
  return { ok: true };
}
