// Pure checks for phrase-kind.ts: the junk that filled SRT's Objection bucket is not an objection,
// and what buyers actually say is.
//
//   bunx tsx scripts/_probe-phrase-kind.ts

import { classifyPhrase } from "../src/lib/clients/phrase-kind";
import { BELIEF_THEMES, SEED_OBJECTIONS } from "../src/config/objections/aeo-agency-owner";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

// Measured in SRT's step 13 PDF, 2026-09-15, with the source each came from.
const NOT_OBJECTIONS: Array<[string, string]> = [
  ["Request the Governance Risk Audit A structured path to growth.", "harvest"],
  ["All services are delivered following the Governance Risk Audit.", "harvest"],
  ["The Governance Risk Audit.", "harvest"],
  ["Scam agencies break this model immediately.", "harvest"],
  ["### Compliance and Regulatory Risks", "deep_research"],
  ["### Compliance and Legal Risks", "deep_research"],
  ["Compliance and legal risk", "deep_research"],
  ["Compliance and legal risk from aggressive marketing", "deep_research"],
  ["This appears in equipment manufacturer guidance as a frequently overlooked operational risk.", "deep_research"],
  ["No fluff, no fake reviews.", "harvest"],
  ["If a client can book without commitment, your schedule is at risk.", "harvest"],
  ["For clinics operating in a high-trust environment, that materially changes the risk profile.", "harvest"],
  ["Risk is classified with clear reasoning.", "harvest"],
  ["Some channels are right for you; others carry more risk than reward.", "harvest"],
  ["When agencies are not law-literate, clinics inherit the risk.", "harvest"],
  ["Scam operations prefer payment channels that are difficult to reverse.", "harvest"],
];
for (const [p, src] of NOT_OBJECTIONS) {
  const r = classifyPhrase(p, src);
  check(`not an objection: ${p.slice(0, 70)}`, r.kind !== "objection", `${r.kind}: ${r.reason}`);
}

const OBJECTIONS: string[] = [
  "I'm spending hours every night on marketing that doesn't work.",
  "Is AEO worth it for a small med spa?",
  "How do I know this isn't a scam?",
  "We already pay an SEO agency",
  "Do patients actually use ChatGPT to find a med spa?",
  "I tried marketing agencies before and nothing happened",
  "Am I locked into a contract?",
  "How long until I see inquiries?",
  "Can you guarantee results?",
  "Is lip filler painful?",
  "Is botox safe while breastfeeding?",
  "What if it doesn't work?",
];
for (const p of OBJECTIONS) {
  const r = classifyPhrase(p, "harvest");
  check(`objection: ${p}`, r.kind === "objection" && r.speaker === "buyer", `${r.kind}/${r.speaker}: ${r.reason}`);
}

// ‼️ EVERY SEED IN THE REGISTRY, NOT JUST THE FIRST VERTICAL'S. This iterated AEO_OWNER_OBJECTIONS
// by name, so the day a second vertical was added its lines went unproven and the probe still said
// all checks pass. SEED_OBJECTIONS is the registry, so walking it is what keeps this honest as the
// list of verticals grows.
for (const [vertical, seeds] of Object.entries(SEED_OBJECTIONS)) {
  check(`${vertical} has a seed list`, seeds.length > 0, String(seeds.length));
  for (const o of seeds) {
    const r = classifyPhrase(o.text, "seed");
    check(`${vertical} seed reads as an objection: ${o.text}`, r.kind === "objection", `${r.kind}: ${r.reason}`);
    check(`${vertical} seed maps to a real belief: ${o.text}`, o.belief in BELIEF_THEMES, o.belief);
  }
}

const QUESTIONS = ["What is answer engine optimization?", "How does ChatGPT pick which med spa to recommend?"];
for (const p of QUESTIONS) {
  const r = classifyPhrase(p, "harvest");
  check(`plain question: ${p}`, r.kind === "question", r.kind);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall phrase kind checks pass");
