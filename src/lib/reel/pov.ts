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

import { randomUUID } from "crypto";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { stripEmDashes } from "@/lib/reel/text";
import { generateImages, type ImageProvider } from "@/lib/providers/image-gen";
import { POV_SCENES, POV_SOUL_SIZE, POV_STYLE_VERSION } from "@/config/pov-style";
import type { ReelSlot } from "@/config/reel-style";
import { getActiveVertical, type Vertical } from "@/config/verticals";

// Image provider for the POV/workflow scene paths. Default is "higgsfield-gpt" -
// OpenAI's GPT image model served by the Higgsfield key API (slug openai/hazel) -
// per Matthew's standing rule: ALL image generation uses the GPT image model, Soul is
// only for the trained-character (Vargas) belief drop. Overridable per call/workflow
// via render_options.provider, or globally via POV_IMAGE_PROVIDER.
export function povImageProvider(): ImageProvider {
  const p = (process.env.POV_IMAGE_PROVIDER || "higgsfield-gpt").toLowerCase();
  if (p === "higgsfield" || p === "elevenlabs" || p === "openai" || p === "higgsfield-gpt") {
    return p as ImageProvider;
  }
  return "higgsfield-gpt";
}

/** Build the POV image prompt: the vertical's style token + the scene (no text overlay). */
export async function buildPovImagePrompt(scene: string, vertical?: Vertical): Promise<string> {
  const v = vertical ?? (await getActiveVertical());
  return `${v.style_token}\n\nScene: ${scene}\n\nNo text, captions, logos, or watermark in the image.`;
}

/**
 * Generate a single POV/workflow scene image. Defaults to the GPT image model at the
 * portrait 3:4 look (POV_SOUL_SIZE maps to the model's nearest portrait aspect);
 * per-workflow overrides (render_options.provider/aspect/quality) come in via opts.
 */
export async function generatePovImage(
  prompt: string,
  opts?: { provider?: ImageProvider; aspect?: string; quality?: string }
) {
  const provider = opts?.provider ?? povImageProvider();
  const [img] = await generateImages({
    prompts: [prompt],
    provider,
    size: POV_SOUL_SIZE,
    aspect: opts?.aspect,
    quality: opts?.quality,
  });
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

function buildPovSystem(v: Vertical): string {
  const lines = [
    `You are the content engine for a ${v.business_descriptor}. You write short-form video`,
    "concepts produced as ONE continuous AI clip animated from a first frame to a last",
    "frame, styled to look like real footage captured on Ray-Ban Meta smart glasses.",
    "",
    `The wearer is the ${v.wearer_role}. This is a first-person personal account:`,
    "we see their own gloved hands and forearms in the lower frame performing the task.",
    "",
    "GLOBAL VISUAL STYLE (already applied to the rendered image, keep it in mind):",
    v.style_token,
    "",
    "HARD RULES:",
    "- WTF HOOK: the scene is a scroll-stopping reveal (an infestation, a swarm, a gross discovery). Treat the first frame as a 'wait, what is that' moment; the curiosity caption and title #1 must lean into that shock, not describe a calm routine task.",
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
    JSON.stringify(v.gold_examples, null, 2),
  ];
  // POV videos stay hook-driven: no offer/sales block, per operator direction. The
  // open-loop hook + the gold examples carry the concept; offer-weaving lives elsewhere.
  return lines.join("\n");
}

const SCHEMA_HINT =
  '{ "idea": string, "image_prompt": string, "animation_prompt": string, ' +
  '"captions": { "authority": string, "relatable": string, "curiosity": string }, ' +
  '"titles": [string] }';

/** One Claude call: scene -> idea + image_prompt + animation_prompt + 3 captions + 6 titles. */
export async function generatePovConcept(scene: string, vertical?: Vertical): Promise<PovConcept> {
  const v = vertical ?? (await getActiveVertical());
  const user = [
    `Scene: ${scene}`,
    "Hook direction: a candid, first-person personal account of the technician doing this task.",
    "",
    "Return the JSON concept for this scene.",
  ].join("\n");

  const { data } = await callClaudeJSON<PovConcept>({
    model: model(),
    system: buildPovSystem(v),
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
export async function pickDistinctPovScene(_slot: ReelSlot, scenes: string[] = POV_SCENES): Promise<string> {
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

  const available = scenes.map((_, i) => i).filter((i) => !recent.includes(i));
  const pool = available.length > 0 ? available : scenes.map((_, i) => i);
  const idx = pool[Math.floor(Math.random() * pool.length)];
  return scenes[idx];
}

/** Pick `n` distinct POV scenes not recently used (falls back to fill if the pool is short). */
export async function pickDistinctPovScenes(n: number, scenes: string[] = POV_SCENES): Promise<string[]> {
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

  const shuffle = (arr: number[]) => {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };

  const all = scenes.map((_, i) => i);
  const fresh = shuffle(all.filter((i) => !recent.includes(i)));
  const rest = shuffle(all.filter((i) => recent.includes(i)));
  const ordered = [...fresh, ...rest].slice(0, Math.min(n, all.length));
  return ordered.map((i) => scenes[i]);
}

/** Persist that `scene` was just used, capping the recent list so rotation keeps moving. */
export async function recordPovScene(scene: string, pool: string[] = POV_SCENES): Promise<void> {
  await recordPovScenes([scene], pool);
}

/** Persist that several scenes were just used (drop of 3), capping the recent list. */
export async function recordPovScenes(scenes: string[], pool: string[] = POV_SCENES): Promise<void> {
  const idxs = scenes.map((s) => pool.indexOf(s)).filter((i) => i !== -1);
  if (idxs.length === 0) return;
  const cap = Math.min(9, Math.max(idxs.length, pool.length - 1));
  try {
    const { data } = await supabaseAdmin
      .from("pov_rotation")
      .select("id,recent")
      .eq("id", "pov")
      .maybeSingle();
    const prev = (data as PovRotationRow | null)?.recent ?? [];
    const recent = [...prev.filter((i) => !idxs.includes(i)), ...idxs].slice(-cap);
    await supabaseAdmin
      .from("pov_rotation")
      .upsert({ id: "pov", recent, updated_at: new Date().toISOString() }, { onConflict: "id" });
  } catch (e) {
    console.error("[pov] recordPovScenes failed:", (e as Error).message);
  }
}

/** Upload a generated image to the Supabase `reels` bucket; returns a public URL or null. */
export async function uploadToReels(buffer: Buffer, mimetype: string): Promise<string | null> {
  try {
    const ext = (mimetype.split("/")[1] || "png").replace(/[^a-z0-9]/gi, "") || "png";
    const key = `pov/${randomUUID()}.${ext}`;
    const up = await supabaseAdmin.storage.from("reels").upload(key, buffer, { contentType: mimetype, upsert: true });
    if (up.error) {
      console.error("[pov] reels upload failed:", up.error.message);
      return null;
    }
    return supabaseAdmin.storage.from("reels").getPublicUrl(key).data.publicUrl;
  } catch (e) {
    console.error("[pov] reels upload threw:", (e as Error).message);
    return null;
  }
}

// ---- Drop orchestration -----------------------------------------------------------

export interface RunPovDropArgs {
  channel: string;
  date: string;
  slot: ReelSlot;
  vertical?: Vertical;
}

export interface PovDropResult {
  thread_ts?: string;
  scenes: string[];
  images_ok: number;
  /** "awaiting_approval" (ideas posted, no images yet) | "posted" | "all_failed". */
  status?: string;
}

/** How many image options the daily drop generates for the operator to pick from. */
const POV_OPTIONS_PER_DROP = 3;

/** Sentence-case a scene string for the ideas list (scenes are stored lower-case). */
function titleizeScene(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Post one Meta Glasses POV drop as its OWN top-level message in #content-full.
 *
 * IDEAS-FIRST GATE: this posts the 3 scene IDEAS as text and asks the operator to react
 * ✅ to generate them (or 🚫 to skip), so image credits are only spent on approved ideas.
 * The ✅ reaction is handled by handlePovIdeasApproval (pov-studio.ts) which calls
 * generatePovImagesForJob below. Throws are caught by the cron caller so a POV failure
 * never breaks the belief drop.
 */
export async function runPovDrop(args: RunPovDropArgs): Promise<PovDropResult> {
  const start = Date.now();
  const { channel, date, slot } = args;
  const vertical = args.vertical ?? (await getActiveVertical());
  const scenePool = vertical.scenes ?? POV_SCENES;

  const scenes = await pickDistinctPovScenes(POV_OPTIONS_PER_DROP, scenePool);

  const header = `🕶️ *Meta Glasses POV, ${date}* (${slot})\n_First-person WTF-hook ideas. React ✅ to generate all ${scenes.length}, or 🚫 to skip._`;
  const main = (await slack.postMessage(channel, header)) as { ok?: boolean; ts?: string };
  const threadTs = main?.ts;
  if (!threadTs) throw new Error("failed to post POV header to #content-full");

  const ideasText = [
    "*Scene ideas for this drop:*",
    ...scenes.map((s, i) => `${i + 1}. ${titleizeScene(s)}`),
    "",
    "React ✅ on this message to generate all of them, or 🚫 to skip this drop.",
  ].join("\n");
  const gate = (await slack.postThreadReply(channel, threadTs, ideasText)) as { ts?: string };

  // Record rotation now so the next drop doesn't repeat these scenes even if skipped.
  await recordPovScenes(scenes, scenePool);

  // Stash the chosen scenes on the job (as {index, scene}) so the ✅ handler can generate
  // exactly these. No images/urls yet; the gate status keeps handlePovDropPick from firing.
  await supabaseAdmin.from("pov_studio_jobs").insert({
    slack_channel: channel,
    slack_thread_ts: threadTs,
    picker_msg_ts: gate?.ts ?? null,
    images: scenes.map((scene, i) => ({ index: i + 1, scene })),
    source_kind: "image",
    status: "awaiting_ideas_approval",
  });

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_pov_drop",
    description: `POV drop ${slot}: ${scenes.length} ideas posted, awaiting approval`,
    metadata: { slot, scenes, style_version: POV_STYLE_VERSION, images_ok: 0, status: "awaiting_approval", duration_ms: Date.now() - start },
  });

  return { thread_ts: threadTs, scenes, images_ok: 0, status: "awaiting_approval" };
}

/** Minimal job shape generatePovImagesForJob needs (a pov_studio_jobs row). */
export interface PovIdeasJob {
  id: string;
  slack_channel: string;
  slack_thread_ts: string;
  images: Array<{ index: number; scene?: string }> | null;
}

/**
 * PHASE B — the operator approved the ideas (✅). Generate one image per stashed scene
 * (plain Soul, no character, 3:4), post them as labeled options, and flip the job to
 * awaiting_pick with the real image options + a "react 1/2/3 to pick" message (which
 * handlePovDropPick then routes into the Render/Animate/Recreate workflow breakdown).
 */
export async function generatePovImagesForJob(job: PovIdeasJob): Promise<number> {
  const start = Date.now();
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const provider = povImageProvider();
  const vertical = await getActiveVertical();

  const scenes = (job.images ?? []).map((o) => o.scene ?? "").filter(Boolean);
  if (scenes.length === 0) {
    await slack.postThreadReply(channel, threadTs, "🚫 No scenes stored for this drop; nothing to generate.");
    await supabaseAdmin.from("pov_studio_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
    return 0;
  }

  await slack.postThreadReply(channel, threadTs, `⏳ Generating ${scenes.length} images…`);

  const prompts = await Promise.all(scenes.map((s) => buildPovImagePrompt(s, vertical)));
  // Plain Soul text2image (no soulId) at true 3:4 — never fails on a missing character.
  const imgs = await generateImages({ prompts, provider, size: POV_SOUL_SIZE });

  const options: Array<{ index: number; scene: string; url: string; mimetype: string }> = [];
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (!img) {
      await slack.postThreadReply(
        channel,
        threadTs,
        [`⚠️ Option ${i + 1} failed (${provider}). Prompt:`, "```", prompts[i], "```"].join("\n")
      );
      continue;
    }
    const url = await uploadToReels(img.buffer, img.mimetype);
    if (!url) {
      await slack.postThreadReply(channel, threadTs, `⚠️ Option ${i + 1} generated but could not be stored. Skipping.`);
      continue;
    }
    const index = options.length + 1;
    await slack.postThreadReply(channel, threadTs, `*Option ${index}*`);
    await slack.uploadFile(channel, `pov-${index}.png`, img.buffer, img.mimetype, threadTs);
    options.push({ index, scene: scenes[i], url, mimetype: img.mimetype });
  }

  if (options.length === 0) {
    await slack.postThreadReply(channel, threadTs, "🚫 All image options failed. Check the image provider credentials/credits.");
    await supabaseAdmin.from("pov_studio_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_pov_drop",
      description: `POV drop generate: all ${imgs.length} options failed`,
      metadata: { scenes, provider, style_version: POV_STYLE_VERSION, images_ok: 0, duration_ms: Date.now() - start },
    });
    return 0;
  }

  const nums = options.map((o) => `${o.index}️⃣`).join(" ");
  const pick = (await slack.postThreadReply(
    channel,
    threadTs,
    `React ${nums} to pick the best option. I'll then show you what we can do with it (Render / Animate / Recreate).`
  )) as { ts?: string };

  await supabaseAdmin
    .from("pov_studio_jobs")
    .update({
      images: options,
      picker_msg_ts: pick?.ts ?? null,
      status: "awaiting_pick",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_pov_drop",
    description: `POV drop generate: ${options.length}/${imgs.length} options posted`,
    metadata: { scenes, provider, style_version: POV_STYLE_VERSION, images_ok: options.length, duration_ms: Date.now() - start },
  });

  return options.length;
}
