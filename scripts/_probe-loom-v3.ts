// Probe: the v3 Loom script, per tier, plus the guarantee guard.
//
//   bunx tsx --env-file=.env.local scripts/_probe-loom-v3.ts
//
// Synthetic report and synthetic facts on purpose. A real audit is 40 engine calls, and none of
// what this file checks depends on the numbers being real: it checks the SHAPE the tier produces.
//
// ‼️ THE CASE THAT MATTERS MOST IS THE SECOND ONE. On a tier with no ads in it, the words
// "guarantee", "double your investment" and "$999" must not appear ANYWHERE in the rendered file,
// because a recording is read out loud from that file and there is no reviewer between the two.
// Every other assertion here costs a re-record if it fails. That one costs a commitment we have no
// mechanism to keep, made to somebody who did not buy the mechanism.
//
// The trade-voice call is real (one Claude call per render, ~800 tokens). Everything else in the
// script is a constant, which is the whole reason this probe is cheap enough to run on every edit.

import { buildLoomScript } from "../src/lib/audit-engine/loom-script";
import { spokenPromises } from "../src/lib/audit-engine/delivery-guards";
import {
  GUARANTEE_LINE,
  GUARANTEE_RESTATE,
  RECOMMENDED_TIER,
} from "../src/config/pitch";
import type { BeatSheetFacts } from "../src/lib/audit-engine/loom-beatsheet";
import type { NicheAvatars } from "../src/lib/audit-engine/niche-avatars";
import type { ReportView } from "../src/lib/audit-engine/report-view";
import type { AuditReportRow } from "../src/lib/audit-engine/types";

const FLORIDA = "I had a guy in Florida";
const BARBECUE = "I was at a barbecue with my wife";
const CUT_MATH_LINE = "make back the investment";

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

const prompts = [
  "video production company in Greensboro that does ongoing corporate content",
  "who films resident content for venues in North Carolina",
  "best production studios near Greensboro that work with film school students",
  "corporate video retainer Greensboro",
  "Northlight Pictures reviews",
];

const view = {
  prompts: prompts.map((prompt, i) => ({
    block: i < 3 ? "SERVICIO" : i === 3 ? "COMPARATIVO" : "MARCA",
    prompt,
    appeared: i === 4,
    isBranded: i === 4,
    engines: { openai: null },
    recommended: [],
  })),
  totalMentioned: 1,
  totalPrompts: 5,
  blockStats: [],
  citedDomains: [],
  mostRecommended: [{ name: "Cardinal Media", count: 3 }],
} as unknown as ReportView;

const facts: BeatSheetFacts = {
  company: "Northlight Pictures",
  score: 42,
  appeared: 1,
  total: 5,
  engines: ["ChatGPT"],
  topCompetitor: "Cardinal Media",
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
 *   - the header block, which says things like "GUARANTEE: OFF, do not say either". That is the
 *     opposite of a leak, and a naive "no guarantee anywhere" check reads it as one.
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

async function render(tier: string | null, price?: string) {
  const { text } = await buildLoomScript(report, view, facts, avatars.best[0], {
    avatars,
    tier,
    price: price ?? null,
  });
  return text;
}

async function main() {
  console.log(`\n=== ${RECOMMENDED_TIER} (the default) ===`);
  const adsFull = await render(RECOMMENDED_TIER);
  const ads = spokenPart(adsFull);
  check("guarantee stated once, in full", count(ads, GUARANTEE_LINE) === 1, `found ${count(ads, GUARANTEE_LINE)}`);
  check("guarantee restated once", count(ads, GUARANTEE_RESTATE) >= 1);
  check("the ads promise is present", ads.includes("Number 2. We put you in front of buyers today"));
  check("all three promises present", ["Number 1. We put you", "Number 2. We put you", "Number 3. We make you"].every((p) => ads.includes(p)));
  check("$999 quoted", ads.includes("$999"));
  check("header warns the guarantee is ON", adsFull.includes("GUARANTEE: ON"));
  check("Enterprise offered", ads.includes("$4,999"));
  check("annual terms said", ads.includes("Annual saves you 20%"));
  check("either-or says inside 30 days", ads.includes("starting inside 30 days"));
  check("organic window reconciled against the 30 days", ads.includes("60 to 90 days"));

  console.log(`\n=== Complete (loom complete / loom noads) ===`);
  const completeFull = await render("Complete");
  const complete = spokenPart(completeFull);
  // ‼️ The three that matter. A recording is read straight off this file.
  check("no guarantee anywhere", !/guarantee/i.test(complete), firstHit(complete, /.*guarantee.*/i));
  check("no doubling claim anywhere", !/double your investment/i.test(complete));
  check("no $999 anywhere", !complete.includes("999"));
  check("the ads promise dropped entirely", !complete.includes("We put you in front of buyers today"));
  check("no ChatGPT Ads pitch", !/ChatGPT Ads/i.test(complete));
  // Renumbered at render time: two promises are said as 1 and 2, never as 1 and 3.
  check("the two surviving promises are renumbered 1 and 2", complete.includes("Number 1. We put you in the list") && complete.includes("Number 2. We make you the default answer") && !complete.includes("Number 3."));
  check("still quotes the real tiers", complete.includes("$349") && complete.includes("$499"));
  check("the header still WARNS the operator it is off", completeFull.includes("GUARANTEE: OFF"));

  console.log(`\n=== Core ===`);
  const core = spokenPart(await render("Core"));
  check("no guarantee anywhere", !/guarantee/i.test(core));
  check("no $999 anywhere", !core.includes("999"));

  console.log(`\n=== loom $499 (hand-quoted price) ===`);
  const hand = spokenPart(await render(RECOMMENDED_TIER, "$499"));
  check("a hand-quoted price drops the guarantee", !/guarantee/i.test(hand));
  check("quotes only the hand-set number", hand.includes("the investment is $499"));

  console.log(`\n=== invariants, every tier ===`);
  for (const [label, text] of [["ads", ads], ["complete", complete], ["core", core]] as const) {
    check(`${label}: Florida story exactly once`, count(text, FLORIDA) === 1, `found ${count(text, FLORIDA)}`);
    check(`${label}: barbecue story exactly once`, count(text, BARBECUE) === 1, `found ${count(text, BARBECUE)}`);
    check(`${label}: the cut v2 ROI line is gone`, !text.includes(CUT_MATH_LINE));
    check(`${label}: no em dashes`, !text.includes("—"));
    check(`${label}: the 20 prompts survived`, text.includes(prompts[0]));
    // Asserted on what is SAID during the demo, not on the section marker: spokenPart() strips
    // the markers, and a marker surviving would not prove the beat under it did.
    check(`${label}: the live demo survived`, text.includes("Read the names it gives back"));
    check(`${label}: the concession survived`, text.includes("the one where you do well"));
    // v2 said "promise" once. v3 says the word in the same one place and titles its three
    // promises "Number N", so the transcript flag block does not fill up with expected hits.
    check(`${label}: says "promise" at most twice`, count(text, "promise") <= 2, `found ${count(text, "promise")}`);
  }

  console.log(`\n=== spokenPromises: the guard, not the script ===`);
  const approved = `${GUARANTEE_LINE}. That is the deal.`;
  const paraphrase = "We guarantee you'll make your money back, and this pays for itself in a month.";
  const unapprovedDoubling = "We will double your money in the first month.";
  const spoken = "at 2:14 he says we'll double your investment using ChatGPT Ads within 30 days, or you don't pay";

  check("approved wording passes on the ads tier", spokenPromises(approved, { allowedTier: RECOMMENDED_TIER }).length === 0);
  check("approved wording FAILS on Core", spokenPromises(approved, { allowedTier: "Core" }).length > 0);
  check("approved wording FAILS with no tier", spokenPromises(approved).length > 0);
  // The transcript is Matthew talking, so the contracted form has to be recognised too or the
  // approved guarantee would be flagged as a banned promise on every single recording.
  check("spoken contractions pass on the ads tier", spokenPromises(spoken, { allowedTier: RECOMMENDED_TIER }).length === 0, JSON.stringify(spokenPromises(spoken, { allowedTier: RECOMMENDED_TIER })));
  check("a PARAPHRASE still fails on the ads tier", spokenPromises(paraphrase, { allowedTier: RECOMMENDED_TIER }).length > 0);
  // The hole this probe found: "double your investment" matched no pattern at all before
  // 2026-08-21, so the approved wording was passing on every tier for the wrong reason.
  check("an UNAPPROVED doubling claim fails on the ads tier", spokenPromises(unapprovedDoubling, { allowedTier: RECOMMENDED_TIER }).length > 0);
  check("an unapproved doubling claim fails with no tier", spokenPromises(unapprovedDoubling).length > 0);

  console.log(failures === 0 ? `\nAll checks passed.\n` : `\n${failures} FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

function firstHit(text: string, re: RegExp): string {
  return text.match(re)?.[0]?.trim().slice(0, 160) ?? "";
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
