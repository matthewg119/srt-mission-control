// Probe: the AEO headline lane. No network, no DB, no API calls.
//
//   bunx tsx scripts/_probe-aeo-headlines.ts
//
// !! THE REGRESSION TO CATCH IS AN INVENTED FIGURE REACHING A PAGE H1. Nothing errors when one
// does: twenty well-formed strings come back either way, the page drafts, and the only symptom
// is a statistic on a client's own domain that no source backs. Specificity is a LAW here, so
// the model reaches for a number on almost every line, which is what makes this the live risk.
//
// !! 2026-09-13: BACKED, NOT BANNED. This probe used to assert that results, multipliers and
// timeframes were rejected outright. Matthew removed that: "if the deep research can back the
// data we can talk about results". So case 3 now asserts the OPPOSITE for those lines, and the
// teeth moved to 3b, which is the haystack test. NOW_LEGAL exists so the ban cannot creep back.
//
// !! THE OTHER REGRESSION IS THE AD VOICE LEAKING BACK IN. What separates these from
// `dr-headline-engine.ts` is no longer the subject matter, it is the SHAPE: her question, never
// a marketer's sentence about her. Cases 2, 4 and 7 pin that.

import {
  headlineFaults,
  headlineLength,
  headlineWarnings,
  unbackedNumbers,
  isQueryShaped,
  headlinePrompt,
  typedQueryCore,
} from "../src/lib/clients/client-headlines";
import { AEO_HEADLINE_ENGINE } from "../src/data/reel/aeo-headline-engine";
import { SEO_TITLE_ENGINE } from "../src/data/reel/seo-title-engine";
import { clientAvatarVerticalId } from "../src/config/verticals";
import { DR_HEADLINE_ENGINE } from "../src/data/reel/dr-headline-engine";

// Everything a figure may legally be drawn from in these fixtures: her own quoted amounts.
const HAYSTACK = "I invested over 150000 through loans. spent 1500 last month on FB/IG ads. 80K";

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) failures++;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}`);
  if (!ok && detail) console.log(`          ${detail}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Matthew's own headlines. THE POSITIVE FIXTURE: every one must pass.
// If a rule here rejects one of these, the rule is wrong, not the headline.
//
// ‼️ SIX OF THE ORIGINAL TWENTY WERE REMOVED ON 2026-10-08, WITH HIM, AND THAT IS THE ONLY WAY
// THIS LIST MAY EVER SHRINK. He wrote the twenty on 2026-09-12 and then rejected the engine's
// output on 2026-10-07 for being exactly what the twenty taught it: "nobody would actually google
// this, or search it like that, this sounds too ai". The two cannot both be the bar, so he was
// asked which, shown the measurement, and chose. Removed:
//
//   over 15 words in the query core, which is the band he picked:
//     "Is it normal that I've spent $80K on marketing and my med spa still isn't booked out?" (17)
//     "How do I get my clinic mentioned when someone asks ChatGPT for the best Botox in town?" (17)
//     "Should I close my med spa if I've been at this two years and still can't tell if I'll
//      make it?" (21)
//     "What am I missing if I'm doing everything the marketing gurus say and still not booking
//      consults?" (17)
//   bare confessions, which rule 1's closed door no longer admits:
//     "I'm a solo NP and I feel like I'm doing everything wrong."
//     "My cash-pay med spa isn't growing and I can't figure out what I'm doing wrong."
//
// The fourteen that survive are below, followed by the five he wrote on 2026-10-07 as the new
// bar. Note that the survivors are ALL questions: the confessional door was load-bearing for
// exactly two of twenty, which is how a rule that produced every bad line could look harmless.
// ─────────────────────────────────────────────────────────────────────────────
const GOOD: string[] = [
  // The fourteen of the twenty that still pass, 2026-09-12.
  "Why is my med spa invisible when patients ask ChatGPT for injectors near me?",
  "How do I know if AI is even mentioning my clinic?",
  "Why do my Meta ad leads for Botox keep ghosting me after the first text?",
  "What's the reason nobody finds my med spa when they search AI instead of Google?",
  "Why do patients pick the med spa two blocks away instead of mine?",
  "How come my reviews are better than my competitor's but they book more consults?",
  "Am I the only APRN whose med spa hit a ceiling and won't move?",
  "Does anyone else feel like their med spa website has become invisible?",
  "Why does ChatGPT keep recommending my competitor and not me?",
  "What's wrong if leads book a consult and then never show up?",
  "Is it normal to feel this alone running a solo med spa?",
  "Why isn't SEO working for my med spa anymore?",
  "How can I tell if my marketing agency is actually doing anything for my clinic?",
  "Why does every med spa on Instagram look busier than mine?",
  // ‼️ ALL ELEVEN OF HIS WORKED AEO H1s, ONE PER PLANNED PAGE, pasted 2026-10-09. The doc in the
  // repo carried only five of them, so the other six were never fixtures. These are the quality
  // bar, not an illustration. Three were REJECTED by isQueryShaped before it was rebuilt (the
  // mid-string question mark, the colon comparison, the ", and" tail), and "A 30-Day Plan" was
  // refused by unbackedNumbers until structural counts were exempted.
  "How Do I Get My Med Spa Recommended by ChatGPT? A 30-Day Plan",
  "How Much Does AEO Cost for a Med Spa, and What Should You Get for It?",
  "How to Fire Your Marketing Agency: What to Take Back Before You Leave",
  "AI Search vs Google Search: 5 Differences That Affect Your Bookings",
  "How Does ChatGPT Decide Which Local Business to Recommend?",
  "How to Get More Botox Clients: 7 Ways That Don't Need Ads",
  "Why Facebook Ads Stop Working for Med Spas, and What to Do Instead",
  "How Do Med Spas Get More Google Reviews That AI Search Will Use?",
  "What Ranking Factors Does ChatGPT Use for Local Businesses?",
  "Are Google Ads Worth It for Med Spas? Costs and Alternatives",
  "How Do I Get Clients to Find My Business on ChatGPT?",
];

// Matthew's DON'T column. Every one of these dies on SHAPE or on LENGTH, never on subject matter.
const BAD: Array<{ headline: string; because: string }> = [
  { headline: "Warning: The Silent Algorithm Draining Your Med Spa Budget.", because: "ad voice, not query shaped" },
  {
    headline: "She Sank $150,000 Into Her Med Spa, Then Watched ChatGPT Send Her Patients Two Blocks Away.",
    because: "third-person ad narrator",
  },
  {
    headline: "For the Solo NP Who Poured In Every Dollar and Still Can't Fill Her Chair.",
    because: "ad voice, not a question",
  },
  { headline: "Is my ranking guaranteed if I switch agencies?", because: "a guarantee, which nothing can back" },
  // ‼️ THE LINE HE ACTUALLY REJECTED, 2026-10-07, AND THE REASON THIS LANE WAS REWRITTEN. It was
  // LEGAL before: query shaped by the confessional door, and no rule capped its length.
  {
    headline: "Why have I spent thousands on ads and still can't figure out how to get my med spa on ChatGPT?",
    because: "a 20 word query core, which is a Reddit post rather than a search",
  },
  // The two confessions retired from GOOD above. They are DON'Ts now rather than absences, so a
  // rule that quietly re-admits the shape fails here by name.
  {
    headline: "I'm a solo NP and I feel like I'm doing everything wrong.",
    because: "a bare confession: it states instead of asking, so no query matches it",
  },
  {
    headline: "My cash-pay med spa isn't growing and I can't figure out what I'm doing wrong.",
    because: "a bare confession, and 15 words of one",
  },
];

// 2026-09-13: these were rejected until Matthew removed the promise ban. They are legal now,
// provided their figures are backed. This list exists so the ban cannot quietly come back.
const NOW_LEGAL: string[] = [
  "How do I book 14 new consults this month?",
  "Why can't I double my revenue with Meta ads?",
  "How do I fill my books with cash-pay patients?",
  "Why am I not ranked in ChatGPT within 30 days of publishing?",
];

console.log(`\n1. Matthew's own ${GOOD.length} all pass`);
for (const h of GOOD) {
  const faults = headlineFaults([h], 1, HAYSTACK);
  check(`      ${h.slice(0, 62)}`, faults.length === 0, faults.map((f) => f.why).join("; "));
}

console.log("\n2. The DON'T column is all rejected, on SHAPE");
for (const { headline, because } of BAD) {
  const faults = headlineFaults([headline], 1, HAYSTACK);
  check(`      ${headline.slice(0, 56)}  (${because})`, faults.length > 0, "it passed and should not have");
}

console.log("\n3. Backed, not banned: results and timeframes are legal when a source says so");
for (const h of NOW_LEGAL) {
  const faults = headlineFaults([h], 1, `${HAYSTACK} 14 30`);
  check(`      ${h.slice(0, 62)}`, faults.length === 0, faults.map((f) => f.why).join("; "));
}
check(
  "      dollars GAINED are allowed now",
  headlineFaults(["How do I add 20 new patients a month?"], 1, "20").length === 0
);
check(
  "      dollars LOST are still allowed",
  headlineFaults(["Why isn't my med spa growing after $150,000 invested?"], 1, HAYSTACK).length === 0
);
check(
  "      a guarantee is still illegal whatever the evidence",
  headlineFaults(["Is my ranking guaranteed if I switch agencies?"], 1, HAYSTACK).length > 0
);

console.log("\n3b. But an UNBACKED figure is still rejected");
check(
  "      an invented percentage is caught",
  unbackedNumbers("Why am I invisible when 45% of patients ask AI first?", "").length === 1
);
check(
  "      the same percentage is fine once it is approved",
  unbackedNumbers("Why am I invisible when 45% of patients ask AI first?", "45% of consumers use AI").length === 0
);
check(
  "      an amount from her own quote is backed",
  unbackedNumbers("Why isn't my med spa growing after $150,000 invested?", HAYSTACK).length === 0
);
check("      a bare year is not a statistic", unbackedNumbers("In 2023 I opened a medspa, why is it failing?", "").length === 0);
check("      a single digit is not a statistic", unbackedNumbers("Why are my 2 med spas both stuck?", "").length === 0);
check(
  "      the live failure is caught",
  unbackedNumbers("Why do 45 percent of local searches start with an AI prompt?", "").length > 0
);

console.log("\n4. Query shape is what actually separates this from an ad headline");
check("      a question is query shaped", isQueryShaped("Why is my clinic invisible?"));
// ‼️ INVERTED ON 2026-10-08, AND IT IS THE CENTRAL ASSERTION OF THE WHOLE REWRITE. This check
// used to read "a first-person confession is query shaped" and pass. That door is what produced
// every line Matthew rejected, so the same string is now the thing this lane refuses. If a later
// change makes this pass again, the confessional H1 is back.
check(
  "      a bare first-person confession is NOT query shaped any more",
  !isQueryShaped("My med spa is invisible in ChatGPT.")
);
check("      an ad headline is not", !isQueryShaped("The Silent Algorithm Draining Your Budget."));
// First person is not banned as VOCABULARY, only as a shape. "my" inside a question is correct
// and is what keeps the line in her words, which is rule 4.
check("      but first person inside a QUESTION still is", isQueryShaped("Why isn't my med spa showing up in ChatGPT?"));
check("      a mid-string question mark counts, so a format suffix may follow", isQueryShaped("How Do I Rank? A 30-Day Plan"));
check("      a colon comparison counts", isQueryShaped("AI Search vs Google Search: 5 Differences That Matter"));
check("      a question word with no mark counts", isQueryShaped("Why Facebook Ads Stop Working for Med Spas"));
check("      a bare statement with a colon does not", !isQueryShaped("Warning: The Silent Algorithm Draining Your Budget."));

console.log("\n5. Rule 5, and it REJECTS here unlike the reel lane");
const sameShape = [...Array(20)].map((_, i) => `Why is my med spa problem number ${i} not fixed?`);
check(
  "      four headlines opening the same way are rejected",
  headlineFaults(sameShape, 20, HAYSTACK).some((f) => f.why.includes("rule 5"))
);
// ‼️ THE OPENING ALLOWANCE SCALES, BECAUSE THIS FIXTURE IS A CORPUS AND NOT A BATCH. Rule 5
// forbids a repeated shape inside ONE set of candidates for ONE page, where three lookalikes mean
// one real option. These twenty-five span fourteen weekly headlines and eleven DIFFERENT pages,
// so "how do i" legitimately opens several: they are never offered side by side. Same formula
// precall-headlines.ts uses for its thirty three, and for the same reason.
const CORPUS_OPENINGS = Math.max(2, Math.ceil(GOOD.length / 11));
check(
  `      Matthew's own ${GOOD.length} do not trip rule 5 (at ${CORPUS_OPENINGS} per opening, scaled for a corpus)`,
  headlineFaults(GOOD, GOOD.length, HAYSTACK, CORPUS_OPENINGS).length === 0,
  headlineFaults(GOOD, GOOD.length, HAYSTACK, CORPUS_OPENINGS)
    .map((f) => `${f.headline}: ${f.why}`)
    .join(" | ")
);

console.log("\n6. The count is enforced");
check(
  "      one short of what was asked for is a fault",
  headlineFaults(GOOD.slice(0, GOOD.length - 1), GOOD.length, HAYSTACK).length > 0
);

console.log("\n7. The two engines stay apart");
check("      the AEO engine bans the unbacked claim", /NO UNBACKED CLAIM/.test(AEO_HEADLINE_ENGINE));
check(
  "      the DR engine still carries its 12-45 word rule, so it must never be in this prompt",
  /12 to 45 words/.test(DR_HEADLINE_ENGINE)
);
const prompt = headlinePrompt(
  {
    clientName: "Test Clinic",
    city: "Austin",
    businessType: "med spa",
    avatarLabel: "solo NP owner",
    treatment: "AEO visibility",
    positioning: null,
    framework: null,
    approvedNumbers: [],
    quotes: [{ text: "I'm at a loss and don't understand what I'm doing wrong.", source: "r/MedSpa" }],
  },
  20
);
check("      the client prompt carries the AEO engine", prompt.includes("NO UNBACKED CLAIM"));
check("      the client prompt carries NO 12-45 word rule", !/12 to 45 words/.test(prompt));
check("      specificity is a law again, not a ban", /SPECIFICITY CREATES TRUST/.test(prompt));
check("      the quotes reach the prompt", prompt.includes("I'm at a loss"));
check(
  "      an empty approved-numbers list still bans every figure",
  prompt.includes("there are NO approved statistics")
);

console.log("\n8. The attached framework sits above the engine, never instead of it");
const withFramework = headlinePrompt(
  {
    clientName: "Test Clinic",
    city: null,
    businessType: "med spa",
    avatarLabel: "solo NP owner",
    treatment: null,
    positioning: null,
    framework: "CLIENT FRAMEWORK MARKER",
    approvedNumbers: [],
    quotes: [],
  },
  20
);
check("      the framework reaches the prompt", withFramework.includes("CLIENT FRAMEWORK MARKER"));
check("      the engine is still there too", withFramework.includes("NO UNBACKED CLAIM"));
check(
  "      the framework comes first",
  withFramework.indexOf("CLIENT FRAMEWORK MARKER") < withFramework.indexOf("NO UNBACKED CLAIM")
);
check("      no quotes on file says so out loud", withFramework.includes("NO CUSTOMER QUOTES ARE ON FILE"));

console.log("\n9. House rules");
check("      no em dash in the engine", !/[—–]/.test(AEO_HEADLINE_ENGINE));
check(
  "      an em dash in a headline is a fault",
  headlineFaults(["Why is my clinic — invisible?"], 1, HAYSTACK).length > 0
);

// ─────────────────────────────────────────────────────────────────────────────
// 11. The length band, which this lane did not have until 2026-10-08
//
// ‼️ THE BAND IS MEASURED ON THE QUERY CORE AND THAT IS NOT A DETAIL. Three of Matthew's own five
// worked H1s are over 12 words end to end, and all five are inside the band on their core. A
// future "simplification" that measures the whole string instead will pass section 1 only until
// somebody writes a format suffix, so these checks pin the core explicitly.
// ─────────────────────────────────────────────────────────────────────────────
console.log("\n11. The query core is 4 to 12 words, 15 at the outside, and the line caps at 18");

check("      the core stops at the question mark", typedQueryCore("How Do I Rank? A 30-Day Plan") === "How Do I Rank");
check(
  "      the core stops at the colon",
  typedQueryCore("AI Search vs Google Search: 5 Differences") === "AI Search vs Google Search"
);
check(
  '      the core stops at a ", and"',
  typedQueryCore("Why Facebook Ads Stop Working, and What to Do Instead") === "Why Facebook Ads Stop Working"
);
check(
  "      a line with no break IS its own core, so a long confession cannot hide behind this",
  headlineLength("Why have I spent thousands on ads and still can't figure out how to get my med spa on ChatGPT?").core === 20
);

for (const { words, want } of [
  { words: 3, want: "fault" },
  { words: 4, want: "clean" },
  { words: 12, want: "clean" },
  { words: 13, want: "warn" },
  { words: 15, want: "warn" },
  { words: 16, want: "fault" },
] as const) {
  // "why is my med spa ... invisible?" built to an exact word count, so the boundary is tested
  // rather than approximated. Two fixed words plus filler plus one, all inside one question.
  const filler = Array.from({ length: Math.max(0, words - 3) }, () => "really").join(" ");
  const h = `Why is ${filler} invisible?`.replace(/\s+/g, " ");
  const got = headlineLength(h).core;
  const faults = headlineFaults([h], 1, HAYSTACK);
  const warns = headlineWarnings([h]);
  const verdict = faults.length ? "fault" : warns.length ? "warn" : "clean";
  check(`      a ${got} word core is a ${want}`, verdict === want && got === words, `got ${verdict} at ${got} words`);
}

// A 6 word core with a 14 word tail: legal as a query, 20 words as a line. The suffix is meant
// to name the shape of the answer in a few words, not to be a second headline.
const LONG_TAIL = "Why is my med spa invisible? A plan for every single week of the next six whole calendar months";
check(
  `      a short core with a long tail is refused on the whole line (core ${headlineLength(LONG_TAIL).core}, full ${headlineLength(LONG_TAIL).full})`,
  headlineFaults([LONG_TAIL], 1, HAYSTACK).length > 0
);
// ‼️ ONE OF HIS OWN TWENTY, AND IT IS IN GOOD ABOVE. 13 words: it passes section 1 because a
// warning is not a fault, and it is flagged here. That is the whole shape of the tier he chose,
// and it is why `headlineWarnings` is a separate function from `headlineFaults`.
const THIRTEEN = "Why do patients pick the med spa two blocks away instead of mine?";
check(
  `      13 to 15 words warns rather than refusing, which is the tier he picked (core ${headlineLength(THIRTEEN).core})`,
  headlineWarnings([THIRTEEN]).length === 1 && headlineFaults([THIRTEEN], 1, HAYSTACK).length === 0
);
check("      a clean line warns about nothing", headlineWarnings(["Why isn't SEO working for my med spa anymore?"]).length === 0);

console.log("\n12. A format suffix may count what the PAGE contains, and nothing else");
check('      "A 30-Day Plan" is not an unbacked figure', unbackedNumbers("How Do I Rank? A 30-Day Plan", "").length === 0);
check('      "5 Differences" is not either', unbackedNumbers("AI vs Google: 5 Differences That Matter", "").length === 0);
check('      nor "7 Steps"', unbackedNumbers("How Do I Rank? 7 Steps", "").length === 0);
// ‼️ THE TWO STRINGS THAT COST REAL MONEY. Both were in the ad lane's first live run. If the
// structural exemption above ever widens far enough to admit either of these, it is wrong.
check('      but "within 90 days" is still refused', unbackedNumbers("Will I rank within 90 days?", "").length === 1);
check(
  '      and so is "45 percent of local searches"',
  unbackedNumbers("Why do 45 percent of local searches start with an AI prompt?", "").length === 1
);
check('      and "45%"', unbackedNumbers("Why am I not cited when 45% ask AI first?", "").length === 1);

console.log("\n13. The four engines stay apart, and the H1's prompt carries only its own band");
check(
  "      the SEO title engine keeps its own CHARACTER budget",
  /50 to 60 characters/i.test(SEO_TITLE_ENGINE)
);
check(
  "      and that budget must never reach the H1 prompt, where the shortest rule would win",
  !/50 to 60 characters/i.test(prompt)
);
check("      the H1 prompt carries the word band instead", /4 to 12/.test(prompt));
check("      no em dash in the SEO title engine", !/[—–]/.test(SEO_TITLE_ENGINE));

console.log("\n10. The client slug resolves to an avatar, and an unknown one resolves to NOTHING");
// !! THE REGRESSION THIS CATCHES IS SILENT AND IT ALREADY HAPPENED. `clients.vertical_slug` is a
// CLIENT slug; `loadVertical` wants an avatar id and returns PEST CONTROL for anything it does not
// know. Measured on srt-agency-llc 2026-09-13: 0 quotes and 0 approved numbers reached the prompt
// while 20 quotes and 6 sourced figures sat one row away, so every number read as unbacked and the
// "backed, not banned" rule silently inverted. Nothing errors when this breaks, which is why it is
// pinned here rather than left to the live run.
check(
  "      the AEO agency slug resolves to the med spa owner avatar",
  clientAvatarVerticalId("aeo-agency-med-spa") === "medspa_owner_ai",
  `got ${String(clientAvatarVerticalId("aeo-agency-med-spa"))}`
);
check(
  "      its sibling slugs resolve to the same one",
  clientAvatarVerticalId("aeo-agency") === "medspa_owner_ai" &&
    clientAvatarVerticalId("aeo-marketing-agency") === "medspa_owner_ai"
);
check(
  "      case and padding do not matter",
  clientAvatarVerticalId("  AEO-Agency-Med-Spa ") === "medspa_owner_ai"
);
check(
  "      an unmapped vertical resolves to null, NEVER to the pest default",
  clientAvatarVerticalId("plumbing-co") === null,
  `got ${String(clientAvatarVerticalId("plumbing-co"))}`
);
check("      an empty slug resolves to null", clientAvatarVerticalId("") === null);
check(
  "      an id that is already ours passes through",
  clientAvatarVerticalId("medspa_owner_ai") === "medspa_owner_ai" &&
    clientAvatarVerticalId("pest_control") === "pest_control"
);
check(
  "      a retired id still canonicalises",
  clientAvatarVerticalId("trt_clinic_ai") === "medspa_owner_ai"
);

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} CHECK(S) FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
