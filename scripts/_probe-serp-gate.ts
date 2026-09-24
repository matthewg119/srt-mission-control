// The two scores, the magnet test, and the screenshot gate, proved offline.
//
//   bun run scripts/_probe-serp-gate.ts
//
// ‼️ `bun run`, NOT `bunx tsx`. This file has top-level await and tsx mangles it.
//
// NO MODEL CALL, NO WRITES, NO NETWORK AND NO DATABASE. Every rule here decides what gets written on
// a client's website, and a rule that can only be checked against production is a rule nobody checks.
//
// WHAT IT PROVES
//  1. Both rules are single constants, quoted and not restated, and both reach src/.
//  2. The routing table: low click + high citation + a magnet is REROUTED and never dropped, and the
//     same row with no magnet is SKIPPED. That pair is the whole point of the stage.
//  3. pictured() is the gate, and a typed verdict does not satisfy it.
//  4. gateClusters names what is missing, with the three reasons kept apart.
//  5. The gate is WIRED: every entry in GATED resolves to a real call site in src/, and the three
//     write points each call it. A gate written and never called is the same failure as an unwired
//     column, wearing a safety label.
//  6. The CHECK lists in the migration and the TypeScript unions agree, which the migration has
//     claimed a probe did since before one existed.
//  7. The reader's caps hold in code rather than only in the prompt.
//  8. Every action_id the card mints is one the actions route switches on.

import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";
import {
  AEO_ROUTING_RULE,
  RECOMMENDED_ASSETS,
  RESULT_SHAPES,
  ROUTES,
  SCORE_FLOOR,
  SERP_TRIAGE_RULE,
  VERDICTS,
  blockLine,
  citationValueFrom,
  clickValueFrom,
  gateClusters,
  pictured,
  routeFrom,
  type Finalist,
  type ProposedCluster,
  type SerpRead,
} from "../src/lib/clients/keyword-strategy-rules";
import { AEO_ROUTING_RULE as RULE_FROM_EXPANSION } from "../src/lib/clients/keyword-expansion";
import { GATED, NOT_GATED } from "../src/lib/clients/serp-gate";
import {
  GATE_APPROVE_ACTION,
  GATE_DROP_ACTION,
  GATE_REJECT_ACTION,
} from "../src/lib/clients/serp-cards";
import { shouldAskMagnet } from "../src/lib/clients/magnet-space";

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
const SERP_SQL = readFileSync("docs/2026-09-26-keyword-serp.sql", "utf8");

let n = 0;
function finalist(phrase: string, opts: Partial<Finalist> = {}): Finalist {
  n += 1;
  return {
    id: `k${n}`,
    phrase,
    normalized: phrase.toLowerCase(),
    category: "general",
    score: 100 - n,
    rank: n,
    awarenessStage: 4,
    verdict: null,
    intent: null,
    mergedInto: null,
    pictured: false,
    route: null,
    clickValue: null,
    citationValue: null,
    magnetSpace: null,
    magnetIdea: null,
    magnetBy: null,
    recommendedAsset: null,
    readEvidence: null,
    docId: null,
    slackFileId: null,
    ...opts,
  };
}

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
    evidence: "",
    confidence: 0.9,
    ...opts,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. two rules, both single constants");

check("AEO_ROUTING_RULE is the constant keyword-expansion.ts owns", AEO_ROUTING_RULE === RULE_FROM_EXPANSION);
check("it names being cited as the product", /being named in that answer is/i.test(AEO_ROUTING_RULE));
check("it names the skip case", /nothing left to hand over/i.test(AEO_ROUTING_RULE));

// ‼️ THE TRIAGE RULE WAS NOT REWRITTEN, AND THAT WAS THE DECISION. clusterFinalists has always placed
// a `merge` as a member UNDER a pillar rather than discarding it, so the rule was never in conflict
// with the two-score model: what it lacked was the skip case, which the sibling states.
check("SERP_TRIAGE_RULE still names the AI Overview half", /AI Overview fully answers it/.test(SERP_TRIAGE_RULE));
check("SERP_TRIAGE_RULE still names the listings half", /local listings or software products/.test(SERP_TRIAGE_RULE));

// Both reach the cards. The routing rule quoted without the triage rule, or the other way round, is
// half the instruction, and the half that is missing is the one that changes the answer.
const triageQuotes = (SRC.match(/\$\{SERP_TRIAGE_RULE\}/g) ?? []).length;
const routingQuotes = (SRC.match(/\$\{AEO_ROUTING_RULE\}/g) ?? []).length;
check("both rules are quoted in src/", triageQuotes > 0 && routingQuotes > 0, `triage ${triageQuotes}, routing ${routingQuotes}`);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. the routing table");

const clicky = routeFrom({ verdict: "post", clickValue: 5, citationValue: 1, magnetSpace: null, magnetIdea: null, magnetBy: null });
check("a page people click is kept whatever the magnet says", clicky.route === "keep");

const service = routeFrom({ verdict: "service_page", clickValue: 4, citationValue: 2, magnetSpace: null, magnetIdea: null, magnetBy: null });
check("a clicked service page stays a service page", service.route === "keep" && service.asset === "service_page");

// ‼️ THE ASSERTION THE WHOLE STAGE EXISTS FOR. Every keyword tool drops this row.
const rerouted = routeFrom({
  verdict: "merge",
  clickValue: 1,
  citationValue: 5,
  magnetSpace: 4,
  magnetIdea: "a front desk script",
  magnetBy: "model",
});
check(
  "low click + high citation + a magnet is REROUTED, never dropped",
  rerouted.route === "reroute" && rerouted.asset === "answer_block",
  `${rerouted.route} / ${rerouted.asset}`
);

const tool = routeFrom({
  verdict: "merge",
  clickValue: 1,
  citationValue: 5,
  magnetSpace: 5,
  magnetIdea: "the script itself",
  magnetBy: "model",
});
check("a magnet worth 5 is a tool page, not a section", tool.route === "reroute" && tool.asset === "tool_page");

// ‼️ MATTHEW AMENDED HIS OWN RULE TO ADD THIS. Citation value alone does not save a keyword: what
// saves it is having something left to hand over.
const skipped = routeFrom({
  verdict: "merge",
  clickValue: 0,
  citationValue: 5,
  magnetSpace: 0,
  magnetIdea: null,
  magnetBy: "model",
});
check("low click + high citation + NO magnet is SKIPPED", skipped.route === "skip", skipped.route);
check("and skip is not drop", skipped.route !== "drop");
check("the skip reason says there is nothing to hand over", /nothing left to hand over/i.test(skipped.why));

const dropped = routeFrom({ verdict: "post", clickValue: 0, citationValue: 0, magnetSpace: 5, magnetIdea: "x", magnetBy: "model" });
check("no clicks and no citation value is a drop", dropped.route === "drop");

// ‼️ AN OUTAGE MAY NOT SKIP A KEYWORD. magnet_by null means the judgement never ran, which is a
// different fact from "there is nothing here", and routing them the same way lets a four second
// Anthropic blip delete work silently.
const notRun = routeFrom({ verdict: "merge", clickValue: 1, citationValue: 5, magnetSpace: null, magnetIdea: null, magnetBy: null });
check("a magnet check that never ran asks for one rather than claiming there is none", /has not run/i.test(notRun.why), notRun.why);

const unreadable = routeFrom({ verdict: "unclear", clickValue: null, citationValue: null, magnetSpace: null, magnetIdea: null, magnetBy: null });
check("an unreadable SERP decides nothing", unreadable.route === "skip" && /did not read/i.test(unreadable.why));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2b. the scores move the way the SERP does");

const answered = read({ aiOverview: true, aiOverviewAnswers: true, aiOverviewSatisfies: 5, resultShape: "articles" });
const plain = read({ aiOverview: false, resultShape: "articles" });
check("an AI Overview that answers it in full guts the click score", clickValueFrom(answered) <= 1, String(clickValueFrom(answered)));
check("a clean article SERP scores high", clickValueFrom(plain) >= 4, String(clickValueFrom(plain)));

// ‼️ THE MIRROR IMAGE, AND IT IS THE POINT OF THE TWO-SCORE MODEL. The SERP that destroys the click
// score is the one that RAISES the citation score, because an answer we can be named in is what we
// sell. If these two ever move together, the model has collapsed back into one verdict.
check(
  "the same SERP scores HIGH for citation",
  citationValueFrom(answered) > citationValueFrom(plain),
  `answered ${citationValueFrom(answered)} vs plain ${citationValueFrom(plain)}`
);
check("citation value clears the floor on a fully answered query", citationValueFrom(answered) >= SCORE_FLOOR);
check("a forum ranking raises citation value", citationValueFrom(read({ forumRanks: true })) > citationValueFrom(read({ forumRanks: false })));
check("scores never leave 0..5", [clickValueFrom(answered), citationValueFrom(answered), clickValueFrom(plain)].every((v) => v >= 0 && v <= 5));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2c. the magnet call runs only where it changes the answer");

check("a clicked keyword is not asked about", !shouldAskMagnet({ verdict: "post", clickValue: 5, citationValue: 5 }));
check("a keyword with no citation value is not asked about", !shouldAskMagnet({ verdict: "merge", clickValue: 0, citationValue: 0 }));
check("the middle case IS asked about", shouldAskMagnet({ verdict: "merge", clickValue: 1, citationValue: 5 }));
check("an unreadable one is never asked about", !shouldAskMagnet({ verdict: "unclear", clickValue: null, citationValue: null }));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. pictured() is the gate");

// ‼️ THE ASSERTION THE WHOLE GATE RESTS ON. A typed verdict outranks a vision one for ROUTING and
// must never satisfy the picture requirement: those are two questions and they get two answers.
check("a typed verdict does NOT satisfy the gate", !pictured([{ source: "typed", docId: null }]));
check("a typed verdict with a doc_id still does not", !pictured([{ source: "typed", docId: "d1" }]));
check("a vision read with no doc_id does not either", !pictured([{ source: "vision", docId: null }]));
check("a vision read WITH a doc_id does", pictured([{ source: "vision", docId: "d1" }]));
check("no readings at all does not", !pictured([]));
check(
  "a typed correction beside a real picture still passes",
  pictured([{ source: "typed", docId: null }, { source: "vision", docId: "d1" }])
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. the gate names what is missing, and why");

const pillar = finalist("how to get more google reviews", { verdict: "post", pictured: true });
const shot = finalist("how to ask patients for reviews", { verdict: "merge", pictured: true });
const typedOnly = finalist("when to ask after botox", { verdict: "merge", pictured: false });
const blurred = finalist("does botox hurt", { verdict: "unclear", pictured: false, docId: "d9" });
const unseen = finalist("how to respond to negative reviews", { verdict: null, pictured: false });

const cluster: ProposedCluster = {
  label: "Getting more Google reviews",
  pillarId: pillar.id,
  memberIds: [shot.id, typedOnly.id, blurred.id, unseen.id],
  awarenessEntry: 4,
  awarenessTarget: 3,
  pageKind: "post",
  rationale: "",
};
const byId = new Map([pillar, shot, typedOnly, blurred, unseen].map((r) => [r.id, r]));
const [gate] = gateClusters([cluster], byId);

check("the pictured rows are ready", gate.ready.length === 2, gate.ready.join(","));
check("the three unpictured rows are blocked", gate.blocked.length === 3, String(gate.blocked.length));
check("a pictured pillar is not a blocked pillar", gate.pillarBlocked === false);

const reasonOf = (id: string) => gate.blocked.find((b) => b.id === id)?.reason;
// ‼️ THREE REASONS AND NOT ONE. "nobody looked", "somebody typed it without the picture" and "a
// picture was posted and could not be read" send a person to three different actions, and collapsing
// them is how a gate becomes something nobody can act on.
check("a typed-only row reads as typed_only", reasonOf(typedOnly.id) === "typed_only", String(reasonOf(typedOnly.id)));
check("a filed but unreadable picture reads as unreadable", reasonOf(blurred.id) === "unreadable", String(reasonOf(blurred.id)));
check("a row nobody checked reads as no_reading", reasonOf(unseen.id) === "no_reading", String(reasonOf(unseen.id)));
check("the unreadable line asks for a re-shoot", /shoot it again/i.test(blockLine("unreadable")));
check("the typed line says the picture is what is missing", /no picture/i.test(blockLine("typed_only")));

const [blockedPillar] = gateClusters(
  [{ ...cluster, pillarId: unseen.id, memberIds: [pillar.id] }],
  byId
);
check("a cluster whose PILLAR has no picture is flagged", blockedPillar.pillarBlocked === true);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. the gate is WIRED, not merely written");

// ‼️ THE HOLE CHECK, the same shape page-gate.ts and day-zero.ts both use. This is the assertion that
// would have caught the two inert changes this repo shipped in one week: a merge helper written and
// never added to its chain, and a column written by one writer and read by the other.
for (const entry of GATED) {
  const fn = entry.split(/\s+/)[0];
  check(`GATED names a real function: ${fn}`, new RegExp(`function ${fn}\\b`).test(SRC));
}

const callSites = (SRC.match(/assertPictured\(/g) ?? []).length;
const picturedIdsCalls = (SRC.match(/picturedIds\(/g) ?? []).length;
check("assertPictured is actually called", callSites >= 2, `${callSites} call sites`);
check("picturedIds is actually called", picturedIdsCalls >= 3, `${picturedIdsCalls} call sites`);

// Each of the three write points reaches the gate, by whichever of the two doors.
for (const [fn, body] of [
  ["persistClusters", sliceFunction(SRC, "persistClusters")],
  ["approveStrategyCommand", sliceFunction(SRC, "approveStrategyCommand")],
  ["strategyView", sliceFunction(SRC, "strategyView")],
] as const) {
  check(`${fn} consults the gate`, /assertPictured|picturedIds|gateClusters/.test(body), "the write point does not call it");
}

// ‼️ AND THE REFUSAL IS A REFUSAL. A gate that filters silently produces a smaller plan that looks
// finished, which is the same invisible failure in a quieter coat.
check("the gate throws rather than returning a filtered list", /throw new SerpGateError/.test(SRC));
check("the refusal names the keywords", /refusalLines/.test(SRC));
check("NOT_GATED is documented rather than implied", NOT_GATED.length >= 5, String(NOT_GATED.length));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. the migration's CHECK lists and the unions agree");

// ‼️ THE MIGRATION HAS CLAIMED "a probe asserts the two agree" SINCE BEFORE ONE EXISTED. It does now.
for (const [column, union] of [
  ["verdict", VERDICTS],
  ["route", ROUTES],
  ["recommended_asset", RECOMMENDED_ASSETS],
] as const) {
  const inSql = sqlCheckValues(SERP_SQL, column);
  const missing = union.filter((v) => !inSql.includes(v));
  const extra = inSql.filter((v) => !(union as readonly string[]).includes(v));
  check(
    `${column}: the SQL CHECK and the TypeScript union match`,
    inSql.length > 0 && missing.length === 0 && extra.length === 0,
    `sql [${inSql.join(", ")}] vs ts [${union.join(", ")}]`
  );
}

// ‼️ result_shape CARRIES NO CHECK, DELIBERATELY, and the column's own comment says why: the
// TypeScript union is the authority and the SQL is text. So the thing to hold it to is the COMMENT,
// which is what a person reads when they are deciding what may go in the column. An earlier version
// of this probe asserted a CHECK that was never meant to exist and failed the migration for being
// what it says it is.
for (const shape of RESULT_SHAPES) {
  check(`result_shape's comment lists '${shape}'`, new RegExp(`'${shape}'`).test(SERP_SQL));
}

check("the doc_id column is described as the gate", /THIS COLUMN IS THE GATE/.test(SERP_SQL));

// ‼️ THE OLD SENTENCE IS QUOTED IN THE FILE ON PURPOSE, inside the paragraph that withdraws it, so a
// plain "these words are absent" test fails on the correction itself. What matters is that the claim
// is no longer BEING MADE: the current statement has to be there, and the old wording may only
// appear as something the file is disowning.
// The claim wraps across two comment lines, so the gap between words can carry a newline and the
// `-- ` that starts the next one. Matching on one line only would fail for a reason about formatting
// rather than about meaning.
const flatSql = SERP_SQL.replace(/\n\s*--\s*/g, " ");
check(
  "the file now says a typed verdict does not satisfy the gate",
  /does not satisfy the screenshot gate/i.test(flatSql)
);
// `[\s\S]` rather than the dotAll flag: tsconfig targets ES2017 and `s` needs ES2018, which fails
// `next build` rather than this probe. The repo has hit that class of thing before.
check(
  "the old wording survives only as a correction",
  !/fallback that means a screenshot is never required/.test(flatSql) ||
    /which was true before[\s\S]*?and is false now/i.test(flatSql)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. the reader's caps are in code, not only in the prompt");

const reader = readFileSync("src/lib/clients/serp-read.ts", "utf8");
check("PAA questions are capped", /MAX_PAA\s*=\s*8/.test(reader));
check("vocabulary is capped", /MAX_VOCABULARY\s*=\s*12/.test(reader));
// ‼️ THE ONE TEST THAT HOLDS THE LINE THIS FIELD SITS ON. A term is "tox". A sentence is what this
// lane refuses to take off somebody else's page, and a model drifts from one to the other by
// returning a clause with a full stop in it.
check("anything with a full stop is dropped from vocabulary", /t\.includes\("\."\)/.test(reader));
check("the reader still refuses to transcribe anything else", /TRANSCRIBE NOTHING ELSE/.test(reader));
check("there is still no field for a headline or a snippet", !/headline:|snippet:/.test(reader));
check("the model id is exported rather than duplicated", /export const SERP_MODEL/.test(reader));
check(
  "keyword-strategy.ts no longer carries its own copy of the model id",
  !/"claude-haiku-4-5-20251001"/.test(readFileSync("src/lib/clients/keyword-strategy.ts", "utf8"))
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n8. every button the card mints is one the route answers");

// ‼️ A BUTTON WHOSE action_id NOTHING SWITCHES ON RENDERS FINE AND DOES NOTHING. That is worse than a
// missing button: it reads as the system ignoring a decision somebody made.
const actionsRoute = readFileSync("src/app/api/slack/actions/route.ts", "utf8");
for (const id of [GATE_APPROVE_ACTION, GATE_REJECT_ACTION, GATE_DROP_ACTION]) {
  check(`the actions route switches on ${id}`, actionsRoute.includes(`case "${id}"`));
}

const cards = readFileSync("src/lib/clients/serp-cards.ts", "utf8");
// Slack refuses a whole message when two buttons share an action_id, and renders NO buttons at all.
check("every minted action_id carries a uniqueness suffix", !/action_id: `\$\{GATE_[A-Z_]+\}`,/.test(cards));
check("the approve button is not drawn when it would refuse", /!gate\.pillarBlocked && !gate\.blocked\.length/.test(cards));
// ‼️ THE NAME signedDocUrl APPEARS IN THE FILE, in the comment explaining why it is not used, so the
// test is for a CALL rather than for the word. A signed URL lives 600 seconds and Slack re-fetches
// an image when it renders: a sheet built from them would be broken pictures ten minutes later and
// would have looked perfect going up.
check("the images use slack_file", /slack_file/.test(cards));
check("and no signed URL is ever minted for one", !/signedDocUrl\(/.test(cards));
check("the poster checks res.ok rather than catching", /res\?\.ok !== true/.test(cards));

console.log(failures ? `\n${failures} FAILED\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);

/** The body of one function, roughly, so a wiring check can look inside it rather than the whole file. */
function sliceFunction(src: string, name: string): string {
  const at = src.indexOf(`function ${name}(`);
  if (at < 0) return "";
  return src.slice(at, at + 4000);
}

/** The quoted values inside `check (<column> ... in ('a', 'b'))` for one column. */
function sqlCheckValues(sql: string, column: string): string[] {
  const re = new RegExp(`${column}\\s+(?:text|smallint)[^,]*?check\\s*\\(${column}[^)]*?in\\s*\\(([^)]*)\\)`, "is");
  const m = re.exec(sql);
  if (!m) return [];
  return [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
}
