// Hook Studio — the hook-FIRST lane of the drop channels. Where drop-studio starts from
// media + copy in one message, this lane starts from TEXT ONLY: the operator posts 1-3
// hook lines (optionally naming a workflow, e.g. "with workflow 2") and the bot walks the
// whole video into existence in the thread:
//
//   hook text -> 6 hook-image prompt options (3 Meta-glasses POV + 3 bot picks)
//             + 3 complete-copy options sized to the workflow's boxes
//   -> operator drops the generated hook image (+ optionally edited copy, same message)
//   -> 3 storyboard prompt sets for the remaining scenes, continuous with the hook image
//   -> operator drops the scene images -> motion prompts (Seedance, prompts only)
//   -> "Seems like we have everything we need" full shot-by-shot review
//   -> checkmark/`render` -> finishDropRender (existing render + sales-letter pipeline)
//
// format_id "hook_studio", stages hs_workflow -> hs_options -> hs_await_images -> hs_anim
// -> hs_review -> dr_render -> done. Coexists with drop-studio in the same channels: entry
// is disjoint (text-only vs files) and every in-thread handler self-routes by format_id.
// Prompt-first stays law: this module never generates images; animation is prompts only
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
  generateMotionPrompts,
  finishDropRender,
  writeSalesLetterFor,
  zeroAdaptationCopy,
  splitLines,
  shotCount,
  boxCount,
  songNote,
  activeWorkflows,
} from "@/lib/reel/drop-studio";
import {
  avatarBlock,
  reslotCopyToStructure,
  generateStructuredCopyVariants,
  type StructuredCopyLine,
} from "@/lib/reel/creative-director";
import { stripEmDashes } from "@/lib/reel/text";
import { loadWorkflow, type Workflow } from "@/config/workflows";
import { workflowRenderBuild } from "@/lib/reel/render-dispatch";
import { POV_GLASSES_TOKEN } from "@/config/pov-style";
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

function hasVideoFiles(files: DroppedFile[]): boolean {
  return files.some((f) => (f.mimetype || "").startsWith("video/"));
}

function slotImages(job: ContentJob): string[] {
  return (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean);
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

// ---- step 2: 6 hook-image prompts + 3 complete-copy options ----------------------------------

interface HookImagePrompts {
  meta_pov: string[];
  bot_pick: string[];
}

/** 6 first-frame (hook shot) image prompts: 3 in live Meta-glasses POV, 3 in the bot's own
 *  preferred compositions. The hook TEXT is context for meaning only, never baked in. */
async function generateHookImagePrompts(args: {
  owner: Vertical; // the avatar the copy speaks to (meaning)
  workflow: Workflow; // carries the look (style_dna + visual_rules + reference frames)
  lookVertical: Vertical; // dna fallback when the workflow has none
  hookLines: string[];
}): Promise<HookImagePrompts> {
  const { workflow } = args;
  const dna = (workflow.style_dna ?? "").trim() || args.lookVertical.style_token;
  const metaDna = /\b(pov|meta glasses|first.person)\b/i.test(dna) ? dna : POV_GLASSES_TOKEN;
  const frames = await loadReferenceFrames(workflow.vertical_id, { workflowId: workflow.id, limit: 4 });

  interface Gen {
    meta_pov: string[];
    bot_pick: string[];
  }
  const system = [
    "You write image-generation prompts for the FIRST frame (the hook shot) of a short vertical",
    `video built through the "${workflow.name}" workflow.`,
    `Audience avatar: ${args.owner.name} (${args.owner.business_descriptor}).`,
    "The on-screen hook text below is added later as an overlay, NEVER baked into the image; it",
    "tells you the MEANING the image must dramatize.",
    "",
    "Return 6 scene actions:",
    "- meta_pov: 3 live first-person Meta-glasses moments that make the hook text land.",
    "- bot_pick: 3 of your own preferred scenes (any composition: b-roll, symbolic, cinematic)",
    "  that visually dramatize the hook's meaning.",
    "Each action is ONE sentence: subject + action + setting. No camera or style boilerplate",
    "(the style DNA is prepended separately), no on-screen text, never em dashes.",
    ...(workflow.visual_rules?.length ? ["Visual rules:", ...workflow.visual_rules.map((r) => `- ${r}`)] : []),
    frames.length
      ? `You are shown ${frames.length} reference photo(s) of the exact look the operator wants. Ground materials, wear, lighting, and realism on them.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await callClaudeJSON<Gen>({
    model: model(),
    system,
    user: ["The hook text (overlay, for meaning):", ...args.hookLines.map((l) => `- ${l}`), "", "Return the actions as JSON."].join("\n"),
    images: frames.length ? frames : undefined,
    maxTokens: 1400,
    temperature: 0.85,
    schemaHint: '{ "meta_pov": [string], "bot_pick": [string] }',
    validate: (v: unknown): v is Gen =>
      typeof v === "object" &&
      v !== null &&
      Array.isArray((v as Gen).meta_pov) &&
      Array.isArray((v as Gen).bot_pick) &&
      [...(v as Gen).meta_pov, ...(v as Gen).bot_pick].every((s) => typeof s === "string"),
  });

  const assemble = (base: string, action: string) =>
    `${base.replace(/[.\s]+$/, "")}. ${stripEmDashes(action).replace(/[.\s]+$/, "")}. No text, captions, logos, or watermarks in the image. 9:16 vertical.`;
  return {
    meta_pov: data.meta_pov.slice(0, 3).map((a) => assemble(metaDna, a)),
    bot_pick: data.bot_pick.slice(0, 3).map((a) => assemble(dna, a)),
  };
}

/** Post the 6 hook-image prompts + the 3-copy picker card, then wait at hs_options. */
async function postHookOptions(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const hookLines = job.data.hook_lines ?? [];
  await post(channel, threadTs, `Writing hook image prompts + copy options for *${workflow.name}*...`);

  const drop = await loadVertical(job.vertical_id);
  const owner = await loadVertical(dropOwnerVerticalId(drop));
  const S = shotCount(workflow);

  const [pRes, cRes] = await Promise.allSettled([
    generateHookImagePrompts({ owner, workflow, lookVertical: drop, hookLines }),
    generateStructuredCopyVariants({ vertical: owner, workflow, hookLines, count: 3 }),
  ]);

  const prompts = pRes.status === "fulfilled" ? pRes.value : null;
  const variants = cRes.status === "fulfilled" ? cRes.value : [];
  if (pRes.status === "rejected") console.error("[hook-studio] image prompts failed:", (pRes.reason as Error)?.message);
  if (cRes.status === "rejected") console.error("[hook-studio] copy variants failed:", (cRes.reason as Error)?.message);

  if (!prompts && !variants.length) {
    await post(channel, threadTs, "Could not write the options (Claude error). Reply `retry` to run it again.");
    await updateJob(job, {
      stage: "hs_options",
      data: {
        ...job.data,
        workflow_id: workflow.id,
        prompt_slots: Array.from({ length: S }, (_, i) => ({ scene: i + 1, image_url: null })),
      },
    });
    return;
  }

  if (prompts) {
    const block = (p: string) => `\`\`\`\n${p}\n\`\`\``;
    await post(
      channel,
      threadTs,
      [
        "*Hook image prompts, Meta glasses live POV* (generate ONE with gpt-image-2, then drop it here):",
        ...prompts.meta_pov.map((p, i) => `Option ${i + 1}:\n${block(p)}`),
      ].join("\n")
    );
    await post(
      channel,
      threadTs,
      [
        "*Hook image prompts, my picks:*",
        ...prompts.bot_pick.map((p, i) => `Option ${i + 4}:\n${block(p)}`),
      ].join("\n")
    );
  }

  await updateJob(job, {
    stage: "hs_options",
    data: {
      ...job.data,
      workflow_id: workflow.id,
      hs_image_prompt_options: prompts
        ? [
            ...prompts.meta_pov.map((p) => ({ kind: "meta_pov" as const, prompt: p })),
            ...prompts.bot_pick.map((p) => ({ kind: "bot_pick" as const, prompt: p })),
          ]
        : [],
      hs_copy_options: variants,
      prompt_slots: Array.from({ length: S }, (_, i) => ({ scene: i + 1, image_url: null })),
    },
  });

  if (variants.length) {
    const B = boxCount(workflow);
    const caps = ["one", "two", "three"].slice(0, variants.length);
    await postCard(
      job,
      [
        `*Complete video copy* — ${variants.length} options for *${workflow.name}*'s ${B} text slot${B === 1 ? "" : "s"}.`,
        `React ${caps.map((_, i) => `${i + 1}️⃣`).join("/")} to lock one (or paste an edited version with the image instead):`,
        ...variants.flatMap((v, i) => [`*Option ${i + 1}:*`, ...v.map((c) => `  *${c.label}:* ${c.text}`)]),
        "",
        "Then drop the generated hook image into this thread (copy pasted in the same message is fine).",
      ].join("\n"),
      caps
    );
  } else {
    await post(
      channel,
      threadTs,
      workflow.copy_structure?.length
        ? "Could not write the copy options. Paste your own copy block with the hook image (or reply `retry`)."
        : "This workflow has free-form copy boxes. Drop the hook image + your copy lines (label, hook, payoff, cta) in one message."
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
  if (!copy.length || !slots[0]?.image_url) return;
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

/** 3 DISTINCT storyboard options for the scenes that still need images, each continuing the
 *  chosen hook image's exact look, depicting the copy that lands on each shot. */
async function generateStoryboardOptions(args: {
  owner: Vertical;
  workflow: Workflow;
  lookVertical: Vertical;
  copy: StructuredCopyLine[];
  hookImage: ClaudeImageInput | null;
  scenes: number[]; // 1-based scene indexes still needing an image
}): Promise<Array<{ title: string; prompts: string[] }>> {
  const { workflow } = args;
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

  interface Gen {
    options: Array<{ title: string; prompts: string[] }>;
  }
  const system = [
    `You write image-generation prompts for the remaining scenes of a "${workflow.name}" video.`,
    `Scene 1 (the hook shot) is DONE${args.hookImage ? " and you are shown it" : ""}. Return 3 DISTINCT`,
    `storyboard options for scene(s) ${args.scenes.join(", ")}. Each option: a short title + exactly`,
    `${args.scenes.length} scene action(s), in that scene order.`,
    "Every action must CONTINUE the hook image's exact look (same location arc, lighting, lens,",
    "wardrobe, time of day) while depicting the copy that lands on that scene. The 3 options must",
    "differ in setting/arc, not wording.",
    "Each action is ONE sentence: subject + action + setting. No camera or style boilerplate",
    "(the style DNA is prepended separately), no on-screen text, never em dashes.",
    ...(workflow.visual_rules?.length ? ["Visual rules:", ...workflow.visual_rules.map((r) => `- ${r}`)] : []),
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
    images: args.hookImage ? [args.hookImage] : undefined,
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

  const assemble = (action: string) =>
    `${dna.replace(/[.\s]+$/, "")}. ${stripEmDashes(action).replace(/[.\s]+$/, "")}. No text, captions, logos, or watermarks in the image. 9:16 vertical.`;
  return data.options.slice(0, 3).map((o) => ({
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

// ---- step 6: motion prompts (Seedance, prompts only) ------------------------------------------

async function postMotionPrompts(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const images = slotImages(job);
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  try {
    // v2 animate-directly branch point: everything a clip generator needs is on the job here
    // (final_animation_prompts + prompt_slots images + mode_videos slots). Do not build yet.
    const motions = await generateMotionPrompts(images, { workflow, copy });
    await updateJob(job, {
      stage: "hs_anim",
      data: { ...job.data, final_animation_prompts: motions, mode_images: images },
    });
    await postCard(
      job,
      [
        `*Motion prompts* (Seedance 2.0, one per scene):`,
        ...images.map((_, i) => `${i + 1}. *Scene ${i + 1}* — ${motions[i] ?? "slow push in on the subject"}`),
        "",
        "Animate with Seedance and drop the clips here (optional, comment `scene N` to target).",
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
  waitUntil(finishDropRender(job, workflow, copy, images, job.data.mode_videos ?? []));
}

// ---- routers -----------------------------------------------------------------------------------

const HS_NUDGES: Partial<Record<ContentJob["stage"], string>> = {
  hs_workflow: "Pick a workflow by number (or react ✅ for the top pick), or `cancel`.",
  hs_options:
    "React 1️⃣/2️⃣/3️⃣ on the copy card (or paste your own copy block), then drop the generated hook image here. `retry` re-runs the options, `cancel` ends it.",
  hs_await_images: "Waiting on the scene images. Upload them into this thread (comment `scene N` to target a slot).",
  hs_anim:
    "Drop Seedance clips (optional), react ✅ or reply `review` to continue with the stills, or `motion N <text>` to rewrite a prompt.",
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
  const slots = job.data.prompt_slots ?? [];
  if (slots[0]?.image_url) {
    const workflow = await loadJobWorkflow(job);
    if (workflow) await maybeAdvanceFromOptions(job, workflow);
  } else {
    await post(job.slack_channel, job.slack_thread_ts, `Copy option ${n} locked. Drop the generated hook image here to continue.`);
  }
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
      waitUntil(
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
      const n = /^\s*(\d)\s*$/.exec(text)?.[1];
      if (n) {
        waitUntil(pickMenuWorkflow(job, parseInt(n, 10)));
        return true;
      }
      break;
    }
    case "hs_options": {
      const n = /^\s*(\d)\s*$/.exec(text)?.[1];
      if (n) {
        await lockCopyOption(job, parseInt(n, 10));
        return true;
      }
      if (/^\s*retry\s*$/i.test(text) && workflow) {
        waitUntil(postHookOptions(job, workflow));
        return true;
      }
      if (splitLines(text).length >= 2 && workflow) {
        await post(channel, job.slack_thread_ts, "Fitting your copy to the boxes...");
        waitUntil(
          (async () => {
            const copy = await fitCopy(job, workflow, text);
            if (!copy.length) {
              await post(channel, job.slack_thread_ts, "Could not fit that copy to this workflow's boxes.");
              return;
            }
            const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
            await updateJob(fresh, { data: { ...fresh.data, structured_copy: copy } });
            await post(channel, job.slack_thread_ts, ["Copy locked:", ...copy.map((c) => `*${c.label}:* ${c.text}`)].join("\n"));
            await maybeAdvanceFromOptions(fresh, workflow);
          })()
        );
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
        waitUntil(postStoryboards(job, workflow));
        return true;
      }
      break;
    }
    case "hs_anim": {
      if (/^\s*(review|render|still)\s*$/i.test(text) && workflow) {
        waitUntil(postReview(job, workflow));
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
      if (/^\s*render\s*$/i.test(text) && workflow) {
        await startHookRender(job, workflow);
        return true;
      }
      if (motionEdit && workflow) {
        const i = parseInt(motionEdit[1], 10) - 1;
        const motions = [...(job.data.final_animation_prompts ?? [])];
        while (motions.length <= i) motions.push("");
        motions[i] = stripEmDashes(motionEdit[2]).trim();
        await updateJob(job, { data: { ...job.data, final_animation_prompts: motions } });
        waitUntil(postReview(job, workflow));
        return true;
      }
      if (splitLines(text).length >= 2 && workflow) {
        await post(channel, job.slack_thread_ts, "Refitting your copy...");
        waitUntil(
          (async () => {
            const copy = await fitCopy(job, workflow, text);
            if (!copy.length) {
              await post(channel, job.slack_thread_ts, "Could not fit that copy to this workflow's boxes.");
              return;
            }
            const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
            await updateJob(fresh, { data: { ...fresh.data, structured_copy: copy } });
            await postReview(fresh, workflow);
          })()
        );
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
    if (count < 2) return true;
  }

  if (cancel) {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(job.slack_channel, job.slack_thread_ts, "Cancelled.");
    return true;
  }

  const workflow = await loadJobWorkflow(job);
  switch (job.stage) {
    case "hs_workflow":
      if (approve) waitUntil(pickMenuWorkflow(job, 1));
      else if (keycap) waitUntil(pickMenuWorkflow(job, keycap));
      return true;
    case "hs_options":
      if (keycap) await lockCopyOption(job, keycap);
      return true;
    case "hs_anim":
      if (approve && workflow) waitUntil(postReview(job, workflow));
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
    const clips = await resolveDropClips(args.files);
    if (!clips.length) {
      await post(channel, threadTs, "Could not read those files as video clips. Try re-uploading the MP4s.");
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
      waitUntil(postReview(job, workflow));
    } else if (job.stage === "hs_review" && workflow) {
      waitUntil(postReview(job, workflow));
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
        await post(channel, threadTs, "Hook image in. React 1-3 on the copy card or paste your copy to continue.");
      }
      return true;
    }
    case "hs_await_images": {
      const filled = slots.filter((s) => s.image_url).length;
      if (slots.every((s) => s.image_url)) {
        await post(channel, threadTs, "All scene images in. Writing motion prompts...");
        waitUntil(postMotionPrompts(job, workflow));
      } else {
        await post(channel, threadTs, `${filled} of ${slots.length} scene image(s) in.`);
      }
      return true;
    }
    case "hs_anim":
    case "hs_review": {
      await post(channel, threadTs, "Image swapped. Use `motion N <text>` if its motion prompt needs to change.");
      if (job.stage === "hs_review") waitUntil(postReview(job, workflow));
      return true;
    }
    default: {
      const nudge = HS_NUDGES[job.stage];
      if (nudge) await post(channel, threadTs, nudge);
      return true;
    }
  }
}
