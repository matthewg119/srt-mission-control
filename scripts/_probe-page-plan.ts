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

import {
  isPlannable,
  selectPlan,
  selectOfferPlan,
  frameFaults,
  formatPlan,
  MAX_PER_THEME,
  MAX_PER_CATEGORY,
  PRE_CALL_SUPPORTS,
  PLAN_COMMAND,
  ANCHOR_COMMAND,
  type OfferPoolItem,
  type PoolItem,
  type PlanRow,
} from "@/lib/clients/page-plan";
import { outlineFaults, OUTLINE_LIMITS } from "@/lib/hub/draft-page";
import { readOutline } from "@/lib/hub/pages";
import { readFrame, CTA_MAX } from "@/lib/concierge/magnet-drafts";
import { offerBonus, OFFER_BONUS } from "@/lib/clients/artifacts/page-candidates";
import { normalizePhrase, isAboutOffer, offerVocabulary } from "@/lib/clients/phrase-quality";
import { planLinksFor, orderIndexPages, type PlanLinkRow, type PublishedPageRef } from "@/lib/hub/plan-links";
import { breadcrumbJsonLd } from "@/lib/hub/jsonld";
import { MAP, layoutPlanMap, relatedPairs, wrapLabel, type MapNode } from "@/lib/clients/plan-map";
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
  // Top of SRT's first live keyword run, 2026-09-11: a button label welded onto a heading.
  "Request a free AEO audit What is Answer Engine Optimization for aesthetic practices?",
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
// ‼️ PLAN AND ANCHOR ARE THE REAL PATTERNS NOW, imported from page-plan.ts, which the studio and
// the pre-call step's thread both read. They used to be hand copies of page-studio.ts's inline
// regexes, which is how a probe goes green over a pattern nobody runs. OUTLINE and ADD are still
// copies: they live inside page-studio.ts, and importing that pulls the Slack client in.
console.log("\n6. The new commands fire, and the dictation they could swallow does not");

const PLAN = PLAN_COMMAND;
const ANCHOR = ANCHOR_COMMAND;
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
  role: null,
  pillarId: null,
  keywordCategory: null,
};
const card = formatPlan([row, { ...row, id: "y", rank: 2, status: "approved" }], "The AI Visibility Scan");
check("no dash in the rendered card", !hasBannedDash(card), card);
check("the card names the anchor", card.includes("The AI Visibility Scan"));
const rolesCard = formatPlan([{ ...row, role: "pillar" }, { ...row, id: "z", rank: 2, role: "support" }], null);
check("a pre-call card labels the pillar and the supports", rolesCard.includes("[Pillar]") && rolesCard.includes("[Support]"));

// ── 8. The pre-call plan ─────────────────────────────────────────────────────
console.log("\n8. The pre-call plan: one pillar, eight supports, strict spread, never padded");

const op = (question: string, category: string, over: Partial<OfferPoolItem> = {}): OfferPoolItem => ({
  question,
  score: 30,
  category,
  categoryLabel: category,
  tier: 1,
  naming: category === "naming",
  relevant: true,
  ...over,
});

const CATS = ["price", "fear", "comparison", "process", "candidacy", "results", "provider", "local"];
const offerPool: OfferPoolItem[] = [
  op("lip filler", "naming", { score: 20 }),
  op("lip injections", "naming", { score: 19 }),
  ...CATS.flatMap((cat, i) => [
    op(`${cat} question one about lip filler`, cat, { score: 40 - i }),
    op(`${cat} question two about lip filler`, cat, { score: 39 - i }),
    op(`${cat} question three about lip filler`, cat, { score: 38 - i }),
  ]),
  op("does botox hurt", "fear", { relevant: false, score: 99 }),
];

const full = selectOfferPlan(offerPool, { city: "Charlotte" });
check("the pillar is the top naming variant", full.pillar?.item.question === "lip filler", full.pillar?.item.question);
check("its keyword carries the city when the business is local", full.pillar?.keyword === "lip filler Charlotte", full.pillar?.keyword);
check(`${PRE_CALL_SUPPORTS} supports`, full.supports.length === PRE_CALL_SUPPORTS, `got ${full.supports.length}`);
const perCat = new Map<string, number>();
for (const s of full.supports) perCat.set(s.category, (perCat.get(s.category) ?? 0) + 1);
check(
  `no category takes more than ${MAX_PER_CATEGORY}`,
  [...perCat.values()].every((n) => n <= MAX_PER_CATEGORY),
  [...perCat.entries()].map(([c, n]) => `${c}=${n}`).join(", ")
);
check("a row that is not about the offer never gets in, whatever its score", !full.supports.some((s) => s.question.includes("botox")));
check("the pillar is not also a support", !full.supports.some((s) => s.question === "lip filler"));
check("no naming variant is a support: the pillar owns that search", !full.supports.some((s) => s.naming));
check(
  "eight supports land in eight categories when the set has them",
  new Set(full.supports.map((s) => s.category)).size === PRE_CALL_SUPPORTS,
  full.supports.map((s) => s.category).join(", ")
);
check("a full plan names no fix", full.fix === null);
check("no city, no city in the pillar keyword", selectOfferPlan(offerPool, { city: null }).pillar?.keyword === "lip filler");
check(
  "a naming variant that already carries the city is not given it twice",
  selectOfferPlan([op("lip filler charlotte", "naming"), ...offerPool.slice(2)], { city: "Charlotte" }).pillar?.keyword === "lip filler charlotte"
);

const thin = selectOfferPlan(
  [
    op("lip filler", "naming"),
    op("lip filler cost", "price"),
    op("lip filler price per syringe", "price"),
    op("lip filler price deals", "price"),
    op("does lip filler hurt", "fear"),
    op("how to choose a med spa", "provider", { relevant: false }),
  ],
  { city: null }
);
check("a thin set gives a SHORT plan", thin.supports.length === 3, `got ${thin.supports.length}`);
check("it is not padded past the category cap", thin.supports.filter((s) => s.category === "price").length === MAX_PER_CATEGORY);
check("or with a question about the vertical", !thin.supports.some((s) => s.question.includes("choose a med spa")));
check("and it says what would fill it", thin.short === 5 && Boolean(thin.fix?.includes("KEYWORDS block")), thin.fix ?? "");

const noPillar = selectOfferPlan([op("lip filler cost", "price")], { city: null });
check("no naming variant means no pillar, and the fix says so", noPillar.pillar === null && Boolean(noPillar.fix?.includes("keywords more naming")));

const tiers = selectOfferPlan(
  [
    op("lip filler", "naming"),
    op("proposed price question lip filler", "price", { tier: 1, score: 90 }),
    op("evidenced price question lip filler", "price", { tier: 0, score: 5 }),
    op("another proposed price question lip filler", "price", { tier: 1, score: 80 }),
  ],
  { city: null }
);
check("an evidenced row is chosen before a proposal, whatever the scores", tiers.supports[0]?.question.startsWith("evidenced"));

// ── 9. The offer-relevance test ──────────────────────────────────────────────
console.log("\n9. The offer-relevance test (the full set is in _probe-keywords.ts)");

const lipV = offerVocabulary({ treatment: "Lip filler", terms: ["lip flip"] });
check("lip filler client: 'does lip filler hurt' is about the offer", isAboutOffer("does lip filler hurt", lipV));
check("lip filler client: 'is botox safe' is not", !isAboutOffer("is botox safe", lipV));
const srtV = offerVocabulary({ treatment: "AEO Services for med spas", terms: ["AEO", "answer engine optimization"] });
check("SRT: 'best AEO agency for med spas' is about the offer", isAboutOffer("best AEO agency for med spas", srtV));
check("SRT: 'how to choose a med spa' is not", !isAboutOffer("how to choose a med spa", srtV));
check(
  "the whole-string test on the treatment alone misses it, which was the measured problem",
  offerBonus("best AEO agency for med spas", "AEO Services for med spas") === 0
);

// ── 10. The links a pillar and a support render ─────────────────────────────
console.log("\n10. Links come from the plan, published pages only, plus BreadcrumbList");

const linkPlan: PlanLinkRow[] = [
  { planId: "P", pageId: "p-pillar", role: "pillar", pillarId: null, theme: "Naming", workingTitle: "Lip filler in Charlotte", rank: 1 },
  { planId: "S1", pageId: "p-s1", role: "support", pillarId: "P", theme: "Price", workingTitle: "What lip filler costs", rank: 2 },
  { planId: "S2", pageId: "p-s2", role: "support", pillarId: "P", theme: "Price", workingTitle: "Paying for lip filler over time", rank: 3 },
  { planId: "S3", pageId: "p-s3", role: "support", pillarId: "P", theme: "Fear", workingTitle: "Does lip filler hurt", rank: 4 },
  { planId: "S4", pageId: "p-s4", role: "support", pillarId: "P", theme: "Fear", workingTitle: "Is lip filler safe", rank: 5 },
];
const livePages: PublishedPageRef[] = [
  { id: "p-pillar", slug: "lip-filler-charlotte", title: "Lip filler in Charlotte" },
  { id: "p-s1", slug: "lip-filler-cost", title: "Cost" },
  { id: "p-s2", slug: "lip-filler-financing", title: "Financing" },
  { id: "p-s3", slug: "does-lip-filler-hurt", title: "Hurt" },
  // p-s4 is a DRAFT: absent from the published list.
];

const pillarLinks = planLinksFor("p-pillar", linkPlan, livePages);
check(
  "the pillar lists its published supports in rank order",
  pillarLinks.supports.map((s) => s.slug).join() === "lip-filler-cost,lip-filler-financing,does-lip-filler-hurt",
  pillarLinks.supports.map((s) => s.slug).join()
);
check("a draft support is never linked", !pillarLinks.supports.some((s) => s.slug.includes("safe")));
check("the anchor text is the working title", pillarLinks.supports[0]?.title === "What lip filler costs");
const supportLinks = planLinksFor("p-s1", linkPlan, livePages);
check("a support links its pillar", supportLinks.pillar?.slug === "lip-filler-charlotte");
check(
  "and two related siblings, same theme first",
  supportLinks.related.length === 2 && supportLinks.related[0]?.slug === "lip-filler-financing",
  supportLinks.related.map((r) => r.slug).join()
);
check("a support never lists itself", !supportLinks.related.some((r) => r.slug === "lip-filler-cost"));
check(
  "no pillar link while the pillar is a draft",
  planLinksFor("p-s1", linkPlan, livePages.filter((p) => p.id !== "p-pillar")).pillar === null
);
const offPlan = planLinksFor("p-other", linkPlan, livePages);
check("a page not on the plan carries nothing", offPlan.pillar === null && offPlan.supports.length === 0 && offPlan.related.length === 0);
check("the index leads with the pillar", orderIndexPages([{ id: "p-s1" }, { id: "p-pillar" }], linkPlan)[0]?.id === "p-pillar");

const crumbs = breadcrumbJsonLd([
  { name: "Hub", url: "https://learn.example.com/" },
  { name: "Lip filler in Charlotte", url: "https://learn.example.com/lip-filler-charlotte" },
  { name: "What lip filler costs", url: "https://learn.example.com/lip-filler-cost" },
]) as Record<string, unknown>;
const crumbItems = (crumbs.itemListElement as Array<Record<string, unknown>> | undefined) ?? [];
check(
  "BreadcrumbList: three ListItems, positions 1 to 3",
  crumbs["@type"] === "BreadcrumbList" &&
    crumbItems.length === 3 &&
    crumbItems.every((it, i) => it["@type"] === "ListItem" && it.position === i + 1),
  JSON.stringify(crumbs)
);
check("with absolute URLs", crumbItems.every((it) => String(it.item).startsWith("https://")));

// ── 11. The plan map ─────────────────────────────────────────────────────────
console.log("\n11. The plan map: no box overlaps another, labels fit, links match the hub's");

const overlaps = (a: { x: number; y: number }, b: { x: number; y: number }, w: number, h: number) =>
  Math.abs(a.x - b.x) < w && Math.abs(a.y - b.y) < h;
for (const n of [3, 5, 8]) {
  const pts = layoutPlanMap(n);
  const clash = pts.some((p, i) => pts.some((q, j) => j > i && overlaps(p, q, MAP.NODE_W, MAP.NODE_H)));
  const onPillar = pts.some((p) =>
    overlaps(p, { x: MAP.CX, y: MAP.CY }, (MAP.NODE_W + MAP.PILLAR_W) / 2, (MAP.NODE_H + MAP.PILLAR_H) / 2)
  );
  const inside = pts.every(
    (p) => p.x - MAP.NODE_W / 2 >= 0 && p.x + MAP.NODE_W / 2 <= MAP.W && p.y - MAP.NODE_H / 2 >= 0 && p.y + MAP.NODE_H / 2 <= MAP.H
  );
  check(`${n} supports: no two boxes overlap, none covers the pillar, all inside the drawing`, !clash && !onPillar && inside);
}
const wrapped = wrapLabel("What a med spa actually pays for answer engine optimization every month", 26, 2);
check("a long title wraps to at most two lines of 26", wrapped.length === 2 && wrapped.every((l) => l.length <= 26), wrapped.join(" / "));
check("and says it was cut", wrapped[1].endsWith("…"));
const mapNodes: MapNode[] = linkPlan.map((r) => ({
  planId: r.planId,
  rank: r.rank,
  role: r.role ?? "support",
  pillarId: r.pillarId,
  title: r.workingTitle,
  keyword: r.workingTitle,
  category: r.theme ?? "",
  status: "proposed",
  slug: null,
  words: null,
  unsourced: null,
  pill: null,
}));
const pairs = relatedPairs(mapNodes);
check("sibling links are drawn once per pair, never to itself", pairs.every(([a, b]) => a !== b) && new Set(pairs.map((p) => p.slice().sort().join())).size === pairs.length);
check("and match planLinksFor: support S1 links S2 and S3", pairs.some((p) => p.includes("S1") && p.includes("S2")) && pairs.some((p) => p.includes("S1") && p.includes("S3")));

console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) FAILED.`}`);
process.exit(failures === 0 ? 0 : 1);
