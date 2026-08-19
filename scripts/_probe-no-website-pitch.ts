// Probe: the no-website pitch drafter, on synthetic check results.
//
//   bunx tsx --env-file=.env.local scripts/_probe-no-website-pitch.ts
//
// Synthetic on purpose. runMiniVisibilityCheck is ~90s of research plus three engine calls, and
// researchViaClaude is already covered by _probe-claude-research.ts. What is NOT covered anywhere
// else is the part this file adds: does the right ANGLE get picked for the evidence, and does the
// finished email come out obeying the permission-stage rules.
//
// THE CASE THAT MATTERS MOST IS THE SECOND ONE. When no engine call returned data, the drafter
// must fall back to an angle that rests on research alone, and the email must not claim we asked
// ChatGPT anything. That is the "never claim work that was not done" rule, and it is the one
// failure here that a prospect catches on the first line.

import { draftNoWebsitePitch, pickAngle, type MiniCheck } from "../src/lib/audit-engine/no-website-pitch";
import { OUTREACH_SIGNATURE } from "../src/lib/audit-engine/email-assistant";
import type { BusinessIdentity } from "../src/lib/audit-engine/claude-research";

const identity: BusinessIdentity = {
  found: true,
  tradingName: "Michoacana 3mendos Tacos",
  whatTheyDo: "Family run taqueria serving birria, al pastor and street tacos for dine in and catering",
  services: ["birria tacos", "al pastor", "catering"],
  city: "Charlotte",
  state: "NC",
  cityConfidence: "high",
  alternates: [],
  websites: ["https://www.facebook.com/michoacana3mendos"],
  reviewsSummary: "4.6 stars across ~180 Google reviews, repeat praise for the birria",
  competitors: ["Taqueria El Rey", "Tacos El Nevado"],
  sources: [
    "https://www.facebook.com/michoacana3mendos",
    "https://www.yelp.com/biz/michoacana-3mendos-tacos-charlotte",
  ],
};

const WITH_ENGINES: MiniCheck = {
  identity,
  city: "Charlotte, NC",
  results: [
    { prompt: "Who are the best taquerias in Charlotte, NC?", appeared: false, named: ["Taqueria El Rey", "Tacos El Nevado", "Cuzcatlan"] },
    { prompt: "Who should I hire for taco catering in Charlotte, NC?", appeared: false, named: ["Taqueria El Rey"] },
    { prompt: "Can you recommend a few taquerias in Charlotte, NC?", appeared: false, named: ["Tacos El Nevado"] },
  ],
  enginesAnswered: true,
  platform: "https://www.facebook.com/michoacana3mendos",
};

/** The honesty case: every engine call came back empty (no key, rate limited, outage). */
const NO_ENGINES: MiniCheck = {
  identity,
  city: "Charlotte, NC",
  results: [
    { prompt: "Who are the best taquerias in Charlotte, NC?", appeared: null, named: [] },
    { prompt: "Who should I hire for taco catering in Charlotte, NC?", appeared: null, named: [] },
    { prompt: "Can you recommend a few taquerias in Charlotte, NC?", appeared: null, named: [] },
  ],
  enginesAnswered: false,
  platform: "https://www.facebook.com/michoacana3mendos",
};

/** Claims that are only true if an engine actually answered. */
const ENGINE_CLAIM_RE =
  /\b(i asked|i ran|i checked|i searched|came up|came back|i put .* into|chatgpt (said|gave|named|returned))\b/i;

async function one(name: string, check: MiniCheck, mustNotClaimEngines: boolean, first: string | null): Promise<boolean> {
  console.log(`\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}`);
  console.log(`angle picked: ${pickAngle(check).id}`);

  const draft = await draftNoWebsitePitch(check, "Michoacana 3mendos Tacos LLC", first);
  console.log(`\nSubject: ${draft.subject}\n`);
  console.log(draft.body);

  const problems: string[] = [];
  const all = `${draft.subject}\n${draft.body}`;

  if (draft.rejectedFindings.length) problems.push(`linter rejected: ${draft.rejectedFindings.join("; ")}`);
  if (all.includes("—")) problems.push("contains an em dash");
  if (/https?:\/\//i.test(all)) problems.push("contains a link (permission stage carries none)");
  if (/\$\d/.test(all)) problems.push("quotes a price");
  if ((all.match(/\?/g) ?? []).length !== 1) problems.push(`${(all.match(/\?/g) ?? []).length} question marks, want exactly 1`);
  if (!draft.body.includes("Want me to send it over?")) problems.push("missing the appended close");
  // Read the agency off the constant, never a literal: OUTREACH_SIGNATURE_AGENCY is an env
  // override, so a hardcoded "SRT Agency" here fails on a correctly signed email.
  if (!draft.body.includes(OUTREACH_SIGNATURE.agency)) problems.push("missing the sign-off");
  if (/\b(AEO|GEO|SERPs?|LLMs?)\b/.test(all)) problems.push("contains banned jargon");
  // The subject is a fixed shape set in code, never model-written: "<business> + ChatGPT".
  if (!/ \+ ChatGPT$/.test(draft.subject)) problems.push(`subject is not "<business> + ChatGPT": ${draft.subject}`);
  if (mustNotClaimEngines && ENGINE_CLAIM_RE.test(all)) {
    problems.push("CLAIMS AN ENGINE WAS ASKED, but no engine call returned data");
  }

  const firstLine = draft.body.split("\n")[0].trim();
  if (first && firstLine !== `${first},`) problems.push(`first line should be "${first}," but is "${firstLine}"`);
  if (!first && /^(hi|hello|dear)/i.test(firstLine)) problems.push(`greeted with no name to use: "${firstLine}"`);
  if (!first && firstLine.toLowerCase().includes("michoacana")) problems.push(`greeted the BUSINESS: "${firstLine}"`);

  const wordCount = draft.body.split(/\s+/).filter(Boolean).length;
  console.log(`\n[${wordCount} words including the close and sign-off]`);

  if (problems.length === 0) {
    console.log("✅ clean");
    return true;
  }
  for (const p of problems) console.log(`❌ ${p}`);
  return false;
}

async function main(): Promise<void> {
  // Named contact and anonymous contact: the second must greet NOBODY rather than greeting
  // the business, which is what it did before the greeting rule existed.
  const a = await one("WITH engine results, named contact (should open 'Guadalupe,')", WITH_ENGINES, false, "Guadalupe");
  const b = await one("NO engine results, NO contact name (must not greet the business)", NO_ENGINES, true, null);
  console.log(`\n${a && b ? "✅ both cases pass" : "❌ FAILURES above"}`);
  process.exit(a && b ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 probe threw:", e);
  process.exit(1);
});
