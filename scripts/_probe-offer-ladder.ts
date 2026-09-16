// Pure checks for the awareness ladder's rules and the pick-first plan. No network.
//
//   bunx tsx scripts/_probe-offer-ladder.ts

import { ladderFaults, recommendStage, toLadder, type LadderInputs } from "../src/lib/clients/offer-ladder";
import { selectOfferPlan, type OfferPoolItem } from "../src/lib/clients/page-plan";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const inputs: LadderInputs = {
  clientName: "SRT Agency LLC",
  audienceLabel: "med spa owners",
  buyer: "owner",
  treatment: "AEO/ SEO Services for med spas",
  terms: ["ai visibility", "chatgpt answers"],
  positioning: null,
  outcome: "more booked patients from AI answers",
  price: "$499/month",
  guarantee: null,
  beliefs: [],
  avatarNotes: [],
  objections: [],
  shortOffer: null,
  keywordsByStage: {
    5: { count: 10, examples: [] },
    4: { count: 60, examples: ["why is my med spa not on chatgpt"] },
    3: { count: 90, examples: ["aeo agency for med spas"] },
    2: { count: 40, examples: [] },
    1: { count: 2, examples: [] },
  },
  catalogue: [
    { key: "visibility_scan", title: "The AI Visibility Scan", promise: "See where you stand.", deliverable: true },
    { key: "city_rivals", title: "Who ChatGPT Names In Your City", promise: "The names.", deliverable: false },
  ],
};

const rung = (stage: number, extra: Record<string, unknown> = {}) => ({
  stage,
  reader_state: "Busy with patients and not thinking about AI.",
  angle: "Patients ask AI before they ask friends.",
  claim: "Your next patient asked ChatGPT first. Find out what it told her.",
  risk_reversal: null,
  anchor_key: "visibility_scan",
  proposed_magnet: null,
  beliefs: [],
  keyword_examples: [],
  proof_needed: "A measured scan.",
  ...extra,
});
const good = { rungs: [5, 4, 3, 2, 1].map((s) => rung(s)), recommended_stage: 3, why: "Most searches sit there." };

check("a clean ladder has no faults", ladderFaults(good, inputs).length === 0, ladderFaults(good, inputs).join(" | "));
check("four rungs is refused", ladderFaults({ rungs: good.rungs.slice(0, 4) }, inputs).some((f) => f.includes("exactly 5")));
check(
  "a guarantee with none on file is refused",
  ladderFaults({ rungs: [rung(5, { claim: "Named by ChatGPT in 30 days or you don't pay." }), ...good.rungs.slice(1)] }, inputs).length > 0
);
check(
  "a risk reversal with none on file is refused",
  ladderFaults({ rungs: [rung(5, { risk_reversal: "Free until it works." }), ...good.rungs.slice(1)] }, inputs).some((f) => f.includes("must be null"))
);
check(
  "a guarantee on file may be restated",
  ladderFaults(
    { rungs: [rung(5, { risk_reversal: "Free until 5 AI inquiries arrive." }), ...good.rungs.slice(1)] },
    { ...inputs, guarantee: "free until 5 AI inquiries, then $499/month" }
  ).length === 0
);
check(
  "an invented number is refused",
  ladderFaults({ rungs: [rung(5, { claim: "Clinics like yours get 37 new patients." }), ...good.rungs.slice(1)] }, inputs).some((f) => f.includes("37"))
);
check(
  "an anchor with no asset is refused",
  ladderFaults({ rungs: [rung(5, { anchor_key: "city_rivals" }), ...good.rungs.slice(1)] }, inputs).some((f) => f.includes("hands over nothing"))
);
check(
  "an unknown anchor is refused",
  ladderFaults({ rungs: [rung(5, { anchor_key: "made_up" }), ...good.rungs.slice(1)] }, inputs).some((f) => f.includes("not in the catalogue"))
);
check("an em dash is refused", ladderFaults({ rungs: [rung(5, { angle: "AI — now" }), ...good.rungs.slice(1)] }, inputs).length > 0);
check("the recommendation follows the searches", recommendStage(inputs.keywordsByStage) === 3);
check("rungs are ordered 5 to 1", toLadder(good, inputs).rungs.map((r) => r.stage).join("") === "54321");

const item = (question: string, extra: Partial<OfferPoolItem> = {}): OfferPoolItem => ({
  question,
  score: 5,
  category: "price",
  categoryLabel: "Price and ROI",
  tier: 0,
  naming: false,
  focus: true,
  relevant: true,
  ...extra,
});
const pool: OfferPoolItem[] = [
  item("aeo agency for med spas", { naming: true, score: 9, category: "naming" }),
  item("answer engine optimization for med spas", { naming: true, score: 3, category: "naming", role: "pillar", keywordId: "k2" }),
  item("how much does aeo cost for a med spa", { role: "support", score: 1, keywordId: "k3" }),
  item("is aeo worth it for a small clinic", { score: 8 }),
];
const sel = selectOfferPlan(pool, { city: null });
check("a picked pillar beats a higher-scored naming variant", sel.pillar?.item.question === "answer engine optimization for med spas");
check("a picked support is placed first", sel.supports[0]?.question === "how much does aeo cost for a med spa");
check("the unpicked naming variant never becomes a support", !sel.supports.some((s) => s.question === "aeo agency for med spas"));

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall ladder checks pass");
