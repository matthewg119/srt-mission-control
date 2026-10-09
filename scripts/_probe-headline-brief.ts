// Probe: the headline brief, the door that hands back a prompt instead of running one.
//
//   bun --no-env-file run scripts/_probe-headline-brief.ts
//
// ‼️ THE REGRESSION TO CATCH IS THIS FILE QUIETLY STARTING TO GENERATE. Matthew asked for a
// prompt he runs himself on 2026-10-09, which is the same choice he made for the deep research
// pass on 2026-09-14, and for the same reason: he reads every answer and picks from it. Section 4
// asserts the module imports no model client at all, because "it returns a prompt" is a property
// that is true until somebody adds one convenient call.
//
// ‼️ THE SECOND IS THE TWO CONTRACTS BLENDING. This is the ONE place in the lane where both
// engines are in one prompt. It is allowed because a person reads the answer before a row is
// stored, and it is only safe while both length rules are stated separately and in full.
// Section 2 holds that.

import {
  BRIEF_MARKS,
  BRIEF_MAX_KEYWORDS,
  BRIEF_PER_FORMAT,
  buildHeadlineBrief,
  parseHeadlinePaste,
  parseKeywordList,
  filedLines,
} from "../src/lib/clients/headline-brief";
import { SEO_TITLE_TARGET_MAX, SEO_TITLE_TARGET_MIN } from "../src/data/reel/seo-title-engine";
import { QUERY_CORE_MAX_WORDS, QUERY_CORE_TARGET_WORDS, type HeadlineContext } from "../src/lib/clients/client-headlines";
import { hasBannedDash } from "../src/lib/copy-guard";
import fs from "fs";
import path from "path";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok && detail) console.log(`          ${detail}`);
}

const CTX = {
  clientName: "SRT Agency",
  city: "Austin",
  businessType: "AEO agency",
  avatarLabel: "med spa owner",
  treatment: null,
  positioning: null,
  framework: null,
  approvedNumbers: [],
  quotes: [],
} as unknown as HeadlineContext;

const KEYWORDS = ["how to get my med spa on chatgpt", "aeo agency pricing"];
const BRIEF = buildHeadlineBrief({ ctx: CTX, keywords: KEYWORDS });

console.log("\n1. the keyword list is read the way a person pastes one");
check("plain lines", parseKeywordList("one keyword\nanother keyword").length === 2);
check("numbering is stripped", parseKeywordList("1. aeo agency pricing")[0] === "aeo agency pricing");
check("bullets are stripped", parseKeywordList("- aeo agency pricing")[0] === "aeo agency pricing");
check("duplicates collapse", parseKeywordList("med spa\nMed Spa").length === 1);
check("blank lines and fragments are dropped", parseKeywordList("\n\nbotox\nx\n").length === 1);

console.log("\n2. BOTH contracts reach the brief, stated separately and in full");
check("it asks for two parts", /PART A\./.test(BRIEF) && /PART B\./.test(BRIEF));
check(`${BRIEF_PER_FORMAT} of each`, new RegExp(`PART A\\. ${BRIEF_PER_FORMAT} AEO`).test(BRIEF) && new RegExp(`PART B\\. ${BRIEF_PER_FORMAT} SEO`).test(BRIEF));
check("the AEO WORD band is stated", new RegExp(`4 to ${QUERY_CORE_TARGET_WORDS} words`).test(BRIEF));
check("the AEO hard ceiling is stated", new RegExp(`${QUERY_CORE_MAX_WORDS} is the hard ceiling`).test(BRIEF));
check("the SEO CHARACTER band is stated", new RegExp(`${SEO_TITLE_TARGET_MIN} to ${SEO_TITLE_TARGET_MAX} CHARACTERS`).test(BRIEF));
// ‼️ THE LINE THAT MAKES THE SHARED PROMPT DEFENSIBLE. Every other file in this lane keeps the
// engines apart because in one prompt the shortest rule wins. Here they are together, so the
// brief has to SAY they are two rules and that one must not win.
check("it warns the two rules must not blend", /TWO DIFFERENT LENGTH RULES/.test(BRIEF));
check("it says words versus characters out loud", /measured in WORDS and one in CHARACTERS/.test(BRIEF));
check("the whole AEO engine is in it", BRIEF.includes("RULE 3b - LENGTH"));
check("the whole SEO engine is in it", BRIEF.includes("RULE 1 - THE KEYWORD COMES FIRST"));
check("the confession door is shut in the copy he is handed", BRIEF.includes("A BARE CONFESSIONAL STATEMENT IS NOT A HEADLINE HERE"));
check("every keyword is named", KEYWORDS.every((k) => BRIEF.includes(k)));
check("no em dash anywhere in the brief", !hasBannedDash(BRIEF.replace(/═+/g, "")));

console.log("\n3. the brief dictates a format the parser can read back");
check("it prints the keyword marker", BRIEF.includes(BRIEF_MARKS.KEYWORD_MARK));
check("it prints the AEO marker", BRIEF.includes(BRIEF_MARKS.AEO_MARK));
check("it prints the SEO marker", BRIEF.includes(BRIEF_MARKS.SEO_MARK));

const ANSWER = `Sure, here you go.

=== KEYWORD: how to get my med spa on chatgpt ===
[AEO H1]
1. How Do I Get My Med Spa Recommended by ChatGPT? A 30-Day Plan
2. **Why Isn't My Med Spa Showing Up in ChatGPT?**
3) How Do I Check If ChatGPT Mentions My Clinic?
[SEO TITLE TAG]
1. How to Get Your Med Spa on ChatGPT (2026 Guide)  (47)
2. Get Your Med Spa Into ChatGPT Answers: 2026 Playbook (52 chars)

=== KEYWORD: aeo agency pricing ===
[AEO H1]
1. How Much Does AEO Cost for a Med Spa, and What Should You Get for It?
[SEO TITLE TAG]
1. AEO Agency Pricing: What Med Spas Should Pay in 2026 (52)
`;
const BLOCKS = parseHeadlinePaste(ANSWER);

console.log("\n4. the answer parses back, as a model actually formats it");
check("both keyword blocks", BLOCKS.length === 2);
check("the keyword is clean of the trailing ===", BLOCKS[0]?.keyword === "how to get my med spa on chatgpt");
check("bold markers are stripped", BLOCKS[0]?.aeo[1] === "Why Isn't My Med Spa Showing Up in ChatGPT?");
check("a 3) bracket numbers as well as a 3.", BLOCKS[0]?.aeo.length === 3);
check("a trailing (47) is a measurement, not copy", BLOCKS[0]?.seo[0] === "How to Get Your Med Spa on ChatGPT (2026 Guide)");
check('and so is "(52 chars)"', BLOCKS[0]?.seo[1] === "Get Your Med Spa Into ChatGPT Answers: 2026 Playbook");
check("the preamble is ignored", !JSON.stringify(BLOCKS).includes("Sure, here"));
check("the second block keeps its own lines", BLOCKS[1]?.keyword === "aeo agency pricing" && BLOCKS[1]?.seo.length === 1);
// ‼️ IT PARSES A FORMAT IT ASKED FOR AND NEVER SNIFFS, the rule research-intake.ts states. A
// surface that also takes dictation must not file somebody thinking out loud as a page headline.
check("free text with no markers files NOTHING", parseHeadlinePaste("some headlines\n1. a nice one\n2. another").length === 0);
check("an empty paste files nothing", parseHeadlinePaste("").length === 0);
check("the markers alone, with no lines, file nothing", parseHeadlinePaste(`${BRIEF_MARKS.KEYWORD_MARK} x ===`).length === 0);

console.log("\n5. it returns a prompt and it RUNS nothing");
// ‼️ COMMENTS STRIPPED FIRST, THE SAME RULE _probe-step-rerun.ts KEEPS. This file's own header
// explains what it is NOT allowed to call, by name, so a grep over the raw text finds those names
// in the prose that forbids them and fails for the opposite of the real reason.
const RAW = fs.readFileSync(path.join(process.cwd(), "src/lib/clients/headline-brief.ts"), "utf8");
const SRC = RAW.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
check("no model client is imported", !/callClaudeJSON|anthropic|openai/i.test(SRC));
check(
  "nothing calls a generator",
  !/generateKeywordHeadlines|generateSeoTitlesForPage|generateDrHeadlinesForPage/.test(SRC),
  "this door hands back a prompt; the moment it generates, it is the other door"
);
check("it does write to client_headlines, which is the point of the paste-back", /from\("client_headlines"\)/.test(SRC));
check(`the keyword cap is stated (${BRIEF_MAX_KEYWORDS})`, BRIEF_MAX_KEYWORDS >= 1 && BRIEF_MAX_KEYWORDS <= 11);

console.log("\n6. what he reads back");
const CARD = filedLines({
  aeo: [{ keyword: "aeo agency pricing", planRank: 2, stored: 3, refused: [{ line: "bad one", why: "a 20 word query" }], noted: [] }],
  seo: [{ keyword: "aeo agency pricing", planRank: 2, stored: 2, refused: [], noted: ["short"] }],
  unmatched: ["a keyword with no page"],
});
check("it names the page a keyword landed on", CARD.some((l) => /page 2/.test(l)));
check("a refused line is NAMED, never dropped quietly", CARD.some((l) => /refused: "bad one"/.test(l)));
check("an unmatched keyword is explained", CARD.some((l) => /filed against no page/.test(l)));
check("no banned dash on the card", CARD.every((l) => !hasBannedDash(l)));
check("an empty result says what to do", filedLines({ aeo: [], seo: [], unmatched: [] }).join(" ").includes("Paste the whole answer"));

// ‼️ EVERY LANE APPENDS ABOVE THIS SUMMARY, NEVER BELOW IT.
console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
