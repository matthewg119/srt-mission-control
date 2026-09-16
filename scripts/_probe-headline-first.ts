// Headlines before pages: the grammar, the rung parser, and the rules that decide seven. Offline.
//
//     bunx tsx scripts/_probe-headline-first.ts
//
// What it is here to catch:
//   1. `anchor at 4` falling through to the chat assistant again. That is what happened on 2026-09-16:
//      the card said "Press [Anchor at N] on the card, or `ladder pick N`", Matthew typed the button's
//      words, nothing matched, and a generic assistant answered with an invented seven rung ladder.
//   2. A rung named rather than numbered, which is what somebody types when reading the rendered ladder.
//   3. `headlines` claimed by the wrong lane. The word means two different things at two points in the
//      same step, and only one of them may answer at a time.
//   4. Seven meaning six, or two pages built on one search.

import { readRung, isLadderCommand } from "../src/lib/clients/anchor-ladder";
import { isHeadlineCommand, PRE_CALL_HEADLINES, PRE_CALL_PAGES, EMOTIONAL_FLOOR } from "../src/lib/clients/precall-headlines";
import { commandOwner } from "../src/lib/clients/step-commands";
import { AWARENESS_STAGES } from "../src/lib/audit-engine/awareness";
import { PRE_CALL_SUPPORTS } from "../src/lib/clients/page-plan";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

// ── 1. Anchoring a rung, however it is typed ────────────────────────────────
console.log("\n1. every way a person has actually tried to anchor a rung");

const FOUR = [
  "ladder pick 4",
  "anchor at 4",
  "anchor 4",
  "ladder 4",
  "rung 4",
  "anchor at #4",
  "  ANCHOR AT 4  ",
  "`anchor at 4`",
  "*anchor at 4*",
  "ladder problem aware",
  "anchor at problem aware",
  "ladder Problem Aware",
  "ladder problem-aware",
];
for (const t of FOUR) check(`"${t.trim()}" anchors at 4`, readRung(t) === 4, String(readRung(t)));

// Every stage reachable by its own name, so the card and the thread share one vocabulary.
for (const s of AWARENESS_STAGES) {
  check(`"${s.name}" is stage ${s.stage}`, readRung(`ladder ${s.name}`) === s.stage, String(readRung(`ladder ${s.name}`)));
  check(`"anchor at ${s.stage}" is stage ${s.stage}`, readRung(`anchor at ${s.stage}`) === s.stage);
}

// ‼️ A BARE `ladder` REWRITES THE LADDER AND MUST NOT BE READ AS A RUNG. It is a prefix of both
// anchoring forms, so an over-eager parser costs a model call and throws away the ladder somebody meant
// to anchor on.
for (const t of ["ladder", "ladder pick", "anchor", "anchor at", "ladder 6", "ladder 0", "rung nine", "ladder problem", ""]) {
  check(`"${t}" is not a rung`, readRung(t) === null, String(readRung(t)));
}
// A sentence that merely mentions anchoring is a sentence.
for (const t of ["can we anchor at 4 do you think", "what does rung 4 mean", "anchor at 4pm"]) {
  check(`"${t}" is not a rung`, readRung(t) === null, String(readRung(t)));
}

check("a bare `ladder` is still a command", isLadderCommand("ladder"));
check("`anchor at 4` is a command", isLadderCommand("anchor at 4"));
check("`pillar: 12` still is", isLadderCommand("pillar: 12"));

// ── 2. The wrong thread gets a pointer, never an answer ─────────────────────
console.log("\n2. a plan command typed anywhere else points at step 21");

for (const t of ["ladder pick 4", "anchor at 4", "rung 4", "plan approve", "guarantee: we fix it free"]) {
  check(`"${t}" belongs to step 21`, commandOwner(t)?.step === "pre_call_pages", String(commandOwner(t)?.step));
}
check("a review link belongs to the review step", commandOwner("review link: https://g.page/x")?.step === "review_card_pdf");
check("a review platform does too", commandOwner("review platform: Trustpilot")?.step === "review_card_pdf");

// ── 3. The headline lane's own words ────────────────────────────────────────
console.log("\n3. the headline commands, and the ones that are not");

for (const t of ["headlines", "headlines pick 4, 9, 12, 18, 22, 27, 31", "headlines pick 1 2 3", "`headlines`"]) {
  check(`"${t}" is a headline command`, isHeadlineCommand(t));
}
// ‼️ `headline 3 pick 2` IS THE BATCH LANE'S, SINGULAR AND NUMBERED. Claiming it here would break the
// per-page picker that runs after the plan exists.
for (const t of ["headline 3 pick 2", "headline 3 more", "skeleton", "plan approve", "more headlines please"]) {
  check(`"${t}" is not`, !isHeadlineCommand(t));
}
check("an emotional paste is a command", isHeadlineCommand("emotional:\nwhy does it cost that much\nwhat if it goes wrong"));
check("a bare `emotional:` is not", !isHeadlineCommand("emotional:"));

// ── 4. The numbers agree with each other ────────────────────────────────────
console.log("\n4. seven means seven, everywhere");

check(`the set is ${PRE_CALL_HEADLINES}`, PRE_CALL_HEADLINES === 33, String(PRE_CALL_HEADLINES));
check(`the build is ${PRE_CALL_PAGES} pages`, PRE_CALL_PAGES === 7, String(PRE_CALL_PAGES));
// ‼️ THE TWO CONSTANTS LIVE IN DIFFERENT FILES AND MUST AGREE. page-plan.ts sizes the plan and
// precall-headlines.ts sizes the pick, so a change to one and not the other means a person keeps seven
// headlines and gets six pages, with the seventh silently dropped.
check(
  "one pillar plus the supports is the same seven",
  PRE_CALL_SUPPORTS + 1 === PRE_CALL_PAGES,
  `${PRE_CALL_SUPPORTS} + 1 vs ${PRE_CALL_PAGES}`
);
check(`the emotional floor is ${EMOTIONAL_FLOOR}`, EMOTIONAL_FLOOR === 20, String(EMOTIONAL_FLOOR));

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
