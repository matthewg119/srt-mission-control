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
  unbackedNumbers,
  isQueryShaped,
  headlinePrompt,
} from "../src/lib/clients/client-headlines";
import { AEO_HEADLINE_ENGINE } from "../src/data/reel/aeo-headline-engine";
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
// Matthew's own twenty, 2026-09-12. THE POSITIVE FIXTURE: every one must pass.
// If a rule here rejects one of these, the rule is wrong, not the headline.
// ─────────────────────────────────────────────────────────────────────────────
const GOOD: string[] = [
  "Why is my med spa invisible when patients ask ChatGPT for injectors near me?",
  "How do I know if AI is even mentioning my clinic?",
  "Why do my Meta ad leads for Botox keep ghosting me after the first text?",
  "Is it normal that I've spent $80K on marketing and my med spa still isn't booked out?",
  "What's the reason nobody finds my med spa when they search AI instead of Google?",
  "I'm a solo NP and I feel like I'm doing everything wrong.",
  "Why do patients pick the med spa two blocks away instead of mine?",
  "How come my reviews are better than my competitor's but they book more consults?",
  "Am I the only APRN whose med spa hit a ceiling and won't move?",
  "Does anyone else feel like their med spa website has become invisible?",
  "Why does ChatGPT keep recommending my competitor and not me?",
  "My cash-pay med spa isn't growing and I can't figure out what I'm doing wrong.",
  "What's wrong if leads book a consult and then never show up?",
  "How do I get my clinic mentioned when someone asks ChatGPT for the best Botox in town?",
  "Is it normal to feel this alone running a solo med spa?",
  "Why isn't SEO working for my med spa anymore?",
  "Should I close my med spa if I've been at this two years and still can't tell if I'll make it?",
  "How can I tell if my marketing agency is actually doing anything for my clinic?",
  "Why does every med spa on Instagram look busier than mine?",
  "What am I missing if I'm doing everything the marketing gurus say and still not booking consults?",
];

// Matthew's DON'T column. Every one of these dies on SHAPE, not on subject matter.
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
];

// 2026-09-13: these were rejected until Matthew removed the promise ban. They are legal now,
// provided their figures are backed. This list exists so the ban cannot quietly come back.
const NOW_LEGAL: string[] = [
  "How do I book 14 new consults this month?",
  "Why can't I double my revenue with Meta ads?",
  "How do I fill my books with cash-pay patients?",
  "Why am I not ranked in ChatGPT within 30 days of publishing?",
];

console.log("\n1. Matthew's twenty all pass");
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
check("      a first-person confession is query shaped", isQueryShaped("My med spa is invisible in ChatGPT."));
check("      an ad headline is not", !isQueryShaped("The Silent Algorithm Draining Your Budget."));

console.log("\n5. Rule 5, and it REJECTS here unlike the reel lane");
const sameShape = [...Array(20)].map((_, i) => `Why is my med spa problem number ${i} not fixed?`);
check(
  "      four headlines opening the same way are rejected",
  headlineFaults(sameShape, 20, HAYSTACK).some((f) => f.why.includes("rule 5"))
);
check("      Matthew's twenty do not trip rule 5", headlineFaults(GOOD, 20, HAYSTACK).length === 0);

console.log("\n6. The count is enforced");
check("      nineteen when twenty were asked for is a fault", headlineFaults(GOOD.slice(0, 19), 20, HAYSTACK).length > 0);

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
