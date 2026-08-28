// Probe: the dominance score and the cutoff grammar, offline.
//
//   bunx tsx scripts/_probe-score.ts
//
// No API key, no network, no DB, no Slack. That is the whole reason `score.ts` is pure: this file
// answers "does the number that decides who gets deleted mean what it says" without spending a
// cent at DataForSEO. Every fixture below is hand-written, so a weight change fails here first.
//
// ‼️ THE SUMMARY AND THE process.exit MUST STAY THE LAST TWO STATEMENTS IN THIS FILE. The DM probe
// records what happens otherwise: five checks once sat below them and never ran.

import {
  applyCutoff,
  buildScoreQuery,
  captionTemplate,
  CUTOFF_GRAMMAR,
  NEUTRAL_SCORE_QUERY,
  parseCutoff,
  parseFollowerCount,
  scoreSerp,
  sortForCutoff,
  type ScoredRow,
  type SerpItem,
  type SerpPayload,
} from "../src/lib/scraper/score";
import { buildApolloTargetsCsv, buildScoredCsv } from "../src/lib/scraper/report";
import { parseCsv } from "../src/lib/scraper/csv";
import { accountRefusalHint, isTaskAccepted } from "../src/lib/scraper/dataforseo";

let passed = 0;
const failures: string[] = [];

function check(label: string, cond: boolean, detail?: string): void {
  if (cond) passed++;
  else failures.push(label + (detail ? "  (" + detail + ")" : ""));
}

function eq(label: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  check(label, a === e, "got " + a + ", wanted " + e);
}

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
//
// One dominant business, spelled out so the arithmetic below can be checked by hand:
//
//   knowledge_graph present          20 / 20
//   250 reviews of a 500 ceiling     13 / 25   (round(25 * 0.5))
//   rated 4.6, at or above 4.0       10 / 10
//   own domain is #1 organic         15 / 15
//   3 directory hosts in the top 10   9 / 30   (3 each)
//   Instagram with 12.3K followers   15 / 15
//                                    -------
//                                    82 / 115  ->  round(82/115*100) = 71

function organic(rank: number, url: string, description = ""): SerpItem {
  return { type: "organic", rank_group: rank, url, description };
}

const KNOWLEDGE_GRAPH: SerpItem = {
  type: "knowledge_graph",
  title: "Radiance Med Spa",
  rating: { value: 4.6, votes_count: 250 },
};

const IG_WITH_COUNT = organic(3, "https://www.instagram.com/radiancemedspa/", "12.3K followers, 480 posts");
const IG_NO_COUNT = organic(3, "https://www.instagram.com/radiancemedspa/", "Radiance Med Spa on Instagram");
const NOT_IG = organic(3, "https://someblog.example/best-spas", "A blog post");

function serp(third: SerpItem): SerpPayload {
  return {
    items: [
      KNOWLEDGE_GRAPH,
      organic(1, "https://www.ownsite.com/"),
      organic(2, "https://www.yelp.com/biz/radiance"),
      third,
      organic(4, "https://www.bbb.org/us/nc/radiance"),
      organic(5, "https://www.healthgrades.com/radiance"),
    ],
  };
}

const FULL = serp(IG_WITH_COUNT);
const WEBSITE = "https://ownsite.com";

// ── 1. the full SERP ────────────────────────────────────────────────────────────────────────────

const full = scoreSerp(FULL, { company: "Radiance Med Spa", website: WEBSITE });
eq("full SERP scores 71", full.score, 71);
eq("full SERP measured all six", full.measured, "6 of 6");
eq("knowledge_graph earns its full weight", full.components.knowledge_graph.earned, 20);
eq("250 of 500 reviews earns 13 of 25", full.components.reviews.earned, 13);
eq("4.6 clears the 4.0 bar", full.components.rating.earned, 10);
eq("own domain at #1 earns 15", full.components.own_domain.earned, 15);
eq("3 directory hosts earn 9", full.components.directories.earned, 9);
eq("Instagram with a count earns 15", full.components.instagram.earned, 15);

// A directory host seen twice is ONE citation, not two. Otherwise a business with three Yelp pages
// in its results looks three times as established as one with three different directories.
const dupeDirectories = scoreSerp(
  {
    items: [
      KNOWLEDGE_GRAPH,
      organic(1, "https://www.ownsite.com/"),
      organic(2, "https://www.yelp.com/biz/radiance"),
      organic(3, "https://www.yelp.com/biz/radiance-2"),
      organic(4, "https://m.yelp.com/biz/radiance-3"),
    ],
  },
  { company: "Radiance", website: WEBSITE }
);
eq("three Yelp pages count as one citation", dupeDirectories.components.directories.earned, 3);

// ── 2. COULD NOT MEASURE IS NOT MEASURED ZERO ───────────────────────────────────────────────────
//
// The single most important property in this file. A missing website means nobody ran the
// "do they rank #1 for their own name" contest, so its 15 points leave the DENOMINATOR. If they
// stayed in the denominator and earned zero, a business nobody could measure would sink toward the
// bottom of the file, and the bottom of the file is the pile that gets scraped.

const noWebsite = scoreSerp(FULL, { company: "Radiance Med Spa", website: null });
eq("no website leaves own_domain unmeasured", noWebsite.components.own_domain.attempted, false);
eq("no website measured five of six", noWebsite.measured, "5 of 6");
eq("no website scores 67 out of a 100-point denominator", noWebsite.score, 67);

// The counterfactual, asserted rather than argued: 67/115 is what the wrong implementation returns.
const ifCountedAsZero = Math.round((67 / 115) * 100);
eq("counting the unmeasured 15 as a zero would give 58", ifCountedAsZero, 58);
check(
  "leaving the denominator scores HIGHER than counting it as an earned zero",
  (noWebsite.score as number) > ifCountedAsZero,
  noWebsite.score + " vs " + ifCountedAsZero
);

// The same rule, one component over: an empty website string is the same answer as a null one.
eq("empty website string is also unmeasured", scoreSerp(FULL, { company: "x", website: "  " }).components.own_domain.attempted, false);

// ── 3. the Instagram split ──────────────────────────────────────────────────────────────────────
//
// Two outcomes that look alike and are not. No profile in the top 5 is a MEASURED absence and earns
// zero, because that is a real finding about their presence. A profile that IS there whose follower
// count will not parse is UNMEASURED, because we know they have one and cannot say how big.

const igAbsent = scoreSerp(serp(NOT_IG), { company: "Radiance", website: WEBSITE });
const igUnparseable = scoreSerp(serp(IG_NO_COUNT), { company: "Radiance", website: WEBSITE });

eq("no Instagram in the top 5 is measured", igAbsent.components.instagram.attempted, true);
eq("no Instagram in the top 5 earns zero", igAbsent.components.instagram.earned, 0);
eq("an unparseable follower count is NOT measured", igUnparseable.components.instagram.attempted, false);
eq("igAbsent scores 58", igAbsent.score, 58);
eq("igUnparseable scores 67", igUnparseable.score, 67);
check(
  "the two Instagram outcomes produce DIFFERENT scores from the same organic block",
  igAbsent.score !== igUnparseable.score,
  igAbsent.score + " vs " + igUnparseable.score
);

eq("12.3K parses", parseFollowerCount("12.3K followers"), 12300);
eq("1,204 parses", parseFollowerCount("1,204 Followers"), 1204);
eq("2.1M parses", parseFollowerCount("2.1M followers"), 2100000);
eq("no count parses to null, never to 0", parseFollowerCount("on Instagram"), null);
eq("undefined parses to null", parseFollowerCount(undefined), null);

// ── 4. the GBP split, same shape ────────────────────────────────────────────────────────────────
//
// A profile that exists and carries no rating is a measured zero: Google knows this business and
// has nothing to show. NO profile block at all is a failure to look.

const kgNoRating = scoreSerp(
  { items: [{ type: "knowledge_graph", title: "Radiance" }, organic(1, "https://www.ownsite.com/")] },
  { company: "Radiance", website: WEBSITE }
);
eq("a profile with no rating still MEASURES reviews", kgNoRating.components.reviews.attempted, true);
eq("a profile with no rating earns no review points", kgNoRating.components.reviews.earned, 0);

const noProfile = scoreSerp({ items: [organic(1, "https://www.ownsite.com/")] }, { company: "x", website: WEBSITE });
eq("no profile block leaves reviews unmeasured", noProfile.components.reviews.attempted, false);
eq("no profile block leaves rating unmeasured", noProfile.components.rating.attempted, false);

// ── 5. nothing measurable at all ────────────────────────────────────────────────────────────────

const empty = scoreSerp({ items: [] }, { company: "Radiance", website: WEBSITE });
eq("an empty SERP scores NULL, not 0", empty.score, null);
eq("an empty SERP measured nothing", empty.measured, "0 of 6");
const missing = scoreSerp({}, { company: "Radiance", website: null });
eq("a missing items array also scores null", missing.score, null);

// ── 6. the query, and the vertical that must not be baked in ────────────────────────────────────

eq("the neutral fallback is company and city", NEUTRAL_SCORE_QUERY, "{company} {city}");
eq(
  "an unset template falls back to the neutral query",
  buildScoreQuery(null, { company: "Radiance Med Spa", city: "Charlotte" }),
  "Radiance Med Spa Charlotte"
);
eq(
  "a missing city collapses rather than leaving a gap",
  buildScoreQuery(null, { company: "Radiance", city: null }),
  "Radiance"
);
eq(
  "a per-batch template wins",
  buildScoreQuery("{company} dentist {city} reviews", { company: "Radiance", city: "Charlotte" }),
  "Radiance dentist Charlotte reviews"
);
check(
  "no vertical is hardcoded anywhere in the default query path",
  !buildScoreQuery(null, { company: "Radiance", city: "Charlotte" }).toLowerCase().includes("med spa"),
  buildScoreQuery(null, { company: "Radiance", city: "Charlotte" })
);
eq("a caption with no {company} token is not a template", captionTemplate("med spa charlotte batch 3"), null);
eq(
  "a caption carrying the token IS a template",
  captionTemplate("{company} med spa {city}"),
  "{company} med spa {city}"
);

// ── 7. the sort ─────────────────────────────────────────────────────────────────────────────────
//
// ‼️ DESCENDING IS LOAD-BEARING. Ascending, "drop the first 10" and the file disagree about what
// "first" means, and getting that backwards deletes exactly the invisible businesses this lane
// exists to find.

function row(id: string, score: number | null): ScoredRow {
  return { id, company: "co-" + id, score };
}

const unsorted = [row("a", 40), row("b", null), row("c", 94), row("d", 12), row("e", 71)];
const sorted = sortForCutoff(unsorted, (r) => r.score);
eq("row 1 is the HIGHEST score", sorted[0].score, 94);
eq("the order is strictly descending", sorted.map((r) => r.score), [94, 71, 40, 12, null]);
eq("the unmeasured row lands LAST", sorted[sorted.length - 1].score, null);

// ── 8. the cutoff grammar ───────────────────────────────────────────────────────────────────────

eq("drop the first 10", parseCutoff("drop the first 10"), { kind: "drop_first", n: 10 });
eq("drop first 10", parseCutoff("drop first 10"), { kind: "drop_first", n: 10 });
eq("drop 10", parseCutoff("drop 10"), { kind: "drop_first", n: 10 });
eq("bare first 10", parseCutoff("first 10"), { kind: "drop_first", n: 10 });
eq(
  "the sentence he actually types",
  parseCutoff("drop the first 10 and give me the rest as scrapers"),
  { kind: "drop_first", n: 10 }
);
eq("top 20%", parseCutoff("top 20%"), { kind: "drop_top_pct", pct: 20 });
eq("drop the top 20%", parseCutoff("drop the top 20%"), { kind: "drop_top_pct", pct: 20 });
eq("bottom 30%", parseCutoff("bottom 30%"), { kind: "keep_bottom_pct", pct: 30 });
eq("score > 60", parseCutoff("score > 60"), { kind: "drop_above_score", score: 60 });
eq("score above 60", parseCutoff("score above 60"), { kind: "drop_above_score", score: 60 });
eq("score < 40 is the same cut said backwards", parseCutoff("score < 40"), { kind: "drop_above_score", score: 39 });
eq("keep 120", parseCutoff("keep 120"), { kind: "keep_n", n: 120 });

// ‼️ "drop 20%" MUST NOT READ AS 20 ROWS. A percentage and a count are different instructions and
// the difference is silent: on a 240-row file one drops 48 and the other drops 20.
eq("drop 20% is a percentage, not 20 rows", parseCutoff("drop the top 20%"), { kind: "drop_top_pct", pct: 20 });

// The refusal. An unrecognised phrase costs one retyped message; a guess costs the wrong leads.
eq("gibberish refuses", parseCutoff("do the thing with the list"), null);
eq("an empty string refuses", parseCutoff("   "), null);
eq("a bare thanks refuses", parseCutoff("thanks"), null);
check("the grammar names drop the first", CUTOFF_GRAMMAR.includes("drop the first 10"));
check("the grammar names keep", CUTOFF_GRAMMAR.includes("keep 120"));

// ── 9. applying the cutoff ──────────────────────────────────────────────────────────────────────

// 12 measured rows, 94 down to 6, plus 2 that could not be measured.
const scores = [94, 88, 81, 77, 71, 64, 55, 47, 38, 29, 17, 6];
const file: ScoredRow[] = sortForCutoff(
  [...scores.map((s, i) => row("m" + i, s)), row("u1", null), row("u2", null)],
  (r) => r.score
);

const dropTen = applyCutoff(file, { kind: "drop_first", n: 10 });
eq("drop the first 10 drops ten", dropTen.dropped.length, 10);
eq("it drops the TEN HIGHEST, in order", dropTen.dropped.map((r) => r.score), [94, 88, 81, 77, 71, 64, 55, 47, 38, 29]);
eq("the survivors are the least dominant plus the unmeasured", dropTen.kept.map((r) => r.score), [17, 6, null, null]);
eq("the echo can name the highest dropped", dropTen.droppedHigh, 94);
eq("the echo can name the lowest dropped", dropTen.droppedLow, 29);
eq("the unmeasured are counted for the echo", dropTen.keptUnmeasured, 2);

// ‼️ THE UNMEASURED STAY IN THE KEEP PILE. Scraping a company unnecessarily costs one Apollo
// credit; discarding one loses a lead. The safe direction is the one that is taken.
check("no unmeasured row is ever dropped", dropTen.dropped.every((r) => r.score !== null));

// ‼️ A PERCENTAGE IS A PERCENTAGE OF THE MEASURED ROWS. Counting the two unmeasured rows into the
// denominator would make the cut depend on how many lookups happened to fail, which is not a fact
// about any business on this list.
const bottom30 = applyCutoff(file, { kind: "keep_bottom_pct", pct: 30 });
eq("bottom 30% of TWELVE measured keeps 4 measured", bottom30.kept.filter((r) => r.score !== null).length, 4);
eq("bottom 30% drops 8", bottom30.dropped.length, 8);
eq("the unmeasured are still kept on a percentage cut", bottom30.keptUnmeasured, 2);

const above60 = applyCutoff(file, { kind: "drop_above_score", score: 60 });
eq("score > 60 drops the six above it", above60.dropped.map((r) => r.score), [94, 88, 81, 77, 71, 64]);

const keep5 = applyCutoff(file, { kind: "keep_n", n: 5 });
eq("keep 5 keeps five rows", keep5.kept.length, 5);

// Clamping. "drop 5000" on a 14-row file must not take the unmeasured tail with it.
const overDrop = applyCutoff(file, { kind: "drop_first", n: 5000 });
eq("an over-large drop is clamped to the measured rows", overDrop.dropped.length, 12);
eq("the unmeasured survive even an over-large drop", overDrop.kept.map((r) => r.score), [null, null]);
eq("a zero drop keeps everything", applyCutoff(file, { kind: "drop_first", n: 0 }).kept.length, 14);

// ── 10. the two output files ────────────────────────────────────────────────────────────────────

const HEADERS = ["Company", "First Name", "Email", "Website", "City", "State"];
const RAWS = [
  { Company: "Radiance", "First Name": "Ana", Email: "ana@radiance.com", Website: "radiance.com", City: "Charlotte", State: "NC" },
  { Company: "Glo", "First Name": "Ben", Email: "ben@glo.com", Website: "glo.com", City: "Raleigh", State: "NC" },
  { Company: "Nowhere", "First Name": "", Email: "", Website: "", City: "", State: "" },
];

const scoredCsv = buildScoredCsv(HEADERS, [
  { raw: RAWS[0], score: 94, measured: "6 of 6" },
  { raw: RAWS[1], score: 12, measured: "5 of 6" },
  { raw: RAWS[2], score: null, measured: "not measured" },
]);
const parsedScored = parseCsv(scoredCsv);

// ‼️ dominant.csv IS THE INPUT TO A SEPARATE COLD-EMAIL PROJECT that qualifies on first name,
// verified email, website, city and state. Narrowing these columns would look like a lead problem
// downstream rather than the plumbing problem it would actually be.
for (const h of HEADERS) {
  check("scored.csv keeps the original column " + h, parsedScored.headers.includes(h));
}
eq("scored.csv appends exactly three columns", parsedScored.headers.slice(HEADERS.length), [
  "rank",
  "dominance_score",
  "score_measured",
]);
eq("rank 1 is the most dominant row", parsedScored.rows[0].rank, "1");
eq("the ranks are consecutive", parsedScored.rows.map((r) => r.rank), ["1", "2", ""]);
eq("an unmeasured row gets a BLANK rank, never the next number", parsedScored.rows[2].rank, "");
eq("an unmeasured row says so in the score column", parsedScored.rows[2].dominance_score, "not measured");
eq("the original values survive the round trip", parsedScored.rows[0]["First Name"], "Ana");

const apolloCsv = buildApolloTargetsCsv([
  { company: "Radiance", website: "radiance.com" },
  { company: "Glo", website: null },
  { company: null, website: "orphan.com" },
  { company: "  ", website: "blank.com" },
]);
const parsedApollo = parseCsv(apolloCsv);
eq("apollo_targets.csv is exactly two columns", parsedApollo.headers, ["company", "website"]);
eq("a row with no company is dropped rather than exported blank", parsedApollo.rows.length, 2);
eq("a missing website is an empty cell, not the word null", parsedApollo.rows[1].website, "");

// ── 11. google_reviews, the live bug ────────────────────────────────────────────────────────────
//
// ‼️ THE FIRST REAL SERP SCORED A NATIONAL CHAIN AT 23/100. "Ideal Image Charlotte" returned a
// knowledge_graph with NO rating on it plus a separate `google_reviews` item carrying all of it.
// Reading only the knowledge_graph found a profile with no numbers, which is correctly a MEASURED
// ZERO, so 35 points of review and rating weight were scored as real zeros rather than read. The
// business looked invisible and would have gone into the scrape pile.

const splitBlocks: SerpPayload = {
  items: [
    { type: "knowledge_graph", title: "Ideal Image" },
    { type: "google_reviews", rating: { value: 4.4 }, reviews_count: 612 },
    organic(1, "https://www.ownsite.com/"),
  ],
};
const split = scoreSerp(splitBlocks, { company: "Ideal Image", website: WEBSITE });
eq("a google_reviews block is read for the review count", split.components.reviews.earned, 25);
eq("a google_reviews block is read for the rating", split.components.rating.earned, 10);
check("the note names the real count", split.components.reviews.note.includes("612"));

// The fallback must survive: a profile block with genuinely nothing on it is still a measured zero,
// because Google knows this business and has nothing to show. Widening WHERE we look must not
// loosen WHAT counts as measured.
const emptyProfile = scoreSerp(
  { items: [{ type: "knowledge_graph", title: "Nobody" }, organic(1, "https://www.ownsite.com/")] },
  { company: "Nobody", website: WEBSITE }
);
eq("an empty profile block is still MEASURED", emptyProfile.components.reviews.attempted, true);
eq("an empty profile block still earns zero", emptyProfile.components.reviews.earned, 0);

// reviews_count as a string, which is how their JSON sometimes renders it.
const stringCount = scoreSerp(
  { items: [{ type: "google_reviews", rating: { value: "4.8" }, reviews_count: "1,020" }, organic(1, "https://x.com/")] },
  { company: "x", website: null }
);
eq("a string reviews_count parses", stringCount.components.reviews.earned, 25);
eq("a string rating parses", stringCount.components.rating.earned, 10);

// ── 12. task_post accepts 20100 ─────────────────────────────────────────────────────────────────
//
// ‼️ `task_post` ANSWERS 20100 "Task Created", NOT 20000, AND THE ACCOUNT IS ALREADY CHARGED. The
// first live call created and billed a task and the client threw the id away, which is money spent
// on a company that never scores, with no error anywhere.

check("20100 Task Created is accepted", isTaskAccepted(20100));
check("20000 Ok is accepted", isTaskAccepted(20000));
check("40601 Task Handed is accepted", isTaskAccepted(40601));
check("40501 is NOT accepted", !isTaskAccepted(40501));
check("undefined is NOT accepted", !isTaskAccepted(undefined));

// ── 13. the account refusal ─────────────────────────────────────────────────────────────────────
//
// Found on the first live call: a new DataForSEO account authenticates, answers the free endpoints
// with a real balance, and then refuses task_post with 40104 "verify your account". That is a
// CONFIGURATION state, not a data fault, so the batch parks at `scoring` and the cron resumes it
// once the account clears rather than dying and needing the file re-dropped.

check("an unverified account is named, with the place to fix it", accountRefusalHint("dataforseo task_post failed: 403 {\"status_code\":40104}").includes("app.dataforseo.com"));
check("an unverified account says nothing needs re-dropping", accountRefusalHint("...40104...").includes("re-dropping"));
check("an out-of-funds account is a different message", accountRefusalHint("...40200...").includes("out of funds"));
check("an unknown account refusal still says nothing was spent", accountRefusalHint("...40101...").includes("Nothing was spent"));

console.log("\n" + passed + " passed, " + failures.length + " failed");
if (failures.length) for (const f of failures) console.log("  FAIL " + f);
process.exit(failures.length ? 1 : 0);
