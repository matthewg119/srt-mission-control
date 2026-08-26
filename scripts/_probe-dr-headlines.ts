// Probe: the direct-response headline lane. No network, no DB, no API calls.
//
//   bunx tsx scripts/_probe-dr-headlines.ts
//
// The bug this lane was built to fix is invisible in the output: `generateHeadlineOptions`
// returns twenty perfectly well-formed strings whether or not they are direct-response
// headlines, so nothing errors and nothing looks broken. What separates the two artifacts is
// entirely in the PROMPT, so the prompt is what gets asserted here.
//
// !! THE REGRESSION TO CATCH IS THE 8-WORD RULE COMING BACK. It reaches the long-form prompt
// by three different doors: the shared headline swipe, `avatarBlock`'s PROVEN OFFER HEADLINES
// exemplars, and anyone re-pointing `handleDropGo` at `generateHeadlineOptions`. Cases 1, 4
// and 5 cover the three.

import { avatarBlock, repeatedOpenings, approvedNumbersBlock } from "../src/lib/reel/creative-director";
import { DR_HEADLINE_ENGINE } from "../src/data/reel/dr-headline-engine";
import { HEADLINE_SWIPE_GENERIC, headlineSwipeFor } from "../src/data/reel/headline-swipe";
import { parseQuotePaste, normalizeQuote, vocBlock } from "../src/lib/reel/voc-quotes";
import type { Vertical, VocQuote } from "../src/config/verticals";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok && detail) console.log(`          ${detail}`);
}
function eq(name: string, got: unknown, want: unknown) {
  check(
    name,
    JSON.stringify(got) === JSON.stringify(want),
    `want ${JSON.stringify(want)}  got ${JSON.stringify(got)}`
  );
}

const APOS = String.fromCharCode(39); // '
const RSQUO = String.fromCharCode(8217); // right single quote, what Slack rewrites APOS into
const LDQUO = String.fromCharCode(8220);
const RDQUO = String.fromCharCode(8221);

const QUOTES: VocQuote[] = [
  {
    text: "honestly feeling a bit burnt out. spent $1500 last month on FB/IG ads for my med spa.",
    source: "r/MedSpa",
  },
  {
    text: `I${APOS}m so embarrassed about my situation that I${APOS}ve created a throwaway account to post this.`,
    source: "r/MedSpa",
  },
];

const AVATAR = {
  id: "medspa_owner_ai",
  name: "Med Spa Owner AI Visibility (B2B)",
  business_descriptor: "done-for-you AI-search visibility service for independent med spas",
  wearer_role: "clinic owner",
  avatar_summary: "She opened her own clinic and the calendar is not full.",
  beliefs: [{ n: 1, text: "Agencies have taken her money before." }],
  offer: {
    ump: "",
    ums: "",
    big_idea: "One clinic per city gets this seat.",
    belief_chains: [],
    objections: [],
    headlines: [{ title: "ChatGPT named your competitor. Not you." }],
  },
  approved_numbers: [
    "45% of consumers use AI for local recommendations, vs 6% a year ago (BrightLocal, n=1,002, Feb 2026)",
  ],
  voc_quotes: QUOTES,
} as unknown as Vertical;

console.log("\n-- 1. avatarBlock: the exemplar/claims split --");
const asExemplars = avatarBlock(AVATAR);
const asClaims = avatarBlock(AVATAR, { headlinesAs: "claims" });
check("bare call still labels them PROVEN OFFER HEADLINES", asExemplars.includes("PROVEN OFFER HEADLINES"));
check("claims mode does NOT", !asClaims.includes("PROVEN OFFER HEADLINES"));
check("claims mode disowns their shape", asClaims.includes("Do NOT imitate their length"));
check("both still carry the headline text itself", asClaims.includes("ChatGPT named your competitor"));
check(
  "both still carry the avatar summary",
  asClaims.includes("calendar is not full") && asExemplars.includes("calendar is not full")
);

console.log("\n-- 2. vocBlock --");
check("renders the quotes verbatim", vocBlock(AVATAR).includes("spent $1500 last month on FB/IG ads"));
check("attributes the subreddit", vocBlock(AVATAR).includes("(r/MedSpa)"));
check("forbids summarizing, next to the quotes", vocBlock(AVATAR).includes("Do NOT summarize a quote"));
eq("an empty bank renders nothing at all", vocBlock({ voc_quotes: [] }), "");
eq("a null bank renders nothing at all", vocBlock({ voc_quotes: null }), "");

console.log("\n-- 3. the assembled long-form system prompt --");
// Mirrors generateDirectResponseHeadlines' assembly. Kept in step by hand deliberately:
// importing the private builder would make this probe pass by construction.
const SYSTEM = [
  `You are an elite direct-response copywriter working for a ${AVATAR.business_descriptor}.`,
  "Write exactly 20 high-converting DIRECT-RESPONSE headlines for the avatar below.",
  avatarBlock(AVATAR, { headlinesAs: "claims" }),
  vocBlock(AVATAR),
  approvedNumbersBlock(AVATAR),
  DR_HEADLINE_ENGINE,
].join("\n\n");
check("carries the engine", SYSTEM.includes("THE SEVEN LAWS"));
check("carries the 30-angle menu", SYSTEM.includes("Vulnerable Confession"));
check("carries the classic patterns", SYSTEM.includes("They Laughed When I Sat Down At The Piano"));
check("carries the seeded quotes", SYSTEM.includes("throwaway account"));
check("states the real length band", SYSTEM.includes("12 to 45 words"));
check("says the 8-word rule does not apply here", SYSTEM.includes("THERE IS NO 8-WORD RULE"));
check("guards English", SYSTEM.includes("Write in ENGLISH"));
check("bans em dashes", SYSTEM.includes("Never use em dashes"));
check(
  "no em dash anywhere in the assembled prompt",
  !SYSTEM.includes(String.fromCharCode(8212)) && !SYSTEM.includes(String.fromCharCode(8211))
);

console.log("\n-- 4. the 8-word rule must not reach the long-form prompt --");
check("prompt never says '8 words or fewer'", !SYSTEM.includes("8 words or fewer"));
check(
  "the on-screen swipe is NOT in it",
  !SYSTEM.includes("HEADLINE PRINCIPLES (direct-response swipe, distilled)")
);
check("but the on-screen swipe still keeps its own cap", HEADLINE_SWIPE_GENERIC.includes("8 words or fewer"));

console.log("\n-- 5. headlineSwipeFor: pest examples stay in pest --");
check("pest avatar still gets termites", headlineSwipeFor({ id: "pest_control" }).includes("termite"));
check("pest_owner_ai too", headlineSwipeFor({ id: "pest_owner_ai" }).includes("colony"));
check("med spa gets NO pest examples", !/termite|roach|colony|mud tubes/i.test(headlineSwipeFor(AVATAR)));
check("med spa still gets the patterns", headlineSwipeFor(AVATAR).includes(`"How to ___ without ___"`));

console.log("\n-- 6. parseQuotePaste --");
const blockPaste = [
  `"I${APOS}m at a loss and don${APOS}t understand what I${APOS}m doing wrong."`,
  "Fuente: https://www.reddit.com/r/MedSpa/comments/1c1107g/",
  "",
  `"I own two med spas. I have spent countless dollars on ineffective marketing." (r/MedSpa)`,
].join("\n");
const parsedBlocks = parseQuotePaste(blockPaste);
eq("blank-line-separated: 2 quotes", parsedBlocks.length, 2);
check("multi-line quote is not shredded", parsedBlocks[0].text.startsWith(`I${APOS}m at a loss`));
check("a Fuente: line becomes the source", parsedBlocks[0].source?.includes("reddit.com") === true);
check("an inline (r/MedSpa) becomes the source", parsedBlocks[1].source === "r/MedSpa");
check("wrapping quote marks are stripped", !parsedBlocks[1].text.startsWith(`"`));

const linePaste = [
  `"I did everything and managed everything myself, start to finish." (r/MedSpa)`,
  `"I need help but not sure whom to ask or hire, and I am running out of time." (r/MedSpa)`,
].join("\n");
eq("one-per-line fallback when there is no blank line", parseQuotePaste(linePaste).length, 2);
eq(
  "document numbering is stripped",
  parseQuotePaste(`12. "I started a medspa about a year ago, entirely solo."`)[0].text.startsWith("I started"),
  true
);
eq("a bare URL is not a quote", parseQuotePaste("https://www.reddit.com/r/MedSpa/").length, 0);
eq("a short fragment is not a quote", parseQuotePaste("thanks").length, 0);
eq("empty in, empty out", parseQuotePaste("   ").length, 0);

console.log("\n-- 7. dedupe survives Slack's curly quotes --");
const straight = `I${APOS}m at a loss and don${APOS}t understand what I${APOS}m doing wrong.`;
const curly = `I${RSQUO}m at a loss and don${RSQUO}t understand what I${RSQUO}m doing wrong.`;
eq("curly and straight normalize to one key", normalizeQuote(straight), normalizeQuote(curly));
eq(
  "wrapped in curly double quotes too",
  normalizeQuote(`${LDQUO}Hello there${RDQUO}`),
  normalizeQuote(`"Hello there"`)
);
eq("re-wrapped whitespace normalizes", normalizeQuote("a  b\nc"), normalizeQuote("a b c"));
check("different quotes do NOT collide", normalizeQuote(straight) !== normalizeQuote("I own two med spas."));

console.log("\n-- 8. repeatedOpenings warns, and only past twice --");
eq("twice is fine", repeatedOpenings(["Why your ads fail", "Why your ads died", "Stop doing this"]), []);
eq(
  "three times is flagged",
  repeatedOpenings(["Why your ads fail", "Why your ads died", "Why your ads stall"]),
  ["why your ads"]
);
eq("empty in, empty out", repeatedOpenings([]), []);
check(
  "punctuation does not defeat it",
  repeatedOpenings(["Why your ads, fail", "Why your ads: died", "Why your ads. stall"]).length === 1
);

console.log("\n-- 9. approvedNumbersBlock: no invented statistics --");
// The first live run returned "In 2024, 45 Percent of Local Searches Start With an AI Prompt"
// (a real figure restated as a different claim, with the wrong year), plus "within 90 days"
// and "the next 15 years". `approved_numbers` already held the true list and no headline
// prompt had ever been given it.
const withNums = approvedNumbersBlock(AVATAR);
check("prints the closed list", withNums.includes("APPROVED NUMBERS"));
check("carries the stat with its source attached", withNums.includes("BrightLocal, n=1,002, Feb 2026"));
check("forbids restating a number as something else", withNums.includes("Do not restate one as something else"));
check("forbids changing its year", withNums.includes("change its year"));
check("bans performance timeframes", withNums.includes("performance timeframes"));
const noNums = approvedNumbersBlock({ approved_numbers: [] });
check("an empty list forbids ALL figures", noNums.includes("NO approved statistics"));
check("an empty list never prints an APPROVED header", !noNums.includes("APPROVED NUMBERS"));
check("an undefined list behaves like an empty one", approvedNumbersBlock({}).includes("NO approved statistics"));
check("the assembled prompt carries the gate", SYSTEM.includes("APPROVED NUMBERS"));

console.log(failures ? `\n${failures} FAILED\n` : "\nall checks passed\n");
process.exit(failures ? 1 : 0);
