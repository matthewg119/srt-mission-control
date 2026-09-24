// The headline-first page, proved offline: placement, section length, and the [Pn] router.
//
//   bunx tsx scripts/_probe-headline-page.ts
//
// NO MODEL CALL, NO WRITES, NO NETWORK, AND NO DATABASE. Every function under test here is pure
// by design, which is the reason they were written that way: the rules they encode are the ones
// that decide whether seven pages a day are worth publishing, and a rule that can only be checked
// against production is a rule nobody checks.
//
// WHAT IT PROVES
//  1. keywordSlug strips the words that make a URL longer without making it different.
//  2. carriesKeyword matches on CONTENT WORDS, not on the string, and does not match a prefix.
//  3. All eight placement slots, including the two that are skipped rather than failed.
//  4. Per-section character bounds, measured per section rather than across the page.
//  5. Outline divergence and the what/why/how floor.
//  6. The [Pn] batch-research router, including untagged, mid-line and unknown tags.
//
// The section-length fixtures are built rather than typed out, because a 250-character string in
// source is unreadable and a person maintaining it would get the boundary wrong by a character.

import {
  keywordSlug,
  carriesKeyword,
  carriesAnyKeyword,
  checkPlacement,
  firstSentence,
  h2Headings,
} from "../src/lib/hub/keyword-placement";
import {
  SECTION_CHARS,
  OUTLINE_LIMITS,
  bodySections,
  sectionLengthFaults,
  outlineFaults,
  convergentSubject,
  shapesCovered,
} from "../src/lib/hub/draft-page";
import { splitTaggedResearch, batchIngestLine } from "../src/lib/clients/batch-research";
import { BATCH_COMMAND, HEADLINE_COMMAND, SKELETON_COMMAND } from "../src/lib/clients/page-batch";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

/** A block of exactly `n` characters of plausible prose, so a boundary test is exact. */
function prose(n: number): string {
  const unit = "She asked what it costs and how long it lasts, so the page answers both. ";
  return unit.repeat(Math.ceil(n / unit.length)).slice(0, n);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n1. keywordSlug strips what does not distinguish");

check(
  "question words and stopwords go",
  keywordSlug("how long does lip filler last") === "long-lip-filler-last",
  keywordSlug("how long does lip filler last")
);
// ‼️ "website" GOES, AND THAT IS CORRECT RATHER THAN A LOSS. It is in gbp-audit.ts's STOPWORDS,
// and on a URL that is itself a page of a website the word distinguishes nothing.
check(
  "the content words survive in order",
  keywordSlug("what does chatgpt read on a med spa website") === "chatgpt-read-med-spa",
  keywordSlug("what does chatgpt read on a med spa website")
);
check("punctuation does not become a separator run", !/--/.test(keywordSlug("what is it, really?")));
check("no leading or trailing dash", !/^-|-$/.test(keywordSlug("how is it done?")));
// ‼️ AN EMPTY SLUG IS WORSE THAN A NOISY ONE. A phrase that is entirely stopwords has to come
// back as something, or the page is published at the client's root.
check("an all-stopword phrase keeps the whole phrase", keywordSlug("how does it") !== "", keywordSlug("how does it"));
check("accents fold", keywordSlug("chemical peel for melasma") === "chemical-peel-melasma", keywordSlug("chemical peel for melasma"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n2. carriesKeyword reads content words, not the string");

check(
  "the exact phrase matches",
  carriesKeyword("How long does lip filler last?", "how long does lip filler last")
);
// ‼️ THE MEASURED FAILURE THE WHOLE-STRING TEST HAD, recorded in _probe-page-plan.ts for
// plan-links.ts. Repeating it here would be the same mistake twice.
check(
  "the words in another order still match",
  carriesKeyword("Lip filler: how long will it actually last?", "how long does lip filler last")
);
check(
  "a missing content word does not match",
  !carriesKeyword("How long does Botox last?", "how long does lip filler last")
);
check("a prefix is not a match", !carriesKeyword("a spacious waiting room", "spa"));
check("empty text never matches", !carriesKeyword("", "lip filler"));
check("null text never matches", !carriesKeyword(null, "lip filler"));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3. All eight placement slots");

const KEYWORD = "lip filler swelling";
const goodBody = [
  `Lip filler swelling is normal for the first two days. ${prose(200)}`,
  "",
  "## How long does lip filler swelling last",
  prose(300),
  "",
  "## What you can do about it",
  prose(300),
].join("\n");

const full = checkPlacement({
  keyword: KEYWORD,
  slug: "lip-filler-swelling",
  title: "Lip filler swelling, and how long it lasts",
  h1: "Why is my lip filler swelling this much?",
  metaDescription: "Lip filler swelling settles in about two days. Here is what is normal.",
  answerMd: goodBody,
  pillarAnchor: "Lip filler swelling",
  schema: '{"headline":"Why is my lip filler swelling this much?"}',
});
check("a fully placed keyword reaches all eight", full.missing.length === 0 && full.present.length === 8, full.detail);

const noMeta = checkPlacement({
  keyword: KEYWORD,
  slug: "lip-filler-swelling",
  title: "Lip filler swelling, and how long it lasts",
  h1: "Why is my lip filler swelling this much?",
  metaDescription: "Everything you need to know before your appointment.",
  answerMd: goodBody,
  pillarAnchor: "Lip filler swelling",
  schema: '{"headline":"x"}',
});
check("a missing meta is named", noMeta.missing.includes("meta"), noMeta.detail);
check("and the slug is not blamed for it", !noMeta.missing.includes("slug"));

// ‼️ A SLOT THAT DOES NOT APPLY IS NEITHER PRESENT NOR MISSING. A pillar has no pillar linking
// it. Counting that as a fault teaches a person to ignore this check on every pillar they write.
const pillar = checkPlacement({
  keyword: KEYWORD,
  slug: "lip-filler-swelling",
  title: "Lip filler swelling",
  h1: null,
  metaDescription: "Lip filler swelling, explained.",
  answerMd: goodBody,
  pillarAnchor: null,
  schema: null,
});
check("an absent pillar anchor is skipped, not failed", !pillar.missing.includes("pillar_anchor"));
check("and so are an absent h1 and schema", !pillar.missing.includes("h1") && !pillar.missing.includes("schema"));
check("a pillar with everything else placed has no faults", pillar.missing.length === 0, pillar.detail);

// ─────────────────────────────────────────────────────────────────────────────
// 3b. THE PHRASE FAMILY. Matthew, 2026-09-23: "Google understands that 'get more reviews',
// 'increase patient reviews' and 'review generation' mean the same thing, so one well-written page
// can rank for dozens of related phrases, not just the one you picked."
//
// This is his own example, written the way a person would actually write it, and the point of the
// section is that WITHOUT the family this page is reported as faulty and the only way to clear the
// report is to weld the exact phrase into the subheads, which keyword_shaped then fails it for.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n3b. a natural variation counts as the keyword");

const REVIEWS = "get more google reviews";
const FAMILY = ["increase patient reviews", "review generation", "asking patients for reviews"];

const naturalBody = [
  `Getting more Google reviews for a med spa comes down to when you ask. ${prose(200)}`,
  "",
  "## Asking patients for reviews without the awkward pause",
  prose(300),
  "",
  "## What review generation looks like over a month",
  prose(300),
].join("\n");

const naturalArgs = {
  keyword: REVIEWS,
  slug: "more-google-reviews-med-spa",
  title: "How to get more Google reviews for a med spa",
  h1: "How to get more Google reviews for a med spa (without awkward asks)",
  metaDescription: "How to increase patient reviews without the awkward ask.",
  answerMd: naturalBody,
  pillarAnchor: "Get more Google reviews",
  schema: '{"headline":"How to get more Google reviews for a med spa"}',
} as const;

const without = checkPlacement({ ...naturalArgs });
const withFamily = checkPlacement({ ...naturalArgs, variants: FAMILY });

check(
  "without the family, a naturally written page is reported as missing its subheads",
  without.missing.includes("h2"),
  without.detail
);
check(
  "without the family, the meta description is blamed too",
  without.missing.includes("meta"),
  without.detail
);
check("with the family, the page is clean", withFamily.missing.length === 0, withFamily.detail);
check("and the detail says the variations counted", /variation/.test(withFamily.detail), withFamily.detail);

// ‼️ THE SLUG IS THE ONE SLOT THE FAMILY MUST NOT OPEN UP. Every other slot asks "is this page
// about that subject". The URL is one permanent string built from the primary keyword, and a slug
// matching only a variant would mean the plan and the address disagree about what was chosen.
const variantSlug = checkPlacement({
  ...naturalArgs,
  slug: "review-generation",
  variants: FAMILY,
});
check(
  "a slug carrying only a VARIANT is still reported",
  variantSlug.missing.includes("slug"),
  variantSlug.detail
);

// An empty family must behave exactly as the file did before it existed.
const emptyFamily = checkPlacement({ ...naturalArgs, variants: [] });
check(
  "an empty family changes nothing",
  emptyFamily.missing.join(",") === without.missing.join(","),
  `${emptyFamily.missing.join(",")} vs ${without.missing.join(",")}`
);
check(
  "a family of blank strings is ignored rather than matching everything",
  checkPlacement({ ...naturalArgs, variants: ["", "  "] }).missing.includes("h2")
);

// carriesAnyKeyword is the sibling, and carriesKeyword must be unchanged: client-headlines.ts uses
// it as a HARD validator that a kept headline still carries the keyword it was written for.
check(
  "carriesKeyword still refuses a synonym on its own",
  !carriesKeyword("asking patients for reviews", REVIEWS)
);
check(
  "carriesAnyKeyword accepts it once the family is supplied",
  carriesAnyKeyword("asking patients for reviews", REVIEWS, FAMILY)
);

check("firstSentence skips headings", firstSentence(goodBody).startsWith("Lip filler swelling is normal"));
check("h2Headings finds both", h2Headings(goodBody).length === 2, h2Headings(goodBody).join(" | "));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n4. Section length, measured per section");

const opening = prose(SECTION_CHARS.min + 20);
const body = (...sections: string[]) =>
  [opening, ...sections.map((s, i) => `\n## Heading ${i + 1}\n${s}`)].join("\n");

check("sections split on ## and the opening counts as one", bodySections(body(prose(300), prose(300))).length === 3);
check("a legal page has no faults", sectionLengthFaults(body(prose(300), prose(400))).length === 0);
check(
  `${SECTION_CHARS.min - 1} characters is under the floor`,
  sectionLengthFaults(body(prose(SECTION_CHARS.min - 1))).some((f) => f.includes("at least"))
);
check(`exactly ${SECTION_CHARS.min} passes`, sectionLengthFaults(body(prose(SECTION_CHARS.min))).length === 0);
check(`exactly ${SECTION_CHARS.max} passes`, sectionLengthFaults(body(prose(SECTION_CHARS.max))).length === 0);
check(
  `${SECTION_CHARS.max + 1} characters is over the ceiling`,
  sectionLengthFaults(body(prose(SECTION_CHARS.max + 1))).some((f) => f.includes("two questions"))
);

// ‼️ THE WHOLE REASON THE FLAT WORD FLOOR WENT. This page clears 120 words easily and is mostly
// captions, and the old `>= 120 words` on the whole body passed it.
const lopsided = body(prose(600), prose(40), prose(40), prose(40), prose(40), prose(40));
check("one full section cannot carry five thin ones", sectionLengthFaults(lopsided).length === 5, `${sectionLengthFaults(lopsided).length} faults`);
check("and every thin section is named at once", sectionLengthFaults(lopsided).every((f) => f.includes("at least")));

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n5. Outline divergence and the what/why/how floor");

check('"What it costs" is convergent on price', convergentSubject("What it costs") === "price");
check('"Is it painful" is convergent on fear', convergentSubject("Is it painful") === "fear");
check('"Botox vs filler" is convergent on comparison', convergentSubject("Botox vs filler") === "comparison");
check('"What to expect at your appointment" is convergent on process', convergentSubject("What to expect at your appointment") === "process");
check('"How the product settles into the tissue" is divergent', convergentSubject("How the product settles into the tissue") === null);
// ‼️ WHOLE WORDS ONLY. "processing" is not "process" and "compared" is not "compare", or the
// divergence floor fails on headings that are plainly about their own subject.
check('"How your body processes it" is not caught by "process"', convergentSubject("How your body processes it") === null);

check("shapesCovered reads the FIRST word", shapesCovered(["What it is", "Why it matters", "How it works"]).size === 3);
check(
  "a question word mid-heading does not count",
  !shapesCovered(["The cost of knowing what to expect"]).has("what")
);

const outline = (headings: string[]) => ({
  sections: headings.map((heading, i) => ({
    heading,
    keyword: `long tail phrase number ${i + 1}`,
    bullets: ["A note about it", "Another note [G1]"],
  })),
  gaps: [
    { id: "G1", prompt: "What do you charge?", scope: "client" },
    { id: "G2", prompt: "Who does it?", scope: "client" },
    { id: "G3", prompt: "How long have you done it?", scope: "client" },
  ],
});

// G2 and G3 are unreferenced in this helper, so these fixtures assert on the SPECIFIC fault
// rather than on emptiness.
const divergentSet = [
  "What lip filler actually is",
  "Why it settles the way it does",
  "How the product is placed",
  "What it costs",
  "Which product suits which lip",
  "What happens as it wears off",
];
check(
  `${OUTLINE_LIMITS.minDivergent} divergent headings pass the floor`,
  !outlineFaults(outline(divergentSet), "").some((f) => f.includes("something other than price"))
);
check(
  "four convergent headings trip it",
  outlineFaults(outline(["What it costs", "Is it safe", "Botox vs filler", "What to expect", "How much does it hurt", "Why it is worth the price"]), "")
    .some((f) => f.includes("something other than price"))
);
check(
  "a missing Why is named",
  outlineFaults(outline(["What it is", "What it does", "How it works", "What it costs", "Which one suits", "What happens after"]), "")
    .some((f) => f.includes('"Why"'))
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n6. The [Pn] batch-research router");

const pasted = [
  "Here is what I found across the seven pages.",
  "",
  "[P1] Most people report swelling for two days.",
  "Source: https://example.com/thread",
  "",
  "[P2] Could not verify any figure for this.",
  "",
  "Their pricing page lists a consultation fee, which applies to every page.",
  "",
  "[P9] Something about a page that is not in this batch.",
].join("\n");

const sections = splitTaggedResearch(pasted);
check("the preamble is untagged", sections[0].position === null, JSON.stringify(sections[0]));
check("P1 is routed", sections[1].position === 1);
// ‼️ THE ANSWER'S SECOND LINE BELONGS TO THE ANSWER. Splitting on blank lines would have made
// the source URL its own untagged row and lost the link from the finding.
check("and keeps its source line", sections[1].text.includes("https://example.com/thread"), sections[1].text);
check("P2 is routed", sections[2].position === 2);
check("the untagged paragraph after P2 stays with P2", sections[2].text.includes("consultation fee"));
check("an unknown tag is still a section", sections.some((s) => s.position === 9));

const midLine = splitTaggedResearch("The answer is the same as [P2] above, so see there.");
check("a tag mid-line is a reference, not a section", midLine[0].position === null, JSON.stringify(midLine[0]));

check("empty text yields nothing", splitTaggedResearch("   \n\n  ").length === 0);

const line = batchIngestLine(
  { routed: 41, library: 2, unknownTags: [9], withUrl: 0, silentPages: [5, 6] },
  7
);
check("zero URLs raises the alarm", line.includes("Not one answer carries a URL"));
// ‼️ THE COUNT A TOTAL CAN NEVER SHOW. 41 answers looks healthy whether it covers seven pages
// or five.
check("silent pages are named", line.includes("pages 5, 6"), line);
check("an unknown tag is reported", line.includes("page 9"), line);
check(
  "a healthy run raises nothing",
  !batchIngestLine({ routed: 41, library: 2, unknownTags: [], withUrl: 38, silentPages: [] }, 7).includes(":warning:")
);

// ─────────────────────────────────────────────────────────────────────────────
console.log("\n7. The batch grammar, and the dictation it must not swallow");

// ‼️ COPIES OF THE PRODUCTION REGEXES, imported rather than retyped. page-studio.ts's dispatch
// appends anything that is not a command to the page VERBATIM, so a pattern one character too
// loose does not throw: it eats a sentence and puts nothing on screen to say it did. Three
// separate live captures are recorded in that file's comments. These three verbs are new, and
// `batch` and `skeleton` are both ordinary words in a channel about writing pages.
const batchCases: Array<[string, boolean]> = [
  ["batch", true],
  ["batch new", true],
  ["batch approve", true],
  ["batch under 3", true],
  ["batch the next seven pages tomorrow", false],
  ["batching these together would be faster", false],
  ["we should batch approve everything at once", false],
];
for (const [typed, expected] of batchCases) {
  check(`BATCH_COMMAND on ${JSON.stringify(typed)} is ${expected}`, BATCH_COMMAND.test(typed) === expected);
}

const headlineCases: Array<[string, boolean]> = [
  ["headline 3 pick 2", true],
  ["headline 12 more", true],
  ["headline 3", false],
  ["headlines are the hardest part", false],
  ["headline the pillar page differently", false],
];
for (const [typed, expected] of headlineCases) {
  check(`HEADLINE_COMMAND on ${JSON.stringify(typed)} is ${expected}`, HEADLINE_COMMAND.test(typed) === expected);
}

const skeletonCases: Array<[string, boolean]> = [
  ["skeleton", true],
  ["skeleton 3 more", true],
  ["skeletons take longer than drafts", false],
  ["skeleton of the page is fine", false],
];
for (const [typed, expected] of skeletonCases) {
  check(`SKELETON_COMMAND on ${JSON.stringify(typed)} is ${expected}`, SKELETON_COMMAND.test(typed) === expected);
}

const pick = HEADLINE_COMMAND.exec("headline 3 pick 2");
check("headline 3 pick 2 captures page 3 and option 2", pick?.[1] === "3" && pick?.[2] === "2");
const more = HEADLINE_COMMAND.exec("headline 3 more");
check("headline 3 more captures page 3 and no option", more?.[1] === "3" && more?.[2] === undefined);

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
