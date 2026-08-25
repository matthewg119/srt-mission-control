// Probe: the v4 Loom script — the offer, the two customer lanes, and the competitor fallbacks.
//
//   bunx tsx --env-file=.env.local scripts/_probe-loom-v4.ts
//
// Synthetic report and synthetic facts on purpose. A real audit is 20 engine calls, and none of
// what this file checks depends on the numbers being real: it checks the SHAPES the branches
// produce. This replaced _probe-loom-v3.ts, which tested the four tiers and the money guarantee.
//
// ‼️ THE CASES THAT MATTER MOST ARE THE COMPETITOR FALLBACKS. The script names a rival twice, off
// this audit's own run, and the third state is an audit where no usable rival came back. A script
// that fills that hole with "your competitor" is making a claim about a business that may not
// exist, said out loud, with no reviewer between the file and the recording. Every other assertion
// here costs a re-record if it fails. That one costs a sentence we cannot support.
//
// The second-most-important case is the customer lane. A pest control company that matched the
// aesthetics regex would have Matthew reading Botox prices on camera.
//
// The trade-voice call is real (one Claude call per render, ~800 tokens). Everything else in the
// script is a constant, which is the whole reason this probe is cheap enough to run on every edit.

import { buildLoomScript } from "../src/lib/audit-engine/loom-script";
import { spokenPromises } from "../src/lib/audit-engine/delivery-guards";
import {
  BOOKING_LINK,
  FREE_UNTIL_LINE,
  GUARANTEE_LINE,
  GUARANTEE_RESTATE,
  PRICE_RETAINER,
  VALUE_RECURRING,
} from "../src/config/pitch";
import type { BeatSheetFacts } from "../src/lib/audit-engine/loom-beatsheet";
import type { NicheAvatars } from "../src/lib/audit-engine/niche-avatars";
import type { ReportView } from "../src/lib/audit-engine/report-view";
import type { AuditReportRow } from "../src/lib/audit-engine/types";

const FORT_PIERCE = "nurse practitioner in Fort Pierce";
const BARBECUE = "I was at a barbecue with my wife";
/** Figures from the offer that no longer exists. None may appear in any render. */
const DEAD_PRICES = ["$349", "$999", "$4,999", "$399", "$299"];
/** Wording from the offer that no longer exists. */
const DEAD_OFFER = ["double your investment", "Complete + ChatGPT Ads", "Core Visibility", "Enterprise"];

const avatars = {
  worst: [
    { label: "the one-off highlight reel shopper", whyItHurts: "single deliverable, no repeat", economics: "$800 once", ownersSay: "they vanish after delivery" },
    { label: "the free-spec pitch chaser", whyItHurts: "unpaid concepting", economics: "$0", ownersSay: "wants three treatments before signing" },
    { label: "the wedding one-timer", whyItHurts: "never returns", economics: "$2k once", ownersSay: "one weekend and gone" },
  ],
  best: [
    { label: "The Corporate Film Program Buyer", ticket: "recurring annual retainer across multiple shoots", whyHighRoi: "predictable monthly revenue", aiQuestion: "who runs ongoing video programs for companies" },
    { label: "The Venue Residency Partner", ticket: "monthly house filmmaker arrangement", whyHighRoi: "guaranteed schedule", aiQuestion: "who films resident content for venues" },
    { label: "The Film School Pipeline Partner", ticket: "term-long placement contracts", whyHighRoi: "renews every term", aiQuestion: "which studios work with film students" },
  ],
  pick: 1,
  pickWhy: "recurring beats one-time",
  isReposition: false,
} as unknown as NicheAvatars;

const report = {
  id: "probe",
  client_name: "Northlight Pictures",
  business_type: "video production company",
  vertical_slug: "video-production",
  city: "Greensboro",
  buyer_persona: "corporate marketing directors and venue general managers",
  prospect_name: "Jorge",
  requester_name: null,
  score: 42,
  slug: "probe-northlight",
  website: "https://northlightpictures.com",
  site_signals: null,
  robots_check: null,
  loom_state: null,
} as unknown as AuditReportRow;

/** Same shape, but a business the aesthetics gate must catch. */
const clinicReport = {
  ...report,
  client_name: "Radiance Med Spa",
  business_type: "med spa",
  vertical_slug: "med-spa",
  buyer_persona: "women 30 to 55 considering injectables",
} as unknown as AuditReportRow;

const prompts = [
  "video production company in Greensboro that does ongoing corporate content",
  "who films resident content for venues in North Carolina",
  "best production studios near Greensboro that work with film school students",
  "corporate video retainer Greensboro",
  "Northlight Pictures reviews",
];

/**
 * A view where Cardinal Media appears in 3 questions the client is absent from.
 *
 * `recommended` has to be populated on the ABSENT, NON-BRANDED rows or competitorsWhereAbsent()
 * counts nothing — which is exactly the state `viewNoRival` below tests.
 */
function makeView(recommended: Array<{ name: string; isClient: boolean }>, mostRecommended: Array<{ name: string; count: number }>): ReportView {
  return {
    prompts: prompts.map((prompt, i) => ({
      block: i < 3 ? "SERVICIO" : i === 3 ? "COMPARATIVO" : "MARCA",
      prompt,
      appeared: i === 4,
      isBranded: i === 4,
      engines: { openai: null },
      recommended: i < 3 ? recommended : [],
    })),
    totalMentioned: 1,
    totalPrompts: 5,
    blockStats: [],
    citedDomains: [],
    mostRecommended,
  } as unknown as ReportView;
}

const view = makeView([{ name: "Cardinal Media", isClient: false }], [{ name: "Cardinal Media", count: 3 }]);
/** No rival in the absent questions, but one in mostRecommended: the name-only fallback. */
const viewNameOnly = makeView([], [{ name: "Cardinal Media", count: 3 }]);
/** Nothing at all. The script must say nothing about a competitor. */
const viewNoRival = makeView([], []);

function makeFacts(topCompetitor: { name: string; count: number } | null): BeatSheetFacts {
  return {
    company: "Northlight Pictures",
    score: 42,
    appeared: 1,
    total: 5,
    engines: ["ChatGPT"],
    topCompetitor,
    trampa: { prompt: "Northlight Pictures reviews", rank: 1 },
    apertura: { prompt: prompts[0], rank: null },
    ticketAlto: { prompt: prompts[1], rank: null },
    pattern: "",
    patternIsInferred: false,
    siteFinding: null,
    robotsVerdict: null,
    robotsBot: null,
    robotsEngine: null,
  } as unknown as BeatSheetFacts;
}

const facts = makeFacts({ name: "Cardinal Media", count: 3 });
const factsNoRival = makeFacts(null);

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** Case-insensitive occurrence count, for "exactly once" assertions. */
function count(haystack: string, needle: string): number {
  return haystack.toLowerCase().split(needle.toLowerCase()).length - 1;
}

/**
 * ONLY THE LINES THAT GET SAID OUT LOUD.
 *
 * Three things in the file are not speech and must not be asserted against as if they were:
 *   - the header block, which says things like "NO BOOKING LINK SET, do not say ...". That is the
 *     opposite of a leak, and a naive "no X anywhere" check reads it as one.
 *   - the `--- SECTION ---` rules, which are structural markers Matthew scrolls past.
 *   - the `[ON SCREEN: ...]` cues, which are stage directions.
 *
 * This matters beyond tidiness: `spokenPromises()` runs against a TRANSCRIPT, which is what was
 * actually said. Asserting against anything else measures a string no guard will ever see.
 */
function spokenPart(text: string): string {
  const start = text.indexOf("[ON SCREEN:");
  return (start === -1 ? text : text.slice(start))
    .split("\n")
    .filter((l) => !/^\s*---\s/.test(l) && !/^\s*\[ON SCREEN:/.test(l))
    .join("\n");
}

async function render(r: AuditReportRow, v: ReportView, f: BeatSheetFacts, price?: string) {
  const { text } = await buildLoomScript(r, v, f, avatars.best[0], {
    avatars,
    price: price ?? null,
  });
  return text;
}

async function main() {
  console.log(`\n=== The standard offer, generic vertical ===`);
  const genericFull = await render(report, view, facts);
  const generic = spokenPart(genericFull);

  check("guarantee stated once, in full", count(generic, GUARANTEE_LINE) === 1, `found ${count(generic, GUARANTEE_LINE)}`);
  // count() is case-insensitive on purpose: the script renders this through sentence(), so the
  // spoken form starts with a capital. spokenForm() in delivery-guards.ts is case-insensitive for
  // the same reason, so an exact-case check here would be testing something no guard enforces.
  check("the free period is stated", count(generic, FREE_UNTIL_LINE) === 1, `found ${count(generic, FREE_UNTIL_LINE)}`);
  check("the one price is quoted", generic.includes(PRICE_RETAINER));
  check("the recurring value is quoted", generic.includes(VALUE_RECURRING));
  check("all three pillars present", ["Number 1. Being findable", "Number 2. Being familiar", "Number 3. Staying fresh"].every((p) => generic.includes(p)));
  check("the pillars are named up front too", generic.includes("Being findable") && generic.includes("I will break those down"));
  check("the Fort Pierce anecdote is told", generic.includes(FORT_PIERCE));
  check("the barbecue anecdote is told", generic.includes(BARBECUE));
  check("the ads are present and UNPRICED", generic.includes("2016 Facebook ads") && !generic.includes("$999"));
  check("founding cohort named", generic.includes("founding clients"));

  // ‼️ The whole point of the rebuild. A figure from the dead offer reaching a recording is the
  // failure this probe exists to catch, because nobody reads the file before reading it out loud.
  for (const dead of DEAD_PRICES) {
    check(`dead price ${dead} does not appear`, !genericFull.includes(dead));
  }
  for (const dead of DEAD_OFFER) {
    check(`dead offer wording "${dead}" does not appear`, !genericFull.includes(dead));
  }

  console.log(`\n=== The customer lanes ===`);
  check("generic vertical reads the GENERATED avatar labels", generic.includes("The Corporate Film Program Buyer"));
  check("generic vertical does NOT read the patient types", !generic.includes("First-time injectable patients"));

  const clinicFull = await render(clinicReport, view, facts);
  const clinic = spokenPart(clinicFull);
  check("a med spa reads the HAND-WRITTEN patient types", clinic.includes("First-time injectable patients") && clinic.includes("Membership program buyers"));
  check("a med spa keeps the patient LTV figures", clinic.includes("$4,200 to $6,800"));
  check("a med spa does NOT read the generated labels", !clinic.includes("The Corporate Film Program Buyer"));
  check("a med spa names the customer to avoid", clinic.includes("Groupon deal hunters"));
  check("the header says which lane was taken", clinicFull.includes("AESTHETICS") && genericFull.includes("generated niche set"));
  check("the med spa still gets the same offer", clinic.includes(PRICE_RETAINER) && count(clinic, FREE_UNTIL_LINE) === 1);
  check("the med spa still gets the same anecdote", clinic.includes(FORT_PIERCE));

  console.log(`\n=== The competitor, and its two fallbacks ===`);
  check("the gap count is spoken", generic.includes("Cardinal Media showed up in 3 of the ones you are missing from"));
  check("the rival is named in the close", generic.includes("or Cardinal Media is"));
  check("the header records the rival", genericFull.includes("Competitor named on camera: Cardinal Media"));

  const nameOnly = spokenPart(await render(report, viewNameOnly, facts));
  check("fallback 2 names the rival", nameOnly.includes("Cardinal Media"));
  check("fallback 2 speaks NO gap count", !nameOnly.includes("of the ones you are missing from"));

  const noRivalFull = await render(report, viewNoRival, factsNoRival);
  const noRival = spokenPart(noRivalFull);
  check("fallback 3 names no rival at all", !noRival.includes("Cardinal Media"));
  check("fallback 3 does NOT invent one", !/your competitor|a competitor|the competitor/i.test(noRival));
  check("fallback 3 keeps the either-or", noRival.includes("going to become the name that keeps getting quoted"));
  check("fallback 3 warns in the header", noRivalFull.includes("NO COMPETITOR FOUND"));

  console.log(`\n=== The close, and the link that has to exist ===`);
  if (BOOKING_LINK) {
    check("the close sends them to the booking link", generic.includes("book the onboarding call"));
    check("no payment/checkout language survives", !/pay by credit card|payment page|after the payment/i.test(generic));
  } else {
    check("with no booking link the header corrects it", genericFull.includes("NO BOOKING LINK SET"));
    check("with no booking link the close does not promise one", !generic.includes("The link to book the onboarding call is right here"));
  }

  console.log(`\n=== A hand-quoted price drops the standard commitments ===`);
  const handFull = await render(report, view, facts, "$299 / month");
  check("the hand-quoted price is used", handFull.includes("$299 / month"));
  check("the header says it was quoted by hand", handFull.includes("quoted by hand"));

  console.log(`\n=== spokenPromises: the guard, not the script ===`);
  const approvedGuarantee = `${GUARANTEE_LINE}. That is the deal.`;
  const approvedFree = `Here is how it works: ${FREE_UNTIL_LINE}.`;
  const paraphrase = "We guarantee you'll make your money back, and this pays for itself in a month.";
  const unapprovedCount = "We will get you 15 new patients in the first month.";
  const oldDoubling = "We will double your investment in the first month.";

  check("the approved guarantee passes", spokenPromises(approvedGuarantee).length === 0, JSON.stringify(spokenPromises(approvedGuarantee)));
  // ‼️ THE ONE THAT MATTERS. FREE_UNTIL_LINE names a number of inquiries, which is the single
  // pattern DELIVERY_BANNED_PROMISES exists to enforce. It passes ONLY because it is masked by
  // exact string, and the next check is what proves the mask did not become a topic exemption.
  check("the approved free period passes", spokenPromises(approvedFree).length === 0, JSON.stringify(spokenPromises(approvedFree)));
  check("a PARAPHRASE of the guarantee still fails", spokenPromises(paraphrase).length > 0);
  check("an UNAPPROVED count of patients still fails", spokenPromises(unapprovedCount).length > 0);
  check("the retired doubling claim still fails", spokenPromises(oldDoubling).length > 0);

  console.log(failures === 0 ? `\nAll checks passed.\n` : `\n${failures} FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
