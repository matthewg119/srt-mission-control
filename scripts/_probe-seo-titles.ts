// Probe: the title tag lane, the third of the three headline artifacts. No network, no DB, no API.
//
//   bun --no-env-file run scripts/_probe-seo-titles.ts
//
// ‼️ THE REGRESSION TO CATCH IS THE THREE FORMATS CONVERGING. A title tag, a page H1 and an ad
// hook are three artifacts for three readers with three length contracts, and the whole reason
// each has its own engine constant and its own fault function is that in one prompt the shortest
// rule wins every run. Section 5 is the load-bearing one: it asserts that the H1's word band is
// NOT in this prompt and that this prompt's character budget is NOT in the H1's.
//
// ‼️ THE SECOND REGRESSION IS THE FLOOR BECOMING A REFUSAL. Two of Matthew's five worked title
// tags are 47 and 41 characters, under the 50 the brief named, so he was asked and chose a hard
// ceiling with a soft floor on 2026-10-08. A hard 50 floor rejects his own quality bar, and the
// visible symptom would be padding: "(2026 Guide to Getting Found)" bolted onto a finished line
// to reach a number. Section 1 holds his five; section 2 holds the floor open.

import {
  keywordStartsWithin,
  seoTitleFaults,
  seoTitleLength,
  seoTitleLines,
  seoTitlePrompt,
  titleOpeningAfterKeyword,
  seoTitleWarnings,
  SEO_ORIGIN,
  SEO_TITLES_PER_PAGE,
} from "../src/lib/clients/page-seo-titles";
import {
  SEO_TITLE_ENGINE,
  SEO_TITLE_HARD_MIN,
  SEO_TITLE_KEYWORD_BY_WORD,
  SEO_TITLE_TARGET_MAX,
  SEO_TITLE_TARGET_MIN,
  loadSeoTitleEngine,
} from "../src/data/reel/seo-title-engine";
import { AEO_HEADLINE_ENGINE } from "../src/data/reel/aeo-headline-engine";
import { DR_HEADLINE_ENGINE } from "../src/data/reel/dr-headline-engine";
import type { PlanRow } from "../src/lib/clients/page-plan";
import type { HeadlineContext } from "../src/lib/clients/client-headlines";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok && detail) console.log(`          ${detail}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Matthew's own five, 2026-10-07. THE POSITIVE FIXTURE: every one must pass.
// If a rule here rejects one of these, the rule is wrong, not the title.
// ─────────────────────────────────────────────────────────────────────────────
const GOOD: Array<{ keyword: string; title: string }> = [
  { keyword: "how to get my med spa on chatgpt", title: "How to Get Your Med Spa on ChatGPT (2026 Guide)" },
  { keyword: "aeo agency pricing", title: "AEO Agency Pricing: What Med Spas Should Pay in 2026" },
  { keyword: "ai search vs google search", title: "AI Search vs Google Search: What Changes for Med Spas" },
  { keyword: "chatgpt local business ranking", title: "How ChatGPT Ranks Local Businesses (2026)" },
  { keyword: "facebook ads not working for med spa", title: "Facebook Ads Not Working for Your Med Spa? Read This" },
];

console.log("\n1. Matthew's five title tags all pass");
for (const { keyword, title } of GOOD) {
  const faults = seoTitleFaults([title], 1, keyword);
  check(`      (${seoTitleLength(title)}c) ${title}`, faults.length === 0, faults.join("; "));
}

console.log("\n2. The ceiling refuses and the floor does not");
check(
  `      over ${SEO_TITLE_TARGET_MAX} characters is refused, because Google truncates it`,
  seoTitleFaults(["Why Your Med Spa Is Invisible in ChatGPT and What It Costs You Every Month"], 1, "med spa").length > 0
);
check(
  `      exactly ${SEO_TITLE_TARGET_MAX} passes`,
  seoTitleFaults(["AEO Agency Pricing: What Med Spas Should Pay Here in 2026"], 1, "aeo agency pricing").length === 0,
  `that fixture is ${seoTitleLength("AEO Agency Pricing: What Med Spas Should Pay Here in 2026")} characters`
);
// ‼️ HIS OWN TWO SHORT ONES. A hard floor here would reject the quality bar this file holds.
check(
  `      47 characters passes and is only NOTED, not refused`,
  seoTitleFaults(["How to Get Your Med Spa on ChatGPT (2026 Guide)"], 1, "how to get my med spa on chatgpt").length === 0 &&
    seoTitleWarnings(["How to Get Your Med Spa on ChatGPT (2026 Guide)"]).length === 1
);
check(
  `      41 characters too`,
  seoTitleFaults(["How ChatGPT Ranks Local Businesses (2026)"], 1, "chatgpt local business ranking").length === 0 &&
    seoTitleWarnings(["How ChatGPT Ranks Local Businesses (2026)"]).length === 1
);
check(
  `      but under ${SEO_TITLE_HARD_MIN} is a fragment and IS refused`,
  seoTitleFaults(["Med Spa SEO"], 1, "med spa").length > 0
);
check(
  `      a title inside ${SEO_TITLE_TARGET_MIN} to ${SEO_TITLE_TARGET_MAX} is noted about nothing`,
  seoTitleWarnings(["AEO Agency Pricing: What Med Spas Should Pay in 2026"]).length === 0
);

console.log("\n3. The keyword leads, which is his page rule 2");
check(
  "      the keyword at word one is fine",
  keywordStartsWithin("Facebook Ads Not Working for Your Med Spa? Read This", "facebook ads not working for med spa")
);
check(
  `      at word four is fine, because the rule is "first 3-5 words"`,
  keywordStartsWithin("How to Get Your Med Spa on ChatGPT (2026 Guide)", "how to get my med spa on chatgpt")
);
check(
  "      past word five is not",
  !keywordStartsWithin("What Med Spas Should Pay an AEO Agency for Pricing", "aeo agency pricing")
);
check(
  "      and that is a fault, not a note",
  seoTitleFaults(["What Med Spas Should Pay an AEO Agency for Pricing in 2026"], 1, "aeo agency pricing").length > 0
);
check(
  "      a title missing the keyword entirely is refused",
  seoTitleFaults(["What Changes for Clinics in 2026, According to Research"], 1, "med spa chatgpt").length > 0
);
// ‼️ INFLECTION COUNTS AS THE KEYWORD, AND WITHOUT THIS HIS OWN TITLE FAILS. "Ranks Local
// Businesses" against `chatgpt local business ranking` disagrees in two words at once, which is
// why keywordFamily does a cross product rather than one swap at a time.
check(
  "      an inflected keyword still counts: Businesses for business, Ranks for ranking",
  seoTitleFaults(["How ChatGPT Ranks Local Businesses (2026)"], 1, "chatgpt local business ranking").length === 0
);

console.log("\n4. No hype, no open loop, and no ad voice (his page rules 3 and 10)");
for (const [title, why] of [
  ["You Won't Believe What ChatGPT Says About Your Med Spa", "clickbait"],
  ["The Secret Algorithm Deciding Which Med Spa ChatGPT Names", "a withheld subject"],
  ["Med Spa Marketing: Here's Why Your Ads Stopped Working", "an open loop"],
  ["Med Spa Owners: Nobody Tells You This About AI Search", "a withheld-knowledge tease"],
  ["This One Trick Gets Your Med Spa Into ChatGPT Answers", "a one-trick tease"],
  ["Med Spa Ads: The Shocking Truth About Where Leads Go", "hype wording"],
  ["Med Spa Owners So Embarrassed They Use Throwaway Accounts", "confession wording"],
  ["Med Spa Leads Ghosting You? Why It Keeps On Happening", "ad copy wording"],
  ["My Med Spa Was Invisible in ChatGPT Until I Did This", "first person"],
] as const) {
  check(`      refused (${why}): ${title.slice(0, 46)}`, seoTitleFaults([title], 1, "med spa").length > 0);
}
check(
  "      an em dash is refused",
  seoTitleFaults([`Med Spa AEO ${String.fromCharCode(8212)} What to Pay in 2026`], 1, "med spa").length > 0
);
// ‼️ THE REPEAT RULE IS COUNTED AFTER THE KEYWORD, AND COUNTING IT FROM WORD ONE WAS A RULE THAT
// COULD NEVER BE SATISFIED. Rule 1 requires the keyword inside the first five words, so every
// title in a batch front-loads the same phrase BY DESIGN. Measured from word one it fired on
// every batch ever written: the first live run on `ai search ranking factors` (2026-10-09)
// returned six good titles and the fault '"ai search ranking" opens 6 titles'. Both halves are
// pinned here, because a rule that cannot be satisfied is worse than no rule.
const SAME_OPENING = [
  "AI Search Ranking Factors for Med Spas (2026)",
  "AI Search Ranking Factors: What Med Spas Must Know",
  "AI Search Ranking Factors Explained for Med Spas 2026",
  "AI Search Ranking Factors: A 2026 Med Spa Guide",
  "AI Search Ranking Factors That Decide Who Gets Named",
  "AI Search Ranking Factors for Med Spa Owners (2026)",
];
check(
  "      six titles that all LEAD with the keyword are clean, because rule 1 requires that",
  seoTitleFaults(SAME_OPENING, 6, "ai search ranking factors").length === 0,
  seoTitleFaults(SAME_OPENING, 6, "ai search ranking factors").join(" | ")
);
check(
  "      but titles that are the same AFTER the keyword are refused",
  seoTitleFaults(
    [
      "Med Spa AEO Pricing: What to Pay in 2026 for This",
      "Med Spa AEO Pricing: What to Pay in 2027 for That",
      "Med Spa AEO Pricing: What to Pay Later On This Year",
    ],
    0,
    "med spa aeo pricing"
  ).some((f) => /after the keyword/.test(f))
);
check(
  "      the opening is measured past the keyword's own words",
  titleOpeningAfterKeyword("AI Search Ranking Factors That Decide Who Gets Named", "ai search ranking factors") ===
    "that decide who"
);
check(
  "      a title that is only the keyword has no opening to count",
  titleOpeningAfterKeyword("AEO Agency Pricing", "aeo agency pricing") === ""
);
check("      a short count is reported when one was asked for", seoTitleFaults(GOOD.map((g) => g.title), 6, "").length > 0);

// ─────────────────────────────────────────────────────────────────────────────
// 5. THE LOAD-BEARING SECTION: four engines, four contracts, never merged
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. The four length contracts never meet in one prompt");

const CTX = {
  clientName: "Test Clinic",
  city: "Austin",
  businessType: "med spa",
  avatarLabel: "solo NP owner",
  treatment: null,
  positioning: null,
  framework: null,
  approvedNumbers: [],
  quotes: [],
} as unknown as HeadlineContext;

const ROW = {
  id: "row-1",
  rank: 3,
  workingTitle: "AEO agency pricing for med spas",
  targetKeyword: "aeo agency pricing",
  headline: "How Much Does AEO Cost for a Med Spa?",
} as unknown as PlanRow;

const prompt = seoTitlePrompt({ ctx: CTX, row: ROW, keyword: "aeo agency pricing", angle: null, count: 6 });

check("      the prompt carries its own character budget", /50 to 60 characters/i.test(prompt));
check("      and the keyword position rule", new RegExp(`first ${SEO_TITLE_KEYWORD_BY_WORD} words`).test(prompt));
check("      and names the page's keyword", prompt.includes("aeo agency pricing"));
// ‼️ EACH OF THESE THREE IS A DIFFERENT WAY THE SAME BUG ARRIVES. The 8-word reel rule, the DR
// engine's 12 to 45, and the H1's 4 to 12 all reach a prompt by somebody appending a shared
// block, and whichever is shortest silently wins. The DR lane's own probe guards the mirror case.
check("      the 8-word reel rule is NOT in it", !/8 words or fewer/.test(prompt));
check("      the DR 12 to 45 word rule is NOT in it", !/12 to 45 words/.test(prompt));
check("      the H1's 4 to 12 word core rule is NOT in it", !/4 to 12 words/.test(prompt));
check(
  "      and this engine's character budget is NOT in the H1's engine",
  !/50 to 60 characters/i.test(AEO_HEADLINE_ENGINE)
);
check(
  "      nor in the DR engine",
  !/50 to 60 characters/i.test(DR_HEADLINE_ENGINE)
);
check(
  "      the H1 names the title tag as a SEPARATE artifact rather than banning the shape",
  /TITLE TAG/.test(AEO_HEADLINE_ENGINE)
);
check("      the prompt names the page's H1 so it is not repeated", prompt.includes("How Much Does AEO Cost for a Med Spa?"));
// The quotes are deliberately absent here: a title tag may not carry confession wording at all,
// so handing this call 24 Reddit quotes would be handing it what its own rule 4 forbids.
check("      no voice-of-customer block reaches this prompt", !/VOICE OF CUSTOMER|Do NOT summarize a quote/i.test(prompt));
// The LOADED engine, not the bare constant: this avatar is a "solo NP owner", which does not
// match the examples' buyer, so the loader appends the "examples are shape only" tail and that
// tail is correctly the last thing in the prompt.
check(
  "      the engine goes in last and whole",
  prompt.trimEnd().endsWith(loadSeoTitleEngine({ avatarLabel: "solo NP owner" }).trimEnd())
);
check("      and the whole engine is in there", prompt.includes(SEO_TITLE_ENGINE));
check("      no em dash anywhere in the assembled prompt", !/[—–]/.test(prompt));

console.log("\n6. The engine's examples are a med spa's, and another buyer is told so");
check("      a med spa owner gets the engine as it is", loadSeoTitleEngine({ avatarLabel: "med spa owner" }) === SEO_TITLE_ENGINE);
check(
  "      any other buyer is told the examples are shape only",
  loadSeoTitleEngine({ avatarLabel: "dentist" }).includes("THE EXAMPLES ABOVE ARE WRITTEN FOR A MED SPA OWNER")
);
check("      an absent label gets the engine as it is", loadSeoTitleEngine() === SEO_TITLE_ENGINE);

console.log("\n7. The lane's own constants and card");
check(`      six per page, the same number the H1 lane writes`, SEO_TITLES_PER_PAGE === 6);
check(`      its own origin, so the H1 picker can never offer one`, SEO_ORIGIN === "seo_title");
const card = seoTitleLines(ROW, [GOOD[1].title, GOOD[3].title]);
check("      the card says which artifact these are", card.join("\n").includes("what Google prints"));
check("      and that the page keeps its own H1", card.join("\n").includes("keeps its own H1"));
check("      it numbers them", card.some((l) => /^\s+1\./.test(l)));
check("      it prints the character count, which is the thing being judged", card.some((l) => /\(\d+ chars\)/.test(l)));
check("      it carries the short note for the 41 character one", card.some((l) => /note:/.test(l)));
check("      no banned dash on the card", !/[—–]/.test(card.join("\n")));
check("      an empty bank says so rather than printing an empty list", seoTitleLines(ROW, []).join(" ").includes("no title tags"));

// ‼️ EVERY LANE APPENDS ABOVE THIS SUMMARY, NEVER BELOW IT. scripts/_probe-dm-pitch.ts records
// what happens otherwise: five checks once sat under the exit and never ran.
console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
