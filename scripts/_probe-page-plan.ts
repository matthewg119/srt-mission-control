// The page plan, the anchor framings and the skeleton, proved offline.
//
// Run: bunx tsx --env-file=.env.local scripts/_probe-page-plan.ts
//
// ‼️ NO MODEL CALL, NO WRITES, NO NETWORK. Every check is a pure function: the junk filter, the
// spread rule, the two validators the model is held to, and the dispatch grammar. The live half
// is the walk in Slack, which this cannot do.
//
// WHAT IT PROVES
//  1. SRT's real debris rows (copied from prod on 2026-09-11) can never be planned.
//  2. selectPlan spreads across themes, fills past the cap only when it must, dedupes, excludes.
//  3. frameFaults rejects an invented keyword, a long pill, a dash, an invented number, a short batch.
//  4. outlineFaults rejects too few gaps, an unreferenced gap, a phantom gap, an invented number.
//  5. offerBonus is one definition, and it is a bonus rather than a filter.
//  6. The dispatch grammar: the new commands fire, and the dictation they could swallow does not.

import { isPlannable, selectPlan, frameFaults, formatPlan, MAX_PER_THEME, type PoolItem, type PlanRow } from "@/lib/clients/page-plan";
import { outlineFaults, OUTLINE_LIMITS } from "@/lib/hub/draft-page";
import { readOutline } from "@/lib/hub/pages";
import { readFrame, CTA_MAX } from "@/lib/concierge/magnet-drafts";
import { offerBonus, OFFER_BONUS } from "@/lib/clients/artifacts/page-candidates";
import { normalizePhrase } from "@/lib/clients/phrase-quality";
import { hasBannedDash } from "@/lib/copy-guard";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

// ── 1. The debris that was on SRT's menu ─────────────────────────────────────
console.log("\n1. SRT's real debris rows are never plannable");

const DEBRIS = [
  "Why: Compliance and privacy concern; owner worried about HIPAA violations or data misuse.",
  "Why: Vendor lock-in fear; owner worried about losing assets, data, or progress if switching providers.",
  '"',
  "\\",
  'Headline: \\"',
  "“best marketing for med spa high ROI”【41†L65-L69】 – Owners worry about ROI: quotes warn",
  '"Inconsistent or missing citations don\'t just hurt rankings—they trigger trust penalties that can suppress visibility across all local queries."  ->  https://www.medspaseoagency.com/blog/citation-building-and-local-listings-for-med-spas/?utmsource=openai',
  "that agencies are either snake oil or too expensive.",
  '"The Acquisition Cost Trap: Why Doubling Your Marketing Budget Might Actually Hurt Profitability"',
  "Out of scope of $900: medical copywriting retainers, ad management, guaranteed ChatGPT inclusion, fake case studies, or security hardening.",
];

for (const d of DEBRIS) check(`not plannable: ${d.slice(0, 60)}`, !isPlannable(d, "harvested"));

const REAL = [
  "How much does this cost?",
  "How much work is this for me and my front desk?",
  "Is a consultation required?",
  "How long is the booked appointment?",
];
for (const r of REAL) check(`plannable: ${r}`, isPlannable(r, "harvested"));

check(
  "a derived comparison is plannable as derived, though the full rules call it a label",
  isPlannable("LeadXN compared: what each is better at", "derived") &&
    !isPlannable("LeadXN compared: what each is better at", "harvested")
);
check(
  "a derived cost estimator is plannable though it is long",
  isPlannable('A cost estimator that answers "How much does this cost?" and 15 other pricing questions on one page', "derived")
);
check(
  "a derived idea carrying a URL or a citation marker is still refused",
  !isPlannable("A guide covering https://example.com questions", "derived") &&
    !isPlannable("A guide covering【3†L1】 questions", "derived")
);

// ── 2. The spread rule ───────────────────────────────────────────────────────
console.log("\n2. selectPlan spreads, fills, dedupes and excludes");

const mk = (question: string, score: number, theme: string, origin: PoolItem["origin"] = "harvested"): PoolItem => ({
  question,
  score,
  theme,
  origin,
});

const pool: PoolItem[] = [
  ...Array.from({ length: 12 }, (_, i) => mk(`Is objection number ${i + 1} a real worry here?`, 90 - i, "Objection")),
  ...Array.from({ length: 6 }, (_, i) => mk(`How much does option ${i + 1} cost per month?`, 60 - i, "Price")),
  ...Array.from({ length: 6 }, (_, i) => mk(`How do I set up step ${i + 1} properly?`, 50 - i, "Guide")),
  mk("Why: a label that must never be chosen", 999, "General"),
  mk("How much does option 1 cost per month?", 10, "Price"), // a duplicate in normal form
];

const picked = selectPlan(pool, 12, MAX_PER_THEME);
const byTheme = (rows: PoolItem[], t: string) => rows.filter((r) => r.theme === t).length;
check("returns the size asked for", picked.length === 12, `got ${picked.length}`);
check(
  `no theme above ${MAX_PER_THEME} when other themes can fill`,
  ["Objection", "Price", "Guide"].every((t) => byTheme(picked, t) <= MAX_PER_THEME),
  ["Objection", "Price", "Guide"].map((t) => `${t}=${byTheme(picked, t)}`).join(", ")
);
check("a debris row never gets in, whatever its score", !picked.some((p) => p.question.startsWith("Why:")));
check(
  "no two picks share a normal form",
  new Set(picked.map((p) => normalizePhrase(p.question))).size === picked.length
);
check("highest score first within the spread", picked[0].score === 90);

const concentrated = selectPlan(pool.filter((p) => p.theme === "Objection"), 10, MAX_PER_THEME);
check(
  "a pool concentrated in one theme still fills the plan past the cap",
  concentrated.length === 10,
  `got ${concentrated.length}`
);

const exclude = new Set([normalizePhrase("Is objection number 1 a real worry here?")]);
check(
  "an excluded question is never re-proposed",
  !selectPlan(pool, 20, MAX_PER_THEME, exclude).some((p) => p.question === "Is objection number 1 a real worry here?")
);

// ── 3. The framing validator ─────────────────────────────────────────────────
console.log("\n3. frameFaults holds the model to the keyword set and the copy rules");

const keywordSet = new Set(["how much does this cost", "is a consultation required"].map(normalizePhrase));
const haystack = "How much does this cost? Is a consultation required? The AI Visibility Scan Twenty questions";

const goodRow = {
  workingTitle: "What AI visibility work costs a med spa",
  angle: "What goes into the price and how to judge whether it is worth it.",
  targetKeyword: "How much does this cost?",
  frame: { title: "See what the audit would fix first", ctaLabel: "See what I'd get first", conciergeEntry: "I can run the audit on your spa right now. What is your website?" },
};

check("a correct batch passes", frameFaults({ rows: [goodRow] }, 1, keywordSet, haystack).length === 0,
  frameFaults({ rows: [goodRow] }, 1, keywordSet, haystack).join(" | "));
check(
  "a keyword that is not in the set is rejected",
  frameFaults({ rows: [{ ...goodRow, targetKeyword: "best med spa marketing agency" }] }, 1, keywordSet, haystack).some((f) => f.includes("not in the KEYWORDS"))
);
check(
  `a pill over ${CTA_MAX} characters is rejected`,
  frameFaults({ rows: [{ ...goodRow, frame: { ...goodRow.frame, ctaLabel: "Run my complete AI visibility audit now" } }] }, 1, keywordSet, haystack).length > 0
);
check(
  "a dash anywhere is rejected",
  frameFaults({ rows: [{ ...goodRow, angle: "What it costs — and why" }] }, 1, keywordSet, haystack).some((f) => f.includes("dash"))
);
check(
  "an invented number is rejected",
  frameFaults({ rows: [{ ...goodRow, angle: "Most spas see 47 percent more bookings." }] }, 1, keywordSet, haystack).some((f) => f.includes("47"))
);
check(
  "a short batch is rejected",
  frameFaults({ rows: [goodRow] }, 2, keywordSet, haystack).some((f) => f.includes("2 pages"))
);
check("readFrame drops a frame missing a field", readFrame({ title: "x", ctaLabel: "y" }) === null);

// ── 4. The skeleton validator ────────────────────────────────────────────────
console.log("\n4. outlineFaults holds the skeleton to its limits");

const goodOutline = {
  sections: [
    { heading: "What it costs", bullets: ["The range you quote out loud [G1]", "What moves the price"] },
    { heading: "What you get for it", bullets: ["What the first month covers [G2]", "Who does the work [G3]"] },
  ],
  gaps: [
    { id: "G1", prompt: "What do you charge per month?", scope: "client" },
    { id: "G2", prompt: "What happens in the first month?", scope: "page" },
    { id: "G3", prompt: "Who on your team does the work?", scope: "client" },
  ],
};

check("a correct skeleton passes", outlineFaults(goodOutline, "").length === 0, outlineFaults(goodOutline, "").join(" | "));
check(
  `fewer than ${OUTLINE_LIMITS.minGaps} gaps is rejected`,
  outlineFaults({ ...goodOutline, gaps: goodOutline.gaps.slice(0, 2) }, "").length > 0
);
check(
  "a gap nobody references is rejected",
  outlineFaults(
    { ...goodOutline, gaps: [...goodOutline.gaps, { id: "G4", prompt: "Anything else?", scope: "page" }] },
    ""
  ).some((f) => f.includes("G4 is never referenced"))
);
check(
  "a bullet naming a gap that does not exist is rejected",
  outlineFaults(
    { ...goodOutline, sections: [{ heading: "X", bullets: ["See [G9]", "Other"] }, goodOutline.sections[1]] },
    ""
  ).some((f) => f.includes("G9"))
);
check(
  "an invented number in a bullet is rejected",
  outlineFaults(
    { ...goodOutline, sections: [{ heading: "What it costs", bullets: ["Usually 499 a month [G1]", "What moves it"] }, goodOutline.sections[1]] },
    ""
  ).some((f) => f.includes("499"))
);
check(
  "the same number is fine when a source carries it",
  outlineFaults(
    { ...goodOutline, sections: [{ heading: "What it costs", bullets: ["Usually 499 a month [G1]", "What moves it"] }, goodOutline.sections[1]] },
    "we charge 499 a month"
  ).length === 0
);
check(
  "a dash in a heading is rejected",
  outlineFaults({ ...goodOutline, sections: [{ ...goodOutline.sections[0], heading: "Cost — explained" }, goodOutline.sections[1]] }, "").some((f) => f.includes("dash"))
);
check("readOutline keeps a valid outline", readOutline({ ...goodOutline, writtenAt: "x" })?.gaps.length === 3);
check("readOutline drops an outline with no sections", readOutline({ sections: [], gaps: [] }) === null);

// ── 5. The offer bonus ───────────────────────────────────────────────────────
console.log("\n5. offerBonus is one definition and a bonus, not a filter");

check("a phrase naming the offer earns the bonus", offerBonus("how much does lip filler cost", "Lip filler") === OFFER_BONUS);
check("a phrase that does not name it earns nothing, and is not removed", offerBonus("does it hurt", "Lip filler") === 0);
check("no offer, no bonus", offerBonus("lip filler near me", null) === 0);

// ── 6. The dispatch grammar ──────────────────────────────────────────────────
//
// ‼️ A COPY OF THE PATTERNS IN page-studio.ts, for the reason _probe-page-studio.ts keeps one:
// importing that file pulls the Slack client and the database in. If a pattern there changes,
// change it here, and this section says whether the dictation is still safe.
console.log("\n6. The new commands fire, and the dictation they could swallow does not");

const PLAN = /^plan(?:\s+(new|approve|(?:drop|swap)\s+[0-9]{1,2}|edit\s+[0-9]{1,2}\s*:\s*.+))?$/i;
const ANCHOR = /^anchor(?:\s*:\s*(\S+))?$/i;
const OUTLINE = /^outline(\s+new)?$/i;
const ADD = /^\s*add\s*:\s*([\s\S]+)$/i;

for (const c of ["plan", "plan new", "plan approve", "plan drop 4", "plan swap 12", "plan edit 3: A better title"]) {
  check(`"${c}" is a plan command`, PLAN.test(c));
}
for (const d of ["plan ahead for your first visit", "plans change", "plan drop everything else", "planning matters"]) {
  check(`"${d}" is dictation`, !PLAN.test(d));
}
check('"anchor: visibility_scan" sets the anchor', ANCHOR.exec("anchor: visibility_scan")?.[1] === "visibility_scan");
check('"anchor" lists', ANCHOR.test("anchor"));
for (const d of ["anchor text matters for links", "anchor text"]) check(`"${d}" is dictation`, !ANCHOR.test(d));
check('"outline" and "outline new" fire', OUTLINE.test("outline") && OUTLINE.test("outline new"));
check('"outline the process for me" is dictation', !OUTLINE.test("outline the process for me"));
check('"add: 1" carries the 1', ADD.exec("add: 1")?.[1] === "1");
check('"add a note about pricing" is dictation', !ADD.test("add a note about pricing"));

// ── The card itself ──────────────────────────────────────────────────────────
console.log("\n7. The plan card carries no banned dash");

const row: PlanRow = {
  id: "x",
  clientId: "c",
  rank: 1,
  question: "How much does this cost?",
  targetKeyword: "How much does this cost?",
  workingTitle: goodRow.workingTitle,
  angle: goodRow.angle,
  theme: "Price",
  origin: "harvested",
  frame: goodRow.frame,
  status: "proposed",
  pageId: null,
  pageStatus: null,
};
const card = formatPlan([row, { ...row, id: "y", rank: 2, status: "approved" }], "The AI Visibility Scan");
check("no dash in the rendered card", !hasBannedDash(card), card);
check("the card names the anchor", card.includes("The AI Visibility Scan"));

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
