// The decision cards: the shape rule, the fit score, the screenshot matcher, and the wiring.
//
//   bun run scripts/_probe-keyword-cards.ts
//
// ‼️ `bun run`, NOT `bunx tsx`. This file has top-level await and tsx mangles it.
//
// NO MODEL CALL, NO WRITES, NO NETWORK AND NO DATABASE. Every rule here decides which keywords a
// client's whole content plan is built from, and a rule that can only be checked against production
// is a rule nobody checks.
//
// WHAT IT PROVES
//  1. Matthew's six SERPs come out the way he rated them out loud. They are the fixture the rule was
//     derived FROM, so they are the only evidence it is the right rule.
//  2. assetFit and magnetSpace have not quietly become the same number.
//  3. shouldAskAssets keeps the model off every row where its answer changes nothing.
//  4. The matcher: exactly one match reads, no match refuses, an ambiguous match refuses. Nothing is
//     ever scored against a keyword somebody did not look at.
//  5. The reaction handler is WIRED into the reaction_added chain. A handler written and never added
//     to its chain is the exact failure this repo has found twice.
//  6. The three emoji are constants both files share, not literals typed twice.
//  7. The card poster edits rather than re-posts, and re-posts only on message_not_found.
//  8. Every column the migration adds has something that reads it back.
//  9. The CHECK lists in the migration and the TypeScript unions agree.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  ANSWER_SHAPES,
  SCORE_FLOOR,
  answerShapeFrom,
  assetFitFrom,
  matchQueryToShortlist,
  type SerpRead,
} from "../src/lib/clients/keyword-strategy-rules";
import { shouldAskAssets, ASSET_KINDS } from "../src/lib/clients/asset-ideas";
import { shouldAskMagnet } from "../src/lib/clients/magnet-space";
import { CARD_EMOJI, DROP_EMOJI, PICK_EMOJI, SELECTION_TARGET, VARY_EMOJI } from "../src/lib/clients/keyword-cards";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

/** Every .ts/.tsx under src/, concatenated once, so the wiring greps are one pass. */
function allSource(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) allSource(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push(readFileSync(p, "utf8"));
  }
  return acc;
}

const SRC = allSource("src").join("\n");
const SQL = readFileSync("docs/2026-09-27-keyword-decision-cards.sql", "utf8");
const CARDS = readFileSync("src/lib/clients/keyword-cards.ts", "utf8");
const DECISIONS = readFileSync("src/lib/clients/keyword-decisions.ts", "utf8");
const EVENTS = readFileSync("src/app/api/slack/events/route.ts", "utf8");

/**
 * ‼️ EVERY FIELD IS LISTED, so adding one to SerpRead breaks this probe loudly rather than letting
 * every case here silently default. That is how the four new observables were caught.
 */
function read(opts: Partial<SerpRead> = {}): SerpRead {
  return {
    aiOverview: null,
    aiOverviewAnswers: null,
    aiOverviewSatisfies: null,
    resultShape: null,
    topDomains: [],
    forumRanks: null,
    clientRanks: null,
    localPack: null,
    paaPresent: null,
    adsAboveFold: null,
    paaQuestions: [],
    vocabulary: [],
    queryOnScreen: null,
    hasScript: null,
    hasSteps: null,
    hasChecklist: null,
    videosRank: null,
    evidence: "",
    confidence: 0.9,
    ...opts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. Matthew's six SERPs, as he rated them");
//
// ‼️ THESE ARE THE FIXTURE THE RULE CAME FROM. He screenshotted six results pages on 2026-09-24 and
// said out loud which were worth building for. The three he liked all had a script or steps ON THE
// SCREEN; the three he did not were explanations. If a change to answerShapeFrom breaks one of
// these, the change is wrong, not the case.

const SIX = [
  {
    phrase: "front desk script for asking for reviews",
    said: "the best one. a live AI front desk trainer tool",
    want: "task" as const,
    // Three quoted scripts, verbatim, plus best practices. The AI Overview hands the whole thing over.
    read: read({ hasScript: true, hasSteps: true, hasChecklist: false, aiOverview: true, aiOverviewSatisfies: 5 }),
  },
  {
    phrase: "how to get more google reviews for a med spa",
    said: "the only one I liked of the first three",
    want: "task" as const,
    // Steps, a script, QR codes, SMS timing.
    read: read({ hasScript: true, hasSteps: true, hasChecklist: false, aiOverview: true, aiOverviewSatisfies: 4 }),
  },
  {
    phrase: "how to ask patients for reviews med spa",
    said: "strong, same family",
    want: "task" as const,
    // In-person script, text template, timing.
    read: read({ hasScript: true, hasSteps: true, hasChecklist: false, aiOverview: true, aiOverviewSatisfies: 4 }),
  },
  {
    phrase: "do google reviews affect chatgpt recommendations",
    said: "5 out of 10",
    want: "fact" as const,
    // A yes, then an explanation.
    read: read({ hasScript: false, hasSteps: false, hasChecklist: false, aiOverview: true, aiOverviewSatisfies: 5 }),
  },
  {
    phrase: "how does chatgpt choose which business to recommend",
    said: "not liked",
    want: "fact" as const,
    // An explanation, plus a sponsored ad.
    read: read({ hasScript: false, hasSteps: false, hasChecklist: false, aiOverview: true, aiOverviewSatisfies: 4, adsAboveFold: 1 }),
  },
  {
    phrase: "do recent reviews matter more than old reviews",
    said: "not liked",
    want: "fact" as const,
    // An explanation, with Reddit and Quora ranking.
    read: read({ hasScript: false, hasSteps: false, hasChecklist: false, aiOverview: true, aiOverviewSatisfies: 4, forumRanks: true }),
  },
];

for (const c of SIX) {
  const got = answerShapeFrom(c.read);
  check(`"${c.phrase}" is a ${c.want} (he said: ${c.said})`, got === c.want, `got ${got}`);
}

const fits = SIX.map((c) => assetFitFrom(c.read));

check("the front desk script scores the highest fit there is", fits[0] === 5, `got ${fits[0]}`);
check(
  "and strictly higher than the other two he liked",
  fits[0] > fits[1] && fits[0] > fits[2],
  `${fits[0]} vs ${fits[1]}, ${fits[2]}`
);
check(
  "every one he liked clears the floor",
  fits.slice(0, 3).every((f) => f >= SCORE_FLOOR),
  fits.slice(0, 3).join(", ")
);
// ‼️ EXACTLY ZERO, NOT MERELY LOW. An explanation has nothing to open, so there is nothing to build a
// better version OF, and the early return in assetFitFrom is what guarantees it rather than an
// accident of the weights.
check(
  "every one he did not like scores exactly 0",
  fits.slice(3).every((f) => f === 0),
  fits.slice(3).join(", ")
);

// ‼️ THE ASSERTION THAT STOPS THE TWO FUNCTIONS COLLAPSING INTO ONE. forumRanks is the single
// strongest signal citationValueFrom has, and it must not drag a pure explanation into `mixed`: the
// mixed branch is only reachable once a deliverable is already on the screen.
check(
  "a forum ranking alone does not make an explanation `mixed`",
  answerShapeFrom(read({ hasScript: false, hasSteps: false, hasChecklist: false, forumRanks: true })) === "fact"
);
check(
  "but a forum ranking BESIDE a script is `mixed`",
  answerShapeFrom(read({ hasScript: true, hasSteps: false, hasChecklist: false, forumRanks: true })) === "mixed"
);
check(
  "and a map pack beside a script is `mixed` too",
  answerShapeFrom(read({ hasScript: true, hasSteps: false, hasChecklist: false, localPack: true })) === "mixed"
);

// ‼️ null IS NOT "fact". Nobody has looked, and telling somebody there is nothing to build here on
// the strength of an unreadable screenshot is the failure every tri-state on this read prevents.
check("nothing legible reads as null, never as a fact", answerShapeFrom(read()) === null);
check("and an unreadable page has no fit", assetFitFrom(read()) === 0);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. assetFit and magnetSpace are not the same number");
//
// ‼️ THEY ARE CLOSE AND THEY ASK DIFFERENT QUESTIONS. magnetSpace: is there anything left to trade
// for an email. assetFit: could we build the thing that WINS this page. If real data ever shows they
// agree everywhere, delete one on the evidence. Until then, this is the case that separates them.

// A pricing search: a calculator is exactly the thing to build, and it is also the whole giveaway.
const pricing = read({ hasChecklist: true, hasSteps: true, resultShape: "products", aiOverview: true, aiOverviewSatisfies: 2 });
check("a page with a deliverable on it has real asset fit", assetFitFrom(pricing) >= SCORE_FLOOR, `${assetFitFrom(pricing)}`);
check(
  "while the magnet test declines to even ask about it (people still click)",
  shouldAskMagnet({ verdict: "post", clickValue: 5, citationValue: 1 }) === false
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. shouldAskAssets keeps the model off rows it cannot help");

check(
  "a task above the floor is asked",
  shouldAskAssets({ verdict: "post", answerShape: "task", assetFit: SCORE_FLOOR }) === true
);
check(
  "a fact is never asked, however high the fit",
  shouldAskAssets({ verdict: "post", answerShape: "fact", assetFit: 5 }) === false
);
check(
  "an unreadable page is never asked",
  shouldAskAssets({ verdict: "post", answerShape: null, assetFit: 5 }) === false
);
check(
  "an unclear verdict is never asked",
  shouldAskAssets({ verdict: "unclear", answerShape: "task", assetFit: 5 }) === false
);
check(
  "a task below the floor is not asked",
  shouldAskAssets({ verdict: "post", answerShape: "task", assetFit: SCORE_FLOOR - 1 }) === false
);
check(
  "`mixed` is asked: there is still a thing on the screen",
  shouldAskAssets({ verdict: "post", answerShape: "mixed", assetFit: SCORE_FLOOR }) === true
);

// Every one of Matthew's three liked SERPs reaches the model, and none of the three he disliked does.
for (const [i, c] of SIX.entries()) {
  const shape = answerShapeFrom(c.read);
  const asked = shape !== null && shouldAskAssets({ verdict: "post", answerShape: shape, assetFit: fits[i] });
  check(`"${c.phrase}" ${i < 3 ? "reaches" : "never reaches"} the asset call`, asked === i < 3);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. the screenshot finds its own keyword");

const LIST = [
  { normalized: "front desk script for asking for reviews" },
  { normalized: "how to get more google reviews for a med spa" },
  { normalized: "botox cost" },
  { normalized: "how much does botox cost near me" },
  { normalized: "lip filler aftercare" },
];

const exact = matchQueryToShortlist("front desk script for asking for reviews", LIST);
check("an exact match reads that row", exact.kind === "one" && exact.index === 0, JSON.stringify(exact));

// ‼️ THE CASE THAT JUSTIFIES EXACT-BEFORE-CONTAINMENT. "botox cost" is CONTAINED in "how much does
// botox cost near me", so a containment-first matcher would call this ambiguous and refuse a
// screenshot that names its row exactly. Leading with exact resolves it to the row somebody typed.
const both = matchQueryToShortlist("botox cost", LIST);
check("an exact match wins even when it is contained in another row", both.kind === "one" && both.index === 2, JSON.stringify(both));

const contained = matchQueryToShortlist("lip filler aftercare tips", LIST);
check("containment resolves when nothing matched exactly", contained.kind === "one" && contained.index === 4, JSON.stringify(contained));

// ‼️ REFUSED, NOT GUESSED. Scoring the wrong keyword stores evidence against a phrase nobody looked
// at and clears its gate, which is the most expensive mistake this lane can make.
const ambiguous = matchQueryToShortlist("botox", LIST);
check("an ambiguous containment is refused", ambiguous.kind === "many", JSON.stringify(ambiguous));

const missing = matchQueryToShortlist("how to whiten teeth at home", LIST);
check("something not on the list is refused", missing.kind === "none", JSON.stringify(missing));
check(
  "and the refusal names at most three nearest rows",
  missing.kind === "none" && missing.nearest.length <= 3,
  JSON.stringify(missing)
);

const nothing = matchQueryToShortlist("", LIST);
check("an empty search box is refused", nothing.kind === "none");

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. the reaction handler is wired");
//
// ‼️ THE CHECK THAT MATTERS MOST HERE. A handler written, exported and never added to its chain is
// the exact failure this repo has found twice: a merge helper written and never called, and a column
// written by one thing and read by another that never saw it. The rule is grepped, not trusted.

check("handleKeywordCardReaction is called in the events route", /handleKeywordCardReaction\(/.test(EVENTS));

// It has to be INSIDE the reaction_added block, not merely somewhere in a 3,000 line file.
const reactionBlock = EVENTS.slice(
  EVENTS.indexOf('event.type === "reaction_added"'),
  EVENTS.indexOf('event.type === "reaction_added"') + 6000
);
check("and it is inside the reaction_added block", /handleKeywordCardReaction\(/.test(reactionBlock));
check("and its result short-circuits the chain", /keywordCardHandled\)\s*return/.test(reactionBlock));

// ‼️ BOTH SELF-REACTION GUARDS. The bot seeds all three emoji onto its own card, so without these
// every card would decide itself the moment it was posted.
check("it refuses the bot's own reactions by user id", /getBotUserId\(\)/.test(DECISIONS));
check("and treats a count below 2 as its own seed", /getReactionCount\([\s\S]{0,120}?count\s*!==\s*null\s*&&\s*count\s*<\s*2/.test(DECISIONS));
// ‼️ A null COUNT IS NOT ZERO. reactions.get fails when the scope is missing, and reading that as
// "nobody reacted" would make the whole lane go dead silently.
check("and a null count does not read as zero", /count !== null/.test(DECISIONS));

check("a ts that is not ours returns false", /if \(!row\) return false;/.test(DECISIONS));
check("and the card's own reactions all return true", /return true;/.test(DECISIONS));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. the three emoji are shared constants");

check("three of them", CARD_EMOJI.length === 3);
check("the target is twenty", SELECTION_TARGET === 20);
check("the decision handler imports them rather than retyping", /from "\.\/keyword-cards"/.test(DECISIONS));
// A literal in the handler and a constant in the card is how the two drift apart and the card grows
// a reaction nothing answers.
for (const [name, value] of [["PICK_EMOJI", PICK_EMOJI], ["DROP_EMOJI", DROP_EMOJI], ["VARY_EMOJI", VARY_EMOJI]] as const) {
  check(`${name} is not retyped as a literal in the handler`, !DECISIONS.includes(`"${value}"`), value);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. the card is edited, never re-posted");

check("it looks for a stored ts first", /cardTsOf\(/.test(CARDS));
check("it edits when there is one", /updateMessage\(/.test(CARDS));
// ‼️ ANY OTHER ERROR WOULD POST A SECOND CARD CARRYING THE SAME FAULT, and now there are two of them
// to react to. serp-cards.ts learned this first.
check(
  "and only message_not_found falls through to a fresh post",
  /edit\?\.error !== "message_not_found"/.test(CARDS)
);
check("every slack call is checked on ok rather than caught", /res\?\.ok !== true/.test(CARDS));
check("the ts is stored after the post, not before", CARDS.indexOf("card_ts: res.ts") > CARDS.indexOf("postThreadReply"));
check("the three emoji are seeded onto a fresh card", /addReaction\(/.test(CARDS));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. every column the migration adds is read back");
//
// ‼️ THE RULE scripts/_probe-serp-gate.ts ENFORCES FOR THE SERP MIGRATION, extended to this one. A
// write with no read is a fact nobody can ever be wrong about out loud, which is the same as not
// having recorded it. The last build shipped ten write-only columns before that probe caught them.

const scriptSrc = readdirSync("scripts")
  .filter((f) => /\.ts$/.test(f))
  .map((f) => readFileSync(join("scripts", f), "utf8"))
  .join("\n");
const READERS = `${SRC}\n${scriptSrc}`;

const added = [...SQL.matchAll(/add column if not exists ([a-z_]+)/g)].map((m) => m[1]);
check("the migration adds the columns this build needs", added.length >= 12, `${added.length} added`);

const selectStrings: string[] = [
  ...[...READERS.matchAll(/\.select\(\s*("(?:[^"\\]|\\.)*")/g)].map((m) => m[1]),
  ...[...READERS.matchAll(/const\s+[A-Za-z_]*COLUMNS[A-Za-z_]*\s*(?::[^=]+)?=\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/g)].map(
    (m) => m[1]
  ),
];
const selected = selectStrings.join(" ");

for (const col of [...new Set(added)]) {
  const readBack = new RegExp(`\\b${col}\\b`).test(selected);
  check(`${col} is read back by something`, readBack, "written and never read: either wire it or drop it");
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n9. the CHECK lists and the TypeScript unions agree");

function sqlCheckValues(sql: string, column: string): string[] {
  // The CHECK can wrap across lines, so newlines are flattened before matching. autocrlf makes those
  // \r\n on Windows, which is why \s is used rather than a literal newline.
  const flat = sql.replace(/\s+/g, " ");
  const m = new RegExp(`${column} is null or ${column} in \\(([^)]+)\\)`).exec(flat);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}

const shapeValues = sqlCheckValues(SQL, "answer_shape");
check("answer_shape's CHECK is in the migration", shapeValues.length === 3, shapeValues.join(", "));
check(
  "and it matches ANSWER_SHAPES exactly",
  shapeValues.slice().sort().join(",") === ANSWER_SHAPES.slice().sort().join(","),
  `${shapeValues.join(",")} vs ${ANSWER_SHAPES.join(",")}`
);

// ‼️ recordKeywordDecisions SWALLOWS ITS OWN ERRORS BY DESIGN, so a decision word missing from this
// CHECK is refused by Postgres, logged to a console nobody reads, and lost without a sound.
const flatSql = SQL.replace(/\s+/g, " ");
for (const action of ["select", "unselect", "variation", "delete_all"]) {
  check(`keyword_decisions.action accepts '${action}'`, flatSql.includes(`'${action}'`));
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n10. the step 12 decision reaches the drafting prompt");
//
// ‼️ THE WHOLE POINT OF DECIDING AT STEP 12 IS THAT STEP 21 USES IT. The ideas are written while
// somebody is looking at the actual results page, nine steps before the page exists; if the offer
// drafter does not read them, that judgement is thrown away and a model guesses again from less.
// This is the wire, grepped, because a wire nothing checks is a wire that gets removed.

const MAGNETS = readFileSync("src/lib/concierge/magnet-drafts.ts", "utf8");

check("the offer drafter resolves the keyword's SERP reading", /serpAssetsFor\(/.test(MAGNETS));
check("it reads the ideas that were proposed", /asset_ideas/.test(MAGNETS));
check("and the shape and the fit beside them", /answer_shape/.test(MAGNETS) && /asset_fit/.test(MAGNETS));
check("the brief reaches the prompt", /serpAssetLines\(g\.serpAssets\)/.test(MAGNETS));
// ‼️ PREFER, NOT OBEY. An idea written against a SERP in September must not override the angle
// somebody approved for the page last week, and the prompt has to say so in words.
check("and it is offered as a preference the drafter may refuse", /Prefer these where they still fit/.test(MAGNETS));
check("a `fact` SERP is named rather than left to be guessed at", /The results page is an explanation/.test(MAGNETS));
// ‼️ RESOLVED ON normalized WHEN THE ID HAS GONE. `keywords delete all` and resetForNewOffer both
// null keyword_id while the reading stays true, and the phrase is what re-attaches it.
check("it falls back to the phrase when the keyword row has gone", /normalizePhrase\(phrase\)/.test(MAGNETS));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n11. the asset vocabulary");

check("every asset kind names a thing with a door on it", ASSET_KINDS.length === 6);
check(
  "and none of them is a guide or an article",
  !ASSET_KINDS.some((k) => /guide|article|post|tips/.test(k)),
  ASSET_KINDS.join(", ")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log(failures ? `\n${failures} FAILED\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);
