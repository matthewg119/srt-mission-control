// The ONE content pipeline. Every single-image format flows through this, driven by its row
// in src/config/format-registry.ts. Replaces the per-format orchestrators (bug-reveal.ts,
// pov.ts drop, pov-studio.ts picker) with a single robotic flow:
//
//   runDrop            -> IDEATE: pick scenes, post ideas, gate ✅/🚫              (stage=ideate)
//   handlePipelineReaction (✅) -> SHOT: generate images, post options, gate 1/2/3 (stage=shot)
//   handlePipelineReaction (1/2/3) -> BUILD: reveal (if edit) + CAPTION (5, POV#1) (stage=build->done)
//
// Reactions and thread replies self-route by looking the job up in content_jobs, so the Slack
// events route calls ONE dispatcher instead of ten per-format branches.
//
// Rendering is deliberately deferred: no Phase-1 format sets rendersVideo, so DELIVER = the
// hook image + 5 captions + animation prompt (operator animates in Higgsfield).

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { generateImages, editImage } from "@/lib/providers/image-gen";
import { povImageProvider, buildPovImagePrompt, uploadToReels } from "@/lib/reel/pov";
import { enrichScene } from "@/lib/reel/prompt-enrich";
import {
  loadStyleRulesText,
  distillFeedbackToRules,
  savePendingRules,
} from "@/lib/reel/style-rules";
import { generateHookCopy, buildHookCopySystem } from "@/lib/reel/captions";
import { buildBugAddInstruction } from "@/config/bug-reveal-style";
import { POV_SOUL_SIZE, POV_IMAGE_SIZE } from "@/config/pov-style";
import { loadVertical, type Vertical } from "@/config/verticals";
import { getFormat, type ContentFormat } from "@/config/format-registry";
import type { ReelSlot } from "@/config/reel-style";
import {
  insertJob,
  getJobByPickerTs,
  getLatestJobByThread,
  updateJob,
  type ContentJob,
  type ShotOption,
} from "@/lib/reel/jobs";

const APPROVE_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check"]);
const SKIP_REACTIONS = new Set(["no_entry", "no_entry_sign", "x"]);
const REACTION_TO_OPTION: Record<string, number> = { one: 1, two: 2, three: 3 };
const REMIX_RE = /\b(remix|regenerate|regen|another|again|different|fresh|more|others?|examples|new options|not (that|these))\b/i;

function titleize(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** Pick `n` distinct scenes from the format's pool (Fisher-Yates on a copy). */
function pickScenes(format: ContentFormat, n: number): string[] {
  const pool = [...format.scenePool];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

function logEvent(format: ContentFormat, description: string, metadata: Record<string, unknown>) {
  return supabaseAdmin.from("system_logs").insert({
    event_type: "content_pipeline",
    description: `[${format.id}] ${description}`,
    metadata: { format_id: format.id, ...metadata },
  });
}

// ---- IDEATE: post scene ideas + gate ✅/🚫 --------------------------------------------

export interface RunDropArgs {
  channel: string;
  date: string;
  slot: ReelSlot;
}

export interface RunDropResult {
  format_id: string;
  thread_ts?: string;
  scenes: string[];
  status: "awaiting_approval";
}

/** Post one drop for a format: ideas-first, gated on ✅ so image credits only follow approval. */
export async function runDrop(format: ContentFormat, args: RunDropArgs): Promise<RunDropResult> {
  const start = Date.now();
  const { channel, date, slot } = args;
  const scenes = pickScenes(format, format.shotCount);

  const header = `${format.headerEmoji} *${format.label}, ${date}* (${slot})\n_React ✅ to generate the ${scenes.length} ${format.ideaNoun} shots, or 🚫 to skip._`;
  const main = (await slack.postMessage(channel, header)) as { ts?: string };
  const threadTs = main?.ts;
  if (!threadTs) throw new Error(`failed to post ${format.id} header`);

  const ideasText = [
    `*${titleize(format.ideaNoun)} shots for this drop:*`,
    ...scenes.map((s, i) => `${i + 1}. ${titleize(s)}`),
    "",
    "React ✅ on this message to generate all of them, or 🚫 to skip this drop.",
  ].join("\n");
  const gate = (await slack.postThreadReply(channel, threadTs, ideasText)) as { ts?: string };

  await insertJob({
    formatId: format.id,
    verticalId: format.verticalId,
    channel,
    threadTs,
    pickerTs: gate?.ts ?? null,
    stage: "ideate",
    data: { scenes: scenes.map((scene, i) => ({ index: i + 1, scene })) },
  });

  await logEvent(format, `${scenes.length} ideas posted, awaiting approval`, {
    slot,
    scenes,
    duration_ms: Date.now() - start,
  });

  return { format_id: format.id, thread_ts: threadTs, scenes, status: "awaiting_approval" };
}

// ---- Reaction dispatcher (ideate gate + shot pick) -----------------------------------

/**
 * One entry point for every reaction on a pipeline job. Self-routes by content_jobs +
 * the job's current stage. Returns true when handled so the events route can stop.
 */
export async function handlePipelineReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const job = await getJobByPickerTs(args.slackTs);
  if (!job || job.status !== "active") return false;
  const format = getFormat(job.format_id);
  if (!format) return false;

  if (job.stage === "ideate") return handleIdeasGate(job, format, args.reaction);
  if (job.stage === "shot") return handleShotPick(job, format, args.reaction);
  return false;
}

async function handleIdeasGate(job: ContentJob, format: ContentFormat, reaction: string): Promise<boolean> {
  const approve = APPROVE_REACTIONS.has(reaction);
  const skip = SKIP_REACTIONS.has(reaction);
  if (!approve && !skip) return false;

  if (skip) {
    await updateJob(job, { stage: "skipped", status: "skipped" });
    await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, "🚫 Skipped this drop. No images generated.");
    return true;
  }

  // Claim first (guard double-tap), then generate in the background.
  await updateJob(job, { stage: "build", status: "active" }); // transient guard; set to 'shot' when options post
  waitUntil(
    generateShotsForJob(job, format).catch((e) => failJob(job, "image generation", e))
  );
  return true;
}

async function handleShotPick(job: ContentJob, format: ContentFormat, reaction: string): Promise<boolean> {
  const optNum = REACTION_TO_OPTION[reaction];
  if (!optNum) return false;
  const chosen = (job.data.scenes ?? []).find((o) => o.index === optNum && o.url);
  if (!chosen) return false;

  await updateJob(job, { stage: "build", data: { chosen } });
  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, `✅ Option ${optNum} chosen. Finishing it…`);
  waitUntil(buildForJob(job, format, chosen).catch((e) => failJob(job, "build", e)));
  return true;
}

// ---- SHOT: generate the option images, post them, gate 1/2/3 --------------------------

async function generateShotsForJob(job: ContentJob, format: ContentFormat): Promise<number> {
  const start = Date.now();
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const provider = povImageProvider();
  const vertical = await loadVertical(format.verticalId);

  const scenes = (job.data.scenes ?? []).map((o) => o.scene).filter(Boolean);
  if (scenes.length === 0) {
    await slack.postThreadReply(channel, threadTs, "🚫 No scenes stored; nothing to generate.");
    await updateJob(job, { stage: "error", status: "error" });
    return 0;
  }

  await slack.postThreadReply(channel, threadTs, `⏳ Generating ${scenes.length} ${format.ideaNoun} shots…`);

  // Ground each scene in the reference library + active style rules (byte-identical to the raw
  // scene when both are empty), then generate all options in parallel.
  const grounded = await Promise.all(
    scenes.map((s) => enrichScene(s, { vertical, formatGroup: format.formatGroup }))
  );
  const prompts = await Promise.all(grounded.map((s) => buildPovImagePrompt(s, vertical)));
  const imgs = await Promise.all(
    prompts.map((p) => generateImages({ prompts: [p], provider, size: POV_SOUL_SIZE }).then((r) => r[0] ?? null))
  );

  const options: ShotOption[] = [];
  for (let i = 0; i < imgs.length; i++) {
    const img = imgs[i];
    if (!img) {
      await slack.postThreadReply(channel, threadTs, [`⚠️ Option ${i + 1} failed (${provider}). Prompt:`, "```", prompts[i], "```"].join("\n"));
      continue;
    }
    const url = await uploadToReels(img.buffer, img.mimetype);
    if (!url) {
      await slack.postThreadReply(channel, threadTs, `⚠️ Option ${i + 1} generated but could not be stored. Skipping.`);
      continue;
    }
    const index = options.length + 1;
    await slack.postThreadReply(channel, threadTs, `*Option ${index}*`);
    await slack.uploadFile(channel, `${format.id}-${index}.png`, img.buffer, img.mimetype, threadTs);
    options.push({ index, scene: scenes[i], url, mimetype: img.mimetype });
  }

  if (options.length === 0) {
    await slack.postThreadReply(channel, threadTs, "🚫 All shots failed. Check the image provider credentials/credits.");
    await updateJob(job, { stage: "error", status: "error" });
    return 0;
  }

  const nums = options.map((o) => `${o.index}️⃣`).join(" ");
  const verb =
    format.kind === "before_after_edit"
      ? "I'll then spray it: add the bugs, write the caption, titles, and the animation prompt."
      : "I'll then write the caption, 5 titles, and the animation prompt.";
  const pick = (await slack.postThreadReply(channel, threadTs, `React ${nums} to pick the one you like. ${verb}`)) as { ts?: string };

  await updateJob(job, { stage: "shot", pickerTs: pick?.ts ?? null, data: { scenes: options } });
  await logEvent(format, `${options.length}/${imgs.length} shots posted`, { provider, duration_ms: Date.now() - start });
  return options.length;
}

// ---- BUILD: reveal (edit formats) + the 5-option copy, then DELIVER -------------------

async function buildForJob(job: ContentJob, format: ContentFormat, chosen: ShotOption): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const vertical = await loadVertical(format.verticalId);
  const rulesText = await loadStyleRulesText(vertical.id, format.formatGroup);

  let afterUrl: string | null = null;

  // before_after_edit: produce the "after" frame (edit the chosen before, or a fresh after).
  if (format.kind === "before_after_edit") {
    afterUrl = await buildAfterFrame(job, format, vertical, rulesText, chosen);
  }

  // CAPTION (standardized): 5 options (POV #1) + caption + animation prompt (+ after-image prompt).
  const system = buildHookCopySystem(format.copyStyle, vertical, rulesText, format.animationSpec);
  const copy = await generateHookCopy({
    scene: chosen.scene,
    system,
    withAfterFrame: format.kind === "before_after_edit",
    povFallback: `POV: a regular day as a ${vertical.wearer_role}`,
  });

  const titles = copy.options.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const lines = [
    "*Title options (pick one, #1 is the POV default):*",
    titles,
    "",
    "*Caption:*",
    copy.caption,
    "",
    `*Animation prompt:* ${copy.animation_prompt}`,
  ];
  if (format.kind === "before_after_edit") {
    lines.push(
      "",
      "*After-image prompt (to reproduce frame 2 on its own):*",
      "```",
      copy.after_image_prompt ?? "(none returned)",
      "```",
      "",
      "*Split test both animations, keep the winner:*",
      "• *A* = the *before* image + the animation prompt above.",
      afterUrl
        ? "• *B* = *before + after* images (first frame to last frame) + the animation prompt above."
        : "• *B* = needs the after frame (it failed this time); rerun to get before + after interpolation."
    );
  } else {
    lines.push("", "_Animate the hook image in Higgsfield with the prompt above, then post with title #1._");
  }

  await slack.postThreadReply(channel, threadTs, lines.join("\n"));
  await updateJob(job, { stage: "done", status: "done", data: { after_image_url: afterUrl, copy } });
  await logEvent(format, "delivered", { after_ok: Boolean(afterUrl), scene: chosen.scene, kind: format.kind });
}

/** The "after" frame for before_after_edit formats: edit the chosen before, or generate fresh. */
async function buildAfterFrame(
  job: ContentJob,
  format: ContentFormat,
  vertical: Vertical,
  rulesText: string,
  chosen: ShotOption
): Promise<string | null> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  let afterBuffer: Buffer | null = null;
  let afterMime = "image/png";

  // Preferred (needs OPENAI_API_KEY): edit the exact chosen before so the two frames line up.
  if (process.env.OPENAI_API_KEY && chosen.url) {
    const src = await fetch(chosen.url);
    if (src.ok) {
      const srcBuf = Buffer.from(await src.arrayBuffer());
      const srcMime = src.headers.get("content-type") || chosen.mimetype || "image/png";
      const instruction = buildBugAddInstruction(chosen.scene, rulesText);
      const edited = await editImage({ image: srcBuf, mimetype: srcMime, prompt: instruction, size: POV_IMAGE_SIZE });
      if (edited) {
        afterBuffer = edited.buffer;
        afterMime = edited.mimetype;
      }
    }
  }

  // Higgsfield path (no OpenAI key): fresh text2image of the same seam with the swarm.
  if (!afterBuffer) {
    const groundedBase = await enrichScene(chosen.scene, { vertical, formatGroup: format.formatGroup });
    const afterPrompt = await buildPovImagePrompt(
      `${groundedBase} Now a dense swarm of German cockroaches is pouring out of that exact seam and scattering fast across the floor away from the spray.`,
      vertical
    );
    const [fresh] = await generateImages({ prompts: [afterPrompt], provider: povImageProvider(), size: POV_SOUL_SIZE });
    if (fresh) {
      afterBuffer = fresh.buffer;
      afterMime = fresh.mimetype;
    }
  }

  if (!afterBuffer) {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't produce the after frame. Copy + prompts still below.");
    return null;
  }
  const afterUrl = await uploadToReels(afterBuffer, afterMime);
  await slack.postThreadReply(channel, threadTs, "*After (bugs pouring from the sprayed seam)*");
  await slack.uploadFile(channel, "after.png", afterBuffer, afterMime, threadTs);
  return afterUrl;
}

async function failJob(job: ContentJob, phase: string, e: unknown): Promise<void> {
  console.error(`[pipeline] ${phase} failed:`, (e as Error).message);
  await updateJob(job, { stage: "error", status: "error" });
  await slack.postThreadReply(
    job.slack_channel,
    job.slack_thread_ts,
    `🚫 ${phase} failed (${(e as Error).message.slice(0, 160)}).`
  );
}

// ---- Thread replies: remix (fresh options) + tuning feedback (✅-gated rules) ----------

const OPTION_WORDS: Record<string, number> = { first: 1, second: 2, third: 3 };

function parseTargetOptions(text: string, available: number[]): number[] {
  const found = new Set<number>();
  const re = /\b(?:option|image|img|pic|photo|number|no\.?|#)?\s*([1-3])\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (available.includes(n)) found.add(n);
  }
  for (const [word, n] of Object.entries(OPTION_WORDS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(text) && available.includes(n)) found.add(n);
  }
  return [...found];
}

/**
 * A text reply on a pipeline drop thread. Two interpretations, in order:
 *   1. tuning feedback ("make the furnace older") -> live preview + ✅-gated style rules.
 *   2. "remix / more / another"                    -> regenerate a fresh set of options.
 * Returns true when handled. Best-effort.
 */
export async function handlePipelineThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const job = await getLatestJobByThread(args.threadTs);
  if (!job) return false;
  const format = getFormat(job.format_id);
  if (!format) return false;

  const opts = job.data.scenes ?? [];

  // 1) Tuning feedback -> distilled rules + a preview, then ✅-gate the save.
  if (opts.length > 0) {
    const tuned = await handleTuningFeedback(job, format, args.text);
    if (tuned) return true;
  }

  // 2) Remix -> fresh options (skips the gate, like the old bug-reveal remix).
  if (REMIX_RE.test(args.text)) {
    const scenes = pickScenes(format, format.shotCount);
    await updateJob(job, {
      stage: "build",
      status: "active",
      data: { scenes: scenes.map((s, i) => ({ index: i + 1, scene: s })), chosen: undefined, after_image_url: null },
    });
    await slack.postThreadReply(args.channel, args.threadTs, `🔁 On it, generating ${scenes.length} fresh options…`);
    waitUntil(generateShotsForJob(job, format).catch((e) => failJob(job, "remix", e)));
    return true;
  }

  return false;
}

async function handleTuningFeedback(job: ContentJob, format: ContentFormat, text: string): Promise<boolean> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const vertical = await loadVertical(format.verticalId);
  const opts = job.data.scenes ?? [];

  let distilled;
  try {
    distilled = await distillFeedbackToRules({ text, formatGroup: format.formatGroup, verticalId: vertical.id });
  } catch (e) {
    console.error("[pipeline] feedback distill failed:", (e as Error).message);
    return false;
  }
  if (distilled.intent !== "tune" || distilled.rules.length === 0) return false;

  const available = opts.map((o) => o.index);
  let targets = parseTargetOptions(text, available);
  if (targets.length === 0) {
    targets = job.data.chosen?.index && available.includes(job.data.chosen.index) ? [job.data.chosen.index] : [available[0]];
  }
  targets = targets.slice(0, 3);

  await slack.postThreadReply(channel, threadTs, `🔁 Applying your changes to option ${targets.join(", ")} and regenerating a preview…`);
  const ruleStrings = distilled.rules.map((r) => r.rule);

  waitUntil(
    (async () => {
      try {
        const provider = povImageProvider();
        let posted = 0;
        for (const idx of targets) {
          const opt = opts.find((o) => o.index === idx);
          if (!opt) continue;
          const grounded = await enrichScene(opt.scene, { vertical, formatGroup: format.formatGroup, extraRules: ruleStrings });
          const prompt = await buildPovImagePrompt(grounded, vertical);
          const [img] = await generateImages({ prompts: [prompt], provider, size: POV_SOUL_SIZE });
          if (!img) {
            await slack.postThreadReply(channel, threadTs, `⚠️ Preview for option ${idx} failed.`);
            continue;
          }
          await slack.postThreadReply(channel, threadTs, `*Option ${idx} with your changes (preview)*`);
          await slack.uploadFile(channel, `preview-${idx}.png`, img.buffer, img.mimetype, threadTs);
          posted++;
        }

        const lines = distilled.rules.map((r, i) => {
          const tag = r.scope === "brand" ? "brand" : r.format_group ?? format.formatGroup;
          return `${i + 1}. [${tag}] ${r.rule}`;
        });
        const card = (await slack.postThreadReply(
          channel,
          threadTs,
          [
            posted > 0 ? "☝️ Preview above." : "Preview could not be generated, but you can still save the rule.",
            "🎚️ *Keep these changes?* React ✅ to save them for future drops, or 🚫 to discard.",
            ...lines,
          ].join("\n")
        )) as { ts?: string };
        if (card?.ts) {
          await savePendingRules(distilled.rules, { verticalId: vertical.id, channel, threadTs, proposalTs: card.ts });
        }
      } catch (e) {
        console.error("[pipeline] feedback preview failed:", (e as Error).message);
        await slack.postThreadReply(channel, threadTs, `🚫 Preview failed (${(e as Error).message.slice(0, 140)}).`);
      }
    })()
  );
  return true;
}
