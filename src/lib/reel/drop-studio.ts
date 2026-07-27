// Drop Studio — the SIMPLE daily lane. Runs in any channel wired to a vertical via
// verticals.slack_drop_channel_id (plus #ai-content-pest-control via env, backward
// compat). Adding an avatar channel is a SQL paste, no deploy — see
// docs/2026-07-10-drop-channel-verticals.sql.
//
//   1. DROP-AND-RENDER: drop 1+ images (or videos) + your copy in ONE message. The copy
//      + media count are matched against the workflow library (Shabang = 1 image + 2-4
//      lines). A perfect fit renders immediately; a near fit gets the adapted copy for a
//      checkmark; anything else gets a fit card with numbered picks. MP4 + caption land
//      in the thread. (format_id "drop_render", stages dr_fit -> dr_copy -> dr_render)
//
//   2. PROMPT DROPS (3x/day cron): each drop picks the least-recently-used ACTIVE
//      workflow and posts 9 image prompts in ITS style (style DNA + its reference
//      images). Upload the generated images into the thread, pick a copy option,
//      it renders with the workflow's own build + song. (format_id "prompt_drop",
//      stages pd_await_images -> pd_copy -> pd_render)
//
//   3. FEEDBACK: replying in any finished drop thread with example images saves them
//      as THAT workflow's references (grounds future prompts); text feedback becomes
//      a checkmark-gated style rule.
//
// All rendering goes through renderWorkflow() (render-dispatch.ts) — one build per
// workflow. Prompt-first stays law: this module never generates images.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { callClaudeJSON, type ClaudeImageInput, type ClaudeModel } from "@/lib/claude-calls";
import {
  insertJob,
  getJobByPickerTs,
  getLatestJobByThread,
  updateJob,
  type ContentJob,
  type JobData,
} from "@/lib/reel/jobs";
import { uploadToReels } from "@/lib/reel/pov";
import { parseBoxes } from "@/lib/reel/studio";
import { resolveStillFrame } from "@/lib/reel/pov-studio";
import { generateStudioVariations, type ReelScript } from "@/lib/reel/studio-variations";
import {
  generateHookCopy,
  buildHookCopySystem,
  generateSalesLetterCaption,
  hasSalesLetterExamples,
} from "@/lib/reel/captions";
import {
  reslotCopyToStructure,
  generateStructuredCopy,
  generateStructuredCopyVariants,
  generateHeadlineOptions,
  generateCreativeReference,
  type StructuredCopyLine,
  type CreativeReference,
} from "@/lib/reel/creative-director";
import { renderWorkflow, workflowRenderBuild } from "@/lib/reel/render-dispatch";
import { markWorkflowUsed, ensureWorkflowRow } from "@/lib/reel/workflow-author";
import { loadReferenceFrames, saveContentExample } from "@/lib/reel/content-examples";
import { distillFeedbackToRules, savePendingRules } from "@/lib/reel/style-rules";
import { stripEmDashes } from "@/lib/reel/text";
import { listWorkflows, loadWorkflow, resolveSong, type Workflow } from "@/config/workflows";
import {
  loadVertical,
  dropOwnerVerticalId,
  dropWorkflowLibraryId,
  type Vertical,
} from "@/config/verticals";

// Which vertical a drop belongs to travels on the job row (content_jobs.vertical_id), set
// once by handleDropMessage/runPromptDrop from the channel's vertical; the `go` report and
// the sales-letter caption speak to that vertical's OWNER avatar (dropOwnerVerticalId), and
// workflow matching uses its library (dropWorkflowLibraryId, shared pest_control by default).
const DROP_FORMAT = "drop_render";
const PROMPT_FORMAT = "prompt_drop";

export const APPROVE = new Set(["white_check_mark", "heavy_check_mark", "+1", "ballot_box_with_check"]);
export const CANCEL = new Set(["no_entry_sign", "no_entry", "x", "-1"]);
export const KEYCAPS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5 };

export interface DroppedFile {
  id?: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  url_private?: string;
  url_private_download?: string;
}

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

async function post(channel: string, threadTs: string, text: string): Promise<string | null> {
  const res = await slack.postThreadReply(channel, threadTs, text).catch(() => null);
  return ((res as { ts?: string } | null)?.ts as string) ?? null;
}

async function postCard(job: ContentJob, text: string, emojis: string[] = ["white_check_mark"]): Promise<void> {
  const ts = await post(job.slack_channel, job.slack_thread_ts, text);
  if (ts) {
    for (const e of emojis) await slack.addReaction(job.slack_channel, ts, e).catch(() => {});
    await updateJob(job, { pickerTs: ts, data: { ...job.data, seeded_reactions: emojis } });
  }
}

// Slack chat.postMessage truncates around 40k but long cards get unreadable well before
// that; split on paragraph boundaries at ~3800 chars so each chunk stays scannable.
const CHUNK_LIMIT = 3800;
export function splitForSlack(text: string, limit = CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];
  const parts: string[] = [];
  let current = "";
  for (const para of text.split("\n\n")) {
    const candidate = current ? `${current}\n\n${para}` : para;
    if (candidate.length > limit && current) {
      parts.push(current);
      current = para;
    } else {
      current = candidate;
    }
  }
  if (current) parts.push(current);
  return parts;
}

/** Post long text as sequential thread messages; returns the LAST message's ts. */
async function postLong(channel: string, threadTs: string, text: string): Promise<string | null> {
  let last: string | null = null;
  for (const chunk of splitForSlack(text)) last = (await post(channel, threadTs, chunk)) ?? last;
  return last;
}

/** The job's still images, format-aware: prompt drops collect into prompt_slots, the
 *  drop-and-render lane into drop_media. Getting this wrong makes ✅ at dr_copy a no-op. */
function jobImages(job: ContentJob): string[] {
  return job.format_id === PROMPT_FORMAT
    ? (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean)
    : (job.data.drop_media ?? []).map((m) => m.url);
}

async function downloadSlackUrl(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN || ""}` },
    });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Resolve dropped files to public still URLs in the reels bucket (videos -> poster frame). */
export async function resolveDropMedia(
  files: DroppedFile[]
): Promise<Array<{ url: string; kind: "image" | "video" }>> {
  const out: Array<{ url: string; kind: "image" | "video" }> = [];
  for (const f of files) {
    const still = await resolveStillFrame(f);
    if (!still) continue;
    const buf = await downloadSlackUrl(still.url);
    if (!buf) continue;
    const url = await uploadToReels(buf, still.mimetype || "image/jpeg");
    if (url) out.push({ url, kind: still.kind });
  }
  return out;
}

const VIDEO_FILETYPES = new Set(["mp4", "mov", "m4v", "webm", "mpg", "mpeg"]);

/** Slack sometimes delivers thin file objects with no mimetype — fall back to
 *  filetype/extension so a real clip never silently routes down the image path. */
export function isVideoFile(f: DroppedFile): boolean {
  if ((f.mimetype || "").startsWith("video/")) return true;
  if (VIDEO_FILETYPES.has((f.filetype || "").toLowerCase())) return true;
  return /\.(mp4|mov|m4v|webm|mpe?g)$/i.test(f.name || "");
}

/** MP4/MOV/M4V carry "ftyp" at offset 4; WebM/MKV open with the EBML magic. */
function looksLikeVideoBytes(buf: Buffer): boolean {
  return (
    buf.length > 12 &&
    (buf.subarray(4, 8).toString("latin1") === "ftyp" ||
      (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3))
  );
}

export interface ResolvedClips {
  clips: string[];
  /** Per-file reasons a clip could NOT be pulled in — post these to the thread;
   *  silently dropping one turns its shot into a still with no warning. */
  failures: string[];
}

/** Resolve dropped VIDEO files to public clip URLs in the reels bucket — the FULL clip,
 *  not a poster frame (that's resolveDropMedia's job). Non-video files are skipped. */
export async function resolveDropClips(files: DroppedFile[]): Promise<ResolvedClips> {
  const clips: string[] = [];
  const failures: string[] = [];
  for (const f of files) {
    if (!isVideoFile(f)) continue;
    const label = f.name || "clip";
    const src = f.url_private_download || f.url_private;
    if (!src) {
      failures.push(`${label}: Slack sent no download URL`);
      continue;
    }
    const buf = await downloadSlackUrl(src);
    if (!buf || !buf.length) {
      failures.push(`${label}: download from Slack failed`);
      continue;
    }
    if (!looksLikeVideoBytes(buf)) {
      failures.push(`${label}: downloaded bytes are not a video`);
      continue;
    }
    // Normalize quicktime so the bucket key gets a .mp4-style extension the
    // render service (and anything else fetching it) can trust.
    const mt = f.mimetype === "video/quicktime" ? "video/mp4" : f.mimetype || "video/mp4";
    const url = await uploadToReels(buf, mt);
    if (!url) {
      failures.push(`${label}: upload to the reels bucket failed`);
      continue;
    }
    clips.push(url);
  }
  return { clips, failures };
}

export function hasVideoFiles(files: DroppedFile[]): boolean {
  return files.some(isVideoFile);
}

export function splitLines(text: string): string[] {
  return (text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

// ---- fit scoring ---------------------------------------------------------------------------

export function shotCount(w: Workflow): number {
  return (
    w.render_spec?.shots?.length ||
    w.render_options?.max_shots ||
    w.scenes.length ||
    1
  );
}

export function boxCount(w: Workflow): number {
  return (w.copy_structure ?? []).length;
}

/** An AUTHORED-SCENE workflow ships its own per-scene prompts (a whiteboard image_prompt +
 *  a locked draw-beat animation_prompt on every scene), so the drop lanes must use THOSE
 *  instead of generating generic ones. Legacy b-roll workflows have `scenes: []` -> false,
 *  which keeps every existing hook-first / motion-generation path byte-for-byte unchanged. */
export function hasAuthoredScenes(w: Workflow): boolean {
  return Boolean(w.scenes?.length) && w.scenes.every((s) => Boolean(s.image_prompt?.trim()));
}

function isRenderable(w: Workflow): boolean {
  const build = workflowRenderBuild(w);
  if (build === "render_reel") return true;
  return Boolean(w.render_spec?.shots?.length && boxCount(w) > 0);
}

interface FitResult {
  workflow: Workflow;
  score: number;
  mediaScore: number;
  copyScore: number;
  perfect: boolean;
  strong: boolean;
  notes: string[];
}

function scoreFit(w: Workflow, mediaCount: number, lines: string[]): FitResult {
  const S = shotCount(w);
  const B = boxCount(w);
  const build = workflowRenderBuild(w);
  const notes: string[] = [];

  let mediaScore = 0;
  if (mediaCount === S) mediaScore = 3;
  else if (mediaCount > S) {
    mediaScore = 1;
    notes.push(`${mediaCount - S} extra image(s) will be ignored`);
  } else {
    notes.push(`needs ${S - mediaCount} more image(s)`);
  }

  let copyScore = 0;
  if (build === "render_reel") {
    const script = parseBoxes(lines.join("\n"));
    if (script) copyScore = 2;
    else notes.push("copy could not be read as label/hook/payoff/cta");
  } else {
    if (lines.length === B) copyScore = 2;
    else if (Math.abs(lines.length - B) === 1) {
      copyScore = 1;
      notes.push("copy will be refit to the boxes");
    } else if (B > 0 && lines.length >= 2) {
      copyScore = 0.5;
      notes.push(`copy will be refit (${lines.length} lines into ${B} boxes)`);
    } else notes.push(`needs ${B} copy lines`);
  }

  const perfect = mediaScore === 3 && copyScore === 2;
  const strong = mediaScore === 3 && copyScore >= 1;
  return { workflow: w, score: mediaScore + copyScore, mediaScore, copyScore, perfect, strong, notes };
}

/** True when his exact lines map into the workflow with ZERO rewriting. */
export function zeroAdaptationCopy(w: Workflow, lines: string[]): StructuredCopyLine[] | null {
  const build = workflowRenderBuild(w);
  if (build === "render_reel") {
    const script = parseBoxes(lines.join("\n"));
    const complete = script && script.label && script.line1 && script.line2 && script.cta;
    if (!complete || !script) return null;
    return [
      { key: "label", label: "Label", text: script.label },
      { key: "hook", label: "Hook", text: script.line1 },
      { key: "payoff", label: "Payoff", text: script.line2 },
      { key: "cta", label: "CTA", text: script.cta },
    ];
  }
  const roles = w.copy_structure ?? [];
  if (lines.length !== roles.length || roles.length === 0) return null;
  return roles.map((r, i) => ({ key: r.key, label: r.label, text: lines[i] }));
}

export async function activeWorkflows(libraryVerticalId: string): Promise<Workflow[]> {
  const all = await listWorkflows(libraryVerticalId, { status: "active" });
  return all.filter(isRenderable);
}

// ---- `go` — headlines + story material (no images needed) ----------------------------------

/**
 * `go` in the drop channel: post 30 headline angles + the avatar's story material so the
 * operator has raw copy to build from, then drop images + lines to render. Mirrors the
 * #agent-wokrflow-creator report but pinned to the pest-control OWNER avatar.
 */
/** Proven headlines already in the avatar kit — the fallback when Claude is unavailable. */
function seedHeadlines(vertical: Vertical): string[] {
  return (vertical.offer?.headlines ?? []).map((h) =>
    h.subtitle ? `${h.title} ${h.subtitle}` : h.title
  );
}

/** Story material derived straight from the avatar kit — the fallback when Claude is down. */
function seedReference(vertical: Vertical): CreativeReference {
  const three = (a: (string | undefined)[]) => a.filter((x): x is string => Boolean(x)).slice(0, 3);
  const objections = vertical.offer?.objections ?? [];
  return {
    fears: three(objections.map((o) => o.objection)),
    beliefs: three((vertical.beliefs ?? []).map((b) => b.text)),
    desires: three(vertical.offer?.belief_chains ?? []),
    facts: three(objections.map((o) => o.evidence)),
    fantasies: three([vertical.offer?.big_idea]),
    horror: three(objections.map((o) => o.response)),
  };
}

export async function handleDropGo(channel: string, dropVerticalId: string): Promise<void> {
  const drop = await loadVertical(dropVerticalId);
  const vertical = await loadVertical(dropOwnerVerticalId(drop));
  await slack.postMessage(channel, `*${vertical.name}* — pulling 30 headline angles + story material...`);

  // Run both independently: one failing (e.g. a transient Claude error) must not kill the
  // other, and either can fall back to the avatar's own seed material so `go` never dead-ends.
  const [hRes, rRes] = await Promise.allSettled([
    generateHeadlineOptions({ vertical, count: 30 }),
    generateCreativeReference(vertical),
  ]);

  let headlines: string[];
  let headlinesFellBack = false;
  if (hRes.status === "fulfilled" && hRes.value.length) {
    headlines = hRes.value;
  } else {
    if (hRes.status === "rejected") console.error("[drop-studio] headlines failed:", (hRes.reason as Error)?.message);
    headlines = seedHeadlines(vertical);
    headlinesFellBack = true;
  }

  let ref: CreativeReference;
  let refFellBack = false;
  if (rRes.status === "fulfilled") {
    ref = rRes.value;
  } else {
    console.error("[drop-studio] reference failed:", (rRes.reason as Error)?.message);
    ref = seedReference(vertical);
    refFellBack = true;
  }

  await slack.postMessage(
    channel,
    [
      `*${vertical.name}* — ${headlines.length} headline angles (raw material for your copy):`,
      headlines.map((h, i) => `${i + 1}. ${h}`).join("\n"),
      headlinesFellBack ? "\n_(used seed headlines, Claude was unavailable)_" : "",
    ]
      .filter(Boolean)
      .join("\n")
  );
  await slack.postMessage(
    channel,
    [
      "*Story material* (mix these in):",
      `*Fears:* ${ref.fears.join(" | ")}`,
      `*Beliefs:* ${ref.beliefs.join(" | ")}`,
      `*Desires:* ${ref.desires.join(" | ")}`,
      `*Facts:* ${ref.facts.join(" | ")}`,
      `*Fantasies:* ${ref.fantasies.join(" | ")}`,
      `*Horror stories:* ${ref.horror.join(" | ")}`,
      refFellBack ? "_(used seed material, Claude was unavailable)_" : "",
      "",
      "Write your lines, then drop your images + those lines in ONE message and I'll ask which workflow to render.",
    ]
      .filter(Boolean)
      .join("\n")
  );
}

// ---- drop-and-render -----------------------------------------------------------------------

/**
 * Top-level message in the drop channel with media + copy. Always claims the message
 * (the channel is dedicated); posts guidance when something is missing.
 */
export async function handleDropMessage(args: {
  channel: string;
  threadTs: string;
  files: DroppedFile[];
  text: string;
  verticalId: string;
}): Promise<void> {
  const { channel, threadTs } = args;
  const media = await resolveDropMedia(args.files);
  if (!media.length) {
    await post(channel, threadTs, "I could not read any image or video from that message. Try again.");
    return;
  }
  const lines = splitLines(args.text);
  if (lines.length < 2) {
    await post(
      channel,
      threadTs,
      "Send the copy together with the media (2+ lines in the same message). Example: label, hook, payoff, cta."
    );
    return;
  }

  const videoNote = media.some((m) => m.kind === "video")
    ? "\nNote: videos were resolved to still frames (render builds are stills based for now)."
    : "";

  const dropVertical = await loadVertical(args.verticalId);
  const candidates = await activeWorkflows(dropWorkflowLibraryId(dropVertical));
  const fits = candidates
    .map((w) => scoreFit(w, media.length, lines))
    .sort((a, b) => b.score - a.score || (b.workflow.used_at ?? "").localeCompare(a.workflow.used_at ?? ""));

  const baseData: JobData = {
    drop_media: media,
    drop_lines: lines,
  };

  // ALWAYS ask which workflow (the library is song-based and grows over time). The pick then
  // routes through pickFitWorkflow -> the animate/still gate -> render. No silent auto-render.
  if (!fits.length) {
    await post(channel, threadTs, "No active workflows can render yet. Create one in #agent-wokrflow-creator first.");
    return;
  }
  await insertJob({
    formatId: DROP_FORMAT,
    verticalId: args.verticalId,
    channel,
    threadTs,
    pickerTs: threadTs,
    stage: "dr_fit",
    sourceKind: "drop",
    data: { ...baseData, fit_menu: fits.map((f) => f.workflow.id) },
  });
  const menu = fits.map((f, i) => {
    const w = f.workflow;
    const S = shotCount(w);
    const B = boxCount(w);
    const meta = [`${S} shot${S === 1 ? "" : "s"}`, `${B} copy box${B === 1 ? "" : "es"}`, songNote(w)]
      .filter(Boolean)
      .join(", ");
    const note = f.notes.length ? `  (${f.notes.join("; ")})` : "  ready as dropped";
    return `${i + 1}. *${w.name}* (${meta})${note}`;
  });
  const job = await getLatestJobByThread(threadTs);
  if (job) {
    await postCard(job, [
      `*Which workflow?* You dropped ${media.length} image(s) + ${lines.length} line(s). React ✅ for the top pick, or reply a number:`,
      ...menu,
      videoNote.trim(),
      "Missing images can be pasted right here (comment `scene N` to target a slot). `cancel` ends it.",
    ].filter(Boolean).join("\n"));
  }
}

/** Short human label for a workflow's song (workflows are song-based). */
export function songNote(w: Workflow): string {
  const dur = w.render_spec?.duration_seconds;
  const durPart = dur ? `${dur}s, ` : "";
  if (!w.song_ref || w.song_ref === "song_master") return `${durPart}house bed`;
  if (/^https?:/i.test(w.song_ref)) return `${durPart}custom song`;
  return `${durPart}${resolveSong(w.song_ref).label}`;
}

/** The dr_copy card: option 1 = a faithful reslot of the operator's lines, options 2-5 =
 *  divergent direct-response angles built on the same hook. Pick by keycap/typed number;
 *  checkmark keeps option 1 (structured_copy already defaults to it). */
async function postCopyVariantsCard(job: ContentJob, w: Workflow, pastedBlock: string): Promise<void> {
  try {
    const drop = await loadVertical(job.vertical_id);
    const owner = await loadVertical(dropOwnerVerticalId(drop));
    const hookLines = splitLines(pastedBlock).slice(0, 2);
    const [reslotRes, divergentRes] = await Promise.allSettled([
      reslotCopyToStructure({ vertical: drop, workflow: w, pastedBlock }),
      generateStructuredCopyVariants({ vertical: owner, workflow: w, hookLines, count: 4 }),
    ]);
    const reslot = reslotRes.status === "fulfilled" ? reslotRes.value : [];
    const divergent = divergentRes.status === "fulfilled" ? divergentRes.value : [];
    if (reslotRes.status === "rejected")
      console.error("[drop-studio] copy reslot failed:", (reslotRes.reason as Error)?.message);
    if (divergentRes.status === "rejected")
      console.error("[drop-studio] copy variants failed:", (divergentRes.reason as Error)?.message);

    const variants = [...(reslot.length ? [reslot] : []), ...divergent].slice(0, 5);
    if (!variants.length) {
      throw new Error(
        (reslotRes.status === "rejected" && (reslotRes.reason as Error)?.message) || "the workflow has no copy boxes"
      );
    }

    const fresh = (await getLatestJobByThread(job.slack_thread_ts)) ?? job;
    await updateJob(fresh, {
      stage: "dr_copy",
      data: { ...fresh.data, workflow_id: w.id, structured_copy: variants[0], copy_variants: variants },
    });

    const header =
      variants.length === 1
        ? `*${w.name}* copy, adapted from your lines:`
        : `*${w.name}* copy - ${variants.length} options${reslot.length ? " (1 = your lines refit, rest = new angles)" : ""}:`;
    const body = variants
      .map((v, i) => [`*Option ${i + 1}:*`, ...v.map((c) => `*${c.label}:* ${c.text}`)].join("\n"))
      .join("\n\n");
    const footer = [
      variants.length > 1
        ? `Pick one: react 1-${variants.length} or type the number. Checkmark = option 1.`
        : "React with the checkmark to keep this copy.",
      "Paste your own block to refit, `animate` for motion prompts, `still`/`render` to render as-is, or `cancel`.",
    ].join("\n");

    // Long cards split at option boundaries; the reactions + pickerTs ride the LAST chunk.
    const caps = [
      "white_check_mark",
      ...["one", "two", "three", "four", "five"].slice(0, variants.length > 1 ? variants.length : 0),
    ];
    const ts = await postLong(fresh.slack_channel, fresh.slack_thread_ts, [header, body, footer].join("\n\n"));
    if (ts) {
      for (const e of caps) await slack.addReaction(fresh.slack_channel, ts, e).catch(() => {});
      await updateJob(fresh, { pickerTs: ts, data: { ...fresh.data, seeded_reactions: caps } });
    }
  } catch (e) {
    await post(job.slack_channel, job.slack_thread_ts, `Could not adapt the copy: ${(e as Error).message}`);
  }
}

/** Lock copy option N and move to the animate-vs-still gate (same as the checkmark). */
async function pickCopyVariant(job: ContentJob, n: number): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const variants = job.data.copy_variants ?? [];
  const picked = variants[n - 1];
  if (!picked) {
    await post(
      channel,
      threadTs,
      variants.length ? `Pick a number between 1 and ${variants.length}.` : "No copy options on this drop. Paste a copy block instead."
    );
    return;
  }
  const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
  if (!workflow) {
    await post(channel, threadTs, "Lost this drop's workflow. Re-drop the images + copy to start again.");
    return;
  }
  await updateJob(job, { data: { ...job.data, structured_copy: picked } });
  await enterDropModeGate(job, workflow, picked, job.data.mode_images ?? jobImages(job));
}

/** Sales letter for a finished drop, in the channel's OWNER avatar voice. Returns the
 *  Slack note to post: the letter itself, the "paste letters first" instructions when the
 *  avatar has no reference letters yet, or the manual-fallback line on a Claude error. */
export async function writeSalesLetterFor(
  job: ContentJob,
  workflow: Workflow,
  copy: StructuredCopyLine[]
): Promise<{ caption: string; beliefInstalled: string; note: string }> {
  const none = { caption: "", beliefInstalled: "" };
  try {
    const drop = await loadVertical(job.vertical_id);
    const ownerId = dropOwnerVerticalId(drop);
    const owner = await loadVertical(ownerId);
    if (!hasSalesLetterExamples(owner)) {
      return {
        ...none,
        note: [
          `Reel ready. No sales letter: the *${owner.name}* avatar has no reference letters yet,`,
          "and I never write captions in a borrowed voice.",
          `Paste 3-5 of your letters into \`verticals.sales_letter_examples\` for id \`${ownerId}\``,
          "(Supabase SQL editor), then reply `caption` here and I'll write it.",
        ].join("\n"),
      };
    }
    const onScreen = copy.map((c) => c.text).filter(Boolean).join(" | ");
    const sl = await generateSalesLetterCaption({ vertical: owner, workflow, onScreenCopy: onScreen });
    const beliefLine = sl.belief_installed
      ? `_Installs belief: ${sl.belief_installed}${sl.lead_type ? ` (${sl.lead_type})` : ""}_`
      : "";
    return {
      caption: sl.caption,
      beliefInstalled: sl.belief_installed,
      note: [beliefLine, "*Sales letter*", sl.caption].filter(Boolean).join("\n"),
    };
  } catch (e) {
    console.error("[drop-studio] sales letter failed:", (e as Error).message);
    return { ...none, note: "Reel ready. (Sales letter generation failed, reply `caption` to retry or write it manually.)" };
  }
}

/** Shared render + caption finish for both drop flows. `videos` (per-shot animated clip
 *  URLs, null = keep the still) rides along when the operator pasted Seedance clips. */
export async function finishDropRender(
  job: ContentJob,
  workflow: Workflow,
  copy: StructuredCopyLine[],
  images: string[],
  videos?: Array<string | null>
): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  // On a render failure each lane rewinds to its own "ready to render" stage so `render` retries.
  const retryStage =
    job.format_id === PROMPT_FORMAT ? "pd_copy" : job.format_id === "hook_studio" ? "hs_review" : "dr_copy";
  await updateJob(job, {
    stage: job.format_id === PROMPT_FORMAT ? "pd_render" : "dr_render",
    data: { ...job.data, workflow_id: workflow.id, structured_copy: copy },
  });
  try {
    const shots = workflow.scenes?.length || workflow.render_spec?.shots?.length || 1;
    const clipCount = (videos ?? []).filter(Boolean).length;
    await post(
      channel,
      threadTs,
      `Rendering *${workflow.name}* - ${shots} shot${shots === 1 ? "" : "s"}${clipCount ? ` (${clipCount} animated clip${clipCount === 1 ? "" : "s"})` : ""} into one reel. This takes about a minute...`
    );
    const result = await renderWorkflow(workflow, { images, copy, videos });
    if (result.versionWarning) await post(channel, threadTs, result.versionWarning);

    let uploaded = false;
    let mp4 = result.mp4 ?? null;
    if (!mp4 && result.url) {
      const r = await fetch(result.url).catch(() => null);
      if (r?.ok) mp4 = Buffer.from(await r.arrayBuffer());
    }
    if (mp4) {
      const up = (await slack.uploadFile(channel, "reel.mp4", mp4, "video/mp4", threadTs)) as {
        ok?: boolean;
      };
      uploaded = up.ok !== false;
    }
    if (!uploaded) {
      await post(channel, threadTs, result.url ? `Reel ready: ${result.url}` : "Render finished but nothing came back.");
    }

    // Post-render caption is a belief-installing SALES LETTER written to this channel's
    // OWNER avatar (dropOwnerVerticalId), condensed to 150-220 words so it drops straight
    // under the reel. The voice is anchored on real reference letters: an avatar without
    // sales_letter_examples gets NO caption, just instructions to paste letters and reply
    // `caption`. Non-fatal either way: the MP4 is already posted.
    const { caption, beliefInstalled, note } = await writeSalesLetterFor(job, workflow, copy);
    await post(channel, threadTs, note);

    await markWorkflowUsed(workflow.id);
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, {
      stage: "done",
      status: "done",
      data: {
        ...fresh.data,
        final_video_url: result.url ?? undefined,
        caption_draft: caption,
        belief_installed: beliefInstalled || undefined,
      },
    });
  } catch (e) {
    console.error("[drop-studio] render failed:", (e as Error).message);
    await post(channel, threadTs, `Render failed: ${(e as Error).message}\nReact with the checkmark again or reply \`render\` to retry.`);
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, { stage: retryStage });
  }
}

// ---- animate-vs-still gate -----------------------------------------------------------------
// "Just ask before rendering in case I do it by mistake." Every drop that would otherwise render
// stops here first: animate the images (write a Seedance motion prompt per image, no render) or
// render them as stills (the normal render-spec path). Nothing renders until the operator picks.

/** Open the gate: hold the matched workflow + copy + images on the job, post the choice card. */
async function enterDropModeGate(
  job: ContentJob,
  workflow: Workflow,
  copy: StructuredCopyLine[],
  images: string[]
): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const ts = await post(
    channel,
    threadTs,
    [
      `Matched *${workflow.name}* — ${images.length} image(s) + ${copy.length} line(s).`,
      "Animate these images, or render as stills?",
      "React 1️⃣ *Animate* (I write a motion prompt per image, nothing renders) or 2️⃣ *Still* (render now).",
      "Or reply `animate` / `still`. Nothing renders until you pick.",
    ].join("\n")
  );
  const fresh = (await getLatestJobByThread(threadTs)) ?? job;
  await updateJob(fresh, {
    stage: "dr_mode",
    ...(ts ? { pickerTs: ts } : {}),
    data: {
      ...fresh.data,
      workflow_id: workflow.id,
      structured_copy: copy,
      mode_images: images,
      seeded_reactions: ["one", "two"],
    },
  });
  if (ts) {
    await slack.addReaction(channel, ts, "one").catch(() => {});
    await slack.addReaction(channel, ts, "two").catch(() => {});
  }
}

/** Read the images + copy + workflow (+ any pasted clips) held at the gate. */
async function gateContext(
  job: ContentJob
): Promise<{
  workflow: Workflow;
  copy: StructuredCopyLine[];
  images: string[];
  videos: Array<string | null>;
} | null> {
  const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const images = job.data.mode_images ?? jobImages(job);
  if (!workflow || !copy.length || !images.length) return null;
  return { workflow, copy, images, videos: job.data.mode_videos ?? [] };
}

/** Resolve the gate: "still" renders now, "animate" writes motion prompts (no render). */
async function resolveDropMode(job: ContentJob, mode: "animate" | "still"): Promise<void> {
  const ctx = await gateContext(job);
  if (!ctx) {
    await post(job.slack_channel, job.slack_thread_ts, "Lost the drop details. Re-drop the images + copy to start again.");
    return;
  }
  if (mode === "still") {
    // finishDropRender posts the "Rendering ... N shots ..." status itself.
    waitUntil(finishDropRender(job, ctx.workflow, ctx.copy, ctx.images));
  } else {
    await post(job.slack_channel, job.slack_thread_ts, "Writing a motion prompt for each image...");
    waitUntil(postAnimatePrompts(job, ctx.workflow, ctx.copy, ctx.images));
  }
}

/** ONE Seedance motion sentence per image (camera/subject motion only, no render). */
export async function generateMotionPrompts(
  images: string[],
  ctx: { workflow: Workflow; copy: StructuredCopyLine[] }
): Promise<string[]> {
  // These are already-public reels-bucket URLs (resolveDropMedia -> uploadToReels), so fetch
  // them plainly. Using downloadSlackUrl here attaches a Slack token the bucket rejects, and
  // the error body gets base64-encoded and sent as a bogus image (Anthropic 400).
  const imgs: ClaudeImageInput[] = [];
  for (const url of images) {
    const res = await fetch(url).catch(() => null);
    if (!res?.ok) continue;
    const mt = res.headers.get("content-type") || "";
    // Only forward real images. A non-image body (an HTML/JSON error page from a private or
    // stale bucket URL) base64-encoded as an "image" is exactly what makes Anthropic 400 on
    // messages.0.content.N.image, so skip it instead of sending garbage.
    if (!mt.startsWith("image/")) continue;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length) continue;
    imgs.push({ media_type: mt, data: buf.toString("base64") });
  }
  if (!imgs.length) {
    throw new Error("no fetchable images (reels-bucket URLs may not be public)");
  }
  const roles = (ctx.workflow.copy_structure ?? []).map((r) => r.label);
  interface MotionGen {
    motions: string[];
  }
  const system = [
    `You write image-to-video MOTION prompts for Seedance 2.0 for a ${ctx.workflow.name} reel.`,
    "For EACH image (in order), return ONE short sentence describing camera and subject MOTION only:",
    "how the shot should move (slow push in, tilt up, handheld drift, subject action). No style, no",
    "on-screen text, no scene re-description, never em dashes. Keep each under 20 words.",
    ctx.workflow.visual_rules?.length ? `Look: ${ctx.workflow.visual_rules.join(" ")}` : "",
    roles.length ? `On-screen line per shot (for pacing context): ${roles.join(" | ")}` : "",
    `Return exactly ${images.length} motion prompt(s), one per image, in order.`,
  ]
    .filter(Boolean)
    .join("\n");
  const { data } = await callClaudeJSON<MotionGen>({
    model: model(),
    system,
    user: "Return the motion prompts as JSON.",
    images: imgs.length ? imgs : undefined,
    maxTokens: 700,
    temperature: 0.7,
    schemaHint: '{ "motions": [string] }',
    validate: (v: unknown): v is MotionGen =>
      typeof v === "object" && v !== null && Array.isArray((v as MotionGen).motions),
  });
  return data.motions.slice(0, images.length).map((m) => stripEmDashes(m));
}

/** Post one motion prompt per image; keep the job open so `still` still works and clips can drop. */
async function postAnimatePrompts(
  job: ContentJob,
  workflow: Workflow,
  copy: StructuredCopyLine[],
  images: string[]
): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  try {
    // Authored-scene workflows carry LOCKED motion (draw-beat seconds) on each scene; use it
    // verbatim rather than asking Claude for fresh camera sentences.
    const authored = hasAuthoredScenes(workflow);
    const motions = authored
      ? workflow.scenes.map((s) => (s.animation_prompt ?? "").trim())
      : await generateMotionPrompts(images, { workflow, copy });
    const roles = workflow.copy_structure ?? [];
    const lines = images.map((_, i) => {
      const role = roles[i]?.label ?? `Shot ${i + 1}`;
      return `${i + 1}. *${role}* — ${motions[i] ?? "slow push in on the subject"}`;
    });
    await post(
      channel,
      threadTs,
      [
        authored
          ? `*Locked draw-beat motion for ${workflow.name}* (one per image, do not edit unless intentional):`
          : `*Motion prompts for ${workflow.name}* (Seedance 2.0, one per image):`,
        ...lines,
        "",
        `Animate each image with these and drop the clips back here — I'll render automatically once all ${images.length} are in. Or reply \`still\` to render the images as-is.`,
      ].join("\n")
    );
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, { stage: "dr_animate", data: { ...fresh.data, mode_images: images } });
  } catch (e) {
    console.error("[drop-studio] motion prompts failed:", (e as Error).message);
    await post(channel, threadTs, `Could not write the motion prompts (${(e as Error).message.slice(0, 120)}). Reply \`still\` to render the images instead.`);
  }
}

/** Seedance clips pasted at the animate gate: upload the FULL clips, slot them per shot
 *  (drop order, or comment `scene N` to target), and render as soon as every shot has one.
 *  A partial drop holds; `render` renders now (missing shots keep their stills) and `still`
 *  still renders stills only. */
async function handleAnimatedClipDrop(
  job: ContentJob,
  files: DroppedFile[],
  text: string
): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const ctx = await gateContext(job);
  if (!ctx) {
    await post(channel, threadTs, "Lost the drop details. Re-drop the images + copy to start again.");
    return;
  }
  await post(channel, threadTs, "Got the clips. Pulling them in...");
  const { clips, failures } = await resolveDropClips(files);
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
    return;
  }
  const total = ctx.images.length;
  const videos: Array<string | null> = [...ctx.videos];
  while (videos.length < total) videos.push(null);
  const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(text);
  let target = targetMatch ? parseInt(targetMatch[1], 10) - 1 : null;
  for (const url of clips) {
    let slot = target ?? videos.findIndex((v) => !v);
    if (slot === null || slot < 0 || slot >= total) slot = total - 1;
    videos[slot] = url;
    if (target !== null) target++;
  }
  const fresh = (await getLatestJobByThread(threadTs)) ?? job;
  await updateJob(fresh, { data: { ...fresh.data, mode_videos: videos } });
  const filled = videos.filter(Boolean).length;
  if (filled >= total) {
    // finishDropRender posts its own "Rendering ..." status line.
    waitUntil(
      finishDropRender(
        { ...fresh, data: { ...fresh.data, mode_videos: videos } },
        ctx.workflow,
        ctx.copy,
        ctx.images,
        videos
      )
    );
  } else {
    await post(
      channel,
      threadTs,
      `${filled} of ${total} clip(s) in. Drop the rest, reply \`render\` to render now (shots without a clip keep the still), or \`still\` for stills only.`
    );
  }
}

// ---- prompt drops (3x/day) -------------------------------------------------------------------

interface DropPromptsResult {
  groups: Array<{ scene: number; role: string; prompts: string[] }>;
}

/** 9 image prompts for ONE workflow, grounded by its style DNA + reference images. */
export async function generateDropPrompts(
  workflow: Workflow,
  vertical: Vertical,
  count = 9
): Promise<DropPromptsResult> {
  const dna = (workflow.style_dna ?? "").trim() || vertical.style_token;
  const scenes = workflow.scenes.length
    ? workflow.scenes.map((s) => s.role)
    : ["the single hero shot"];
  // References are filed under the workflow's own vertical, so every channel sharing the
  // library benefits from the same examples.
  const frames = await loadReferenceFrames(workflow.vertical_id, { workflowId: workflow.id, limit: 4 });

  interface PromptGen {
    prompts: Array<{ scene: number; action: string }>;
  }
  const perScene = Math.max(1, Math.ceil(count / scenes.length));
  const system = [
    `You write image-generation SCENE ACTIONS for the "${workflow.name}" workflow of a ${vertical.business_descriptor}.`,
    `The workflow: ${stripEmDashes(workflow.description ?? workflow.name)}`,
    "The style DNA below is prepended separately, so each action describes ONLY what happens",
    "in the frame (subject + action + setting detail), one sentence, no camera or style boilerplate,",
    "no on-screen text, never em dashes.",
    `Style DNA: ${stripEmDashes(dna)}`,
    ...(workflow.visual_rules?.length ? ["Visual rules:", ...workflow.visual_rules.map((r) => `- ${r}`)] : []),
    // The avatar's own subject law goes LAST and wins: a channel can share a workflow
    // library whose rules were written for a different avatar's shoots.
    ...(vertical.visual_rules?.length
      ? [
          "Avatar visual rules (these WIN over the workflow visual rules on any conflict):",
          ...vertical.visual_rules.map((r) => `- ${r}`),
        ]
      : []),
    frames.length
      ? `You are shown ${frames.length} reference photo(s) of the exact look the operator wants. Ground materials, wear, lighting, and realism on them.`
      : "",
    "",
    `Scenes (1-based): ${scenes.map((r, i) => `${i + 1}. ${r}`).join("  ")}`,
    `Return ${count} total actions distributed across the scenes (about ${perScene} per scene), each clearly different.`,
  ]
    .filter(Boolean)
    .join("\n");

  const { data } = await callClaudeJSON<PromptGen>({
    model: model(),
    system,
    user: "Return the actions as JSON.",
    images: frames.length ? frames : undefined,
    maxTokens: 1800,
    temperature: 0.8,
    schemaHint: '{ "prompts": [{ "scene": number, "action": string }] }',
    validate: (v: unknown): v is PromptGen =>
      typeof v === "object" &&
      v !== null &&
      Array.isArray((v as PromptGen).prompts) &&
      (v as PromptGen).prompts.every(
        (p) => p && typeof p.scene === "number" && typeof p.action === "string"
      ),
  });

  const groups: DropPromptsResult["groups"] = scenes.map((role, i) => ({ scene: i + 1, role, prompts: [] }));
  // The rules above steer the sentence Claude writes; this tail is what the IMAGE model
  // reads, so the avatar's negative rides along on the finished prompt too.
  const negative = vertical.image_negative ? `${stripEmDashes(vertical.image_negative).replace(/[.\s]+$/, "")}. ` : "";
  for (const p of data.prompts.slice(0, count)) {
    const idx = Math.min(Math.max(p.scene, 1), scenes.length) - 1;
    const full = `${dna.replace(/[.\s]+$/, "")}. ${stripEmDashes(p.action).replace(/[.\s]+$/, "")}. ${negative}No text, captions, logos, or watermarks in the image. 9:16 vertical.`;
    groups[idx].prompts.push(full);
  }
  return { groups };
}

/** The 3x/day cron entry: pick the LRU active workflow, post 9 prompts, open the intake job. */
export async function runPromptDrop(args: {
  channel: string;
  slot: string;
  verticalId: string;
}): Promise<{ ok: boolean; workflowId?: string; error?: string }> {
  const vertical = await loadVertical(args.verticalId);
  const candidates = await activeWorkflows(dropWorkflowLibraryId(vertical));
  if (!candidates.length) return { ok: false, error: "no active renderable workflows" };
  const byLru = [...candidates].sort((a, b) => {
    const au = a.used_at ?? "";
    const bu = b.used_at ?? "";
    return au.localeCompare(bu); // "" (never used) sorts first
  });
  const workflow = byLru[0];
  await ensureWorkflowRow(workflow.id);

  let prompts: DropPromptsResult;
  try {
    prompts = await generateDropPrompts(workflow, vertical, 9);
  } catch (e) {
    return { ok: false, error: `prompt generation failed: ${(e as Error).message}` };
  }

  const S = shotCount(workflow);
  const header = (await slack.postMessage(
    args.channel,
    [
      `*Prompt drop (${args.slot})* through *${workflow.name}* (${S} shot${S === 1 ? "" : "s"}).`,
      "Generate any of these and upload your favorites into this thread" +
        (S > 1 ? " (in scene order, or comment `scene N` on an upload)." : "."),
    ].join("\n")
  )) as { ts?: string };
  if (!header?.ts) return { ok: false, error: "could not post the drop header" };

  const blocks: string[] = [];
  for (const g of prompts.groups) {
    if (prompts.groups.length > 1) blocks.push(`*Scene ${g.scene}: ${g.role}*`);
    g.prompts.forEach((p, i) => blocks.push(`Option ${i + 1}:\n\`\`\`\n${p}\n\`\`\``));
  }
  await post(args.channel, header.ts, blocks.join("\n"));

  await insertJob({
    formatId: PROMPT_FORMAT,
    verticalId: args.verticalId,
    channel: args.channel,
    threadTs: header.ts,
    pickerTs: header.ts,
    stage: "pd_await_images",
    sourceKind: "cron",
    data: {
      workflow_id: workflow.id,
      prompt_slots: Array.from({ length: S }, (_, i) => ({ scene: i + 1, image_url: null })),
    },
  });
  await markWorkflowUsed(workflow.id);
  return { ok: true, workflowId: workflow.id };
}

async function advancePromptDropToCopy(job: ContentJob, workflow: Workflow): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const images = (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean);
  try {
    if (workflowRenderBuild(workflow) === "render_reel") {
      const buf = await fetch(images[0]).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null);
      const img: ClaudeImageInput | undefined = buf
        ? { media_type: "image/png", data: Buffer.from(buf).toString("base64") }
        : undefined;
      const variations = await generateStudioVariations({ brief: "", image: img, count: 4 });
      const fresh = (await getLatestJobByThread(threadTs)) ?? job;
      await updateJob(fresh, {
        stage: "pd_copy",
        data: { ...fresh.data, copy_options: variations.map((v) => JSON.stringify(v)) },
      });
      const caps = ["1.", "2.", "3.", "4."];
      await postCard(fresh, [
        "*Copy options* (reply the number or react 1-4; or paste your own 4 boxes):",
        ...variations.map((v, i) => `${caps[i]} *${v.label}*\n      ${v.line1}\n      ${v.line2}\n      _${v.cta}_`),
      ].join("\n"));
    } else {
      const vertical = await loadVertical(job.vertical_id);
      const hook = await generateHookCopy({
        scene: `Workflow: ${workflow.description ?? workflow.name}. Scenes: ${workflow.scenes.map((s) => s.role).join(" -> ")}`,
        system: buildHookCopySystem("pov_hook", vertical),
        withAfterFrame: false,
      });
      const fresh = (await getLatestJobByThread(threadTs)) ?? job;
      await updateJob(fresh, { stage: "pd_copy", data: { ...fresh.data, copy_options: hook.options } });
      await postCard(fresh, [
        "*Title options* (reply the number or react 1-5; picking one writes the full copy):",
        ...hook.options.map((o, i) => `${i + 1}. ${o}`),
        "Or paste your own lines and I will fit them to the boxes.",
      ].join("\n"));
    }
  } catch (e) {
    console.error("[drop-studio] copy options failed:", (e as Error).message);
    await post(channel, threadTs, `Could not build copy options (${(e as Error).message.slice(0, 120)}). Paste your own lines.`);
    const fresh = (await getLatestJobByThread(threadTs)) ?? job;
    await updateJob(fresh, { stage: "pd_copy", data: { ...fresh.data, copy_options: [] } });
  }
}

async function pickPromptDropOption(job: ContentJob, n: number): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
  if (!workflow) return;
  const options = job.data.copy_options ?? [];
  const picked = options[n - 1];
  if (!picked) {
    await post(channel, threadTs, `There is no option ${n}.`);
    return;
  }
  const images = (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean);

  if (workflowRenderBuild(workflow) === "render_reel") {
    let script: ReelScript | null = null;
    try {
      script = JSON.parse(picked) as ReelScript;
    } catch {
      /* not JSON */
    }
    if (!script) return;
    const copy: StructuredCopyLine[] = [
      { key: "label", label: "Label", text: script.label },
      { key: "hook", label: "Hook", text: script.line1 },
      { key: "payoff", label: "Payoff", text: script.line2 },
      { key: "cta", label: "CTA", text: script.cta },
    ];
    waitUntil(enterDropModeGate(job, workflow, copy, images));
    return;
  }

  await post(channel, threadTs, `Writing the full copy from: "${picked}"...`);
  waitUntil(
    (async () => {
      try {
        const vertical = await loadVertical(job.vertical_id);
        const copy = await generateStructuredCopy({ vertical, workflow, seed: { headline: picked } });
        const fresh = (await getLatestJobByThread(threadTs)) ?? job;
        await updateJob(fresh, { data: { ...fresh.data, structured_copy: copy } });
        await postCard(fresh, [
          `*${workflow.name}* copy:`,
          ...copy.map((c) => `*${c.label}:* ${c.text}`),
          "",
          "React with the checkmark to render, pick another number, or paste replacement lines.",
        ].join("\n"));
      } catch (e) {
        await post(channel, threadTs, `Could not write the copy: ${(e as Error).message}`);
      }
    })()
  );
}

// ---- feedback loop ----------------------------------------------------------------------------

async function saveFeedbackReferences(
  job: ContentJob,
  files: DroppedFile[],
  text: string
): Promise<boolean> {
  const wfId = job.data.workflow_id;
  if (!wfId) return false;
  const media = await resolveDropMedia(files);
  if (!media.length) return false;
  const wf = await loadWorkflow(wfId);
  for (const m of media) {
    await saveContentExample({
      // File the reference under the workflow's own vertical (shared library), falling
      // back to the drop's vertical for legacy workflows without one.
      verticalId: wf?.vertical_id ?? job.vertical_id,
      workflowId: wfId,
      sourcePath: m.url,
      storyboard: { hook: stripEmDashes(text).slice(0, 200) || wf?.name || wfId, shots: [] },
      labels: ["workflow_reference", "operator_feedback"],
      difficulty: "medium",
      frameUrls: [m.url],
    });
  }
  await post(
    job.slack_channel,
    job.slack_thread_ts,
    `Saved ${media.length} reference image(s) to *${wf?.name ?? wfId}*. Future prompt drops for this workflow will lean on them.`
  );
  return true;
}

async function handleTextFeedback(job: ContentJob, text: string): Promise<boolean> {
  try {
    const distilled = await distillFeedbackToRules({
      text,
      formatGroup: "drop_studio",
      verticalId: job.vertical_id,
    });
    if (distilled.intent !== "tune" || distilled.rules.length === 0) return false;
    const lines = distilled.rules.map((r, i) => {
      const tag = r.scope === "brand" ? "brand" : r.format_group ?? "drop_studio";
      return `${i + 1}. [${tag}] ${r.rule}`;
    });
    const card = await post(job.slack_channel, job.slack_thread_ts, [
      "*Keep these style rules?* React with the checkmark to save them for future drops, or the no-entry sign to discard.",
      ...lines,
    ].join("\n"));
    if (card) {
      await savePendingRules(distilled.rules, {
        verticalId: job.vertical_id,
        channel: job.slack_channel,
        threadTs: job.slack_thread_ts,
        proposalTs: card,
      });
    }
    return true;
  } catch (e) {
    console.error("[drop-studio] feedback distill failed:", (e as Error).message);
    return false;
  }
}

// ---- routers -----------------------------------------------------------------------------------

const DR_NUDGES: Partial<Record<ContentJob["stage"], string>> = {
  dr_fit: "Pick a workflow by number, react with the checkmark for the top pick, paste missing images, or `cancel`.",
  dr_copy:
    "Pick copy 1-5 (react or type the number), paste your own block to refit, reply `animate` for motion prompts, `still`/`render` to render as-is, or `cancel`.",
  dr_mode: "Animate or still? React 1️⃣ Animate / 2️⃣ Still, or reply `animate` / `still`.",
  dr_animate: "Motion prompts are above. Animate the images and drop the clips here (renders automatically once every shot has one), reply `render` to render with the clips in so far, or `still` for the images as-is.",
  dr_render: "Rendering now. Reply `render` to retry if it fails.",
  pd_await_images: "Waiting on the generated images. Upload them into this thread (comment `scene N` to target a slot).",
  pd_copy: "Pick a copy option by number (or react), paste your own lines, or `cancel`.",
  pd_render: "Rendering now. Reply `render` to retry if it fails.",
};

function isDropJob(job: ContentJob | null): job is ContentJob {
  return Boolean(job && (job.format_id === DROP_FORMAT || job.format_id === PROMPT_FORMAT));
}

async function getDropJob(threadTs: string): Promise<ContentJob | null> {
  const job = await getLatestJobByThread(threadTs);
  return isDropJob(job) ? job : null;
}

/** Thread reply in the drop channel. Always claims replies on drop threads. */
export async function handleDropThreadReply(args: {
  channel: string;
  threadTs: string;
  text: string;
}): Promise<boolean> {
  const job = await getDropJob(args.threadTs);
  if (!job) return false;
  const text = args.text.trim();
  const { channel } = args;

  if (/^\s*cancel\s*$/i.test(text) && job.status === "active") {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(channel, job.slack_thread_ts, "Cancelled. Drop media + copy any time to start again.");
    return true;
  }

  // Finished threads: `caption` re-runs the sales letter (e.g. after the operator pastes
  // reference letters for a new avatar); other text -> style-rule proposal.
  if (job.status !== "active") {
    if (/^\s*caption\s*$/i.test(text)) {
      const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
      const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
      if (!workflow || !copy.length) {
        await post(channel, job.slack_thread_ts, "I can't find this drop's workflow/copy to caption from.");
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
    const handled = await handleTextFeedback(job, text);
    if (!handled) {
      await post(channel, job.slack_thread_ts, "This drop is finished. Send feedback with example images to teach the workflow, or start a new drop. Reply `caption` to rewrite the sales letter.");
    }
    return true;
  }

  switch (job.stage) {
    case "dr_fit": {
      const n = /^\s*(\d)\s*$/.exec(text)?.[1];
      if (n) {
        await pickFitWorkflow(job, parseInt(n, 10));
        return true;
      }
      break;
    }
    case "dr_copy": {
      if (/^\s*animate\s*$/i.test(text)) {
        await resolveDropMode(job, "animate");
        return true;
      }
      if (/^\s*(still|render|go)\s*$/i.test(text)) {
        await resolveDropMode(job, "still");
        return true;
      }
      const n = /^\s*([1-9])\s*$/.exec(text)?.[1];
      if (n) {
        await pickCopyVariant(job, parseInt(n, 10));
        return true;
      }
      if (splitLines(text).length >= 2) {
        const wf = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
        if (wf) {
          await post(channel, job.slack_thread_ts, "Refitting your copy...");
          waitUntil(postCopyVariantsCard(job, wf, text));
          return true;
        }
      }
      break;
    }
    case "dr_mode": {
      if (/^\s*(animate|1)\s*$/i.test(text)) {
        await resolveDropMode(job, "animate");
        return true;
      }
      if (/^\s*(still|2)\s*$/i.test(text)) {
        await resolveDropMode(job, "still");
        return true;
      }
      break;
    }
    case "dr_animate": {
      if (/^\s*(still|2)\s*$/i.test(text)) {
        await resolveDropMode(job, "still"); // stills only, any pasted clips are ignored
        return true;
      }
      if (/^\s*(render|go)\s*$/i.test(text)) {
        // Render with whatever clips are in; shots without a clip keep their stills.
        const ctx = await gateContext(job);
        if (ctx) waitUntil(finishDropRender(job, ctx.workflow, ctx.copy, ctx.images, ctx.videos));
        else await post(channel, job.slack_thread_ts, "Lost the drop details. Re-drop the images + copy to start again.");
        return true;
      }
      break;
    }
    case "dr_render":
    case "pd_render": {
      if (/^\s*render\s*$/i.test(text)) {
        await retryRender(job);
        return true;
      }
      break;
    }
    case "pd_copy": {
      const n = /^\s*(\d)\s*$/.exec(text)?.[1];
      if (n) {
        await pickPromptDropOption(job, parseInt(n, 10));
        return true;
      }
      if (splitLines(text).length >= 2) {
        await handlePastedCopyAtPdCopy(job, text);
        return true;
      }
      break;
    }
  }

  const nudge = DR_NUDGES[job.stage];
  if (nudge) {
    await post(channel, job.slack_thread_ts, nudge);
    return true;
  }
  return true; // dedicated channel: never fall through
}

async function handlePastedCopyAtPdCopy(job: ContentJob, text: string): Promise<void> {
  const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
  if (!workflow) return;
  const images = (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean);
  const lines = splitLines(text);
  const direct = zeroAdaptationCopy(workflow, lines);
  if (direct) {
    waitUntil(enterDropModeGate(job, workflow, direct, images));
    return;
  }
  await post(job.slack_channel, job.slack_thread_ts, "Fitting your lines to the boxes...");
  waitUntil(postCopyVariantsCard(job, workflow, text));
}

async function pickFitWorkflow(job: ContentJob, n: number): Promise<void> {
  const { slack_channel: channel, slack_thread_ts: threadTs } = job;
  const menu = job.data.fit_menu ?? [];
  const wfId = menu[n - 1];
  if (!wfId) {
    await post(channel, threadTs, `Pick a number between 1 and ${menu.length}.`);
    return;
  }
  const workflow = await loadWorkflow(wfId);
  if (!workflow) {
    await post(channel, threadTs, "That workflow could not be loaded.");
    return;
  }
  const media = job.data.drop_media ?? [];
  const lines = job.data.drop_lines ?? [];
  const S = shotCount(workflow);
  if (media.length < S) {
    await updateJob(job, { data: { ...job.data, workflow_id: workflow.id } });
    await post(
      channel,
      threadTs,
      `*${workflow.name}* needs ${S} image(s); you dropped ${media.length}. Paste ${S - media.length} more here (comment \`scene N\` to target a slot).`
    );
    return;
  }
  const direct = zeroAdaptationCopy(workflow, lines);
  if (direct) {
    await enterDropModeGate(job, workflow, direct, media.map((m) => m.url));
    return;
  }
  await post(channel, threadTs, `Adapting your copy to *${workflow.name}* and writing angles...`);
  waitUntil(postCopyVariantsCard(job, workflow, lines.join("\n")));
}

async function retryRender(job: ContentJob): Promise<void> {
  const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
  const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
  const images = jobImages(job);
  if (!workflow || !copy.length || !images.length) {
    await post(job.slack_channel, job.slack_thread_ts, "Nothing to retry yet.");
    return;
  }
  waitUntil(finishDropRender(job, workflow, copy, images, job.data.mode_videos ?? []));
}

/** Reactions on drop cards. Self-routes by picker ts + format. */
export async function handleDropReaction(args: {
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
  if (!isDropJob(job) || job.status !== "active") return false;

  // The bot pre-seeds the emoji on its cards as a one-click affordance, which makes Slack
  // fire a reaction_added event for the bot itself. Ignore it: only a HUMAN reaction acts,
  // so the card advances only when the operator adds the second reaction (count reaches 2).
  if (args.userId && args.userId === (await slack.getBotUserId())) return true;

  // Deterministic firewall (does not depend on the bot id resolving): a pre-seeded emoji only
  // acts once its total count on the card reaches 2 (the bot's seed + the operator's reaction).
  // Non-seeded reactions (number keycaps on the fit card, cancel) still fire on the first tap.
  const seeded = (job.data.seeded_reactions ?? []) as string[];
  if (seeded.includes(args.reaction)) {
    const count = await slack.getReactionCount(job.slack_channel, args.slackTs, args.reaction);
    // null = reactions.get failed (likely missing reactions:read scope). The bot-userId guard
    // above already filtered the bot's own seed event, so trust it instead of going dead.
    if (count !== null && count < 2) return true; // only the bot's pre-seed so far
  }

  if (cancel) {
    await updateJob(job, { status: "skipped", stage: "skipped" });
    await post(job.slack_channel, job.slack_thread_ts, "Cancelled.");
    return true;
  }

  switch (job.stage) {
    case "dr_fit":
      if (approve) await pickFitWorkflow(job, 1);
      else if (keycap) await pickFitWorkflow(job, keycap);
      return true;
    case "dr_copy": {
      if (keycap) {
        waitUntil(pickCopyVariant(job, keycap));
        return true;
      }
      if (!approve) return true;
      const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
      const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
      if (workflow && copy.length) waitUntil(enterDropModeGate(job, workflow, copy, jobImages(job)));
      else
        await post(
          job.slack_channel,
          job.slack_thread_ts,
          "Lost this drop's workflow or copy. Paste the copy block again, or `cancel` and re-drop."
        );
      return true;
    }
    case "dr_mode":
      if (keycap === 1) waitUntil(resolveDropMode(job, "animate"));
      else if (keycap === 2 || approve) waitUntil(resolveDropMode(job, "still"));
      return true;
    case "dr_animate":
      if (approve || keycap === 2) waitUntil(resolveDropMode(job, "still"));
      return true;
    case "pd_copy": {
      if (keycap) {
        await pickPromptDropOption(job, keycap);
        return true;
      }
      if (approve) {
        const copy = (job.data.structured_copy ?? []) as StructuredCopyLine[];
        if (copy.length) {
          const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
          const images = (job.data.prompt_slots ?? []).map((s) => s.image_url!).filter(Boolean);
          if (workflow) waitUntil(enterDropModeGate(job, workflow, copy, images));
        } else {
          await pickPromptDropOption(job, 1);
        }
      }
      return true;
    }
    default:
      return true; // our card; swallow
  }
}

/** Files dropped into an existing drop thread. */
export async function handleDropFileDrop(args: {
  channel: string;
  threadTs: string;
  files: DroppedFile[];
  text?: string;
}): Promise<boolean> {
  const job = await getDropJob(args.threadTs);
  if (!job) return false;
  const text = args.text ?? "";

  // Finished threads: images are feedback references for the workflow.
  if (job.status !== "active") {
    const saved = await saveFeedbackReferences(job, args.files, text);
    if (!saved) await post(job.slack_channel, job.slack_thread_ts, "Could not read those files as images.");
    return true;
  }

  if (job.stage === "dr_fit") {
    const media = await resolveDropMedia(args.files);
    if (!media.length) return true;
    const all = [...(job.data.drop_media ?? []), ...media];
    await updateJob(job, { data: { ...job.data, drop_media: all } });
    const wf = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
    if (wf && all.length >= shotCount(wf)) {
      const lines = job.data.drop_lines ?? [];
      const direct = zeroAdaptationCopy(wf, lines);
      if (direct) await enterDropModeGate(job, wf, direct, all.map((m) => m.url));
      else {
        await post(job.slack_channel, job.slack_thread_ts, `All images in. Adapting your copy to *${wf.name}* and writing angles...`);
        waitUntil(postCopyVariantsCard(job, wf, lines.join("\n")));
      }
    } else {
      await post(job.slack_channel, job.slack_thread_ts, `Got it. ${all.length} image(s) on this drop now.`);
    }
    return true;
  }

  if (job.stage === "pd_await_images") {
    const media = await resolveDropMedia(args.files);
    if (!media.length) return true;
    const slots = (job.data.prompt_slots ?? []).map((s) => ({ ...s }));
    const targetMatch = /\bscene\s+(\d{1,2})\b/i.exec(text);
    let target = targetMatch ? parseInt(targetMatch[1], 10) - 1 : null;
    for (const m of media) {
      let slot = target ?? slots.findIndex((s) => !s.image_url);
      if (slot === null || slot < 0 || slot >= slots.length) slot = slots.length - 1;
      slots[slot] = { ...slots[slot], image_url: m.url };
      if (target !== null) target++;
    }
    await updateJob(job, { data: { ...job.data, prompt_slots: slots } });
    const filled = slots.filter((s) => s.image_url).length;
    if (slots.every((s) => s.image_url)) {
      await post(job.slack_channel, job.slack_thread_ts, "All scene images in. Building copy options...");
      const workflow = job.data.workflow_id ? await loadWorkflow(job.data.workflow_id) : null;
      if (workflow) waitUntil(advancePromptDropToCopy(job, workflow));
    } else {
      await post(job.slack_channel, job.slack_thread_ts, `${filled} of ${slots.length} scene image(s) in.`);
    }
    return true;
  }

  // Animate gate: pasted VIDEO files are the Seedance clips for this drop — slot them per
  // shot and render. (Image-only replies below still teach the workflow as references.)
  if ((job.stage === "dr_animate" || job.stage === "dr_mode") && hasVideoFiles(args.files)) {
    await handleAnimatedClipDrop(job, args.files, text);
    return true;
  }

  // Other active stages: images are treated as feedback refs too (teach while working).
  const saved = await saveFeedbackReferences(job, args.files, text);
  if (!saved) {
    const nudge = DR_NUDGES[job.stage];
    if (nudge) await post(job.slack_channel, job.slack_thread_ts, nudge);
  }
  return true;
}
