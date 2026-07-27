// Hook Studio — the hook-FIRST lane of the drop channels. Where drop-studio starts from
// media + copy in one message, this lane starts from TEXT ONLY: the operator posts 1-3
// hook lines (optionally naming a workflow, e.g. "with workflow 2") and the bot walks the
// whole video into existence in the thread:
//
//   hook text -> 5 complete-copy options sized to the workflow's boxes
//   -> operator locks one (react a number) or pastes his own block
//   -> ONE image prompt per scene, written from that locked copy, on a checkmark card
//   -> checkmark generates every scene image with gpt-image-2 in-thread (or the operator
//      drops his own) -> motion prompts (Seedance, prompts only)
//   (an image dropped BEFORE copy locks still takes the older hook-first route: that image
//    anchors the look and postStoryboards writes the remaining scenes to continue it)
//   -> "Seems like we have everything we need" full shot-by-shot review
//   -> checkmark/`render` -> finishDropRender (existing render + sales-letter pipeline)
//
// format_id "hook_studio", stages hs_workflow -> hs_options -> hs_await_images -> hs_anim
// -> hs_review -> dr_render -> done. Coexists with drop-studio in the same channels: entry
// is disjoint (text-only vs files) and every in-thread handler self-routes by format_id.
// Prompt-first stays the DEFAULT: nothing generates on its own. Images are only ever made
// when the operator asks for them by reacting on the scene-prompt card (generateSceneImages,
// which is why it is the one caller passing allowWhenPaused). Animation stays prompts-only
// (v1) — the future animate-directly branch slots in at postMotionPrompts (the job already
// carries final_animation_prompts + mode_videos + prompt_slots, all a v2 needs).

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeImageInput, type ClaudeModel } from "@/lib/claude-calls";
import {
  insertJob,
  getJobByPickerTs,
  getLatestJobByThread,
  updateJob,
  type ContentJob,
} from "@/lib/reel/jobs";
import {
  APPROVE,
  CANCEL,
  KEYCAPS,
  type DroppedFile,
  resolveDropMedia,
  resolveDropClips,
  hasVideoFiles,
  generateMotionPrompts,
  finishDropRender,
  writeSalesLetterFor,
  zeroAdaptationCopy,
  splitLines,
  shotCount,
  boxCount,
  songNote,
  activeWorkflows,
  hasAuthoredScenes,
} from "@/lib/reel/drop-studio";
import { enrichScene } from "@/lib/reel/prompt-enrich";
import {
  avatarBlock,
  reslotCopyToStructure,
  generateStructuredCopyVariants,
  type StructuredCopyLine,
} from "@/lib/reel/creative-director";
import { stripEmDashes } from "@/lib/reel/text";
import { loadWorkflow, type Workflow } from "@/config/workflows";
import { workflowRenderBuild } from "@/lib/reel/render-dispatch";
import { getMotionAdapter } from "@/lib/reel/motion-adapter";
import { generateImages } from "@/lib/providers/image-gen";
import { uploadToReels } from "@/lib/reel/pov";
import {
  loadVertical,
  dropOwnerVerticalId,
  dropWorkflowLibraryId,
  type Vertical,
} from "@/config/verticals";
import { loadReferenceFrames } from "@/lib/reel/content-examples";

const HOOK_FORMAT = "hook_studio";

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

async function post(channel: string, threadTs: string, text: string): Promise<string | null> {
  const res = await slack.postThreadReply(channel, threadTs, text).catch(() => null);
  return ((res as { ts?: string } | null)?.ts as string) ?? null;
}

/** Run a step in the background with its failure made VISIBLE. A bare waitUntil(promise) puts
 *  the work outside every error handler (the route's .catch is attached to the outer closure,
 *  which resolves as soon as the handler returns), so a throw used to leave the thread silent
 *  and the job parked on its stage. Anything detached from a handler goes through here. */
function bg(job: ContentJob, label: string, p: Promise<unknown>): void {
  waitUntil(
    p.catch(async (e) => {
      const msg = (e as Error).message ?? String(e);
      console.error(`[hook-studio] ${label} failed:`, msg);
      await post(job.slack_channel, job.slack_thread_ts, `${label} failed (${msg.slice(0, 140)}). Reply \`retry\`.`).catch(() => {});
    })
  );
}

/** Post a card that TAKES reactions: seed the emojis, move pickerTs to it. Plain status
 *  posts go through post() and never move pickerTs, so re-picks on the live card still route. */
async function postCard(job: ContentJob, text: string, emojis: string[]): Promise<void> {
  const ts = await post(job.slack_channel, job.slack_thread_ts, text);
  if (!ts) return;
  for (const e of emojis) await slack.addReaction(job.slack_channel, ts, e).catch(() => {});
  await updateJob(job, { pickerTs: ts, data: { ...job.data, seeded_reactions: emojis } });
}

function isHookJob(job: ContentJob | null): job is ContentJob {
  return Boolean(job && job.format_id === HOOK_FORMAT);
}

async function getHookJob(threadTs: string): Promise<ContentJob | null> {
  const job = await getLatestJobByThread(threadTs);
  return isHookJob(job) ? job : null;
}

function slotImages(job: ContentJob): string[] {
  return (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean);
}

/** Enrich an authored scene's image_prompt with the workflow's visual_rules + reference frames
 *  (mirrors enrichWorkflowPrompt in workflow-pipeline.ts). The b-roll branch of enrichScene keeps
 *  it documentary — no Meta-glasses framing — which is correct for the hand-drawn whiteboard look.
 *  Falls back to the raw authored prompt on any error, so the prompt is never lost. */
async function enrichAuthoredScene(imagePrompt: string, wf: Workflow): Promise<string> {
  try {
    const vertical = await loadVertical(wf.vertical_id);
    return await enrichScene(imagePrompt, {
      vertical,
      formatGroup: String(wf.category ?? "broll"),
      extraRules: wf.visual_rules,
      workflow: { id: wf.id, category: String(wf.category), description: wf.description ?? null },
    });
  } catch {
    return imagePrompt;
  }
}

// ---- entry: text-only top-level message ------------------------------------------------------

/** Split the operator's message into hook lines: newlines first, then " / " separators. */
function parseHookLines(text: string): string[] {
  return splitLines(text)
    .flatMap((l) => l.split(/\s+\/\s+/))
    .map((l) => l.trim())
    .filter(Boolean);
}

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** Find a workflow named in the text ("with workflow 2", "use Shabang"). Name mention wins
 *  (longest match, so "workflow 2.1" beats "workflow 2"); then the `workflow <token>` phrase
 *  is tried against names as "workflow <token>" and "<token>". */
function matchWorkflowInText(text: string, candidates: Workflow[]): Workflow | null {
  const t = norm(text);
  let best: Workflow | null = null;
  for (const w of candidates) {
    const n = norm(w.name);
    if (n && t.includes(n) && (!best || n.length > norm(best.name).length)) best = w;
  }
  if (best) return best;
  const token = /\b(?:workflow|template)\s+([\w.\-]+)\b/i.exec(text)?.[1];
  if (!token) return null;
  const asName = norm(token);
  return (
    candidates.find((w) => norm(w.name) === `workflow ${asName}`) ??
    candidates.find((w) => norm(w.name) === asName) ??
    null
  );
}

/** Drop instruction lines ("I want to make a video with workflow 2...") from the hook. */
function stripInstructionLines(lines: string[], matched: Workflow | null): string[] {
  const instruction = (l: string) => {
    const mentions =
      /\b(?:workflow|template)\s+[\w.\-]+\b/i.test(l) ||
      (matched ? norm(l).includes(norm(matched.name)) : false);
    const asks = /\b(i want|make (me )?(a |the )?(video|reel)|can you|use th|using th|give me)\b/i.test(l);
    return mentions || asks;
  };
  const hook = lines.filter((l) => !instruction(l));
  return hook.length ? hook : lines;
}

export async function handleHookStudioStart(args: {
  channel: string;
  threadTs: string;
  text: string;
  verticalId: string;
}): Promise<void> {
  const { channel, threadTs } = args;
  const lines = parseHookLines(args.text);
  if (!lines.length) return;

  const dropVertical = await loadVertical(args.verticalId);
  const candidates = await activeWorkflows(dropWorkflowLibraryId(dropVertical));
  if (!candidates.length) {
    await post(channel, threadTs, "No active workflows can render yet. Create one in #agent-wokrflow-creator first.");
    return;
  }

  const matched = matchWorkflowInText(args.text, candidates);
  const hookLines = stripInstructionLines(lines, matched).map((l) => stripEmDashes(l));

  if (matched) {
    await insertJob({
      formatId: HOOK_FORMAT,
      verticalId: args.verticalId,
      channel,
      threadTs,
      pickerTs: null,
      stage: "hs_options",
      sourceKind: "drop",
      data: { hook_lines: hookLines, workflow_id: matched.id },
    });
    const job = await getHookJob(threadTs);
    if (job) await postHookOptions(job, matched);
    return;
  }

  // No workflow named: ask which one first (fit-menu pattern, keycap/number pick).
  await insertJob({
    formatId: HOOK_FORMAT,
    verticalId: args.verticalId,
    channel,
    threadTs,
    pickerTs: null,
    stage: "hs_workflow",
    sourceKind: "drop",
    data: { hook_lines: hookLines, fit_menu: candidates.map((w) => w.id) },
  });
  const job = await getHookJob(threadTs);
  if (!job) return;
  const menu = candidates.map((w, i) => {
    const S = shotCount(w);
    const B = boxCount(w);
    const meta = [`${S} shot${S === 1 ? "" : "s"}`, `${B} copy box${B === 1 ? "" : "es"}`, songNote(w)]
      .filter(Boolean)
      .join(", ");
    return `${i + 1}. *${w.name}* (${meta})`;
  });
  const caps = ["one", "two", "three", "four", "five"].slice(0, Math.min(candidates.length, 5));
  await postCard(
    job,
    [
      `*Which workflow?* Your hook: "${hookLines.join(" / ")}"`,
      "React ✅ for the top pick or reply a number:",
      ...menu,
      "`cancel` ends it.",
    ].join("\n"),
    ["white_check_mark", ...caps]
  );
}

// ---- step 2: the complete-copy options card ---------------------------------------------------

/** Post the copy-options picker card (shared by the copy-first and authored-scene paths). */
async function postCopyOptionsCard(
  job: ContentJob,
  workflow: Workflow,
  variants: Array<Array<{ key: string; label: string; text: string }>>
): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  if (variants.length) {
    const B = boxCount(workflow);
    const caps = ["one", "two", "three", "four", "five"].slice(0, variants.length);
    await postCard(
      job,
      [
        `*Complete video copy* — ${variants.length} options for *${workflow.name}*'s ${B} text slot${B === 1 ? "" : "s"}.`,
        `React ${caps.map((_, i) => `${i + 1}️⃣`).join("/")} to lock one (or paste an edited version instead):`,
        ...variants.flatMap((v, i) => [`*Option ${i + 1}:*`, ...v.map((c) => `  *${c.label}:* ${c.text}`)]),
        "",
        "Lock a copy option (react a number, or paste your own copy block) and I'll post the image prompts to generate.",
      ].join("\n"),
      caps
    );
  } else {
    await post(
      channel,
      threadTs,
      workflow.copy_structure?.length
        ? "Could not write the copy options. Paste your own copy block to continue (or reply `retry`)."
        : "This workflow has free-form copy boxes. Paste your copy lines (label, hook, payoff, cta) to continue."
    );
  }
}

/** Authored-scene workflows (e.g. Workflow 30) ship their own per-scene image + motion prompts.
 *  Post the copy options first and DEFER the image prompts until copy is locked (they are the
 *  workflow's own whiteboard prompts, so there is no hook-image / storyboard improvisation). */
async function postAuthoredSceneOptions(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const hookLines = job.data.hook_lines ?? [];
  const S = shotCount(workflow);
  await post(channel, threadTs, `Fitting *${workflow.name}* — writing copy options for its ${boxCount(workflow)} text slots...`);

  const drop = await loadVertical(job.vertical_id);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  let variants: Array<Array<{ key: string; label: string; text: string }>> = [];
  try {
    variants = await generateStructuredCopyVariants({ vertical: owner, workflow, hookLines, count: 5 });
  } catch (e) {
    console.error("[hook-studio] authored copy variants failed:", (e as Error).message);
  }

  await updateJob(job, {
    stage: "hs_options",
    data: {
      ...job.data,
      workflow_id: workflow.id,
      hs_copy_options: variants,
      prompt_slots: Array.from({ length: S }, (_, i) => ({ scene: i + 1, image_url: null })),
      authored_prompts_posted: false,
    },
  });
  await postCopyOptionsCard(job, workflow, variants);
}

/** Post the workflow's OWN per-scene image prompts (each enriched with its visual_rules), one
 *  card in scene order. Called once the operator locks a copy option. */
async function postAuthoredScenePrompts(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const scenes = workflow.scenes ?? [];
  await post(channel, threadTs, `Writing the ${scenes.length} image prompt${scenes.length === 1 ? "" : "s"} for *${workflow.name}*...`);
  const enriched = await Promise.all(scenes.map((s) => enrichAuthoredScene(s.image_prompt, workflow)));
  const block = (p: string) => `\`\`\`\n${p}\n\`\`\``;
  await post(
    channel,
    threadTs,
    [
      `*Image prompts for ${workflow.name}* — generate each with gpt-image-2 and drop them here in scene order (comment \`scene N\` to target a slot):`,
      ...scenes.map((s, i) => `*Scene ${i + 1} — ${s.role}*\n${block(enriched[i])}`),
    ].join("\n")
  );
  const fresh = (await getLatestJobByThread(threadTs)) ?? job;
  await updateJob(fresh, { data: { ...fresh.data, authored_prompts_posted: true } });
}

/** Post the 6 hook-image prompts + the 3-copy picker card, then wait at hs_options. */
async function postHookOptions(job: ContentJob, workflow: Workflow): Promise<void> {
  if (hasAuthoredScenes(workflow)) return postAuthoredSceneOptions(job, workflow);
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const hookLines = job.data.hook_lines ?? [];
  await post(channel, threadTs, `Writing copy options for *${workflow.name}*...`);

  const drop = await loadVertical(job.vertical_id);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  const S = shotCount(workflow);

  // The image prompts are DEFERRED until copy is locked, so they can be written from the
  // actual chosen copy (see postSceneImagePromptsFromCopy). Here we only write the copy options.
  let variants: Array<Array<{ key: string; label: string; text: string }>> = [];
  try {
    variants = await generateStructuredCopyVariants({ vertical: owner, workflow, hookLines, count: 5 });
  } catch (e) {
    console.error("[hook-studio] copy variants failed:", (e as Error).message);
  }

  await updateJob(job, {
    stage: "hs_options",
    data: {
      ...job.data,
      workflow_id: workflow.id,
      hs_copy_options: variants,
      prompt_slots: Array.from({ length: S }, (_, i) => ({ scene: i + 1, image_url: null })),
      hs_image_prompts_posted: false,
    },
  });

  await postCopyOptionsCard(job, workflow, variants);
}

/** After copy is locked: write ONE image prompt per scene FROM the locked copy, post them as a
 *  single card in scene order, and move to hs_await_images. The operator generates all of them
 *  externally and drops them into the thread; once every slot is filled the file-drop handler
 *  fires postMotionPrompts, so Seedance prompts follow with no extra step.
 *  On a Claude error, fall back to a plain nudge so the session never stalls. */
async function postSceneImagePromptsFromCopy(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const S = shotCount(workflow);
  const scenes = Array.from({ length: S }, (_, i) => i + 1);
  const roles = workflow.copy_structure ?? [];
  const roleLabel = (scene: number) =>
    roles.find((r) => r.shot === scene)?.label ?? (scene === 1 ? "Hook" : `Scene ${scene}`);

  try {
    const drop = await loadVertical(job.vertical_id);
    const owner = await loadVertical(dropOwnerVerticalId(drop));
    const [board] = await generateStoryboardOptions({
      owner,
      workflow,
      lookVertical: drop,
      copy,
      hookImage: null,
      scenes,
      optionCount: 1,
    });
    if (!board?.prompts.length) throw new Error("no prompts returned");

    // Stage + prompts land BEFORE the card, because postCard moves pickerTs onto it and a
    // fast checkmark would otherwise race a job that has neither.
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, {
      stage: "hs_await_images",
      data: {
        ...fresh.data,
        hs_image_prompt_options: board.prompts.map((p) => ({ kind: "bot_pick" as const, prompt: p })),
        hs_image_prompts_posted: true,
      },
    });

    const block = (p: string) => `\`\`\`\n${p}\n\`\`\``;
    const carded = (await getLatestJobByThread(threadTs)) ?? fresh;
    await postCard(
      carded,
      [
        `Copy locked. *Image prompts for ${workflow.name}*, built from it${board.title ? ` (${board.title})` : ""}:`,
        ...board.prompts.map((p, i) => `*Scene ${i + 1} — ${roleLabel(i + 1)}*\n${block(p)}`),
        "",
        `React ✅ and I'll generate all ${board.prompts.length} with gpt-image-2 right here, then write the motion prompts.`,
        "Or generate them yourself and drop them in scene order (comment `scene N` to target a slot). `retry` rewrites the prompts.",
      ].join("\n"),
      ["white_check_mark"]
    );
  } catch (e) {
    console.error("[hook-studio] scene image prompts from copy failed:", (e as Error).message);
    await post(
      channel,
      threadTs,
      `Copy locked, but I could not write the image prompts (${(e as Error).message.slice(0, 140)}). Reply \`retry\`, or drop your ${S} scene images here anyway.`
    );
  }
}

/** Fit pasted copy to the workflow: exact-count lines pass through verbatim, else re-slot. */
async function fitCopy(job: ContentJob, workflow: Workflow, text: string): Promise<StructuredCopyLine[]> {
  const lines = splitLines(text);
  const direct = zeroAdaptationCopy(workflow, lines);
  if (direct) return direct;
  const drop = await loadVertical(job.vertical_id);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  return reslotCopyToStructure({ vertical: owner, workflow, pastedBlock: text });
}

/** After a copy lock or an image drop at hs_options: advance once BOTH are in. */
async function maybeAdvanceFromOptions(job: ContentJob, workflow: Workflow): Promise<void> {
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const slots = job.data.prompt_slots ?? [];
  if (!copy.length) return;

  // Authored-scene workflows: image prompts are the workflow's OWN scene prompts, posted once
  // copy is locked; then collect the images (no hook-image/storyboard step) and go to the locked
  // motion prompts.
  if (hasAuthoredScenes(workflow)) {
    if (!slots.some((s) => s.image_url)) {
      if (!job.data.authored_prompts_posted) await postAuthoredScenePrompts(job, workflow);
      return;
    }
    if (slots.every((s) => s.image_url)) {
      await post(job.slack_channel, job.slack_thread_ts, "All scene images in. Writing motion prompts...");
      await postMotionPrompts(job, workflow);
    } else {
      const filled = slots.filter((s) => s.image_url).length;
      await post(job.slack_channel, job.slack_thread_ts, `${filled} of ${slots.length} image(s) in. Drop the rest in scene order.`);
    }
    return;
  }

  // Copy-first: no image yet, so write one prompt per scene from the now-locked copy (once)
  // and hold at hs_await_images for all of them.
  if (!slots[0]?.image_url) {
    if (!job.data.hs_image_prompts_posted) {
      await postSceneImagePromptsFromCopy(job, workflow);
    } else {
      await post(job.slack_channel, job.slack_thread_ts, "Copy updated. Drop the generated scene images here to continue.");
    }
    return;
  }
  if (slots.every((s) => s.image_url)) {
    await post(job.slack_channel, job.slack_thread_ts, "All scene images in. Writing motion prompts...");
    await postMotionPrompts(job, workflow);
  } else {
    await post(job.slack_channel, job.slack_thread_ts, "Hook image + copy locked. Building storyboards for the remaining scenes...");
    await postStoryboards(job, workflow);
  }
}

// ---- step 4: 3 storyboard sets for the remaining scenes --------------------------------------

/** Fetch a public reels-bucket image as a Claude image input (plain fetch, no Slack token —
 *  see the note on generateMotionPrompts in drop-studio.ts). */
async function fetchImageInput(url: string): Promise<ClaudeImageInput | null> {
  const res = await fetch(url).catch(() => null);
  if (!res?.ok) return null;
  const mt = res.headers.get("content-type") || "";
  if (!mt.startsWith("image/")) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) return null;
  return { media_type: mt, data: buf.toString("base64") };
}

/** Storyboard prompt sets for a run of scenes, depicting the copy that lands on each shot.
 *
 *  Two callers, one generator:
 *  - hook-image-first (`hookImage` set): 3 DISTINCT options for the scenes still missing an
 *    image, each continuing the chosen hook image's exact look.
 *  - copy-first (`hookImage` null, `optionCount` 1): ONE prompt per scene for the whole video,
 *    written straight off the locked copy, with the look grounded on the workflow's reference
 *    frames instead of a hook image. */
export async function generateStoryboardOptions(args: {
  owner: Vertical;
  workflow: Workflow;
  lookVertical: Vertical;
  copy: StructuredCopyLine[];
  hookImage: ClaudeImageInput | null;
  scenes: number[]; // 1-based scene indexes still needing an image
  optionCount?: number;
}): Promise<Array<{ title: string; prompts: string[] }>> {
  const { workflow } = args;
  const optionCount = args.optionCount ?? 3;
  const dna = (workflow.style_dna ?? "").trim() || args.lookVertical.style_token;
  const roles = workflow.copy_structure ?? [];
  const copyByShot = args.scenes.map((scene) => {
    const lines = roles
      .filter((r) => r.shot === scene)
      .map((r) => {
        const text = args.copy.find((c) => c.key === r.key)?.text ?? "";
        return text ? `${r.label}: ${text}` : "";
      })
      .filter(Boolean);
    return `Scene ${scene} carries: ${lines.length ? lines.join(" | ") : "no on-screen line"}`;
  });

  // With no hook image to anchor the look, ground it on the workflow's reference frames
  // (the workflow's own approved frames in content_examples).
  const frames = args.hookImage
    ? [args.hookImage]
    : await loadReferenceFrames(workflow.vertical_id, { workflowId: workflow.id, limit: 4 }).catch(() => []);

  interface Gen {
    options: Array<{ title: string; prompts: string[] }>;
  }
  const continuation = args.hookImage
    ? [
        `Scene 1 (the hook shot) is DONE and you are shown it. Return ${optionCount} DISTINCT`,
        `storyboard option(s) for scene(s) ${args.scenes.join(", ")}. Each option: a short title +`,
        `exactly ${args.scenes.length} scene action(s), in that scene order.`,
        "Every action must CONTINUE the hook image's exact look (same location arc, lighting, lens,",
        "wardrobe, time of day) while depicting the copy that lands on that scene. The options must",
        "differ in setting/arc, not wording.",
      ]
    : [
        `No image exists yet. Return ${optionCount} storyboard option(s) covering scene(s)`,
        `${args.scenes.join(", ")} — the WHOLE video. Each option: a short title + exactly`,
        `${args.scenes.length} scene action(s), in that scene order.`,
        "Scene 1 is the hook and has to earn the scroll-stop on its own. The scenes must read as one",
        "continuous shoot: same location arc, lighting, lens, wardrobe, and time of day throughout,",
        "each depicting the copy that lands on it.",
        ...(frames.length
          ? ["You are shown reference photo(s) of the exact look wanted. Ground materials, wear, lighting, and realism on them."]
          : []),
      ];
  const system = [
    `You write image-generation prompts for the scenes of a "${workflow.name}" video.`,
    ...continuation,
    "Each action is ONE sentence: subject + action + setting. No camera or style boilerplate",
    "(the style DNA is prepended separately), no on-screen text, never em dashes.",
    ...(workflow.visual_rules?.length ? ["Visual rules:", ...workflow.visual_rules.map((r) => `- ${r}`)] : []),
    // The avatar's own subject law goes LAST and wins. The clinic borrows the pest workflow
    // library, whose rules talk about gloved hands and suburban job sites.
    ...(args.owner.visual_rules?.length
      ? [
          "Avatar visual rules (these WIN over the workflow visual rules on any conflict):",
          ...args.owner.visual_rules.map((r) => `- ${r}`),
        ]
      : []),
    "",
    avatarBlock(args.owner),
    "",
    "The copy per scene:",
    ...copyByShot,
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await callClaudeJSON<Gen>({
    model: model(),
    system,
    user: "Return the storyboard options as JSON.",
    images: frames.length ? frames : undefined,
    maxTokens: 1600,
    temperature: 0.9,
    schemaHint: '{ "options": [{ "title": string, "prompts": [string] }] }',
    validate: (v: unknown): v is Gen =>
      typeof v === "object" &&
      v !== null &&
      Array.isArray((v as Gen).options) &&
      (v as Gen).options.every(
        (o) => o && typeof o.title === "string" && Array.isArray(o.prompts) && o.prompts.every((p) => typeof p === "string")
      ),
  });

  // The rules above steer the sentence Claude writes; this tail is what the IMAGE model
  // reads, so the avatar's negative rides along on the finished prompt too.
  const negative = args.owner.image_negative ? `${stripEmDashes(args.owner.image_negative).replace(/[.\s]+$/, "")}. ` : "";
  const assemble = (action: string) =>
    `${dna.replace(/[.\s]+$/, "")}. ${stripEmDashes(action).replace(/[.\s]+$/, "")}. ${negative}No text, captions, logos, or watermarks in the image. 9:16 vertical.`;
  return data.options.slice(0, optionCount).map((o) => ({
    title: stripEmDashes(o.title).trim(),
    prompts: o.prompts.slice(0, args.scenes.length).map(assemble),
  }));
}

async function postStoryboards(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const slots = job.data.prompt_slots ?? [];
  const empty = slots.filter((s) => !s.image_url).map((s) => s.scene);
  if (!empty.length) {
    await postMotionPrompts(job, workflow);
    return;
  }
  try {
    const drop = await loadVertical(job.vertical_id);
    const owner = await loadVertical(dropOwnerVerticalId(drop));
    const hookImage = slots[0]?.image_url ? await fetchImageInput(slots[0].image_url) : null;
    const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
    const boards = await generateStoryboardOptions({ owner, workflow, lookVertical: drop, copy, hookImage, scenes: empty });

    const blocks: string[] = [
      `*Storyboards for the remaining ${empty.length} image(s)* (pick one set, or mix):`,
    ];
    boards.forEach((b, i) => {
      blocks.push(`*Set ${i + 1}: ${b.title}*`);
      b.prompts.forEach((p, j) => blocks.push(`Scene ${empty[j]}:\n\`\`\`\n${p}\n\`\`\``));
    });
    blocks.push(
      "Generate them and upload into this thread in scene order (comment `scene N` to target a slot). Reply `set N` to note which set you're using."
    );
    await post(channel, threadTs, blocks.join("\n"));
    await updateJob(job, { stage: "hs_await_images", data: { ...job.data, hs_storyboards: boards } });
  } catch (e) {
    console.error("[hook-studio] storyboards failed:", (e as Error).message);
    await post(
      channel,
      threadTs,
      `Could not write the storyboards (${(e as Error).message.slice(0, 120)}). Upload the remaining ${empty.length} image(s) anyway (comment \`scene N\` to target), or reply \`retry\`.`
    );
    await updateJob(job, { stage: "hs_await_images" });
  }
}

// ---- step 5b: generate the scene images in-thread ----------------------------------------------

/**
 * The checkmark on the scene-prompt card: generate every scene image that is still missing
 * with gpt-image-2, drop them into the thread, and go straight on to the motion prompts.
 *
 * Passes `allowWhenPaused` deliberately. IMAGE_GEN_ENABLED exists to stop UNATTENDED lanes
 * (crons, auto-reel) from spending credits on their own; an operator reacting to a card is
 * the explicit request that switch was never meant to block, and `allowWhenPaused` was left
 * in GenerateImagesOpts for exactly this seam. Nothing else here bypasses it.
 */
async function generateSceneImages(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const slots = (job.data.prompt_slots ?? []).map((s) => ({ ...s }));
  const prompts = (job.data.hs_image_prompt_options ?? []).map((o) => o.prompt);
  // Only the empty slots, so a re-react retries the failures instead of redoing the set.
  const todo = slots
    .map((s, i) => ({ i, scene: s.scene, prompt: prompts[i] ?? "" }))
    .filter((t) => !slots[t.i].image_url && t.prompt);

  if (!todo.length) {
    await post(
      channel,
      threadTs,
      slots.length && slots.every((s) => s.image_url)
        ? "Every scene already has an image. Reply `review` to keep going."
        : "I have no prompts to generate from here. Reply `retry` to rewrite them."
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY) {
    await post(
      channel,
      threadTs,
      "I can't generate: OPENAI_API_KEY is not set on this deployment. Generate them yourself and drop them here, or set the key in Vercel and react again."
    );
    return;
  }

  await post(channel, threadTs, `Generating ${todo.length} image${todo.length === 1 ? "" : "s"} with gpt-image-2. Give it a minute.`);

  // Generated together (3 images, well inside the 300s budget), then handled in scene order
  // so the thread reads top to bottom. generateImages already retries each prompt once.
  const results = await Promise.all(
    todo.map((t) =>
      generateImages({ prompts: [t.prompt], aspect: "9:16", allowWhenPaused: true })
        .then((r) => r[0] ?? null)
        .catch((e) => {
          console.error(`[hook-studio] scene ${t.scene} generation threw:`, (e as Error).message);
          return null;
        })
    )
  );

  const failed: number[] = [];
  for (let n = 0; n < todo.length; n++) {
    const t = todo[n];
    const img = results[n];
    const url = img ? await uploadToReels(img.buffer, img.mimetype) : null;
    if (!img || !url) {
      failed.push(t.scene);
      continue;
    }
    slots[t.i] = { ...slots[t.i], image_url: url };
    // The slot is already saved, so an upload failure must not read as a lost image:
    // fall back to the public URL rather than silently showing nothing.
    const shown = await slack
      .uploadFile(channel, `scene-${t.scene}.png`, img.buffer, img.mimetype, threadTs)
      .catch(() => null);
    if (!shown) await post(channel, threadTs, `*Scene ${t.scene}* (couldn't attach it here): ${url}`);
  }

  const fresh = (await getLatestJobByThread(threadTs)) ?? job;
  await updateJob(fresh, { data: { ...fresh.data, prompt_slots: slots } });

  if (failed.length) {
    await post(
      channel,
      threadTs,
      `Scene ${failed.join(", ")} didn't come back. React ✅ again to retry just those, or drop the image yourself (comment \`scene N\`).`
    );
  }
  if (slots.length && slots.every((s) => s.image_url)) {
    await post(channel, threadTs, "All scene images in. Writing motion prompts...");
    const filled = (await getLatestJobByThread(threadTs)) ?? fresh;
    await postMotionPrompts(filled, workflow);
  }
}

// ---- step 6: motion prompts (Seedance, prompts only) ------------------------------------------

async function postMotionPrompts(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const images = slotImages(job);
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  try {
    // v2 animate-directly branch point: everything a clip generator needs is on the job here
    // (final_animation_prompts + prompt_slots images + mode_videos slots). Do not build yet.
    // Authored-scene workflows carry LOCKED motion (draw-beat seconds) per scene; use it verbatim.
    const authored = hasAuthoredScenes(workflow);
    const motions = authored
      ? workflow.scenes.map((s) => (s.animation_prompt ?? "").trim())
      : await generateMotionPrompts(images, { workflow, copy });
    await updateJob(job, {
      stage: "hs_anim",
      data: { ...job.data, final_animation_prompts: motions, mode_images: images },
    });
    await postCard(
      job,
      [
        authored
          ? `*Locked draw-beat motion* (one per scene, edit only if intentional):`
          : `*Motion prompts* (Seedance 2.0, one per scene):`,
        ...images.map((_, i) => `${i + 1}. *Scene ${i + 1}* — ${motions[i] ?? "slow push in on the subject"}`),
        "",
        "Reply `animate` and I'll generate every clip with Seedance, drop them here, then ask before rendering.",
        "Or animate them yourself and drop the clips here (comment `scene N` to target).",
        "React ✅ or reply `review` to continue with the stills. `motion N <new text>` rewrites one.",
      ].join("\n"),
      ["white_check_mark"]
    );
  } catch (e) {
    console.error("[hook-studio] motion prompts failed:", (e as Error).message);
    await updateJob(job, { stage: "hs_anim", data: { ...job.data, mode_images: images } });
    await post(
      channel,
      threadTs,
      `Could not write the motion prompts (${(e as Error).message.slice(0, 120)}). Reply \`review\` to continue with the stills.`
    );
  }
}

// ---- step 7: the full review + render gate -----------------------------------------------------

function buildReviewCard(args: {
  workflow: Workflow;
  copy: StructuredCopyLine[];
  images: string[];
  motions: string[];
  videos: Array<string | null>;
  storyboardNote?: string;
}): string {
  const { workflow: w } = args;
  const spec = w.render_spec;
  const lines: string[] = ["Seems like we have everything we need. Here is the full video:", ""];
  const S = spec?.shots?.length ?? args.images.length ?? 1;
  lines.push(`*${w.name}* — ${spec?.duration_seconds ? `${spec.duration_seconds}s, ` : ""}${S} shot${S === 1 ? "" : "s"}, song: ${songNote(w)}`);
  if (args.storyboardNote) lines.push(args.storyboardNote);
  lines.push("");

  const roles = w.copy_structure ?? [];
  const textFor = (key: string) => args.copy.find((c) => c.key === key)?.text ?? "";
  const roleLine = (r: (typeof roles)[number]) => {
    const text = textFor(r.key);
    if (!text) return "";
    const timing =
      r.at_second !== undefined ? `${r.at_second}s${r.out_second !== undefined ? ` to ${r.out_second}s` : ""}` : "";
    return `  ${timing ? `${timing} ` : ""}"${text}" (${r.label}${r.position ? `, ${r.position}` : ""})`;
  };

  if (spec?.shots?.length) {
    for (const shot of [...spec.shots].sort((a, b) => a.i - b.i)) {
      const i = shot.i;
      lines.push(`*Shot ${i}* (${shot.start}s to ${shot.end}s)`);
      const img = args.images[i - 1];
      const clip = args.videos[i - 1];
      const motion = args.motions[i - 1];
      lines.push(`  image: ${img ? `<${img}|scene ${i} image>` : "MISSING"}${clip ? "  [animated clip in]" : motion ? `  |  motion: ${motion}` : ""}`);
      for (const r of roles.filter((x) => x.shot === i)) {
        const rl = roleLine(r);
        if (rl) lines.push(rl);
      }
      lines.push("");
    }
    const unplaced = roles.filter((r) => !r.shot).map(roleLine).filter(Boolean);
    if (unplaced.length) lines.push("*On-screen text (untimed):*", ...unplaced, "");
  } else {
    // render_reel builds (no spec): single-shot summary.
    lines.push(`  image: ${args.images[0] ? `<${args.images[0]}|hook image>` : "MISSING"}${args.videos[0] ? "  [animated clip in]" : args.motions[0] ? `  |  motion: ${args.motions[0]}` : ""}`);
    lines.push(...args.copy.map((c) => `  "${c.text}" (${c.label})`), "");
  }

  lines.push(
    "Render it? React ✅ or reply `render`.",
    "Changes: paste a new copy block (I re-slot it), drop a replacement image with `scene N`,",
    "`motion N <text>` rewrites a motion prompt, `cancel` ends it."
  );
  return lines.join("\n");
}

async function postReview(job: ContentJob, workflow: Workflow): Promise<void> {
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const images = slotImages(job);
  const motions = job.data.final_animation_prompts ?? [];
  const videos = job.data.mode_videos ?? [];
  const boards = job.data.hs_storyboards ?? [];
  const chosen = job.data.hs_chosen_storyboard;
  const storyboardNote =
    chosen && boards[chosen - 1] ? `Storyboard: Set ${chosen} (${boards[chosen - 1].title})` : undefined;
  await updateJob(job, { stage: "hs_review" });
  await postCard(job, buildReviewCard({ workflow, copy, images, motions, videos, storyboardNote }), [
    "white_check_mark",
  ]);
}

async function startHookRender(job: ContentJob, workflow: Workflow): Promise<void> {
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const images = slotImages(job);
  if (!copy.length || !images.length) {
    await post(job.slack_channel, job.slack_thread_ts, "Missing copy or images, nothing to render yet.");
    return;
  }
  bg(job, "Render", finishDropRender(job, workflow, copy, images, job.data.mode_videos ?? []));
}

/** The v2 "animate-directly" branch: animate every scene image with its motion prompt via
 *  Seedance, drop each finished clip into the thread so the operator can see them, then hold
 *  at a render gate (`hs_review`) so nothing renders until they confirm with ✅ / `render`.
 *  Modeled on content-scene-runner.animateAndStitch. When the operator confirms, the existing
 *  hs_review handler renders through the render_spec build (not stitchClipsRemote) so the clips
 *  land on the workflow's beat-synced timeline with their audio ducked under the song. A shot
 *  whose clip fails keeps its still, so a partial failure still renders. */
async function autoAnimateScenes(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const images = slotImages(job);
  const motions = job.data.final_animation_prompts ?? [];
  if (!copy.length || !images.length) {
    await post(channel, threadTs, "Missing copy or images, nothing to animate yet.");
    return;
  }

  await post(channel, threadTs, `Animating ${images.length} scene(s) with Seedance... this runs in parallel and takes a few minutes.`);
  const motion = getMotionAdapter();

  // Animate every image in parallel; post each finished clip into the thread. A failed shot
  // resolves to null and keeps its still.
  const videos = await Promise.all(
    images.map(async (imageUrl, i) => {
      try {
        const buffer = await motion.animate(imageUrl, motions[i] ?? "");
        // Drop the clip into the thread so the operator sees each animated scene.
        await slack.uploadFile(channel, `scene-${i + 1}.mp4`, buffer, "video/mp4", threadTs).catch(() => null);
        // Durable URL for the render service to fetch.
        return await uploadToReels(buffer, "video/mp4");
      } catch (e) {
        console.error(`[hook-studio] scene ${i + 1} animation failed:`, (e as Error).message);
        await post(channel, threadTs, `Scene ${i + 1} did not animate (${(e as Error).message.slice(0, 160)}) - it will render as the still.`);
        return null;
      }
    })
  );

  if (!videos.some(Boolean)) {
    await post(channel, threadTs, "No clips animated, so nothing to render. Reply `review` to render the stills as-is, or `animate` to try again.");
    return;
  }

  // Hold at the render gate: store the clips and ask before rendering. ✅ / `render` on the
  // card below routes through the existing hs_review handler -> startHookRender.
  const filled = videos.filter(Boolean).length;
  const fresh = (await getLatestJobByThread(threadTs)) ?? job;
  await updateJob(fresh, { stage: "hs_review", data: { ...fresh.data, mode_videos: videos } });
  const freshest = (await getLatestJobByThread(threadTs)) ?? fresh;
  await postCard(
    freshest,
    [
      `${filled} of ${images.length} clip(s) animated and posted above.`,
      "Render the final video now? React ✅ or reply `render`.",
      "`motion N <text>` rewrites a prompt, `cancel` ends it.",
    ].join("\n"),
    ["white_check_mark"]
  );
}

// ---- routers -----------------------------------------------------------------------------------

const HS_NUDGES: Partial<Record<ContentJob["stage"], string>> = {
  hs_workflow: "Pick a workflow by number (or react ✅ for the top pick), or `cancel`.",
  hs_options:
    "Pick a copy option 1-5 on the copy card (react or type the number, or paste your own copy block) and I'll post one image prompt per scene. `retry` re-runs the options, `cancel` ends it.",
  hs_await_images:
    "React ✅ (or reply `generate`) and I'll make the scene images with gpt-image-2. Or upload your own into this thread (comment `scene N` to target a slot). `retry` rewrites the prompts.",
  hs_anim:
    "Reply `animate` and I'll generate the clips, drop them here, then ask before rendering. Or drop your own Seedance clips, react ✅ or reply `review` to continue with the stills, or `motion N <text>` to rewrite a prompt.",
  hs_review: "React ✅ or reply `render` to render. Paste a new copy block, drop a replacement image with `scene N`, or `motion N <text>` to change things.",
  dr_render: "Rendering now. Reply `render` to retry if it fails.",
};

async function loadJobWorkflow(job: ContentJob): Promise<Workflow | null> {
  return job.data.workflow_id ? loadWorkflow(job.data.workflow_id) : null;
}

async function pickMenuWorkflow(job: ContentJob, n: number): Promise<void> {
  const menu = job.data.fit_menu ?? [];
  const wfId = menu[n - 1];
  if (!wfId) {
    await post(job.slack_channel, job.slack_thread_ts, `Pick a number between 1 and ${menu.length}.`);
    return;
  }
  const workflow = await loadWorkflow(wfId);
  if (!workflow) {
    await post(job.slack_channel, job.slack_thread_ts, "That workflow could not be loaded.");
    return;
  }
  await postHookOptions(job, workflow);
}

async function lockCopyOption(job: ContentJob, n: number): Promise<void> {
  const options = job.data.hs_copy_options ?? [];
  const picked = options[n - 1];
  if (!picked) {
    await post(job.slack_channel, job.slack_thread_ts, `There is no copy option ${n}.`);
    return;
  }
  await updateJob(job, { data: { ...job.data, structured_copy: picked } });
  const workflow = await loadJobWorkflow(job);
  if (!workflow) {
    await post(job.slack_channel, job.slack_thread_ts, `Copy option ${n} locked, but I lost the workflow. Reply \`cancel\` and start again.`);
    return;
  }
  // Advance from a fresh copy of the job (line above did not refresh the local one) so
  // structured_copy is present when maybeAdvanceFromOptions reads it. That handler now writes
  // the hook-image prompts from the locked copy on the legacy hook-first path.
  const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
  await maybeAdvanceFromOptions(fresh, workflow);
}

/** Thread reply on a hook-studio thread. Returns false when the thread is not ours. */
export async function handleHookStudioReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const job = await getHookJob(args.threadTs);
  if (!job) return false;
  const text = args.text.trim();
  const { channel } = args;

  if (/^\s*cancel\s*$/i.test(text) && job.status === "active") {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(channel, job.slack_thread_ts, "Cancelled. Post a new hook any time to start again.");
    return true;
  }

  // Finished threads: `caption` re-runs the sales letter; anything else gets a pointer.
  if (job.status !== "active") {
    if (/^\s*caption\s*$/i.test(text)) {
      const workflow = await loadJobWorkflow(job);
      const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
      if (!workflow || !copy.length) {
        await post(channel, job.slack_thread_ts, "I can't find this video's workflow/copy to caption from.");
        return true;
      }
      await post(channel, job.slack_thread_ts, "Writing the sales letter...");
      bg(
        job,
        "Sales letter",
        (async () => {
          const { caption, beliefInstalled, note } = await writeSalesLetterFor(job, workflow, copy);
          await post(channel, job.slack_thread_ts, note);
          if (caption) {
            const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
            await updateJob(fresh, {
              data: { ...fresh.data, caption_draft: caption, belief_installed: beliefInstalled || undefined },
            });
          }
        })()
      );
      return true;
    }
    await post(channel, job.slack_thread_ts, "This one is finished. Post a new hook to start again. Reply `caption` to rewrite the sales letter.");
    return true;
  }

  const workflow = await loadJobWorkflow(job);
  const motionEdit = /^\s*motion\s+(\d{1,2})\s+([\s\S]+)$/i.exec(text);

  switch (job.stage) {
    case "hs_workflow": {
      // Two digits: the menu is well past 10 workflows now, and reactions cap at 5 keycaps,
      // so typing is the only way to reach the back half of the list.
      const n = /^\s*(\d{1,2})\s*$/.exec(text)?.[1];
      if (n) {
        bg(job, "Workflow pick", pickMenuWorkflow(job, parseInt(n, 10)));
        return true;
      }
      break;
    }
    case "hs_options": {
      const n = /^\s*(\d{1,2})\s*$/.exec(text)?.[1];
      if (n) {
        await lockCopyOption(job, parseInt(n, 10));
        return true;
      }
      if (/^\s*retry\s*$/i.test(text) && workflow) {
        bg(job, "Copy options", postHookOptions(job, workflow));
        return true;
      }
      if (splitLines(text).length >= 2 && workflow) {
        // Awaited, NOT detached: the route already runs this handler inside waitUntil with a
        // 300s budget, and a nested waitUntil put the fit outside every error handler — a
        // throw from fitCopy's Claude call died silently and left the job parked here forever.
        await post(channel, job.slack_thread_ts, "Fitting your copy to the boxes...");
        try {
          const copy = await fitCopy(job, workflow, text);
          if (!copy.length) {
            await post(channel, job.slack_thread_ts, "Could not fit that copy to this workflow's boxes.");
            return true;
          }
          const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
          await updateJob(fresh, { data: { ...fresh.data, structured_copy: copy } });
          await post(channel, job.slack_thread_ts, ["Copy locked:", ...copy.map((c) => `*${c.label}:* ${c.text}`)].join("\n"));
          await maybeAdvanceFromOptions(fresh, workflow);
        } catch (e) {
          console.error("[hook-studio] copy fit failed:", (e as Error).message);
          await post(
            channel,
            job.slack_thread_ts,
            `Could not fit that copy (${(e as Error).message.slice(0, 140)}). Paste it again, or react 1-${(job.data.hs_copy_options ?? []).length || 5} on the copy card to use one of my options.`
          );
        }
        return true;
      }
      break;
    }
    case "hs_await_images": {
      const setN = /^\s*set\s+(\d)\s*$/i.exec(text)?.[1];
      if (setN) {
        await updateJob(job, { data: { ...job.data, hs_chosen_storyboard: parseInt(setN, 10) } });
        await post(channel, job.slack_thread_ts, `Noted: set ${setN}.`);
        return true;
      }
      if (/^\s*retry\s*$/i.test(text) && workflow) {
        // Nothing dropped yet means these are the copy-first scene prompts; rewrite those.
        // Once the hook image is in, retry means the storyboards for the remaining scenes.
        const anyImage = (job.data.prompt_slots ?? []).some((s) => s.image_url);
        bg(
          job,
          anyImage ? "Storyboards" : "Image prompts",
          anyImage ? postStoryboards(job, workflow) : postSceneImagePromptsFromCopy(job, workflow)
        );
        return true;
      }
      // Typed twin of the checkmark, for when the card has scrolled out of reach.
      if (/^\s*generate(\s+images?)?\s*$/i.test(text) && workflow) {
        bg(job, "Image generation", generateSceneImages(job, workflow));
        return true;
      }
      break;
    }
    case "hs_anim": {
      if (/^\s*animate(\s+all)?\s*$/i.test(text) && workflow) {
        bg(job, "Auto-animate", autoAnimateScenes(job, workflow));
        return true;
      }
      if (/^\s*(review|render|still)\s*$/i.test(text) && workflow) {
        bg(job, "Review", postReview(job, workflow));
        return true;
      }
      if (motionEdit) {
        const i = parseInt(motionEdit[1], 10) - 1;
        const motions = [...(job.data.final_animation_prompts ?? [])];
        while (motions.length <= i) motions.push("");
        motions[i] = stripEmDashes(motionEdit[2]).trim();
        await updateJob(job, { data: { ...job.data, final_animation_prompts: motions } });
        await post(channel, job.slack_thread_ts, `Motion ${i + 1} updated: ${motions[i]}`);
        return true;
      }
      break;
    }
    case "hs_review": {
      if (/^\s*(render|still|go)\s*$/i.test(text) && workflow) {
        await startHookRender(job, workflow);
        return true;
      }
      if (motionEdit && workflow) {
        const i = parseInt(motionEdit[1], 10) - 1;
        const motions = [...(job.data.final_animation_prompts ?? [])];
        while (motions.length <= i) motions.push("");
        motions[i] = stripEmDashes(motionEdit[2]).trim();
        await updateJob(job, { data: { ...job.data, final_animation_prompts: motions } });
        bg(job, "Review", postReview(job, workflow));
        return true;
      }
      if (splitLines(text).length >= 2 && workflow) {
        // Same shape as the hs_options paste branch above: awaited, never detached.
        await post(channel, job.slack_thread_ts, "Refitting your copy...");
        try {
          const copy = await fitCopy(job, workflow, text);
          if (!copy.length) {
            await post(channel, job.slack_thread_ts, "Could not fit that copy to this workflow's boxes.");
            return true;
          }
          const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
          await updateJob(fresh, { data: { ...fresh.data, structured_copy: copy } });
          await postReview(fresh, workflow);
        } catch (e) {
          console.error("[hook-studio] copy refit failed:", (e as Error).message);
          await post(channel, job.slack_thread_ts, `Could not refit that copy (${(e as Error).message.slice(0, 140)}). Paste it again.`);
        }
        return true;
      }
      break;
    }
    case "dr_render": {
      if (/^\s*render\s*$/i.test(text) && workflow) {
        await startHookRender(job, workflow);
        return true;
      }
      break;
    }
  }

  const nudge = HS_NUDGES[job.stage];
  await post(channel, job.slack_thread_ts, nudge ?? "Not sure what to do with that here. `cancel` ends this session.");
  return true;
}

/** Reactions on hook-studio cards. Self-routes by picker ts + format. */
export async function handleHookStudioReaction(args: {
  reaction: string;
  slackTs: string;
  channel: string;
  userId?: string;
}): Promise<boolean> {
  const keycap = KEYCAPS[args.reaction];
  const approve = APPROVE.has(args.reaction);
  const cancel = CANCEL.has(args.reaction);
  if (!keycap && !approve && !cancel) return false;

  const job = await getJobByPickerTs(args.slackTs);
  if (!isHookJob(job) || job.status !== "active") return false;

  // Bot pre-seeds emojis on its own cards; only a HUMAN reaction acts (see drop-studio).
  if (args.userId && args.userId === (await slack.getBotUserId())) return true;
  const seeded = (job.data.seeded_reactions ?? []) as string[];
  if (seeded.includes(args.reaction)) {
    const count = await slack.getReactionCount(job.slack_channel, args.slackTs, args.reaction);
    // null = reactions.get failed (likely missing reactions:read scope) — trust the
    // bot-userId guard above instead of going dead.
    if (count !== null && count < 2) return true;
  }

  if (cancel) {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(job.slack_channel, job.slack_thread_ts, "Cancelled.");
    return true;
  }

  const workflow = await loadJobWorkflow(job);
  switch (job.stage) {
    case "hs_workflow":
      if (approve) bg(job, "Workflow pick", pickMenuWorkflow(job, 1));
      else if (keycap) bg(job, "Workflow pick", pickMenuWorkflow(job, keycap));
      return true;
    case "hs_options":
      if (keycap) await lockCopyOption(job, keycap);
      return true;
    case "hs_await_images":
      if (approve && workflow) bg(job, "Image generation", generateSceneImages(job, workflow));
      return true;
    case "hs_anim":
      if (approve && workflow) bg(job, "Review", postReview(job, workflow));
      return true;
    case "hs_review":
      if (approve && workflow) await startHookRender(job, workflow);
      return true;
    default:
      return true; // our card; swallow
  }
}

/** Files dropped into a hook-studio thread. Returns false when the thread is not ours. */
export async function handleHookStudioFileDrop(args: {
  channel: string;
  threadTs: string;
  files: DroppedFile[];
  text?: string;
}): Promise<boolean> {
  const job = await getHookJob(args.threadTs);
  if (!job) return false;
  const text = args.text ?? "";
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;

  if (job.status !== "active") {
    await post(channel, threadTs, "This one is finished. Post a new hook to start again.");
    return true;
  }

  const workflow = await loadJobWorkflow(job);

  // Seedance clips at the animate gate (or late, at review): slot per shot.
  if ((job.stage === "hs_anim" || job.stage === "hs_review") && hasVideoFiles(args.files)) {
    await post(channel, threadTs, "Got the clips. Pulling them in...");
    const { clips, failures } = await resolveDropClips(args.files);
    if (failures.length) {
      await post(
        channel,
        threadTs,
        `Could not pull in ${failures.length} clip(s):\n${failures.join("\n")}\nRe-upload those and I'll slot them.`
      );
    }
    if (!clips.length) {
      if (!failures.length) {
        await post(channel, threadTs, "Could not read those files as video clips. Try re-uploading the MP4s.");
      }
      return true;
    }
    const total = (job.data.prompt_slots ?? []).length || 1;
    const videos: Array<string | null> = [...(job.data.mode_videos ?? [])];
    while (videos.length < total) videos.push(null);
    const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(text);
    let target = targetMatch ? parseInt(targetMatch[1], 10) - 1 : null;
    for (const url of clips) {
      let slot = target ?? videos.findIndex((v) => !v);
      if (slot === null || slot < 0 || slot >= total) slot = total - 1;
      videos[slot] = url;
      if (target !== null) target++;
    }
    await updateJob(job, { data: { ...job.data, mode_videos: videos } });
    const filled = videos.filter(Boolean).length;
    if (filled >= total && workflow) {
      bg(job, "Review", postReview(job, workflow));
    } else if (job.stage === "hs_review" && workflow) {
      bg(job, "Review", postReview(job, workflow));
    } else {
      await post(channel, threadTs, `${filled} of ${total} clip(s) in. Drop the rest, or react ✅ / reply \`review\` to continue.`);
    }
    return true;
  }

  // Image drops: slot into prompt_slots (scene 1 = the hook image; `scene N` targets a slot).
  const media = await resolveDropMedia(args.files);
  if (!media.length) {
    await post(channel, threadTs, "Could not read any image from that message.");
    return true;
  }
  const slots = (job.data.prompt_slots ?? []).map((s) => ({ ...s }));
  if (!slots.length) slots.push({ scene: 1, image_url: null });
  const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(text);
  let target = targetMatch ? parseInt(targetMatch[1], 10) - 1 : null;
  for (const m of media) {
    let slot = target ?? slots.findIndex((s) => !s.image_url);
    if (slot === null || slot < 0 || slot >= slots.length) slot = slots.length - 1;
    slots[slot] = { ...slots[slot], image_url: m.url };
    if (target !== null) target++;
  }
  await updateJob(job, { data: { ...job.data, prompt_slots: slots } });

  // Copy pasted in the same message as the image (the "image + copy together" case).
  if (job.stage === "hs_options" && splitLines(text).length >= 2 && workflow) {
    const copy = await fitCopy(job, workflow, text);
    if (copy.length) {
      await updateJob(job, { data: { ...job.data, structured_copy: copy } });
      await post(channel, threadTs, ["Copy locked from your message:", ...copy.map((c) => `*${c.label}:* ${c.text}`)].join("\n"));
    }
  }

  if (!workflow) {
    await post(channel, threadTs, "Image in, but I lost the workflow. Reply `cancel` and start again.");
    return true;
  }

  switch (job.stage) {
    case "hs_options": {
      const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
      if (copy.length) {
        await maybeAdvanceFromOptions(job, workflow);
      } else {
        await post(channel, threadTs, "Image in. React 1-5 on the copy card or paste your copy to continue.");
      }
      return true;
    }
    case "hs_await_images": {
      const filled = slots.filter((s) => s.image_url).length;
      if (slots.every((s) => s.image_url)) {
        await post(channel, threadTs, "All scene images in. Writing motion prompts...");
        bg(job, "Motion prompts", postMotionPrompts(job, workflow));
      } else {
        await post(channel, threadTs, `${filled} of ${slots.length} scene image(s) in.`);
      }
      return true;
    }
    case "hs_anim":
    case "hs_review": {
      await post(channel, threadTs, "Image swapped. Use `motion N <text>` if its motion prompt needs to change.");
      if (job.stage === "hs_review") bg(job, "Review", postReview(job, workflow));
      return true;
    }
    default: {
      const nudge = HS_NUDGES[job.stage];
      if (nudge) await post(channel, threadTs, nudge);
      return true;
    }
  }
}
