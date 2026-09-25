// The audit wait teaches, promises no score it cannot produce, and stops when the report lands.
//
//   bun --no-env-file run scripts/_probe-audit-wait.ts
//
// ‼️ IMPORTING THE CARDS IS ITSELF THE COPY CHECK, because every string in audit-wait.ts goes through
// guard(), which throws at module evaluation on an em dash, an en dash or a "--".
//
// ‼️ THE CHECK THAT MATTERS IS SECTION 2. Findable, Familiar and Fresh exist NOWHERE in the data:
// audit_reports carries one aggregate `score` and the only per-dimension breakdown that exists is the
// audit block (MARCA / SERVICIO / INFO / COMPARATIVO). So a card that implies a score per pillar is
// promising a shape the report does not have, and the report itself exposes it ninety seconds later.
// Naming what is about to be measured is fine. Implying a scorecard is not.

import fs from "node:fs";
import path from "node:path";

import { AUDIT_WAIT_CARDS, WAIT_CARD_MS, WAIT_FIRST_MS } from "../src/lib/concierge/audit-wait";

const FRAME = "src/app/w/[slug]/route.ts";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

const frame = fs.readFileSync(path.join(process.cwd(), FRAME), "utf8");

// ── 1. Three cards, short, and the pillars the report is about ──────────────
console.log("\n1. the three pillars, briefly");

check(AUDIT_WAIT_CARDS.length === 3, "there are three cards");
check(
  AUDIT_WAIT_CARDS.map((c) => c.title).join(",") === "Findable,Familiar,Fresh",
  "named as the report and the call name them",
  AUDIT_WAIT_CARDS.map((c) => c.title).join(" -> ")
);
for (const card of AUDIT_WAIT_CARDS) {
  const sentences = card.body.split(/\.\s+/).filter(Boolean).length;
  check(sentences <= 2, `${card.title} is a sentence or two`, `${sentences} sentences, ${card.body.length} chars`);
  check(card.body.length <= 220, `${card.title} fits a bubble on a 375px panel`, `${card.body.length} chars`);
}

// ── 2. It teaches, and promises no score that does not exist ────────────────
console.log("\n2. it teaches and it does not sell");

const SELL = /\b(we|our|us|sign up|book|free|offer|call us|get started|only \$|today only)\b/i;
const SCORE = /\b(score|out of \d|\d+\s*%|percent|grade|rating out of|points)\b/i;

for (const card of AUDIT_WAIT_CARDS) {
  check(!SELL.test(card.body), `${card.title} makes no pitch`, card.body);
  check(
    !SCORE.test(card.body),
    `${card.title} promises no score`,
    "there is no per-pillar number anywhere in audit_reports, so a card implying one is a claim the report contradicts"
  );
}
check(
  AUDIT_WAIT_CARDS.every((c) => !/\b(botox|skinspirit|fort pierce)\b/i.test(c.body)),
  "and no card carries the Loom's named competitor or customer story",
  "loomPillars() is four-beat sales copy spoken over a FINISHED report; these run before anything is known"
);

// ── 3. It cannot fight the progress bar ─────────────────────────────────────
console.log("\n3. it cannot push the progress bar off the panel");

const teach = frame.slice(frame.indexOf("function teachWhileWaiting()"), frame.indexOf("function watchAudit("));
check(teach.length > 300, "the card code was found to read", `${teach.length} chars`);
check(
  (teach.match(/el\('va-msg is-them va-teach'\)/g) ?? []).length === 1,
  "exactly ONE bubble is created, ever",
  "three appended bubbles would push the bar off the top of a 375px panel, and the bar is what is being watched"
);
check(
  teach.includes("name.textContent=WAIT[i].title") && teach.includes("body.textContent=WAIT[i].body"),
  "and it swaps that bubble's text rather than appending"
);
check(!/\bbubble\('a'/.test(teach), "the card never goes through bubble(), which appends");

// ── 4. It stops the moment the report lands ─────────────────────────────────
console.log("\n4. it stops when the wait is over");

const watch = frame.slice(frame.indexOf("function watchAudit("), frame.indexOf("function afterAudit("));
check(watch.includes("var teach=teachWhileWaiting();"), "the watcher owns the card");
const terminal = watch.split("done=true;").slice(1);
check(terminal.length === 2, "there are exactly two terminal branches", "the report landing, and the audit failing");
for (const [i, branch] of terminal.entries()) {
  check(
    branch.slice(0, 60).includes("teach.stop()"),
    `terminal branch ${i + 1} stops the rotation immediately`,
    branch.slice(0, 60).trim()
  );
}
check(teach.includes("clearTimeout(timer)") && teach.includes("clearTimeout(fade)"), "and both timers are cleared");
check(
  teach.includes("card.parentNode.removeChild(card)"),
  "the card is removed rather than left in the log",
  "somebody scrolling back should find what they said and what was found, not a lesson they already had"
);

// ── 5. Reduced motion ───────────────────────────────────────────────────────
console.log("\n5. prefers-reduced-motion");

check(frame.includes('animate=!window.matchMedia("(prefers-reduced-motion: reduce)").matches'), "the preference is read");
check(teach.includes("if(!animate){show(i);return}"), "and the crossfade is skipped, the text still changing");
check(frame.includes(".va-teach{transition:none}"), "the CSS transition is switched off under it too");

// ── 6. Timings ──────────────────────────────────────────────────────────────
console.log("\n6. the timings suit a three minute scan");

check(WAIT_FIRST_MS >= 1500 && WAIT_FIRST_MS <= 5000, "the first card does not arrive on top of the bar", `${WAIT_FIRST_MS}ms`);
check(WAIT_CARD_MS >= 20000 && WAIT_CARD_MS <= 45000, "each card is up long enough to read twice", `${WAIT_CARD_MS}ms`);
check(
  WAIT_FIRST_MS + WAIT_CARD_MS * (AUDIT_WAIT_CARDS.length - 1) < 180_000,
  "and all three are shown inside the scan",
  `${(WAIT_FIRST_MS + WAIT_CARD_MS * (AUDIT_WAIT_CARDS.length - 1)) / 1000}s of a roughly 180s scan`
);
check(
  teach.includes("if(i+1<WAIT.length)"),
  "the last card stays up rather than looping",
  "a rotation that came back round reads as a carousel, which is furniture rather than teaching"
);

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. The wait teaches, claims nothing, and knows when to stop.");

export {};
