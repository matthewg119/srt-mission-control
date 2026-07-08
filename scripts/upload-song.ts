// One-shot: upload a local audio file to the Supabase reels bucket and print its public URL.
// Used to pin Workflow 2's song (0702.MP3). Bun auto-loads .env.local.
//
// Usage:
//   bun run scripts/upload-song.ts "C:\\Users\\matth\\Downloads\\0702.MP3"

import { promises as fs } from "node:fs";
import { uploadToReels } from "../src/lib/reel/pov";

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: bun run scripts/upload-song.ts <path-to-audio>");
    process.exit(1);
  }
  const buf = await fs.readFile(path);
  const url = await uploadToReels(buf, "audio/mpeg");
  if (!url) {
    console.error("Upload failed (see logs above).");
    process.exit(1);
  }
  console.log("SONG_URL=" + url);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
