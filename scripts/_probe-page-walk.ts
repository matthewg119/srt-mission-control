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
import { headlineFaults, isQueryShaped } from "../src/lib/clients/client-headlines";
import {
  DR_HEADLINES_PER_PAGE,
  DR_ORIGIN,
  drHeadlineFaults,
  drHeadlineLines,
  drHeadlinePrompt,
} from "../src/lib/clients/page-dr-headlines";
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
  ["page 3 ads", "ads"],
  ["PAGE 3 ADS", "ads"],
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
for (const t of ["page 3", "page 3 pick 2", "page 3 more", "page 3 draft", "page 3 check", "page 3 ads"]) {
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

// ── 7. The ad headline, which is a different artifact from the H1 ────────────
//
// ‼️ THE WHOLE POINT OF THIS SECTION IS THAT THE TWO RULE SETS MUST NOT CONVERGE. The page H1 is
// query-shaped because being cited when a buyer types her question is the mechanism this lane
// sells, and isQueryShaped enforces that in code. An ad headline is the opposite artifact and
// would be rejected by every one of those rules. If drHeadlineFaults ever starts refusing a
// statement, somebody has merged the two and the ad lane is dead without erroring.

console.log("\n7. ad headlines are judged by their own rules, not the H1's");

// Matthew's own favourites, 2026-10-07. Every one of these is a statement and would die on
// isQueryShaped. If a rule here rejects one of them, the rule is wrong, not the headline.
const DR_GOOD = [
  "Stop Paying Meta to Send You Ghosts",
  "Agencies Sell You Clicks. ChatGPT Sends You Patients. Only One of Them Gets Paid Whether You Grow or Not.",
  "You Didn't Open a Med Spa to Become a Salesperson. Here's How to Get Patients Who Walk In Already Wanting to Book.",
  "The Med Spa Owner So Embarrassed She Made a Throwaway Account to Ask for Help, and the One Fix No Agency Ever Mentioned",
  "Every Month You Stay Invisible to AI, Another Clinic Books the Patient Who Was Looking for You",
];
check("none of his favourites is query shaped", DR_GOOD.every((h) => !isQueryShaped(h)));
check("and the H1 lane would reject every one of them", DR_GOOD.every((h) => headlineFaults([h], 0).length > 0));
check(
  "the ad lane accepts all of them",
  drHeadlineFaults(DR_GOOD, 0).length === 0,
  drHeadlineFaults(DR_GOOD, 0).join(" | ")
);

// What the ad lane still refuses, and the number rule is the one that matters: law 4 of the
// engine asks for unusual numbers, which is exactly the instruction that invents a statistic.
check(
  "an invented figure is refused",
  drHeadlineFaults(["47% of Patients Ask AI First. Yours Cannot Be Found."], 0).length === 1
);
check(
  "the same figure is allowed once something on file says it",
  drHeadlineFaults(["47% of Patients Ask AI First. Yours Cannot Be Found."], 0, "47 percent of patients").length === 0
);
check("a year is not a statistic", drHeadlineFaults(["What Changed in 2026 for Every Med Spa Owner Buying Ads"], 0).length === 0);
check("a single digit is not a statistic", drHeadlineFaults(["The 3 Words That Decide Which Clinic ChatGPT Names"], 0).length === 0);
check("an em dash is refused", drHeadlineFaults(["Stop Paying Meta — Start Being Found"], 0).length === 1);
check(
  "three headlines opening the same way is refused",
  drHeadlineFaults(
    ["Why Your Clinic Is Invisible", "Why Your Clinic Is Ignored", "Why Your Clinic Is Last", "Something Else Entirely"],
    0
  ).some((f) => f.includes("opens 3 headlines"))
);
check(
  "twice is allowed, because the engine says twice",
  drHeadlineFaults(["Why Your Clinic Is Invisible", "Why Your Clinic Is Ignored", "A Third One"], 0).length === 0
);
check("a short count is reported when one was asked for", drHeadlineFaults(["one"], 20)[0]?.includes("expected 20") === true);

// ‼️ THE ENGINE IS THE ONE IN THE REPO, NOT A SECOND COPY OF ITS LAWS. A re-authored engine is
// two sets of laws that drift, and the one that drifts is always the copy nobody is testing.
const DR_PROMPT = drHeadlinePrompt({
  ctx: {
    clientName: "A Clinic",
    city: "Richardson",
    businessType: "med spa",
    avatarLabel: "the owner",
    treatment: null,
    positioning: null,
    framework: null,
    approvedNumbers: [],
    quotes: [],
  },
  row: { rank: 4, targetKeyword: "ai search vs google search", headline: "Is my med spa invisible?", workingTitle: "t" } as never,
  angle: { idea: "Her ad spend buys clicks, not patients", indoctrination: null, narrative: null },
  count: 20,
});
check("the prompt carries the seven laws", DR_PROMPT.includes("THE SEVEN LAWS"));
check("the prompt carries the 30-angle menu", DR_PROMPT.includes("Vulnerable Confession"));
check("the prompt carries the classic patterns", DR_PROMPT.includes("They Laughed When I Sat Down At The Piano"));
check("the prompt states the real length band", DR_PROMPT.includes("12 to 45 words"));
check("the prompt says the 8-word rule does not apply", DR_PROMPT.includes("THERE IS NO 8-WORD RULE"));
// The page is the brief. Without it, eleven pages get one set of twenty with the keyword swapped.
check("the prompt names the page's keyword", DR_PROMPT.includes("ai search vs google search"));
check("the prompt names what the page argues", DR_PROMPT.includes("Her ad spend buys clicks, not patients"));
check("the prompt names the page's own H1 as a different artifact", DR_PROMPT.includes("Is my med spa invisible?"));
check("the prompt says these are NOT the H1", DR_PROMPT.includes("NOT the page's own H1"));
// With no approved numbers, the numbers block must forbid figures outright rather than stay silent.
check("with nothing on file the prompt forbids figures", DR_PROMPT.includes("NO approved statistics"));
check("no banned dash anywhere in the assembled prompt", !hasBannedDash(DR_PROMPT));

// The storage origin is what keeps these out of the H1 picker.
check("the ad origin is its own value", DR_ORIGIN === "dr_ad");
check("twenty, which is the number the angle menu is sized to", DR_HEADLINES_PER_PAGE === 20);

// The card says what these are for, because a list of twenty statements under a page whose H1 is
// a question is otherwise indistinguishable from the H1 lane having gone wrong.
const CARD = drHeadlineLines({ rank: 4, headline: "Is my med spa invisible?", workingTitle: "t" } as never, DR_GOOD);
check("the card says the page keeps its own H1", CARD.join(" ").includes("keeps its own H1"));
check("the card carries no banned dash", CARD.every((l) => !hasBannedDash(l)));
check("an empty bank says so rather than printing an empty list", drHeadlineLines({ rank: 4 } as never, []).length === 1);

// ── Summary ──────────────────────────────────────────────────────────────────
//
// ‼️ EVERY LANE APPENDS ABOVE THIS, NEVER BELOW IT. scripts/_probe-dm-pitch.ts records what happens
// otherwise: five checks once sat under the exit and never ran.

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
