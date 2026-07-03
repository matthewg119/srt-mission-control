// Bug-Reveal Spray format — daily-drop orchestration.
//
// The immediate-reward POV reel: spray a seam, roaches pour out. Flow (ideas-first so image
// credits are only spent on approved ideas, per operator direction):
//
//   runBugRevealDrop (cron)  -> post 3 "before" scene IDEAS, wait for ✅/🚫
//   handleBugRevealIdeasApproval (✅) -> generate 3 BEFORE images, post Option 1/2/3, wait 1/2/3
//   handleBugRevealPick (1/2/3) -> add bugs onto the chosen BEFORE frame (editImage),
//                                  write caption + 5 POV titles + animation_prompt +
//                                  after_image_prompt, post it all + the A/B animation note.
//
// State lives in the `bug_reveal_jobs` table (docs/2026-07-01-bug-reveal.sql), isolated from
// pov_studio_jobs so the 1/2/3 pick never collides with the POV picker. The video render
// itself stays manual/deferred (Step 1 = assets + prompts), like the POV drop.

import { waitUntil } from "@vercel/functions";
import { callClaudeJSON, type ClaudeModel } from "@/lib/claude-calls";
import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";
import { stripEmDashes } from "@/lib/reel/text";
import { generateImages, editImage, imageGenEnabled, IMAGE_GEN_PAUSED_NOTE } from "@/lib/providers/image-gen";
import { povImageProvider, buildPovImagePrompt, uploadToReels } from "@/lib/reel/pov";
import { enrichScene } from "@/lib/reel/prompt-enrich";
import { loadStyleRulesText, distillFeedbackToRules, savePendingRules } from "@/lib/reel/style-rules";
import { POV_SOUL_SIZE, POV_IMAGE_SIZE } from "@/config/pov-style";
import {
  BUG_REVEAL_SCENES,
  BUG_REVEAL_STYLE_VERSION,
  BUG_REVEAL_COPY_SCHEMA_HINT,
  buildBugAddInstruction,
  buildBugRevealCopySystem,
} from "@/config/bug-reveal-style";
import { getActiveVertical } from "@/config/verticals";
import type { ReelSlot } from "@/config/reel-style";

// Format group tag for two-tier style rules + reference-grounded prompt enrichment.
export const BUG_REVEAL_FORMAT_GROUP = "bug_reveal";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

// ✅ approve / 🚫 skip reactions for the ideas-first gate (same set the POV drop uses).
const APPROVE_REACTIONS = new Set(["white_check_mark", "heavy_check_mark", "ballot_box_with_check"]);
const SKIP_REACTIONS = new Set(["no_entry", "no_entry_sign", "x"]);
const REACTION_TO_OPTION: Record<string, number> = { one: 1, two: 2, three: 3 };

const OPTIONS_PER_DROP = 3;

const JOB_COLS =
  "id,slack_channel,slack_thread_ts,picker_msg_ts,before_images,chosen_before,after_image_url,status";

interface BeforeOption {
  index: number;
  scene: string;
  url?: string;
  mimetype?: string;
}

interface BugRevealJobRow {
  id: string;
  slack_channel: string;
  slack_thread_ts: string;
  picker_msg_ts: string | null;
  before_images: BeforeOption[] | null;
  chosen_before: BeforeOption | null;
  after_image_url: string | null;
  status:
    | "awaiting_ideas_approval"
    | "generating"
    | "skipped"
    | "awaiting_pick"
    | "building"
    | "done"
    | "error";
}

// Pick `n` distinct before-scenes at random (Fisher-Yates). The pool is small and the drop is
// the only consumer, so a per-drop random pick is enough (no cross-drop rotation table needed).
function pickBeforeScenes(n: number): string[] {
  const pool = [...BUG_REVEAL_SCENES];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(n, pool.length));
}

function titleize(s: string): string {
  const t = s.trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// ---- Copy generation --------------------------------------------------------------

export interface BugRevealCopy {
  caption: string;
  titles: string[];
  animation_prompt: string;
  after_image_prompt: string;
}

function isBugRevealCopy(v: unknown): v is BugRevealCopy {
  if (typeof v !== "object" || v === null) return false;
  const c = v as BugRevealCopy;
  return (
    typeof c.caption === "string" &&
    typeof c.animation_prompt === "string" &&
    typeof c.after_image_prompt === "string" &&
    Array.isArray(c.titles) &&
    c.titles.length > 0 &&
    c.titles.every((t) => typeof t === "string")
  );
}

/** One Claude call: before-scene -> caption + 5 POV titles + animation_prompt + after_image_prompt. */
export async function generateBugRevealCopy(scene: string): Promise<BugRevealCopy> {
  const vertical = await getActiveVertical();
  const rulesText = await loadStyleRulesText(vertical.id, BUG_REVEAL_FORMAT_GROUP);
  const { data } = await callClaudeJSON<BugRevealCopy>({
    model: model(),
    system: buildBugRevealCopySystem(vertical.business_descriptor, rulesText),
    user: [
      `The before frame shows: ${scene}`,
      "The reel sprays that seam and cockroaches pour out of it.",
      "Return the bug-reveal copy as JSON.",
    ].join("\n"),
    maxTokens: 1000,
    temperature: 0.8,
    schemaHint: BUG_REVEAL_COPY_SCHEMA_HINT,
    validate: isBugRevealCopy,
  });
  return {
    caption: stripEmDashes(data.caption),
    titles: data.titles.slice(0, 5).map((t) => stripEmDashes(t)),
    animation_prompt: stripEmDashes(data.animation_prompt),
    after_image_prompt: stripEmDashes(data.after_image_prompt),
  };
}

// ---- Drop orchestration -----------------------------------------------------------

export interface RunBugRevealArgs {
  channel: string;
  date: string;
  slot: ReelSlot;
}

export interface BugRevealDropResult {
  thread_ts?: string;
  scenes: string[];
  status: "awaiting_approval";
}

/**
 * Post one Bug-Reveal drop as its own top-level message in #content-full. Ideas-first: posts
 * the 3 before-scene ideas and waits for ✅ (generate) / 🚫 (skip). Throws are caught by the
 * cron caller.
 */
export async function runBugRevealDrop(args: RunBugRevealArgs): Promise<BugRevealDropResult> {
  const start = Date.now();
  const { channel, date, slot } = args;
  const scenes = pickBeforeScenes(OPTIONS_PER_DROP);

  const header = `🐛 *Bug-Reveal Spray, ${date}* (${slot})\n_Spray the seam, the bugs pour out. React ✅ to generate the ${scenes.length} "before" shots, or 🚫 to skip._`;
  const main = (await slack.postMessage(channel, header)) as { ts?: string };
  const threadTs = main?.ts;
  if (!threadTs) throw new Error("failed to post Bug-Reveal header to #content-full");

  const ideasText = [
    "*Before shots for this drop (gloved hand + sprayer aimed at a seam, no bugs yet):*",
    ...scenes.map((s, i) => `${i + 1}. ${titleize(s)}`),
    "",
    "React ✅ on this message to generate all of them, or 🚫 to skip this drop.",
  ].join("\n");
  const gate = (await slack.postThreadReply(channel, threadTs, ideasText)) as { ts?: string };

  await supabaseAdmin.from("bug_reveal_jobs").insert({
    slack_channel: channel,
    slack_thread_ts: threadTs,
    picker_msg_ts: gate?.ts ?? null,
    before_images: scenes.map((scene, i) => ({ index: i + 1, scene })),
    status: "awaiting_ideas_approval",
  });

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_bug_reveal_drop",
    description: `Bug-Reveal drop ${slot}: ${scenes.length} before ideas posted, awaiting approval`,
    metadata: { slot, scenes, style_version: BUG_REVEAL_STYLE_VERSION, duration_ms: Date.now() - start },
  });

  return { thread_ts: threadTs, scenes, status: "awaiting_approval" };
}

// ---- Reaction: ideas-first gate (✅ generate / 🚫 skip) ----------------------------

export async function handleBugRevealIdeasApproval(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const approve = APPROVE_REACTIONS.has(args.reaction);
  const skip = SKIP_REACTIONS.has(args.reaction);
  if (!approve && !skip) return false;

  const { data } = await supabaseAdmin
    .from("bug_reveal_jobs")
    .select(JOB_COLS)
    .eq("picker_msg_ts", args.slackTs)
    .limit(1)
    .maybeSingle();
  const job = data as BugRevealJobRow | null;
  if (!job || job.status !== "awaiting_ideas_approval") return false;

  if (skip) {
    await supabaseAdmin
      .from("bug_reveal_jobs")
      .update({ status: "skipped", updated_at: new Date().toISOString() })
      .eq("id", job.id);
    await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, "🚫 Skipped this drop. No images generated.");
    return true;
  }

  // Claim the job first (guard against double-tap), then generate async.
  await supabaseAdmin
    .from("bug_reveal_jobs")
    .update({ status: "generating", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  waitUntil(
    generateBeforeImagesForJob(job).catch(async (e) => {
      console.error("[bug-reveal] before-image generation failed:", (e as Error).message);
      await supabaseAdmin
        .from("bug_reveal_jobs")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      await slack.postThreadReply(
        job.slack_channel,
        job.slack_thread_ts,
        `🚫 Before-image generation failed (${(e as Error).message.slice(0, 160)}).`
      );
    })
  );
  return true;
}

/** Generate the 3 BEFORE images, post them as options, flip the job to awaiting_pick. */
async function generateBeforeImagesForJob(job: BugRevealJobRow): Promise<number> {
  const start = Date.now();
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const provider = povImageProvider();
  const vertical = await getActiveVertical();

  const scenes = (job.before_images ?? []).map((o) => o.scene).filter(Boolean);
  if (scenes.length === 0) {
    await slack.postThreadReply(channel, threadTs, "🚫 No before-scenes stored; nothing to generate.");
    await supabaseAdmin.from("bug_reveal_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
    return 0;
  }

  if (!imageGenEnabled()) {
    // Kill switch: say so loudly and keep the gate open so a later ✅ retries.
    await slack.postThreadReply(channel, threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}`);
    return 0;
  }

  await slack.postThreadReply(channel, threadTs, `⏳ Generating ${scenes.length} "before" shots…`);

  // Ground each scene in the reference library + active style rules before prompting (byte-
  // identical to raw scenes when the library and rules are empty).
  const groundedScenes = await Promise.all(
    scenes.map((s) => enrichScene(s, { vertical, formatGroup: BUG_REVEAL_FORMAT_GROUP }))
  );
  const prompts = await Promise.all(groundedScenes.map((s) => buildPovImagePrompt(s, vertical)));
  // Generate the 3 in PARALLEL so wall-time is ~one image, not the sum (Higgsfield polls slow).
  const imgs = await Promise.all(
    prompts.map((p) => generateImages({ prompts: [p], provider, size: POV_SOUL_SIZE }).then((r) => r[0] ?? null))
  );

  const options: BeforeOption[] = [];
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
    await slack.postThreadReply(channel, threadTs, `*Before, option ${index}*`);
    await slack.uploadFile(channel, `before-${index}.png`, img.buffer, img.mimetype, threadTs);
    options.push({ index, scene: scenes[i], url, mimetype: img.mimetype });
  }

  if (options.length === 0) {
    await slack.postThreadReply(channel, threadTs, "🚫 All before-shots failed. Check the image provider credentials/credits.");
    await supabaseAdmin.from("bug_reveal_jobs").update({ status: "error", updated_at: new Date().toISOString() }).eq("id", job.id);
    return 0;
  }

  const nums = options.map((o) => `${o.index}️⃣`).join(" ");
  const pick = (await slack.postThreadReply(
    channel,
    threadTs,
    `React ${nums} to pick the "before" you like. I'll then spray it: add the bugs, write the caption, titles, and the animation prompt.`
  )) as { ts?: string };

  await supabaseAdmin
    .from("bug_reveal_jobs")
    .update({
      before_images: options,
      picker_msg_ts: pick?.ts ?? null,
      status: "awaiting_pick",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_bug_reveal_drop",
    description: `Bug-Reveal generate: ${options.length}/${imgs.length} before shots posted`,
    metadata: { provider, style_version: BUG_REVEAL_STYLE_VERSION, images_ok: options.length, duration_ms: Date.now() - start },
  });

  return options.length;
}

// ---- Reaction: pick the best "before", then spray it (add bugs + copy) -------------

export async function handleBugRevealPick(args: {
  reaction: string;
  slackTs: string;
  channel: string;
}): Promise<boolean> {
  const optNum = REACTION_TO_OPTION[args.reaction];
  if (!optNum) return false;

  const { data } = await supabaseAdmin
    .from("bug_reveal_jobs")
    .select(JOB_COLS)
    .eq("picker_msg_ts", args.slackTs)
    .limit(1)
    .maybeSingle();
  const job = data as BugRevealJobRow | null;
  if (!job || job.status !== "awaiting_pick") return false;

  const chosen = (job.before_images ?? []).find((o) => o.index === optNum);
  if (!chosen || !chosen.url) return false;

  await supabaseAdmin
    .from("bug_reveal_jobs")
    .update({ chosen_before: chosen, status: "building", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await slack.postThreadReply(job.slack_channel, job.slack_thread_ts, `✅ Before ${optNum} chosen. Spraying it…`);

  waitUntil(
    buildRevealForJob(job, chosen).catch(async (e) => {
      console.error("[bug-reveal] build failed:", (e as Error).message);
      await supabaseAdmin
        .from("bug_reveal_jobs")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      await slack.postThreadReply(
        job.slack_channel,
        job.slack_thread_ts,
        `🚫 Bug-reveal build failed (${(e as Error).message.slice(0, 160)}).`
      );
    })
  );
  return true;
}

// ---- Thread reply: tuning feedback -> live preview, then ✅-gated save --------------

const OPTION_WORDS: Record<string, number> = { first: 1, second: 2, third: 3 };

/** Pull the option numbers the operator referenced ("option 2", "image 1", "the first one"). */
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
 * A tuning-feedback reply on a bug-reveal drop thread ("make the furnace older, add some plates").
 * Distill it into candidate rules, regenerate a LIVE PREVIEW of the referenced before option(s)
 * with those changes applied, then post a "keep these changes? ✅" card. The rules are only saved
 * (pending) here; they go active when the operator reacts ✅ (handleStyleRuleApproval). Returns
 * true when it took the reply (tuning), false for remix/other so the caller falls through to the
 * remix handler. Best-effort.
 */
export async function handleBugRevealFeedback(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("bug_reveal_jobs")
    .select(JOB_COLS)
    .eq("slack_thread_ts", args.threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = data as BugRevealJobRow | null;
  if (!job) return false; // not a bug-reveal thread — let other handlers take it
  const opts = job.before_images ?? [];
  if (opts.length === 0) return false;

  const vertical = await getActiveVertical();
  let distilled;
  try {
    distilled = await distillFeedbackToRules({ text: args.text, formatGroup: BUG_REVEAL_FORMAT_GROUP, verticalId: vertical.id });
  } catch (e) {
    console.error("[bug-reveal] feedback distill failed:", (e as Error).message);
    return false;
  }
  if (distilled.intent !== "tune" || distilled.rules.length === 0) return false;

  const available = opts.map((o) => o.index);
  let targets = parseTargetOptions(args.text, available);
  if (targets.length === 0) {
    targets =
      job.chosen_before?.index && available.includes(job.chosen_before.index)
        ? [job.chosen_before.index]
        : [available[0]];
  }
  targets = targets.slice(0, 3);

  await slack.postThreadReply(
    args.channel,
    args.threadTs,
    `🔁 Applying your changes to option ${targets.join(", ")} and regenerating a preview…`
  );

  const ruleStrings = distilled.rules.map((r) => r.rule);

  waitUntil(
    (async () => {
      try {
        const provider = povImageProvider();
        let posted = 0;
        if (!imageGenEnabled()) {
          await slack.postThreadReply(args.channel, args.threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}`);
          targets = [];
        }
        for (const idx of targets) {
          const opt = opts.find((o) => o.index === idx);
          if (!opt) continue;
          const grounded = await enrichScene(opt.scene, {
            vertical,
            formatGroup: BUG_REVEAL_FORMAT_GROUP,
            extraRules: ruleStrings,
          });
          const prompt = await buildPovImagePrompt(grounded, vertical);
          const [img] = await generateImages({ prompts: [prompt], provider, size: POV_SOUL_SIZE });
          if (!img) {
            await slack.postThreadReply(args.channel, args.threadTs, `⚠️ Preview for option ${idx} failed.`);
            continue;
          }
          await slack.postThreadReply(args.channel, args.threadTs, `*Option ${idx} with your changes (preview)*`);
          await slack.uploadFile(args.channel, `preview-${idx}.png`, img.buffer, img.mimetype, args.threadTs);
          posted++;
        }

        const lines = distilled.rules.map((r, i) => {
          const tag = r.scope === "brand" ? "brand" : r.format_group ?? BUG_REVEAL_FORMAT_GROUP;
          return `${i + 1}. [${tag}] ${r.rule}`;
        });
        const card = (await slack.postThreadReply(
          args.channel,
          args.threadTs,
          [
            posted > 0 ? "☝️ Preview above." : "Preview could not be generated, but you can still save the rule.",
            "🎚️ *Keep these changes?* React ✅ to save them for future drops, or 🚫 to discard.",
            ...lines,
          ].join("\n")
        )) as { ts?: string };
        if (card?.ts) {
          await savePendingRules(distilled.rules, {
            verticalId: vertical.id,
            channel: args.channel,
            threadTs: args.threadTs,
            proposalTs: card.ts,
          });
        }
      } catch (e) {
        console.error("[bug-reveal] feedback preview failed:", (e as Error).message);
        await slack.postThreadReply(args.channel, args.threadTs, `🚫 Preview failed (${(e as Error).message.slice(0, 140)}).`);
      }
    })()
  );
  return true;
}

// ---- Thread reply: "remix / give me more examples" --------------------------------

// Conversational control on a bug-reveal drop thread: reply with "remix", "give me more",
// "another", "different", etc. and we generate a fresh set of 3 before options in-thread.
const REMIX_RE = /\b(remix|regenerate|regen|another|again|different|fresh|more|others?|examples|new options|not (that|these))\b/i;

export async function handleBugRevealReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  if (!REMIX_RE.test(args.text)) return false;

  const { data } = await supabaseAdmin
    .from("bug_reveal_jobs")
    .select(JOB_COLS)
    .eq("slack_thread_ts", args.threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const job = data as BugRevealJobRow | null;
  if (!job) return false;

  if (job.status === "generating") {
    await slack.postThreadReply(args.channel, args.threadTs, "⏳ Already working on a set, hang on.");
    return true;
  }

  const scenes = pickBeforeScenes(OPTIONS_PER_DROP);
  const seeded = scenes.map((s, i) => ({ index: i + 1, scene: s }));
  await supabaseAdmin
    .from("bug_reveal_jobs")
    .update({
      before_images: seeded,
      chosen_before: null,
      after_image_url: null,
      status: "generating",
      updated_at: new Date().toISOString(),
    })
    .eq("id", job.id);

  await slack.postThreadReply(args.channel, args.threadTs, "🔁 On it, generating 3 fresh before options…");

  waitUntil(
    generateBeforeImagesForJob({ ...job, before_images: seeded }).catch(async (e) => {
      console.error("[bug-reveal] remix generate failed:", (e as Error).message);
      await supabaseAdmin
        .from("bug_reveal_jobs")
        .update({ status: "error", updated_at: new Date().toISOString() })
        .eq("id", job.id);
      await slack.postThreadReply(args.channel, args.threadTs, `🚫 Regeneration failed (${(e as Error).message.slice(0, 160)}).`);
    })
  );
  return true;
}

/** Add bugs to the chosen before frame, generate copy, post the after image + prompts + copy. */
async function buildRevealForJob(job: BugRevealJobRow, chosen: BeforeOption): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const vertical = await getActiveVertical();
  const rulesText = await loadStyleRulesText(vertical.id, BUG_REVEAL_FORMAT_GROUP);

  // 1) After frame: add the swarm pouring from the sprayed seam (honoring active style rules).
  const instruction = buildBugAddInstruction(chosen.scene, rulesText);
  let afterBuffer: Buffer | null = null;
  let afterMime = "image/png";

  if (!imageGenEnabled()) {
    await slack.postThreadReply(channel, threadTs, `⏸️ ${IMAGE_GEN_PAUSED_NOTE}`);
    return;
  }

  // Preferred (only when OPENAI_API_KEY is set): edit the exact chosen before image so the two
  // frames line up pixel-for-pixel. We run on Higgsfield today (no OpenAI key), so this is
  // skipped and the after frame is generated fresh below.
  if (process.env.OPENAI_API_KEY) {
    const src = await fetch(chosen.url!);
    if (src.ok) {
      const srcBuf = Buffer.from(await src.arrayBuffer());
      const srcMime = src.headers.get("content-type") || chosen.mimetype || "image/png";
      const edited = await editImage({ image: srcBuf, mimetype: srcMime, prompt: instruction, size: POV_IMAGE_SIZE });
      if (edited) {
        afterBuffer = edited.buffer;
        afterMime = edited.mimetype;
      }
    }
  }

  // Higgsfield path: fresh text2image of the after scene (a new frame of the same seam with the
  // swarm). Not pixel-identical to the before, but that is fine for the single-frame animation
  // (A) and still gives an after frame for the two-frame test (B).
  if (!afterBuffer) {
    const groundedBase = await enrichScene(chosen.scene, { vertical, formatGroup: BUG_REVEAL_FORMAT_GROUP });
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

  let afterUrl: string | null = null;
  if (afterBuffer) {
    afterUrl = await uploadToReels(afterBuffer, afterMime);
    await slack.postThreadReply(channel, threadTs, "*After (bugs pouring from the sprayed seam)*");
    await slack.uploadFile(channel, "after.png", afterBuffer, afterMime, threadTs);
  } else {
    await slack.postThreadReply(channel, threadTs, "⚠️ Couldn't produce the after frame. Copy + prompts still below.");
  }

  // 2) Copy: caption + 5 POV titles + animation prompt + after-image prompt.
  const copy = await generateBugRevealCopy(chosen.scene);
  const titles = copy.titles.map((t, i) => `${i + 1}. ${t}`).join("\n");

  await slack.postThreadReply(
    channel,
    threadTs,
    [
      "*Title options (pick one):*",
      titles,
      "",
      "*Caption:*",
      copy.caption,
      "",
      `*Animation prompt (single frame, bugs erupt):* ${copy.animation_prompt}`,
      "",
      "*After-image prompt (to reproduce frame 2 on its own):*",
      "```",
      copy.after_image_prompt,
      "```",
      "",
      "*Split test both animations, keep the winner:*",
      "• *A* = the *before* image + the animation prompt above.",
      afterUrl
        ? "• *B* = *before + after* images (first frame to last frame) + the animation prompt above."
        : "• *B* = needs the after frame (it failed this time); rerun to get before + after interpolation.",
    ].join("\n")
  );

  await supabaseAdmin
    .from("bug_reveal_jobs")
    .update({ after_image_url: afterUrl, status: "done", updated_at: new Date().toISOString() })
    .eq("id", job.id);

  await supabaseAdmin.from("system_logs").insert({
    event_type: "cron_bug_reveal_drop",
    description: "Bug-Reveal build: after frame + copy posted",
    metadata: { style_version: BUG_REVEAL_STYLE_VERSION, after_ok: Boolean(afterUrl), scene: chosen.scene },
  });
}
