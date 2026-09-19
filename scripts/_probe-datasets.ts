// The dataset registry, the research section parser, and the rule that keeps them honest. No writes.
//
//   bunx tsx --env-file=.env.local scripts/_probe-datasets.ts
//
// ‼️ SECTION 11 IS THE ONE THAT MATTERS MOST, AND IT IS MEANT TO FAIL. Matthew, 2026-09-15: every new
// piece of context should tighten the datasets "down to the teeth". The mechanical version of that is
// here: a research SECTION with no field declared for it fails this probe, and so does a field that
// claims a section the prompt does not have. Adding a section to deep-research-run.ts therefore means
// declaring what it fills in dataset-spec.ts, in the same commit, or this goes red.

import {
  parseResearchSections,
  sectionAnswered,
  looksLikeFullResearch,
  FULL_RESEARCH_MIN_SECTIONS,
} from "../src/lib/clients/avatar-profile";
import { DATASET_FIELDS, evaluateDatasets, formatDatasetReport, type DatasetSnapshot } from "../src/lib/clients/dataset-spec";
import { RESEARCH_SECTION_KEYS } from "../src/lib/clients/artifacts/deep-research-run";
import { isStepKey } from "../src/config/delivery-steps";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

const filler = (label: string) => `${label} `.repeat(40);

// ── 1-6. The parser ─────────────────────────────────────────────────────────
console.log("\n1. Markdown headings split into numbered sections");
const md = [
  "# Deep research: med spa owner",
  "## 1. Who buys",
  filler("owners in their forties"),
  "## 2. What they use now",
  filler("agencies and doing nothing"),
].join("\n");
const mdSections = parseResearchSections(md);
check("two sections", mdSections.length === 2, `got ${mdSections.length}`);
check("numbered 1 and 2", mdSections.map((s) => s.number).join() === "1,2");
check("the title is kept", mdSections[0]?.title === "Who buys", mdSections[0]?.title);
check("the document title is not a section", !mdSections.some((s) => /Deep research/.test(s.title)));

console.log("\n2. A numbered LIST inside a section is body, not thirty sections");
const quotes = [
  "## 7. Their exact words",
  '1. "i am so over paying agencies"',
  '2. "nobody books off instagram"',
  '3. "is chatgpt even a thing for med spas"',
  filler("more quotes"),
  "## 8. Headlines",
  filler("headline ideas"),
].join("\n");
const qs = parseResearchSections(quotes);
check("still two sections", qs.length === 2, qs.map((s) => s.number).join());
check("the quotes stayed inside section 7", /nobody books off instagram/.test(qs[0]?.body ?? ""));

console.log("\n3. A whole-bold line counts as a heading");
const bold = parseResearchSections(["**3. What they like**", filler("the convenience")].join("\n"));
check("bold heading parsed", bold.length === 1 && bold[0].number === 3, JSON.stringify(bold.map((b) => b.number)));

console.log("\n4. ### subsections stay inside their section");
const sub = parseResearchSections(["## 4. What goes wrong", "### Slow follow-up", filler("leads die"), "### Bad reporting", filler("no numbers")].join("\n"));
check("one section", sub.length === 1, `got ${sub.length}`);
check("both subsections are in its body", /Slow follow-up/.test(sub[0]?.body ?? "") && /Bad reporting/.test(sub[0]?.body ?? ""));

console.log("\n5. An unnumbered ## heading ends the section above it");
const ranked = parseResearchSections(["## 8. Headlines", filler("ideas"), "## The twenty-five phrases, ranked", "botox near me"].join("\n"));
check("the ranked list is not part of section 8", !/botox near me/.test(ranked[0]?.body ?? ""));

console.log("\n6. A number that does not increase is not a new section");
const restart = parseResearchSections(["## 5. Beliefs", filler("seo is dead"), "## 2. Not really a section", filler("x")].join("\n"));
check("still one section", restart.length === 1, restart.map((s) => s.number).join());

// ── 7-8. Answered, and full ─────────────────────────────────────────────────
console.log("\n7. A stub or an honest non-answer is not an answered section");
check("a short body is missing", !sectionAnswered({ number: 1, title: "x", body: "not much here" }));
check('"could not verify" alone is missing', !sectionAnswered({ number: 1, title: "x", body: "Could not verify. ".repeat(20) }));
check("a real body is answered", sectionAnswered({ number: 1, title: "x", body: filler("real finding") }));

console.log(`\n8. Only a full answer (${FULL_RESEARCH_MIN_SECTIONS}+ sections) may replace stored research`);
const keywordsOnly = ["KEYWORDS", "ai visibility | unknown | ready | https://a.com", "aeo agency cost | 1900 | price | https://b.com"].join("\n");
check("a KEYWORDS block on its own is NOT full research", !looksLikeFullResearch(keywordsOnly));
const three = [1, 2, 3].map((n) => `## ${n}. Section\n${filler("finding")}`).join("\n");
check("three answered sections is not enough", !looksLikeFullResearch(three));
const four = [1, 2, 3, 4].map((n) => `## ${n}. Section\n${filler("finding")}`).join("\n");
check("four answered sections is", looksLikeFullResearch(four));

// ── 9-11. The registry ──────────────────────────────────────────────────────
console.log("\n9. Every field is declared once and fillable");
const ids = DATASET_FIELDS.map((f) => `${f.dataset}.${f.key}`);
check("no duplicate field keys", new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join());
for (const f of DATASET_FIELDS) {
  if (f.filledBy.kind === "step") {
    check(`${f.dataset}.${f.key} is filled on a real step`, isStepKey(f.filledBy.step), f.filledBy.step);
  }
  for (const b of f.blocks ?? []) {
    check(`${f.dataset}.${f.key} blocks a real step`, isStepKey(b), b);
  }
}

console.log("\n10. A research field only claims a section the prompt really asks");
for (const f of DATASET_FIELDS) {
  if (f.filledBy.kind !== "research" || !f.filledBy.sectionKey) continue;
  check(
    `${f.dataset}.${f.key} -> section "${f.filledBy.sectionKey}" exists`,
    RESEARCH_SECTION_KEYS.includes(f.filledBy.sectionKey),
    `sections: ${RESEARCH_SECTION_KEYS.join(", ")}`
  );
  check(`${f.dataset}.${f.key} is marked asked`, f.filledBy.asked);
}

console.log("\n11. Every research section fills a declared field (a new section without one fails here)");
const claimed = new Set(
  DATASET_FIELDS.flatMap((f) => (f.filledBy.kind === "research" && f.filledBy.sectionKey ? [f.filledBy.sectionKey] : []))
);
for (const key of RESEARCH_SECTION_KEYS) {
  check(`section "${key}" is claimed by a field in dataset-spec.ts`, claimed.has(key));
}

// ── 12. The evaluator ───────────────────────────────────────────────────────
console.log("\n12. The evaluator says why, and an option audience has no offer yet");
const snap: DatasetSnapshot = {
  audience: { label: "women over 60 wanting a lift", isPrimary: false, stance: "patient", hasVocabulary: true, buyerMarket: "med-spa", hardLines: 3, confirmedAt: null },
  avatar: {
    researchText: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => `## ${n}. S\n${filler("finding")}`).join("\n"),
    vocQuotes: 0, approvedNumbers: 0, keywordRows: 0, keywordRowsWithUrl: 0, objectionRows: 0,
  },
  offer: { applies: false, treatment: null, terms: 0, positioning: null, magnetKey: null, lockedAt: null, outcomePromise: null, price: null, guarantee: null },
  documents: { avatarSheet: null, shortOffer: null, beliefs: 0, letterApproved: false },
  audit: { linked: false, pickedAvatar: false, buyerMap: false },
  reviews: 0,
};
const reports = evaluateDatasets(snap, RESEARCH_SECTION_KEYS);
const avatar = reports.find((r) => r.dataset === "avatar")!;
const offer = reports.find((r) => r.dataset === "offer")!;
check("the eight answered sections count as present", ["who_buys", "beliefs", "blame", "headline_ideas"].every((k) => !avatar.gaps.some((g) => g.field.key === k)));
// ‼️ UPDATED 2026-09-15. Fears used to be "not asked"; the framework's avatar sheet asks now.
check("fears is missing until the avatar sheet is pasted, and says where it comes from",
  /avatar sheet:/.test(avatar.gaps.find((g) => g.field.key === "fears")?.reason ?? ""));
check("a script-only research section says only the framework script asks",
  avatar.gaps.find((g) => g.field.key === "hopes_and_dreams")?.reason === "only step 11's framework script asks for this");
check("objections moved from the avatar to the offer",
  !DATASET_FIELDS.some((f) => f.dataset === "avatar" && f.key === "objections") &&
    DATASET_FIELDS.some((f) => f.dataset === "offer" && f.key === "objections"));

// The avatar sheet fills the story-tuning fields; fantasies take either of its two sources.
const withSheet: DatasetSnapshot = {
  ...snap,
  documents: { avatarSheet: ["fears", "emotional_journey", "emotional_journey.journey_relief"], shortOffer: null, beliefs: 0, letterApproved: false },
};
const sheetAvatar = evaluateDatasets(withSheet, RESEARCH_SECTION_KEYS).find((r) => r.dataset === "avatar")!;
check("an answered fears heading fills fears", !sheetAvatar.gaps.some((g) => g.field.key === "fears"));
check("the relief stage alone fills fantasies", !sheetAvatar.gaps.some((g) => g.field.key === "fantasies"));
check("an unanswered heading on a sheet that IS on file says so",
  /leaves this heading empty/.test(sheetAvatar.gaps.find((g) => g.field.key === "pain_points")?.reason ?? ""));
check("search phrases is missing for want of KEYWORDS rows", /KEYWORDS/.test(avatar.gaps.find((g) => g.field.key === "search_phrases")?.reason ?? ""));
check("an option audience is not charged the primary's offer", offer.total === 0);
const lines = formatDatasetReport("women over 60 wanting a lift", false, reports, false);
check("the card says it is an option", /\(option\)/.test(lines[0]));
// Offers ARE per audience since 2026-09-15 (client_offers); an option audience simply has none yet.
check("the card says nothing has been offered to this audience yet", lines.some((l) => /nothing has been offered to this audience yet/.test(l)));

// The outcome and price are captured at the prep call now, so a primary offer that has them counts them.
const primarySnap: DatasetSnapshot = {
  ...snap,
  audience: { ...snap.audience!, isPrimary: true },
  offer: { applies: true, treatment: "lip filler", terms: 2, positioning: null, magnetKey: null, lockedAt: "2026-09-15", outcomePromise: "more appointments", price: "$399 per session", guarantee: null },
};
const primaryOffer = evaluateDatasets(primarySnap, RESEARCH_SECTION_KEYS).find((r) => r.dataset === "offer")!;
check("an outcome on file counts as present", !primaryOffer.gaps.some((g) => g.field.key === "outcome_promise"));
check("a price on file counts as present", !primaryOffer.gaps.some((g) => g.field.key === "price"));
// ‼️ THE GUARANTEE IS A WANT AND ITS ABSENCE IS A REAL ANSWER, so a client who honours none shows
// a gap and is never blocked by it. Declared 2026-09-19 after it was found to have a column, a
// command and a reader, and no field: the system used it and could not ask for it.
check("an absent guarantee shows as a gap", primaryOffer.gaps.some((g) => g.field.key === "guarantee"));
check("and it never blocks a step", !primaryOffer.gaps.some((g) => g.field.key === "guarantee" && g.blocking));
check("the primary audience is charged its offer fields", primaryOffer.total > 0);
check("the card has no em dash", !lines.some((l) => /[—–]/.test(l)));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
