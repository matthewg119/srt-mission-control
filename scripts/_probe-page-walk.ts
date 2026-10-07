/**
 * Probe: the per-page walk. The grammar, the stage machine, and the words they produce.
 *
 *   bun run scripts/_probe-page-walk.ts
 *
 * Pure. No database, no model call, no network, no env. Everything here is a constant or a
 * function of its arguments, which is what lets it run on a clean checkout in CI.
 *
 * What it is here to catch:
 *
 *   1. A bare digit becoming a command. page-studio.ts records what that cost the last time one
 *      was claimed: a "1" typed under five numbered offers was appended to the page as its body,
 *      verbatim. Step 21's thread also takes dictation, research pastes and call notes, so a
 *      grammar one character too loose files somebody's sentence as a decision.
 *   2. `page N` colliding with a word somebody is typing in a sentence, or with the page studio's
 *      own `page <client>` opener.
 *   3. The stage precedence drifting from readBatch's. The batch card and the page card are read
 *      side by side, and a batch that says "headlines" over a page that says "skeleton" is a card
 *      nobody can act on.
 *   4. ‼️ THE ONE THAT MATTERS MOST: a drafted page reported as owing a handover. needHandover is
 *      "has an outline, has no cta line, is not the tool page" and does NOT exclude drafted rows,
 *      deliberately. Every page written before the handover stage existed has no cta line and
 *      never will, so asking that question before "is it drafted" marks them owing forever and no
 *      answer clears it. readBatch guards this in its own chain; pageStage has to as well.
 *   5. An em dash reaching a person. copy-guard.ts bans the character and these lines are copy.
 */

import { hasBannedDash } from "../src/lib/copy-guard";
import {
  PAGE_WALK_COMMAND,
  isPageWalkCommand,
  pageAtPosition,
  pageAtRank,
  pageReplyLine,
  pageStage,
  pageStageLine,
  pageWalkSummary,
  parsePageWalk,
  type BatchState,
  type PageStage,
} from "../src/lib/clients/page-batch";
import { HEADLINE_COMMAND, SKELETON_COMMAND, BATCH_COMMAND } from "../src/lib/clients/page-batch";
import { isAngleCommand } from "../src/lib/clients/page-angles";
import type { PlanRow } from "../src/lib/clients/page-plan";

let pass = 0;
let fail = 0;

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass += 1;
    console.log(`  ok    ${label}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

/** A plan row with only the fields the walk reads. The rest never reach these functions. */
function row(rank: number, over: Partial<PlanRow> = {}): PlanRow {
  return {
    id: `row-${rank}`,
    clientId: "c",
    rank,
    question: `question ${rank}`,
    targetKeyword: `keyword ${rank}`,
    workingTitle: `title ${rank}`,
    angle: "",
    theme: "t",
    origin: "harvested",
    frame: null,
    status: "approved",
    pageId: null,
    pageStatus: null,
    postFormat: null,
    ctaLine: null,
    role: "support",
    pillarId: null,
    keywordCategory: null,
    headline: null,
    secondaryKeywords: null,
    slug: null,
    awarenessEntry: null,
    awarenessTarget: null,
    ...over,
  } as PlanRow;
}

/** A BatchState carrying only what pageStage reads. */
function state(rows: PlanRow[], lists: Partial<Record<string, PlanRow[]>> = {}): BatchState {
  return {
    stage: "headlines",
    rows,
    pillar: null,
    supports: [],
    outlines: new Map(),
    needAngle: lists.needAngle ?? [],
    needHeadline: lists.needHeadline ?? [],
    needSkeleton: lists.needSkeleton ?? [],
    needHandover: lists.needHandover ?? [],
    drafted: lists.drafted ?? [],
  } as BatchState;
}

console.log("\nThe per-page walk\n");

// ── 1. The grammar accepts every form a person types ─────────────────────────

console.log("1. the forms that ARE the command");

const SHOW = ["page 3", "page 03", "  page 3  ", "`page 3`", "*page 3*", "PAGE 3", "Page 12"];
for (const t of SHOW) {
  const got = parsePageWalk(t);
  check(`"${t.trim()}" shows a page`, got?.verb === "show", JSON.stringify(got));
}

for (const [t, verb] of [
  ["page 3 more", "more"],
  ["page 3 draft", "draft"],
  ["page 3 check", "check"],
  ["PAGE 3 CHECK", "check"],
  ["`page 3 draft`", "draft"],
] as const) {
  const got = parsePageWalk(t);
  check(`"${t}" is ${verb}`, got?.verb === verb, JSON.stringify(got));
}

for (const [t, page, option] of [
  ["page 3 pick 2", 3, 2],
  ["page 11 pick 1", 11, 1],
  ["`page 3 pick 2`", 3, 2],
  ["  PAGE 3 PICK 3  ", 3, 3],
] as const) {
  const got = parsePageWalk(t);
  check(
    `"${t.trim()}" picks ${option} on page ${page}`,
    got?.verb === "pick" && got.page === page && got.option === option,
    JSON.stringify(got)
  );
}

check("isPageWalkCommand agrees with parsePageWalk", ["page 3", "page 3 pick 2", "nope", ""].every((t) => isPageWalkCommand(t) === (parsePageWalk(t) !== null)));

// ── 2. The forms that must NOT be the command ────────────────────────────────

console.log("\n2. what it must never claim");

// ‼️ A BARE DIGIT IS THE WHOLE POINT OF THIS SECTION. parseAngleCommand refuses one for the same
// reason and _probe-page-angles.ts pins that; this is the same rule for the same thread.
for (const t of ["1", "2", "3", "11", "0", " 2 ", "`1`"]) {
  check(`"${t.trim()}" is not a command`, parsePageWalk(t) === null, JSON.stringify(parsePageWalk(t)));
}

// "page" alone is a word somebody dictates. The digit is required.
for (const t of ["page", "pages", "page ", "page x", "page srt", "page srt-agency-llc", "page new"]) {
  check(`"${t.trim()}" is not a command`, parsePageWalk(t) === null, JSON.stringify(parsePageWalk(t)));
}

// Rank is 1-based, so zero names nothing and is a typo rather than a page that went away.
check('"page 0" is refused', parsePageWalk("page 0") === null);
check('"page 3 pick 0" is refused', parsePageWalk("page 3 pick 0") === null);

// A sentence that merely contains the words is a sentence.
for (const t of [
  "look at page 3 of the doc",
  "can we do page 3 next",
  "page 3 looks wrong",
  "what does page 3 argue",
  "page 3 pick 2 please",
  "the page 3 headline",
]) {
  check(`"${t}" is a sentence`, parsePageWalk(t) === null, JSON.stringify(parsePageWalk(t)));
}

// ── 3. It collides with no other verb in this thread ─────────────────────────
//
// ‼️ THE WORD `headlines` ALREADY MEANT TWO THINGS AT TWO POINTS IN THIS STEP, which is what
// _probe-headline-first.ts section 3 exists to hold. A third family of numbered verbs in the same
// thread is exactly where that happens again, so every pair is checked rather than assumed.

console.log("\n3. no collision with the verbs already in step 21's thread");

for (const t of ["headline 3 pick 2", "headline 3 more", "skeleton", "skeleton 3 more", "batch", "batch approve"]) {
  check(`"${t}" is not the page walk`, parsePageWalk(t) === null);
}
for (const t of ["page 3", "page 3 pick 2", "page 3 more", "page 3 draft", "page 3 check"]) {
  check(`"${t}" is not a headline, skeleton or batch command`, !HEADLINE_COMMAND.test(t) && !SKELETON_COMMAND.test(t) && !BATCH_COMMAND.test(t));
  check(`"${t}" is not an angle command`, !isAngleCommand(t));
}
for (const t of ["angles", "angles auto", "angle 3 pick 2", "angle 3 more", "angles all comparison"]) {
  check(`"${t}" is not the page walk`, parsePageWalk(t) === null);
}

// The regexes are reused by step-grammar.ts's spec, so a stateful `g` flag would make alternate
// calls return different answers. None of them may carry one.
check("PAGE_WALK_COMMAND is not global", !PAGE_WALK_COMMAND.global, PAGE_WALK_COMMAND.flags);

// ── 4. The stage machine ─────────────────────────────────────────────────────

console.log("\n4. a page's own stage, in readBatch's own precedence");

const r = row(3);
check("no lists at all means it wants a body", pageStage(state([r]), r) === "draft");
check("needing an idea beats everything", pageStage(state([r], { needAngle: [r], needHeadline: [r], needSkeleton: [r] }), r) === "angle");
check("needing a headline beats a skeleton", pageStage(state([r], { needHeadline: [r], needSkeleton: [r] }), r) === "headline");
check("needing a skeleton", pageStage(state([r], { needSkeleton: [r] }), r) === "skeleton");
check("needing a handover", pageStage(state([r], { needHandover: [r] }), r) === "handover");

const drafted = row(3, { pageId: "p3", pageStatus: "draft" });
const live = row(3, { pageId: "p3", pageStatus: "published" });
check("a body with no publish is review", pageStage(state([drafted], { drafted: [drafted] }), drafted) === "review");
check("a published body is live", pageStage(state([live], { drafted: [live] }), live) === "live");

// ‼️ THE CHECK THIS FILE EXISTS FOR. A drafted page is nearly always ALSO in needHandover, because
// that list does not exclude drafted rows. Asking the handover question first marks every page
// written before the handover stage existed as owing a decision forever.
check(
  "a drafted page in needHandover is REVIEW, not handover",
  pageStage(state([drafted], { drafted: [drafted], needHandover: [drafted] }), drafted) === "review",
  "needHandover does not exclude drafted rows; readBatch orders them the same way for the same reason"
);
check(
  "a published page in needHandover is LIVE, not handover",
  pageStage(state([live], { drafted: [live], needHandover: [live] }), live) === "live"
);

// Every stage is reachable, so a switch that lost one is caught rather than defaulting.
const REACHED = new Set<PageStage>();
for (const s of [
  pageStage(state([r], { needAngle: [r] }), r),
  pageStage(state([r], { needHeadline: [r] }), r),
  pageStage(state([r], { needSkeleton: [r] }), r),
  pageStage(state([r], { needHandover: [r] }), r),
  pageStage(state([r]), r),
  pageStage(state([drafted], { drafted: [drafted] }), drafted),
  pageStage(state([live], { drafted: [live] }), live),
]) {
  REACHED.add(s);
}
check(`all seven stages are reachable (${[...REACHED].join(", ")})`, REACHED.size === 7, String(REACHED.size));

// A page that is in NO list of a state whose rows do not hold it still answers, rather than throwing.
const stranger = row(99);
check("a row the batch does not hold still answers", pageStage(state([r]), stranger) === "draft");

// ── 5. Rank and position are two different numbers ───────────────────────────
//
// ‼️ THE DIVERGENCE IS REAL AND OLDER THAN THIS WALK. rerank() keeps ranks contiguous over ALL of a
// client's plan rows, studio rows included, while readBatch's rows are only the approved role rows.
// plan_swap sets its replacement back to `proposed`, so this is a verb somebody can type rather
// than an edge case. `headline N` indexes POSITION; the walk indexes RANK.

console.log("\n5. rank is not position");

const gapped = state([row(2), row(4), row(7)]);
check("rank 4 is the second row", pageAtRank(gapped, 4)?.rank === 4);
check("position 2 is also rank 4, here", pageAtPosition(gapped, 2)?.rank === 4);
check("rank 2 and position 2 disagree", pageAtRank(gapped, 2)?.rank !== pageAtPosition(gapped, 2)?.rank);
check("a rank that is not there is null", pageAtRank(gapped, 3) === null);
check("position 0 and past the end are null", pageAtPosition(gapped, 0) === null && pageAtPosition(gapped, 4) === null);

const summary = pageWalkSummary(gapped);
check("the summary carries BOTH numbers for every page", summary.length === 3 && summary.every((s, i) => s.position === i + 1) && summary.map((s) => s.rank).join() === "2,4,7");

// ── 6. The words ─────────────────────────────────────────────────────────────

console.log("\n6. what a person reads");

const STAGES: PageStage[] = ["angle", "headline", "skeleton", "handover", "draft", "review", "live"];
for (const s of STAGES) {
  const line = pageStageLine(s, row(3, { headline: "A headline", angle: "an idea" }));
  // A sentence that names the page. Not a length floor: "Page 3 is live." is the whole truth at
  // that stage and a floor would only push padding into it.
  check(`${s}: the stage line names the page, in a sentence`, line.startsWith("Page 3") && line.trim().endsWith("."), line);
  check(`${s}: no banned dash in the stage line`, !hasBannedDash(line), line);

  const reply = pageReplyLine(s, 3);
  check(`${s}: the reply line says what to type`, reply.length > 20, reply);
  check(`${s}: no banned dash in the reply line`, !hasBannedDash(reply), reply);
}

// ‼️ THE REPLY LINE IS THE ONLY PLACE THE GRAMMAR IS WORDED, so what it tells a person to type has
// to be a thing the parser accepts. A card teaching a command that does not parse is worse than a
// card teaching nothing, because the person believes they typed it wrong.
for (const s of STAGES) {
  const reply = pageReplyLine(s, 3);
  for (const m of reply.matchAll(/`(page [^`]+)`/g)) {
    const typed = m[1];
    check(`${s}: the card teaches "${typed}", and it parses`, parsePageWalk(typed) !== null);
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────
//
// ‼️ EVERY LANE APPENDS ABOVE THIS, NEVER BELOW IT. scripts/_probe-dm-pitch.ts records what happens
// otherwise: five checks once sat under the exit and never ran.

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
