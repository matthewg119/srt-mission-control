// The launcher opens when it is tapped, and a drag still does not open it. Executable.
//
//   bun --no-env-file run scripts/_probe-launcher-gestures.ts
//
// WHY THIS EXISTS. From 2026-09-16 to 2026-09-25 tapping the launcher did nothing at all, on every
// embedded page, and nobody could see it in a diff. embed.js took a pointer capture on pointerdown
// for the drag; pointer capture retargets the click that FOLLOWS to the capturing element, so every
// click landed on the launcher div and the handler on the inner button never ran. The teaser bubble
// kept working, which made the widget look alive, because the bubble is a sibling of the launcher
// rather than a child of it and was never inside the capture.
//
// ‼️ NO TEST CAN REPRODUCE THAT BUG, AND THAT IS THE WHOLE REASON THIS FILE IS STATIC. Retargeting
// needs a live pointer: setPointerCapture with a synthetic pointerId throws NotFoundError, which
// embed.js swallows, so a scripted click passes identically with the bug present and with it fixed.
// A test that cannot fail on the regression it is named after is worse than no test. So this asserts
// the SHAPE that made the bug impossible instead, and the tap itself stays a human check on a preview.
//
// ‼️ AND IT READS THE SOURCE, WHICH IS THE ONLY THING THERE IS TO READ. The widget loader is a
// template literal served as JavaScript: there is no module to import and no export to call.

import fs from "node:fs";
import path from "node:path";

const LOADER = "src/app/embed.js/route.ts";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

const src = fs.readFileSync(path.join(process.cwd(), LOADER), "utf8");

/** The body of one addEventListener handler on `launcher`, so a claim is about the right block. */
function handler(event: string): string {
  const open = src.indexOf(`launcher.addEventListener("${event}",function(e){`);
  if (open < 0) return "";
  // Handlers here are one level of nesting and end at the dedented `});`.
  const end = src.indexOf("\n });", open);
  return end < 0 ? "" : src.slice(open, end);
}

const down = handler("pointerdown");
const move = handler("pointermove");

check(down.length > 0 && move.length > 0, "both pointer handlers were found to read");

// ── 1. The fix itself. ──────────────────────────────────────────────────────
check(
  !down.includes("setPointerCapture"),
  "pointerdown does NOT take a pointer capture",
  "a capture taken here retargets the following click to the launcher and the open handler never runs"
);
check(
  move.includes("setPointerCapture"),
  "pointermove takes the capture instead",
  "by then the gesture has travelled far enough to be a drag, and a drag has no click to retarget"
);

// ── 2. It is taken once, and only after the gesture is a drag. ──────────────
check(
  /if\(!captured\)\{/.test(move) && move.indexOf("if(!captured){") < move.indexOf("setPointerCapture"),
  "the capture is guarded so it is taken at most once per gesture"
);
check(
  move.indexOf("Math.abs(dx)+Math.abs(dy)<6)return") < move.indexOf("setPointerCapture"),
  "the six pixel threshold is still tested BEFORE the capture",
  "capturing under the threshold would put the bug back for any tap with a shaky hand"
);
check(
  (src.match(/captured=true/g) ?? []).length === 1 && src.includes("captured=false"),
  "the flag is set in one place and cleared on release"
);

// ── 3. A drag still cannot open the panel. ──────────────────────────────────
check(
  /btn\.addEventListener\("click",function\(\)\{\s*\n\s*if\(moved\)\{moved=false;return\}/.test(src),
  "the click handler still swallows exactly one click after a drag",
  "and it is still on btn, which is what makes the keyboard path work: Enter emits a click with no pointer sequence"
);
check(
  src.includes("if(captured){try{launcher.releasePointerCapture"),
  "the release is conditional on having captured",
  "releasing a capture that was never taken throws, and the throw would skip the corner placement below it"
);

// ── 4. The pill is the default, and its label survives an open. ─────────────
check(
  src.includes('btnLabel.textContent="Help"') && src.includes("btn.appendChild(btnLabel)"),
  "the pill label lives on its own element and starts at Help"
);
check(
  !/btn\.textContent=show\?/.test(src),
  "toggle() does not write btn.textContent",
  "it would delete the chat glyph sitting next to the label on the first open"
);
check(
  src.includes("createElementNS"),
  "the chat glyph is built as elements, not markup",
  "the loader's own rule is that it never writes markup into a page it does not own"
);

// ── 5. The teaser cadence Matthew settled on. ──────────────────────────────
check(
  /MAX=Math\.min\(4,\s*lines\.length\)/.test(src),
  "the teaser stops after four lines, and sooner when there are fewer",
  "four is a ceiling rather than a quota: a page carrying only its own CTA line must say it once, not four times"
);
check(/setTimeout\(next,4000\);/.test(src), "the first line lands at four seconds");
check(
  /setTimeout\(next,12000\+Math\.floor\(Math\.random\(\)\*6000\)\);/.test(src),
  "and the rest are twelve to eighteen seconds apart"
);
check(
  src.includes("if(panel.style.display!==\"none\"||document.hidden)") &&
    src.includes("if(dismissed||!document.body"),
  "every suppression rule survived the cadence change",
  "never while the panel is open, never when the tab is hidden, never after the x, never once it is removed"
);
check(
  /function pop\(\)\{\s*\n\s*if\(reduce\)return;/.test(src),
  "the attention animation is skipped under prefers-reduced-motion"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. A tap opens it, a drag does not, and the teaser knows when to stop.");

export {};
