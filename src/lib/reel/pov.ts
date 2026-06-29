// Meta Glasses POV format — creative agent + drop orchestration.
//
// A SECOND content format for the Daily Creative Drop (the belief flow is untouched).
// Each cron fire also posts a first-person "personal account of a pest control
// specialist" drop, styled like real Ray-Ban Meta glasses footage. Unlike the belief
// flow, the image is AUTO-GENERATED (gpt-image-2) so we see the real output and tune
// the prompt. The copy (animation prompt + 3 captions + 6 POV titles) is one Claude
// call anchored on the gold few-shot examples in src/config/pov-style.ts.
//
// Scene rotation lives in the Supabase `pov_rotation` table (docs/2026-06-29-pov-rotation.sql).

import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { stripEmDashes } from "@/lib/reel/text";
import { generateImages, type ImageProvider } from "@/lib/providers/image-gen";
import {
  POV_SCENES,
  POV_STYLE_VERSION,
  POV_GLASSES_TOKEN,
  POV_GOLD_EXAMPLES,
  buildPovImagePrompt,
} from "@/config/pov-style";
import type { ReelSlot } from "@/config/reel-style";

// Image provider for the POV format only (the rest of the system keeps IMAGE_PROVIDER).
// Default gpt-image-2; set POV_IMAGE_PROVIDER=higgsfield to reuse the Vargas Soul / HF
// credentials instead (no extra OpenAI key needed). Higgsfield needs HIGGSFIELD_SOUL_ID.
export function povImageProvider(): ImageProvider {
  const p = (process.env.POV_IMAGE_PROVIDER || "openai").toLowerCase();
  return (p === "higgsfield" || p === "elevenlabs" ? p : "openai") as ImageProvider;
}

/** Generate the single POV image with the configured POV provider (Soul id only used by higgsfield). */
export async function generatePovImage(prompt: string) {
  const provider = povImageProvider();
  const soulId = provider === "higgsfield" ? process.env.HIGGSFIELD_SOUL_ID : undefined;
  const [img] = await generateImages({ prompts: [prompt], provider, soulId });
  return img;
}

export interface PovConcept {
  idea: string;
  image_prompt: string;
  animation_prompt: string; // motion only, one sentence
  captions: { authority: string; relatable: string; curiosity: string };
  titles: string[]; // 6 POV titles
}

function isPovConcept(v: unknown): v is PovConcept {
  if (typeof v !== "object" || v === null) return false;
  const c = v as PovConcept;
  const caps = c.captions;
  return (
    typeof c.idea === "string" &&
    typeof c.image_prompt === "string" &&
    typeof c.animation_prompt === "string" &&
    typeof caps === "object" &&
    caps !== null &&
    typeof caps.authority === "string" &&
    typeof caps.relatable === "string" &&
    typeof caps.curiosity === "string" &&
    Array.isArray(c.titles) &&
    c.titles.length > 0 &&
    c.titles.every((t) => typeof t === "string")
  );
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

const SYSTEM = [
  "You are the content engine for a pest control business. You write short-form video",
  "concepts produced as ONE continuous AI clip animated from a first frame to a last",
  "frame, styled to look like real footage captured on Ray-Ban Meta smart glasses.",
  "",
  "The wearer is the pest control technician. This is a first-person personal account:",
  "we see their own gloved hands and forearms in the lower frame performing the task.",
  "",
  "GLOBAL VISUAL STYLE (already applied to the rendered image, keep it in mind):",
  POV_GLASSES_TOKEN,
  "",
  "HARD RULES:",
  "- image_prompt describes ONE continuous shot; it contains NO on-screen text (text is added in post).",
  "- animation_prompt = motion only (head/camera movement + the hands' action), ONE sentence.",
  "- captions: return exactly three, one per style:",
  "    authority  = positions the business as the expert; calm, factual.",
  "    relatable  = homeowner POV, light humor, conversational.",
  "    curiosity  = a scroll-stopping tease that makes them watch to the end.",
  "- titles: return exactly six on-screen title options; lead with 'POV:' style; #1 is the default; each 7 words or fewer.",
  "- Never invent funding numbers, rates, terms, or guarantees.",
  "- Never use em dashes or en dashes. Use commas, periods, or hyphens.",
  "",
  "Match the quality and style of these gold examples exactly:",
  JSON.stringify(POV_GOLD_EXAMPLES, null, 2),
].join("\n");

const SCHEMA_HINT =
  '{ "idea": string, "image_prompt": string, "animation_prompt": string, ' +
  '"captions": { "authority": string, "relatable": string, "curiosity": string }, ' +
  '"titles": [string] }';

/** One Claude call: scene -> idea + image_prompt + animation_prompt + 3 captions + 6 titles. */
export async function generatePovConcept(scene: string): Promise<PovConcept> {
  const user = [
    `Scene: ${scene}`,
    "Hook direction: a candid, first-person personal account of the technician doing this task.",
    "",
    "Return the JSON concept for this scene.",
  ].join("\n");

  const { data } = await callClaudeJSON<PovConcept>({
    model: model(),
    system: SYSTEM,
    user,
    maxTokens: 1400,
    temperature: 0.7,
    schemaHint: SCHEMA_HINT,
    validate: isPovConcept,
  });

  return {
    idea: stripEmDashes(data.idea),
    image_prompt: stripEmDashes(data.image_prompt),
    animation_prompt: stripEmDashes(data.animation_prompt),
    captions: {
      authority: stripEmDashes(data.captions.authority),
      relatable: stripEmDashes(data.captions.relatable),
      curiosity: stripEmDashes(data.captions.curiosity),
    },
    titles: data.titles.slice(0, 6).map((t) => stripEmDashes(t)),
  };
}

// ---- Scene rotation (Supabase `pov_rotation`, single 'pov' row) -------------------

interface PovRotationRow {
  id: string;
  recent: number[];
}

/** Pick a POV_SCENES index not in the recent list (fall back to any if all recently used). */
export async function pickDistinctPovScene(_slot: ReelSlot): Promise<string> {
  let recent: number[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("pov_rotation")
      .select("id,recent")
      .eq("id", "pov")
      .maybeSingle();
    const row = data as PovRotationRow | null;
    recent = Array.isArray(row?.recent) ? row!.recent : [];
  } catch {
    recent = [];
  }

  const available = POV_SCENES.map((_, i) => i).filter((i) => !recent.includes(i));
  const pool = available.length > 0 ? available : POV_SCENES.map((_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return POV_SCENES[idx];
}

/** Persist that `scene` was just used, capping the recent list so rotation keeps moving. */
export async function recordPovScene(scene: string): Promise<void> {
  const idx = POV_SCENES.indexOf(scene);
  if (idx === -1) return;
  const cap = Math.min(8, Math.max(1, POV_SCENES.length - 1));
  try {
    const { data } = await supabaseAdmin
      .from("pov_rotation")
      .select("id,recent")
      .eq("id", "pov")
      .maybeSingle();
    const prev = (data as PovRotationRow | null)?.recent ?? [];
    const recent = [...prev.filter((i) => i !== idx), idx].slice(-cap);
    await supabaseAdmin
      .from("pov_rotation")
      .upsert({ id: "pov", recent, updated_at: new Date().toISOString() }, { onConflict: "id" });
  } catch (e) {
    console.error("[pov] recordPovScene failed:", (e as Error).message);
  }
}

// ---- Drop orchestration -----------------------------------------------------------

export interface RunPovDropArgs {
  channel: string;
  date: string;
  slot: ReelSlot;
}

export interface PovDropResult {
  thread_ts?: string;
  scene: string;
  image_ok: boolean;
}

/**
 * Post one Meta Glasses POV drop as its OWN top-level message in #content-full:
 * generate the image (gpt-image-2) -> post header + image -> post the creative copy.
 * Step 1/2 only (no animation/render). Throws are caught by the cron caller so a POV
 * failure can never break the belief drop.
 */
export async function runPovDrop(args: RunPovDropArgs): Promise<PovDropResult> {
  const start = Date.now();
  const { channel, date, slot } = args;

  const scene = await pickDistinctPovScene(slot);
  const imagePrompt = buildPovImagePrompt(scene);

  const img = await generatePovImage(imagePrompt);

  const header = `🕶️ *Meta Glasses POV, ${date}* (${slot})\n_First-person personal account, auto-generated image (${povImageProvider()})._`;
  const main = (await slack.postMessage(channel, header)) as { ok?: boolean; ts?: string };
  const threadTs = main?.ts;

  if (!threadTs) {
    throw new Error("failed to post POV header to #content-full");
  }

  if (img) {
    await slack.uploadFile(channel, `pov-${slot}.png`, img.buffer, img.mimetype, threadTs);
  } else {
    await slack.postThreadReply(
      channel,
      threadTs,
      [`⚠️ Image generation failed (${povImageProvider()}). Prompt to render manually:`, "```", imagePrompt, "```"].join("\n")
    );
  }

  const concept = await generatePovConcept(scene);
  const titles = concept.titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
  await slack.postThreadReply(
    channel,
    threadTs,
    [
      `*Idea:* ${concept.idea}`,
      "",
      `*Animation (motion only):* ${concept.animation_prompt}`,
      "",
      "*Captions*",
      `• *Authority:* ${concept.captions.authority}`,
      `• *Relatable:* ${concept.captions.relatable}`,
      `• *Curiosity:* ${concept.captions.curiosity}`,
      "",
      "*POV titles* (pick one):",
      titles,
      "",
      "_Reference image prompt:_",
      "```",
      concept.image_prompt,
      "```",
    ].join("\n")
  );

  await recordPovScene(scene);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_pov_drop",
    description: `POV drop ${slot}: ${scene.slice(0, 60)}`,
    metadata: {
      slot,
      scene,
      style_version: POV_STYLE_VERSION,
      image_ok: !!img,
      duration_ms: Date.now() - start,
    },
  });

  return { thread_ts: threadTs, scene, image_ok: !!img };
}
