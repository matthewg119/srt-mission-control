// The screenshot lane's vision read, against a real image, with NOTHING stored.
//
// ‼️ THIS IS THE FIRST THING IN THE REPO THAT EXERCISES readSkinFromImages OUTSIDE SLACK. Until
// 2026-09-11 the only way to know the read worked was for Matthew to paste a real screenshot into
// a live step thread, which is how the missing accent and the null heading face were found. This
// runs the same call on a local file and prints what the lane would offer, so a prompt change can
// be checked before it reaches a client thread.
//
//   bunx tsx --env-file=.env.local scripts/_probe-skin-vision.ts <image.png|jpg|webp> [note]
//
// A screenshot of any page will do:
//   chrome --headless=new --window-size=1440,1000 --screenshot=srt.png https://srtagency.com
//
// It spends one vision call. It writes nothing to the database and posts nothing to Slack.

import fs from "node:fs";
import path from "node:path";
import { readSkinFromImages } from "../src/lib/hub/skin-vision";
import { skinVariants, brandFromReference } from "../src/lib/hub/skin-variants";
import { skinLine, skinStyle } from "../src/lib/hub/skin";

const TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` - ${detail}` : ""}`);
  }
}

async function main(): Promise<void> {
  const file = process.argv[2];
  const note = process.argv.slice(3).join(" ") || undefined;
  if (!file) {
    console.error("usage: bunx tsx --env-file=.env.local scripts/_probe-skin-vision.ts <image> [note]");
    process.exit(2);
  }

  const mediaType = TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) {
    console.error(`not an image type the lane reads: ${file}`);
    process.exit(2);
  }

  const buf = fs.readFileSync(file);
  console.log(`\nReading ${file} (${buf.byteLength} bytes)`);

  const read = await readSkinFromImages([{ media_type: mediaType, data: buf.toString("base64") }], note);
  console.log("\nThe read, verbatim");
  console.log(JSON.stringify(read, null, 2));

  const candidates = skinVariants(read, "the vision probe");
  console.log("\nThe three it would offer");
  for (const c of candidates) {
    console.log(`\n  ${c.slot}. ${c.blurb}`);
    console.log(`     ${skinLine(c)}`);
    console.log(`     ${JSON.stringify(skinStyle(c))}`);
  }

  const brand = brandFromReference(
    { accentSuggestion: read.accentSuggestion, bodyFace: read.bodyFace ?? null },
    candidates[0]
  );
  console.log("\nWhat a pick would write into the theme");
  console.log(`  ${JSON.stringify(brand)}`);

  // ‼️ WHAT IS ASSERTED IS ONLY WHAT EVERY REAL WEB PAGE HAS. A headline is set in some kind of
  // face, and that field coming back null is the exact failure of 2026-09-11. The accent is
  // printed, not asserted, because an all-grey page genuinely has none.
  console.log("\nChecks");
  ok("three candidates", candidates.length === 3);
  ok("the heading face was read", Boolean(read.headingFace), String(read.headingFace));
  ok("the body face was read", Boolean(read.bodyFace), String(read.bodyFace));
  ok("no free-text font stack came through", read.headingFamily === null, String(read.headingFamily));
  ok("every candidate carries the heading face", candidates.every((c) => c.headingFace === read.headingFace));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
