// The attribution stack, proved without a key, a network call or a database.
//
//   npx tsx scripts/_probe-attribution.ts
//
// Two propositions, and the second is the one the whole feature exists to guarantee:
//
//   1. The AI-domain classifier is right in BOTH directions. An AI referrer is recognised, an
//      ordinary Google search is not, a lookalike domain is not, and an absent referrer is a
//      third answer rather than a no.
//   2. THE PIXEL CAN NEVER DEFINE A QUALIFIED APPOINTMENT. Proved four ways: the rule function,
//      the shape of the writer, the SQL that generates the column, and the request shape of the
//      public collector, read as text.
//
// ‼️ CHECK 2 IS READ OUT OF THE SOURCE FILES AS TEXT, ON PURPOSE. A probe that only called
// isQualified() would prove the mirror and not the authority: the authority is a generated
// column in Postgres and a route that has no field for a basis. Neither is reachable from a
// unit test, and both are exactly what a well-meaning future edit would relax.

import fs from "fs";
import path from "path";
import {
  aiEngineForHost,
  classifyReferrer,
  isAiSelfReport,
  isQualified,
  readSelfReport,
  readUtm,
  splitLanding,
  COUNT_BASIS_RANK,
  SELF_REPORT_OPTIONS,
  type CountBasis,
} from "../src/lib/attribution/ai-domains";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
}

function read(rel: string): string {
  return fs.readFileSync(path.join(process.cwd(), rel), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. The classifier, both directions
// ─────────────────────────────────────────────────────────────────────────────

const AI_CASES: Array<[string, string]> = [
  ["chatgpt.com", "chatgpt"],
  ["www.chatgpt.com", "chatgpt"],
  ["chat.openai.com", "chatgpt"],
  ["claude.ai", "claude"],
  ["www.perplexity.ai", "perplexity"],
  ["gemini.google.com", "gemini"],
  ["copilot.microsoft.com", "copilot"],
];
for (const [host, engine] of AI_CASES) {
  check(`${host} is ${engine}`, aiEngineForHost(host) === engine, `got ${aiEngineForHost(host)}`);
}

// ‼️ THE NEGATIVE HALF IS THE HALF THAT MATTERS. Every one of these would MANUFACTURE evidence
// of an AI referral if a bare endsWith or a substring test were used.
const NOT_AI = [
  "google.com",
  "www.google.com",
  "google.co.uk",
  "notchatgpt.com",
  "chatgpt.com.evil.com",
  "myclaude.ai.example.com",
  "openai.com.phishing.net",
  "bing.com",
  "facebook.com",
  "instagram.com",
  "microsoft.com",
];
for (const host of NOT_AI) {
  check(`${host} is NOT an AI engine`, aiEngineForHost(host) === null, `got ${aiEngineForHost(host)}`);
}

check(
  "an ordinary Google search referrer is non_ai, not ai",
  classifyReferrer("https://www.google.com/search?q=med+spa+near+me").kind === "non_ai"
);
check(
  "gemini.google.com IS ai even though google.com is not",
  classifyReferrer("https://gemini.google.com/app").engine === "gemini"
);

// ── The tri-state ──
for (const [label, value] of [
  ["an empty referrer", ""],
  ["a null referrer", null],
  ["an unparseable referrer", "not a url at all"],
  ["a non-http scheme", "android-app://com.example/"],
] as const) {
  const v = classifyReferrer(value);
  check(
    `${label} is 'absent', which is not the same answer as 'non_ai'`,
    v.kind === "absent" && v.engine === null,
    `got ${v.kind}`
  );
}
check(
  "'absent' and 'non_ai' are genuinely different verdicts",
  classifyReferrer("").kind !== classifyReferrer("https://google.com/").kind
);

// ── The query string never survives ──
const withQuery = classifyReferrer("https://www.google.com/search?q=jane%40example.com&sid=abc123");
check(
  "a referrer's query string is dropped, including an email sitting in it",
  withQuery.path === "/search" && !JSON.stringify(withQuery).includes("example.com"),
  JSON.stringify(withQuery)
);
const landing = splitLanding("https://clinic.com/book?token=secret&utm_source=chatgpt");
check(
  "a landing URL keeps host and path and drops the query",
  landing.host === "clinic.com" && landing.path === "/book",
  JSON.stringify(landing)
);
check(
  "the UTM values are read BEFORE the query is dropped, or they would be lost",
  readUtm("?utm_source=chatgpt&utm_medium=referral&token=secret").source === "chatgpt"
);
check(
  "a non-utm parameter is never read into a column",
  Object.values(readUtm("?token=secret&sid=abc")).length === 0,
  JSON.stringify(readUtm("?token=secret&sid=abc"))
);

// ── Self report ──
check("the six options are the six options", SELF_REPORT_OPTIONS.length === 6);
check("a known slug reads back", readSelfReport("ai") === "ai");
check("case is normalised", readSelfReport("  AI ") === "ai");
check(
  "an unrecognised answer is null, never coerced to 'other'",
  readSelfReport("chatgpt maybe?") === null,
  `got ${readSelfReport("chatgpt maybe?")}`
);
check("only the AI option is AI evidence", isAiSelfReport("ai") === true);
for (const slug of ["google", "friend_family", "instagram_facebook", "sign", "other"] as const) {
  check(`'${slug}' is not AI evidence`, isAiSelfReport(slug) === false);
}
check("no answer at all is not AI evidence", isAiSelfReport(null) === false);

// ─────────────────────────────────────────────────────────────────────────────
// 2. THE PIXEL NEVER DEFINES THE COUNT
// ─────────────────────────────────────────────────────────────────────────────

check(
  "the Concierge outranks a self report, which outranks the pixel",
  COUNT_BASIS_RANK.assistant > COUNT_BASIS_RANK.self_reported &&
    COUNT_BASIS_RANK.self_reported > COUNT_BASIS_RANK.pixel_only
);

// ‼️ EVERY COMBINATION, ENUMERATED, because the rule is small enough that the whole truth table
// fits and a partial one is how an exception gets added without anybody noticing.
const BASES: CountBasis[] = ["assistant", "self_reported", "pixel_only"];
for (const basis of BASES) {
  for (const evidence of [true, false]) {
    const want = basis !== "pixel_only" && evidence;
    check(
      `${basis} + ${evidence ? "AI evidence" : "no AI evidence"} -> ${want ? "QUALIFIED" : "not qualified"}`,
      isQualified(basis, evidence) === want
    );
  }
}
check(
  "a pixel row with AI evidence STILL does not qualify, which is the whole rule",
  isQualified("pixel_only", true) === false
);
check(
  "a Concierge booking by somebody who said 'friend or family' does NOT qualify",
  isQualified("assistant", isAiSelfReport("friend_family")) === false
);
check(
  "a Concierge booking by somebody who said 'ChatGPT or another AI' DOES qualify",
  isQualified("assistant", isAiSelfReport("ai")) === true
);
check(
  "a clinic's own form counts when the patient says AI, which is layer 2's whole job",
  isQualified("self_reported", isAiSelfReport("ai")) === true
);

// ── The authority: the generated column ──
const sql = read("docs/2026-09-03-attribution.sql");
check(
  "qualified is a STORED GENERATED column, not a flag a route writes",
  /qualified\s+boolean generated always as \(/.test(sql) && /\)\s*stored/.test(sql),
  "if this is ever an ordinary column, any writer can set it"
);
check(
  "the generated expression excludes pixel_only by construction",
  /generated always as \(\s*count_basis <> 'pixel_only' and ai_evidence\s*\) stored/.test(
    sql.replace(/\s+/g, " ").replace(/-- [^\n]*/g, "")
  ) || /count_basis <> 'pixel_only' and ai_evidence/.test(sql),
  "the SQL no longer carries the exclusion the whole feature rests on"
);
check(
  "a CHECK constraint stops a pixel row from even carrying ai_evidence",
  /count_basis <> 'pixel_only' or ai_evidence = false/.test(sql)
);
check(
  "a self_reported row cannot exist without an answer behind it",
  /count_basis <> 'self_reported' or self_report is not null/.test(sql)
);
check(
  "the qualified index also excludes test rows, so a test can never move the number",
  /where qualified and is_test = false/.test(sql)
);

// ── The authority: the shape of the writer ──
const store = read("src/lib/attribution/store.ts");
check(
  "recordPixelBooking hardcodes the literal 'pixel_only'",
  /count_basis: "pixel_only"/.test(store)
);
check(
  "recordPixelBooking takes no basis argument at all",
  // [^)] already spans newlines in a character class, so no `s` flag is needed. tsconfig
  // targets below es2018 and the flag is a build error rather than a runtime one.
  !/recordPixelBooking\([^)]*basis/.test(store),
  "a basis parameter here is one typo away from the collector passing 'assistant'"
);
check(
  "recordCountedBooking accepts only the two bases that may count",
  /basis: "assistant" \| "self_reported"/.test(store)
);
check(
  "ai_evidence is DERIVED from the answer and is never a parameter",
  /ai_evidence: isAiSelfReport\(answer\)/.test(store) && !/ai_evidence\?:/.test(store)
);
check(
  "countQualified reads the generated column and never rebuilds the predicate",
  /\.eq\("qualified", true\)/.test(store) &&
    !/count_basis.*!==.*pixel_only/.test(store.replace(/\/\/[^\n]*/g, "")),
  "rebuilding the predicate by hand is the one change that lets a pixel row into the count"
);

// ── The authority: the request shape of the public collector ──
const collect = read("src/app/api/px/collect/route.ts");
const collectCode = collect.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
for (const field of ["count_basis", "self_report", "ai_evidence", "qualified"]) {
  check(
    `the public collector never reads '${field}' off the request body`,
    !new RegExp(`body\\.${field}|body\\["${field}"\\]`).test(collectCode),
    "this endpoint is reachable by anyone who has read a client's page source"
  );
}
check(
  "the collector's only booking writer is recordPixelBooking",
  collectCode.includes("recordPixelBooking") && !collectCode.includes("recordCountedBooking")
);

// ── The snippet ──
const snippet = read("src/lib/attribution/snippet.ts");
// Comments in this file NAME the things the code must not do ("no cookies, no localStorage"),
// so a bare text search finds the prohibition and reports it as the violation.
const snippetCode = snippet.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
check(
  "the browser snippet has no way to send a basis or an answer",
  !/count_basis|self_report|ai_evidence/.test(snippetCode),
  "the answer to how-did-you-hear belongs to the form that asked, not to a script tag"
);
check(
  "the snippet uses sessionStorage and never localStorage or a cookie",
  /sessionStorage/.test(snippetCode) && !/localStorage|document\.cookie/.test(snippetCode),
  "a persistent id would be cross-visit tracking of a clinic's patients, which nobody signed"
);
check(
  "every storage access is wrapped, because Safari private mode throws on setItem",
  /try \{ return window\.sessionStorage\.getItem/.test(snippet) &&
    /try \{ window\.sessionStorage\.setItem/.test(snippet)
);

// ── Test mode rides the real path ──
check(
  "test events go through the SAME collector as production traffic",
  /is_test: Boolean\(testCode\)/.test(store),
  "a separate test table would be proving a code path nobody runs"
);
check(
  "a test session must carry the code that made it one",
  /is_test = false or test_code is not null/.test(sql)
);

console.log("");
if (failures) {
  console.log(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed.");
