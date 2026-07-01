// CLI script: one-time ingest of reference MEDIA into the content_examples style library.
//
// Crawls the recent *.mp4 videos AND *.jpg/.png/.webp images in a folder (default the operator's
// Downloads). Videos are sampled frame-by-frame with ffmpeg; images are read as a single frame.
// Each runs analyzeVideoFile (one Claude-vision call -> labeled, difficulty-tagged storyboard),
// uploads its frame(s) to the `reels` bucket, and upserts one content_examples row. These rows
// become the reference library the generators read back (loadReferenceFrames + loadExampleFewShot):
// videos are tagged 'reference_video', images (real-house photos etc.) are tagged 'reference_house'
// so the realism-grounding step prefers them.
//
// Idempotent: rows key on source_path, so re-running updates in place (stable id) rather than
// duplicating. ffmpeg/ffprobe must be on PATH for videos.
//
// Usage:
//   bun run scripts/ingest-example-mp4s.ts --dry
//   bun run scripts/ingest-example-mp4s.ts
//   bun run scripts/ingest-example-mp4s.ts --dir="C:/Users/matth/Downloads" --since-days=3 --limit=200
//   bun run scripts/ingest-example-mp4s.ts --dir="C:/Users/matth/Desktop/content-references" --since-days=3650
//   bun run scripts/ingest-example-mp4s.ts --vertical=pest_control --force

import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../src/lib/db";
import { analyzeVideoFile, extractFramesLocal } from "../src/lib/reel/content-examples";
import { DEFAULT_VERTICAL_ID } from "../src/config/verticals";
import type { ClaudeImageInput } from "../src/lib/claude-calls";

const DEFAULT_DIR = "C:/Users/matth/Downloads";
const FRAME_COUNT = 6;
const VIDEO_EXTS = [".mp4", ".mov", ".m4v"];
const IMAGE_EXTS = [".jpg", ".jpeg", ".png", ".webp"];
const IMAGE_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

interface Args {
  dir: string;
  sinceDays: number;
  limit: number;
  vertical: string;
  dry: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Args {
  const get = (k: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${k}=`));
    return hit ? hit.slice(k.length + 3) : undefined;
  };
  const has = (k: string): boolean => argv.includes(`--${k}`);
  return {
    dir: get("dir") ?? DEFAULT_DIR,
    sinceDays: Number(get("since-days") ?? 3),
    limit: Number(get("limit") ?? 20),
    vertical: get("vertical") ?? DEFAULT_VERTICAL_ID,
    dry: has("dry"),
    force: has("force"),
  };
}

type MediaKind = "video" | "image";

interface Candidate {
  path: string;
  name: string;
  mtimeMs: number;
  kind: MediaKind;
  ext: string;
}

function classify(name: string): { kind: MediaKind; ext: string } | null {
  const lower = name.toLowerCase();
  const ext = lower.slice(lower.lastIndexOf("."));
  if (VIDEO_EXTS.includes(ext)) return { kind: "video", ext };
  if (IMAGE_EXTS.includes(ext)) return { kind: "image", ext };
  return null;
}

function pickRecentMedia(args: Args): Candidate[] {
  const cutoff = Date.now() - args.sinceDays * 24 * 60 * 60 * 1000;
  const entries = readdirSync(args.dir);
  const media: Candidate[] = [];
  for (const name of entries) {
    const c = classify(name);
    if (!c) continue;
    const path = join(args.dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      if (st.mtimeMs >= cutoff) media.push({ path, name, mtimeMs: st.mtimeMs, kind: c.kind, ext: c.ext });
    } catch {
      // unreadable entry — skip
    }
  }
  media.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  return media.slice(0, args.limit);
}

function toClaudeImage(buf: Buffer, mediaType = "image/jpeg"): ClaudeImageInput {
  return { media_type: mediaType, data: buf.toString("base64") };
}

/** Upload frame/image buffers to the `reels` bucket; returns the public URLs (best-effort). */
async function uploadFrames(buffers: Buffer[], mimeType = "image/jpeg"): Promise<string[]> {
  const ext = (mimeType.split("/")[1] || "jpg").replace(/[^a-z0-9]/gi, "") || "jpg";
  const urls: string[] = [];
  for (const buf of buffers) {
    try {
      const key = `examples/${randomUUID()}.${ext}`;
      const up = await supabaseAdmin.storage
        .from("reels")
        .upload(key, buf, { contentType: mimeType, upsert: true });
      if (up.error) {
        console.error("  frame upload failed:", up.error.message);
        continue;
      }
      urls.push(supabaseAdmin.storage.from("reels").getPublicUrl(key).data.publicUrl);
    } catch (e) {
      console.error("  frame upload threw:", (e as Error).message);
    }
  }
  return urls;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  console.log(
    `[ingest] dir=${args.dir} since-days=${args.sinceDays} limit=${args.limit} vertical=${args.vertical}` +
      `${args.dry ? " (DRY)" : ""}${args.force ? " (FORCE)" : ""}`
  );

  const candidates = pickRecentMedia(args);
  if (candidates.length === 0) {
    console.log("[ingest] no matching video/image files in the recency window. Nothing to do.");
    return;
  }
  console.log(`[ingest] selected ${candidates.length} file(s):`);
  candidates.forEach((c, i) => console.log(`  ${i + 1}. [${c.kind}] ${c.name} (${new Date(c.mtimeMs).toISOString()})`));

  let inserted = 0;
  let skipped = 0;
  let errored = 0;

  for (const c of candidates) {
    try {
      // Existing row? Keep its id stable so the upsert updates in place (idempotent).
      const { data: existing } = await supabaseAdmin
        .from("content_examples")
        .select("id")
        .eq("source_path", c.path)
        .maybeSingle();

      if (existing && !args.force && !args.dry) {
        console.log(`[ingest] skip (already ingested): ${c.name}`);
        skipped++;
        continue;
      }

      console.log(`[ingest] analyzing [${c.kind}]: ${c.name}`);
      // Videos -> ffmpeg frame samples (jpeg). Images -> the single file as one frame.
      const isImage = c.kind === "image";
      const mime = isImage ? IMAGE_MIME[c.ext] ?? "image/jpeg" : "image/jpeg";
      const buffers = isImage ? [readFileSync(c.path)] : extractFramesLocal(c.path, FRAME_COUNT);
      const frames = buffers.map((b) => toClaudeImage(b, mime));
      const { storyboard } = await analyzeVideoFile({ frames, verticalId: args.vertical });

      // Images are real-world realism references; tag them so loadReferenceFrames prefers them.
      const labels = isImage
        ? Array.from(new Set(["reference_house", ...storyboard.labels]))
        : Array.from(new Set(["reference_video", ...storyboard.labels]));

      console.log(`  -> difficulty=${storyboard.difficulty} labels=[${labels.join(", ")}] shots=${storyboard.shots.length}`);

      if (args.dry) {
        console.log(`  (dry) hook: ${storyboard.hook}`);
        continue;
      }

      const frameUrls = await uploadFrames(buffers, mime);
      const id = (existing?.id as string) ?? randomUUID();
      const { error } = await supabaseAdmin.from("content_examples").upsert(
        {
          id,
          vertical_id: args.vertical,
          source_path: c.path,
          storyboard,
          labels,
          difficulty: storyboard.difficulty,
          frame_urls: frameUrls,
        },
        { onConflict: "source_path" }
      );
      if (error) {
        console.error(`[ingest] upsert failed for ${c.name}:`, error.message);
        errored++;
        continue;
      }
      console.log(`  stored (${frameUrls.length} frame url(s))`);
      inserted++;
    } catch (e) {
      console.error(`[ingest] error on ${c.name}:`, (e as Error).message);
      errored++;
    }
  }

  console.log(
    `[ingest] done. analyzed=${args.dry ? candidates.length : inserted + errored} stored=${inserted} skipped=${skipped} errored=${errored}`
  );
}

main().catch((e) => {
  console.error("[ingest] fatal:", e);
  process.exit(1);
});
