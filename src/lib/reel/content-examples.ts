// Content example LIBRARY: turn reference videos into a labeled, difficulty-tagged style
// library that the generators read as extra few-shot context.
//
// This is the programmatic / batch sibling of content-analyzer.ts (which is the live
// #content-analyzer Slack flow). Here `analyzeVideoFile` samples frames LOCALLY with ffmpeg
// from a file on disk and returns a structured storyboard (with labels + difficulty) for the
// one-time ingest script to store in `content_examples`. `loadExampleFewShot` reads those
// rows back as a compact few-shot block — the shared integration point consumed by the
// recreate flow (pov-studio.ts) and the format generator (format-generator.ts).
//
// Self-contained: no render-service dependency. ffmpeg/ffprobe must be on PATH.

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { callClaudeJSON, type ClaudeImageInput, type ClaudeModel } from "@/lib/claude-calls";
import { supabaseAdmin } from "@/lib/db";
import { stripEmDashes } from "@/lib/reel/text";
import { loadVertical, DEFAULT_VERTICAL_ID, type Vertical } from "@/config/verticals";

// ---- Types ------------------------------------------------------------------------------

export interface StoryboardShot {
  t: string; // approximate timestamp / position, e.g. "0:00" or "shot 1"
  what: string; // what happens in this shot
  why: string; // why it earns the next second of attention
}

export type ExampleDifficulty = "easy" | "medium" | "hard";

export interface ContentStoryboard {
  hook: string; // the open-loop / pattern-interrupt that opens the piece
  why_it_works: string; // 2-3 sentences on the hook + format
  shots: StoryboardShot[];
  labels: string[]; // 'open_loop_hook','satisfying_broll','pest_reveal','pov',...
  difficulty: ExampleDifficulty;
  our_version: {
    idea: string; // one-line remake idea in our vertical's POV voice
    image_prompt: string; // first-frame prompt, our POV style, NO on-screen text
    animation_prompt: string; // motion only, one sentence
  };
}

export interface AnalyzeFileResult {
  storyboard: ContentStoryboard;
  frames: ClaudeImageInput[]; // the sampled frames Claude actually read
}

// ---- Local frame extraction (ffmpeg) ----------------------------------------------------

function ffprobeDurationSeconds(filePath: string): number {
  try {
    const out = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", filePath],
      { encoding: "utf-8" }
    );
    const d = parseFloat(String(out).trim());
    return Number.isFinite(d) && d > 0 ? d : 0;
  } catch {
    return 0;
  }
}

/**
 * Extract `count` evenly-spaced JPEG frames from a local video with ffmpeg, in time order.
 * Frames whose seek fails are skipped (best-effort); throws only if not one frame could be read.
 */
export function extractFramesLocal(filePath: string, count = 6): Buffer[] {
  const dir = mkdtempSync(join(tmpdir(), "vidframes-"));
  const buffers: Buffer[] = [];
  try {
    const duration = ffprobeDurationSeconds(filePath);
    for (let i = 0; i < count; i++) {
      // Sample at the middle of each of `count` equal slices. Fall back to 1s steps when the
      // duration is unknown so we still pull something from very short / odd-container clips.
      const ts = duration > 0 ? (duration * (i + 0.5)) / count : i;
      const outPath = join(dir, `frame_${String(i).padStart(2, "0")}.jpg`);
      try {
        execFileSync(
          "ffmpeg",
          ["-y", "-ss", ts.toFixed(3), "-i", filePath, "-frames:v", "1", "-q:v", "3", "-vf", "scale=720:-2", outPath],
          { stdio: "ignore" }
        );
        buffers.push(readFileSync(outPath));
      } catch {
        // skip this frame
      }
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore cleanup errors */
    }
  }
  if (buffers.length === 0) throw new Error("ffmpeg produced no frames");
  return buffers;
}

function toClaudeImage(buf: Buffer): ClaudeImageInput {
  return { media_type: "image/jpeg", data: buf.toString("base64") };
}

// ---- Claude vision storyboard -----------------------------------------------------------

function model(): ClaudeModel {
  return (process.env.ANTHROPIC_MODEL as ClaudeModel) || "claude-sonnet-4-6";
}

function isStoryboard(v: unknown): v is ContentStoryboard {
  if (typeof v !== "object" || v === null) return false;
  const s = v as ContentStoryboard;
  const ov = s.our_version;
  return (
    typeof s.hook === "string" &&
    typeof s.why_it_works === "string" &&
    Array.isArray(s.shots) &&
    s.shots.every((sh) => sh && typeof sh.what === "string") &&
    Array.isArray(s.labels) &&
    s.labels.every((l) => typeof l === "string") &&
    (s.difficulty === "easy" || s.difficulty === "medium" || s.difficulty === "hard") &&
    typeof ov === "object" &&
    ov !== null &&
    typeof ov.idea === "string" &&
    typeof ov.image_prompt === "string" &&
    typeof ov.animation_prompt === "string"
  );
}

function buildSystem(vertical: Vertical): string {
  return [
    `You are the content engine for a ${vertical.business_descriptor}. You are shown several`,
    "frames sampled evenly across ONE short-form video the operator saved as a style reference.",
    "Read all frames together as a single piece, in time order, and reverse-engineer it.",
    "",
    "Our brand format is a first-person personal account of a",
    `${vertical.wearer_role}, styled to look like real footage captured on Ray-Ban Meta smart glasses:`,
    vertical.style_token,
    "",
    "Return JSON with:",
    "- hook: the open-loop / pattern-interrupt that opens the piece (the first-frame 'wtf' that stops the scroll).",
    "- why_it_works: 2-3 sentences on the hook, the format, and why it holds attention.",
    "- shots: an ordered shot-by-shot breakdown; each shot { t (approx position like '0:00' or 'shot 1'), what, why }.",
    "- labels: 2-6 short snake_case tags describing the format. Use these when they fit, add others as needed:",
    "    open_loop_hook, satisfying_broll, pest_reveal, transformation, pov, talking_head, text_overlay_heavy,",
    "    fast_cuts, before_after, tutorial, day_in_the_life, oddly_satisfying.",
    "- difficulty: easy (1-2 simple shots, trivial to stage), medium, or hard (multi-step or hard-to-stage action).",
    "- our_version: a remake of the SAME idea in our POV voice, with:",
    "    idea (one line), image_prompt (a first-frame prompt in our Meta-glasses POV style, NO on-screen text),",
    "    animation_prompt (motion only, one sentence).",
    "",
    "HARD RULES: never invent funding numbers/rates/terms; never use em dashes or en dashes;",
    "image_prompt must contain no text overlay (text is added in post).",
    "",
    "Match the quality and voice of these gold examples:",
    JSON.stringify(vertical.gold_examples ?? [], null, 2),
  ].join("\n");
}

/**
 * Read a reference video shot-by-shot and return a labeled, difficulty-tagged storyboard.
 * Provide a local `filePath` (sampled with ffmpeg) or pre-extracted `frames`. Returns the
 * storyboard plus the frames Claude read so the caller can persist them (e.g. upload for
 * `frame_urls`). This is the batch/library path; the live Slack flow is content-analyzer.ts.
 */
export async function analyzeVideoFile(opts: {
  filePath?: string;
  frames?: ClaudeImageInput[];
  caption?: string;
  verticalId?: string;
  frameCount?: number;
}): Promise<AnalyzeFileResult> {
  const frames =
    opts.frames ??
    (opts.filePath ? extractFramesLocal(opts.filePath, opts.frameCount ?? 6).map(toClaudeImage) : []);
  if (frames.length === 0) throw new Error("analyzeVideoFile: no frames to read (pass filePath or frames)");

  const vertical = await loadVertical(opts.verticalId ?? DEFAULT_VERTICAL_ID);

  const userParts = [
    `Look at these ${frames.length} frames sampled across the video and return the storyboard as JSON.`,
  ];
  if (opts.caption && opts.caption.trim()) {
    userParts.push("", "The original caption was:", opts.caption.trim().slice(0, 1200));
  }

  const { data } = await callClaudeJSON<ContentStoryboard>({
    model: model(),
    system: buildSystem(vertical),
    user: userParts.join("\n"),
    images: frames,
    maxTokens: 2000,
    temperature: 0.5,
    schemaHint:
      '{ "hook": string, "why_it_works": string, "shots": [{ "t": string, "what": string, "why": string }], "labels": [string], "difficulty": "easy"|"medium"|"hard", "our_version": { "idea": string, "image_prompt": string, "animation_prompt": string } }',
    validate: isStoryboard,
  });

  // No em dashes anywhere in stored copy.
  const storyboard: ContentStoryboard = {
    hook: stripEmDashes(data.hook),
    why_it_works: stripEmDashes(data.why_it_works),
    shots: data.shots.map((s) => ({
      t: typeof s.t === "string" ? s.t : "",
      what: stripEmDashes(s.what),
      why: stripEmDashes(s.why ?? ""),
    })),
    labels: data.labels.map((l) => l.trim()).filter(Boolean),
    difficulty: data.difficulty,
    our_version: {
      idea: stripEmDashes(data.our_version.idea),
      image_prompt: stripEmDashes(data.our_version.image_prompt),
      animation_prompt: stripEmDashes(data.our_version.animation_prompt),
    },
  };

  return { storyboard, frames };
}

// ---- Few-shot block (shared integration point) ------------------------------------------

interface ContentExampleRow {
  storyboard: ContentStoryboard | null;
  labels: string[] | null;
  difficulty: string | null;
}

/**
 * Read the stored content examples for a vertical and render them as a compact few-shot block
 * to inject into a generator's system prompt. Returns "" when the table is empty or absent so
 * callers stay byte-identical to today until the library is populated. Best-effort: never throws.
 */
export async function loadExampleFewShot(
  verticalId: string = DEFAULT_VERTICAL_ID,
  limit = 8
): Promise<string> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_examples")
      .select("storyboard,labels,difficulty")
      .eq("vertical_id", verticalId)
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error || !Array.isArray(data) || data.length === 0) return "";

    const blocks = (data as ContentExampleRow[])
      .map((row, i) => {
        const sb = row.storyboard;
        if (!sb || typeof sb !== "object") return "";
        const labels = (row.labels ?? sb.labels ?? []).join(", ");
        const shotLine = Array.isArray(sb.shots)
          ? sb.shots.slice(0, 4).map((s) => s.what).filter(Boolean).join(" -> ")
          : "";
        return [
          `Example ${i + 1} [${row.difficulty ?? sb.difficulty ?? "medium"}] (${labels}):`,
          sb.hook ? `  hook: ${sb.hook}` : "",
          sb.why_it_works ? `  why: ${sb.why_it_works}` : "",
          shotLine ? `  shots: ${shotLine}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      })
      .filter(Boolean);

    return blocks.length ? stripEmDashes(blocks.join("\n\n")) : "";
  } catch (e) {
    console.error("[content-examples] loadExampleFewShot fell back to empty:", (e as Error).message);
    return "";
  }
}

// ---- Reference FRAMES (visual grounding for image generation) ----------------------------

interface FrameRow {
  frame_urls: string[] | null;
  labels: string[] | null;
}

/** Where the Hook Studio scene-1 references live. Declared here rather than in reference-ask.ts
 *  because both the writer (that file) and the reader (loadHookFrames) need it, and the import
 *  only runs one way: reference-ask imports this module, never the reverse. */
export const HOOK_SECTION = "broll/hook";

async function fetchFrame(url: string): Promise<ClaudeImageInput | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const media_type = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    return { media_type, data: buf.toString("base64") };
  } catch {
    return null;
  }
}

/**
 * Load up to `limit` reference FRAMES as base64 image blocks, to visually ground image
 * generation (so houses look real and lived-in, not new/clean).
 *
 * Scoping: with `workflowId`, THAT workflow's own references fill first (tier 1); any
 * remaining slots fill from the vertical's realism refs (`reference_house` /
 * `realism_reference`) only. Without `workflowId`, the vertical-wide behavior applies
 * (realism refs preferred, then recency). Rows labeled `generated` are ALWAYS excluded —
 * our own outputs must never ground new generations (that is how a wasp shot leaked into
 * a storytime). Best-effort: returns [] when the table is empty/absent or on error.
 */
export async function loadReferenceFrames(
  verticalId: string = DEFAULT_VERTICAL_ID,
  opts: { limit?: number; workflowId?: string } = {}
): Promise<ClaudeImageInput[]> {
  const limit = opts.limit ?? 4;
  try {
    const notGenerated = (r: FrameRow) => !(r.labels ?? []).includes("generated");
    const isRealism = (r: FrameRow) =>
      (r.labels ?? []).some((l) => l === "reference_house" || l === "realism_reference");

    // Tier 1: the workflow's own reference rows (newest first). Tolerate a missing
    // workflow_id column (migration not applied yet) by falling through to tier 2.
    let scoped: FrameRow[] = [];
    if (opts.workflowId) {
      const { data, error } = await supabaseAdmin
        .from("content_examples")
        .select("frame_urls,labels")
        .eq("workflow_id", opts.workflowId)
        .order("created_at", { ascending: false })
        .limit(40);
      if (!error && Array.isArray(data)) scoped = (data as FrameRow[]).filter(notGenerated);
      else if (error) console.error("[content-examples] workflow-scoped query failed (falling back):", error.message);
    }

    // Tier 2: vertical-wide rows. With a workflowId in play only realism refs may fill the
    // remainder (never another workflow's subject matter); without one, keep the old order.
    const { data, error } = await supabaseAdmin
      .from("content_examples")
      .select("frame_urls,labels")
      .eq("vertical_id", verticalId)
      .order("created_at", { ascending: false })
      .limit(40);
    let vertical: FrameRow[] = [];
    if (!error && Array.isArray(data)) {
      const rows = (data as FrameRow[]).filter(notGenerated);
      vertical = opts.workflowId
        ? rows.filter(isRealism)
        : [...rows.filter(isRealism), ...rows.filter((r) => !isRealism(r))];
    }

    const urls: string[] = [];
    let scopedCount = 0;
    for (const [tier, rows] of [["workflow", scoped], ["vertical", vertical]] as const) {
      for (const r of rows) {
        for (const u of r.frame_urls ?? []) {
          if (typeof u === "string" && u && !urls.includes(u)) {
            urls.push(u);
            if (tier === "workflow") scopedCount++;
          }
          if (urls.length >= limit) break;
        }
        if (urls.length >= limit) break;
      }
      if (urls.length >= limit) break;
    }
    if (urls.length === 0) return [];
    if (opts.workflowId)
      console.log(
        `[content-examples] loadReferenceFrames: ${scopedCount} workflow-scoped + ${urls.length - scopedCount} vertical frames (workflowId=${opts.workflowId})`
      );

    const frames = await Promise.all(urls.map((u) => fetchFrame(u)));
    return frames.filter((f): f is ClaudeImageInput => f !== null);
  } catch (e) {
    console.error("[content-examples] loadReferenceFrames fell back to empty:", (e as Error).message);
    return [];
  }
}

// ---- Save an example (live #content-analyzer drops feed the library) ----------------------

/**
 * Upsert one row into `content_examples`, keyed on `sourcePath` so re-drops update in place.
 * Used by the live #content-analyzer flow (video + reference image) to feed the library that
 * loadReferenceFrames / loadExampleFewShot read back. Best-effort: never throws.
 */
export async function saveContentExample(row: {
  verticalId?: string;
  sourcePath: string;
  storyboard: unknown;
  labels: string[];
  difficulty: string;
  frameUrls: string[];
  section?: string | null; // e.g. 'pov/modern_house' (requirement: max 30 per avatar per section)
  zip?: string | null; // optional location tag (e.g. '27401')
  workflowId?: string | null; // scope this reference to ONE workflow's library
  sceneIndex?: number | null; // scope to ONE scene of that workflow (1-based; gov2 reference boards)
}): Promise<void> {
  try {
    const { data: existing } = await supabaseAdmin
      .from("content_examples")
      .select("id")
      .eq("source_path", row.sourcePath)
      .maybeSingle();
    const id = (existing?.id as string) ?? randomUUID();
    const { error } = await supabaseAdmin.from("content_examples").upsert(
      {
        id,
        vertical_id: row.verticalId ?? DEFAULT_VERTICAL_ID,
        source_path: row.sourcePath,
        storyboard: row.storyboard ?? {},
        labels: row.labels,
        difficulty: row.difficulty,
        frame_urls: row.frameUrls,
        section: row.section ?? null,
        zip: row.zip ?? null,
        // Only sent when set, so callers that don't pass it (and DBs without the
        // 2026-07-06 / 2026-07-08 migrations) keep byte-identical payloads.
        ...(row.workflowId ? { workflow_id: row.workflowId } : {}),
        ...(row.sceneIndex ? { scene_index: row.sceneIndex } : {}),
      },
      { onConflict: "source_path" }
    );
    if (error) console.error("[content-examples] saveContentExample upsert failed:", error.message);
  } catch (e) {
    console.error("[content-examples] saveContentExample threw:", (e as Error).message);
  }
}

// ---- Scene-scoped reference boards (Workflow Builder v2) ----------------------------------

/**
 * Load a scene's OWN reference frames, and only those. STRICT by design (the continuity
 * guarantee): `workflow_id = X AND scene_index = N`, rows labeled `generated` excluded,
 * and NO vertical/realism fallback — a scene with an empty board gets [] so its prompt is
 * grounded by the style DNA alone, never by another scene's or workflow's subject matter.
 * Best-effort: returns [] on error.
 */
export async function loadSceneReferenceFrames(
  workflowId: string,
  sceneIndex: number,
  limit = 9
): Promise<ClaudeImageInput[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_examples")
      .select("frame_urls,labels")
      .eq("workflow_id", workflowId)
      .eq("scene_index", sceneIndex)
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    if (error || !Array.isArray(data)) return [];
    const urls: string[] = [];
    for (const r of data as FrameRow[]) {
      if ((r.labels ?? []).includes("generated")) continue;
      for (const u of r.frame_urls ?? []) {
        if (typeof u === "string" && u && !urls.includes(u)) urls.push(u);
        if (urls.length >= limit) break;
      }
      if (urls.length >= limit) break;
    }
    if (urls.length === 0) return [];
    const frames = await Promise.all(urls.map((u) => fetchFrame(u)));
    return frames.filter((f): f is ClaudeImageInput => f !== null);
  } catch (e) {
    console.error("[content-examples] loadSceneReferenceFrames fell back to empty:", (e as Error).message);
    return [];
  }
}

/**
 * The HOOK look references for an avatar: the real treatment-in-progress photos filed under
 * section `broll/hook` by the reference ask. STRICT like loadSceneReferenceFrames and for a
 * sharper reason than continuity: these are clean, cinematic, face-forward clinic portraits,
 * i.e. exactly what the B-roll lane's realism guards forbid. They must never leak into the
 * vertical-wide realism pool loadReferenceFrames reads, so there is NO fallback here and the
 * reference ask does not label them `realism_reference`. Empty until the operator drops some.
 */
export async function loadHookFrames(verticalId: string, limit = 4): Promise<ClaudeImageInput[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_examples")
      .select("frame_urls,labels")
      .eq("vertical_id", verticalId)
      .eq("section", HOOK_SECTION)
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    if (error || !Array.isArray(data)) return [];
    const urls: string[] = [];
    for (const r of data as FrameRow[]) {
      if ((r.labels ?? []).includes("generated")) continue;
      for (const u of r.frame_urls ?? []) {
        if (typeof u === "string" && u && !urls.includes(u)) urls.push(u);
        if (urls.length >= limit) break;
      }
      if (urls.length >= limit) break;
    }
    if (urls.length === 0) return [];
    const frames = await Promise.all(urls.map((u) => fetchFrame(u)));
    return frames.filter((f): f is ClaudeImageInput => f !== null);
  } catch (e) {
    console.error("[content-examples] loadHookFrames fell back to empty:", (e as Error).message);
    return [];
  }
}

/** How many reference rows a scene's board holds (for the 9-image cap). */
export async function countSceneRefs(workflowId: string, sceneIndex: number): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin
      .from("content_examples")
      .select("id", { count: "exact", head: true })
      .eq("workflow_id", workflowId)
      .eq("scene_index", sceneIndex);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/** How many references an avatar has stored in a given section (e.g. 'pov/modern_house'). */
export async function countReferencesInSection(verticalId: string, section: string): Promise<number> {
  try {
    const { count, error } = await supabaseAdmin
      .from("content_examples")
      .select("id", { count: "exact", head: true })
      .eq("vertical_id", verticalId)
      .eq("section", section);
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Enforce the per-section cap (default 30): keep the newest `cap` references for a vertical +
 * section and archive the overflow by clearing their `section` (so they leave the section but
 * remain usable as generic realism references). Best-effort. Returns how many were pruned.
 */
export async function pruneReferencesToCap(
  verticalId: string,
  section: string,
  cap = 30
): Promise<number> {
  try {
    const { data, error } = await supabaseAdmin
      .from("content_examples")
      .select("id")
      .eq("vertical_id", verticalId)
      .eq("section", section)
      .order("created_at", { ascending: false });
    if (error || !Array.isArray(data) || data.length <= cap) return 0;
    const overflowIds = (data as Array<{ id: string }>).slice(cap).map((r) => r.id);
    const { error: upErr } = await supabaseAdmin
      .from("content_examples")
      .update({ section: null })
      .in("id", overflowIds);
    if (upErr) {
      console.error("[content-examples] pruneReferencesToCap failed:", upErr.message);
      return 0;
    }
    return overflowIds.length;
  } catch (e) {
    console.error("[content-examples] pruneReferencesToCap threw:", (e as Error).message);
    return 0;
  }
}
