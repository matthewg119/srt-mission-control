// CLI script: one-time ingest of reference MP4s into the content_examples style library.
//
// Crawls the recent *.mp4 files in a folder (default the operator's Downloads), samples frames
// from each with ffmpeg, runs analyzeVideoFile (one Claude-vision call -> labeled, difficulty-
// tagged storyboard), uploads the sampled frames to the `reels` bucket, and upserts one
// content_examples row per video. These rows become extra few-shot context for the recreate
// flow and the format generator (loadExampleFewShot).
//
// Idempotent: rows key on source_path, so re-running updates in place (stable id) rather than
// duplicating. ffmpeg/ffprobe must be on PATH.
//
// Usage:
//   bun run scripts/ingest-example-mp4s.ts --dry
//   bun run scripts/ingest-example-mp4s.ts
//   bun run scripts/ingest-example-mp4s.ts --dir="C:/Users/matth/Downloads" --since-days=3 --limit=20
//   bun run scripts/ingest-example-mp4s.ts --vertical=pest_control --force

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "../src/lib/db";
import { analyzeVideoFile, extractFramesLocal } from "../src/lib/reel/content-examples";
import { DEFAULT_VERTICAL_ID } from "../src/config/verticals";
import type { ClaudeImageInput } from "../src/lib/claude-calls";

const DEFAULT_DIR = "C:/Users/matth/Downloads";
const FRAME_COUNT = 6;

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

interface Candidate {
  path: string;
  name: string;
  mtimeMs: number;
}

function pickRecentMp4s(args: Args): Candidate[] {
  const cutoff = Date.now() - args.sinceDays * 24 * 60 * 60 * 1000;
  const entries = readdirSync(args.dir);
  const mp4s: Candidate[] = [];
  for (const name of entries) {
    if (!name.toLowerCase().endsWith(".mp4")) continue;
    const path = join(args.dir, name);
    try {
      const st = statSync(path);
      if (!st.isFile()) continue;
      if (st.mtimeMs >= cutoff) mp4s.push({ path, name, mtimeMs: st.mtimeMs });
    } catch {
      // unreadable entry — skip
    }
  }
  mp4s.sort((a, b) => b.mtimeMs - a.mtimeMs); // newest first
  return mp4s.slice(0, args.limit);
}

function toClaudeImage(buf: Buffer): ClaudeImageInput {
  return { media_type: "image/jpeg", data: buf.toString("base64") };
}

/** Upload sampled frames to the `reels` bucket; returns the public URLs (best-effort). */
async function uploadFrames(buffers: Buffer[]): Promise<string[]> {
  const urls: string[] = [];
  for (const buf of buffers) {
    try {
      const key = `examples/${randomUUID()}.jpg`;
      const up = await supabaseAdmin.storage
        .from("reels")
        .upload(key, buf, { contentType: "image/jpeg", upsert: true });
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

  const candidates = pickRecentMp4s(args);
  if (candidates.length === 0) {
    console.log("[ingest] no matching .mp4 files in the recency window. Nothing to do.");
    return;
  }
  console.log(`[ingest] selected ${candidates.length} file(s):`);
  candidates.forEach((c, i) => console.log(`  ${i + 1}. ${c.name} (${new Date(c.mtimeMs).toISOString()})`));

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

      console.log(`[ingest] analyzing: ${c.name}`);
      const buffers = extractFramesLocal(c.path, FRAME_COUNT);
      const frames = buffers.map(toClaudeImage);
      const { storyboard } = await analyzeVideoFile({ frames, verticalId: args.vertical });

      console.log(`  -> difficulty=${storyboard.difficulty} labels=[${storyboard.labels.join(", ")}] shots=${storyboard.shots.length}`);

      if (args.dry) {
        console.log(`  (dry) hook: ${storyboard.hook}`);
        continue;
      }

      const frameUrls = await uploadFrames(buffers);
      const id = (existing?.id as string) ?? randomUUID();
      const { error } = await supabaseAdmin.from("content_examples").upsert(
        {
          id,
          vertical_id: args.vertical,
          source_path: c.path,
          storyboard,
          labels: storyboard.labels,
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
