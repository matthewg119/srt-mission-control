// The keyword strategy, proved offline: the triage, the shortlist, the clustering and the grammar.
//
//   bunx tsx scripts/_probe-keyword-strategy.ts
//
// NO MODEL CALL, NO WRITES, NO NETWORK, AND NO DATABASE. Every rule here decides what gets written
// on a client's website, and a rule that can only be checked against production is a rule nobody
// checks.
//
// WHAT IT PROVES
//  1. The triage rule is one string, quoted and not restated.
//  2. verdictFrom is total and NEVER guesses: a null reading is `unclear`, never `post`.
//  3. A typed verdict outranks a vision one.
//  4. The shortlist dedupes subjects before it caps, and is deterministic.
//  5. Clustering places merges under a pillar and never folds one under a service page.
//  6. An unchecked subject is returned unplaced rather than guessed at.
//  7. The grammar is exact: "the strategy is working" is dictation.

import {
  SERP_TRIAGE_RULE,
  SHORTLIST_SIZE,
  MIN_LEGIBLE,
  bestVerdict,
  clusterFinalists,
  parseStrategyCommand,
  sameSubject,
  searchable,
  shortlistOf,
  typedVerdict,
  verdictFrom,
  type Finalist,
} from "../src/lib/clients/keyword-strategy-rules";
import { SERP_TRIAGE_RULE as RULE_FROM_EXPANSION } from "../src/lib/clients/keyword-expansion";
import { KEYWORDS_SERP_TYPED } from "../src/lib/clients/keyword-strategy-rules";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

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
    // ‼️ pictured DEFAULTS TO false, WHICH IS THE UNSAFE-LOOKING CHOICE AND IS THE RIGHT ONE. A
    // helper that defaulted it to true would make every gate assertion below pass by construction,
    // which is precisely the failure mode the gate exists to prevent, reproduced in the thing meant
    // to catch it. Clustering does not read this field, so the clustering cases are unaffected.
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

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. the triage rule is one string");

check("it is the same constant keyword-expansion.ts owns", SERP_TRIAGE_RULE === RULE_FROM_EXPANSION);
check("it names the AI Overview half", /AI Overview fully answers it/.test(SERP_TRIAGE_RULE));
check("it names the listings half", /local listings or software products/.test(SERP_TRIAGE_RULE));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. verdictFrom never guesses");

check(
  "an AI Overview that answers it is a merge, even with articles under it",
  verdictFrom({ aiOverview: true, aiOverviewAnswers: true, resultShape: "articles", confidence: 0.9 }) === "merge"
);
check(
  "all listings is a service page",
  verdictFrom({ aiOverview: false, aiOverviewAnswers: null, resultShape: "listings", confidence: 0.9 }) === "service_page"
);
check(
  "software products is a service page",
  verdictFrom({ aiOverview: false, aiOverviewAnswers: null, resultShape: "products", confidence: 0.9 }) === "service_page"
);
check(
  "articles with no AI Overview is a post",
  verdictFrom({ aiOverview: false, aiOverviewAnswers: null, resultShape: "articles", confidence: 0.9 }) === "post"
);

// ‼️ THE ASSERTION THE WHOLE TRI-STATE DESIGN EXISTS FOR. `post` is the busiest outcome, so a null
// read defaulting to it means every unreadable screenshot silently becomes a page nobody checked,
// and the plan LOOKS complete.
check(
  "a null reading is unclear, NEVER post",
  verdictFrom({ aiOverview: null, aiOverviewAnswers: null, resultShape: null, confidence: 0.9 }) === "unclear"
);
check(
  "an AI Overview we could not judge is unclear, not a post",
  verdictFrom({ aiOverview: true, aiOverviewAnswers: null, resultShape: "articles", confidence: 0.9 }) === "unclear"
);
check(
  "'mixed' does not become a post by default",
  verdictFrom({ aiOverview: false, aiOverviewAnswers: null, resultShape: "mixed", confidence: 0.9 }) === "unclear"
);
check(
  "an illegible screenshot is unclear whatever the fields say",
  verdictFrom({ aiOverview: false, aiOverviewAnswers: false, resultShape: "articles", confidence: MIN_LEGIBLE - 0.01 }) ===
    "unclear"
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. a person outranks a screenshot");

const rows = [
  { source: "vision" as const, createdAt: "2026-09-26T12:00:00Z", verdict: "post" as const },
  { source: "typed" as const, createdAt: "2026-09-26T11:00:00Z", verdict: "merge" as const },
];
check(
  "an older TYPED verdict beats a newer vision one",
  bestVerdict(rows)?.verdict === "merge",
  "a re-run of the vision pass must not quietly overwrite a correction a human made"
);
check("with no typed row, the newest vision one wins", bestVerdict([rows[0]])?.verdict === "post");
check("no rows is null, not a default", bestVerdict([]) === null);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3b. only things a person would actually type reach the shortlist");

// ‼️ keywordFault() KEEPS EVERY ONE OF THE JUNK CASES BELOW. Measured against SRT's 376 approved
// queries: that function was built for extraction debris (urls, citation markers, markup) and it is
// right about all of those. A grammatical English sentence is not debris, it is simply not a search,
// and nothing needed to tell the difference until something started spending a screenshot on each.
for (const real of [
  "med spa marketing agency Greensboro",
  "does seo actually work for med spas",
  "AEO vs SEO: What is the difference and do you need both?",
  "how long does lip filler last",
]) {
  check(`"${real.slice(0, 44)}" is searchable`, searchable(real));
}

for (const junk of [
  "If a client can book without commitment, your schedule is at risk.",
  "When clients cannot see meaningful differences, decisions shift toward price.",
]) {
  check("a statement ending in a full stop is not", !searchable(junk), junk.slice(0, 52));
}

// ‼️ THESE ARE REAL QUESTIONS A BUYER ASKS OUT LOUD, and they stay approved and stay in the keyword
// set: the concierge and the page angles are built from them. As a SEARCH they name nothing, because
// the subject is in the room rather than in the phrase, so a page aimed at one is aimed at "this".
for (const deictic of [
  "How much does this cost?",
  "What is included in the appointment?",
  "How long is the booked appointment?",
  "How much work is this for me and my front desk?",
]) {
  check(`"${deictic}" points at nothing`, !searchable(deictic));
}

check("half a quotation is not searchable", !searchable("“Belief vs Reality: AI Solves Medspa Marketing?"));
check("an apostrophe is not an unbalanced quote", searchable("what is a med spa's busiest month"));
check("a question mark is fine", searchable("how much is botox in greensboro?"));

console.log("\n4. the shortlist dedupes subjects, then caps");

check("'botox cost' and 'how much does botox cost' are one subject", sameSubject("botox cost", "how much does botox cost"));
check("'botox cost' and 'botox aftercare' are not", !sameSubject("botox cost", "botox aftercare"));
check("an empty phrase matches nothing", !sameSubject("", "botox cost"));

const dupes = [
  finalist("botox cost"),
  finalist("how much does botox cost"),
  finalist("what is the cost of botox"),
  finalist("botox aftercare"),
];
const short = shortlistOf(dupes);
check("three phrasings of one subject become one row", short.length === 2, short.map((r) => r.phrase).join(" | "));
check("the highest scoring phrasing represents it", short[0].phrase === "botox cost");

const many = Array.from({ length: 80 }, (_, i) => finalist(`subject ${i} treatment`, { category: `c${i % 12}` }));
check(`the cap holds at ${SHORTLIST_SIZE}`, shortlistOf(many).length <= SHORTLIST_SIZE);
check(
  "it is deterministic",
  shortlistOf(many).map((r) => r.id).join(",") === shortlistOf(many).map((r) => r.id).join(",")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. clustering");

const a = finalist("more google reviews", { verdict: "post", score: 90 });
const b = finalist("google reviews", { verdict: "merge", score: 80 });
const c = finalist("botox pricing near me", { verdict: "service_page", score: 70 });
const d = finalist("botox pricing", { verdict: "merge", score: 60 });
const e = finalist("chemical peel downtime", { verdict: null, score: 50 });

const { clusters, unplaced } = clusterFinalists([a, b, c, d, e]);

check("a post becomes a cluster", clusters.some((x) => x.pillarId === a.id && x.pageKind === "post"));
check("a merge lands under it", clusters.find((x) => x.pillarId === a.id)?.memberIds.includes(b.id) === true);
check("a service page is its own cluster", clusters.some((x) => x.pillarId === c.id && x.pageKind === "service_page"));

// ‼️ A SERVICE PAGE IS NOT A POST, so folding a merge under one would produce a page that is neither.
check(
  "nothing is folded under a service page",
  clusters.find((x) => x.pillarId === c.id)?.memberIds.length === 0
);
check("a merge with no pillar comes back unplaced rather than inventing one", unplaced.some((u) => u.id === d.id));
check("an unchecked subject is unplaced, never guessed at", unplaced.some((u) => u.id === e.id));
check(
  "a cluster's target is one rung closer to buying than its entry",
  clusters.every((x) => !x.awarenessEntry || !x.awarenessTarget || x.awarenessTarget <= x.awarenessEntry)
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. the grammar is exact");

for (const said of [
  "the strategy is working",
  "our strategy here is different",
  "strategy?",
  "what is the strategy",
  "strategy merge 12",
  "strategy pillar",
]) {
  check(`"${said}" is not a command`, parseStrategyCommand(said) === null);
}

check("`strategy` shows it", parseStrategyCommand("strategy")?.kind === "show");
check("`strategy approve` locks it", parseStrategyCommand("strategy approve")?.kind === "approve");
check("`strategy new` re-groups", parseStrategyCommand("strategy new")?.kind === "new");

const merge = parseStrategyCommand("strategy merge 12 under 4");
check("`strategy merge 12 under 4` parses both numbers", merge?.kind === "merge" && merge.from === 12 && merge.under === 4);
// A row merged under itself is a typo, never an instruction.
check("`strategy merge 4 under 4` is refused", parseStrategyCommand("strategy merge 4 under 4") === null);

check("`strategy service 6` sets the kind", parseStrategyCommand("strategy service 6")?.kind === "kind");
const post = parseStrategyCommand("strategy post 6");
check("`strategy post 6` reverses it", post?.kind === "kind" && post.pageKind === "post");
check("backticked forms parse", parseStrategyCommand("`strategy approve`")?.kind === "approve");

check("`keywords serp 12: merge` parses", KEYWORDS_SERP_TYPED.test("keywords serp 12: merge"));
check("`keywords serp 12: service` parses", KEYWORDS_SERP_TYPED.test("keywords serp 12: service"));
check("`keywords serp 12: maybe` does not", !KEYWORDS_SERP_TYPED.test("keywords serp 12: maybe"));
check("typedVerdict maps service to service_page", typedVerdict("service") === "service_page");
check("typedVerdict refuses a word it does not know", typedVerdict("probably") === null);

console.log(failures ? `\n${failures} FAILED` : "\nAll checks passed.");
process.exit(failures ? 1 : 0);
