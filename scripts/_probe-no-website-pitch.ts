// Probe: the no-website pitch drafter, on synthetic check results.
//
//   bunx tsx --env-file=.env.local scripts/_probe-no-website-pitch.ts
//
// Synthetic on purpose. runMiniVisibilityCheck is ~90s of research plus three engine calls, and
// researchViaClaude is already covered by _probe-claude-research.ts. What is NOT covered anywhere
// else is the part this file adds: does the right ANGLE get picked for the evidence, and does the
// finished email come out obeying the permission-stage rules.
//
// THE TWO CASES THAT MATTER MOST ARE THE LAST TWO, and they are one rule a level apart. When no
// engine call returned data, the drafter must fall back to an angle resting on research alone and
// must not claim we asked ChatGPT anything. When RESEARCH itself came back empty, even that is
// gone: the only sayable finding is that we looked and found nothing readable, and the email must
// not claim a source, a category or a service it never saw — nor tell a business with a Google
// profile that it has no listing anywhere. That is the "never claim work that was not done" rule,
// and it is the failure a prospect catches on the first line.

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
  researched: true,
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
  researched: true,
  city: "Charlotte, NC",
  results: [
    { prompt: "Who are the best taquerias in Charlotte, NC?", appeared: null, named: [] },
    { prompt: "Who should I hire for taco catering in Charlotte, NC?", appeared: null, named: [] },
    { prompt: "Can you recommend a few taquerias in Charlotte, NC?", appeared: null, named: [] },
  ],
  enginesAnswered: false,
  platform: "https://www.facebook.com/michoacana3mendos",
};

/**
 * The JBR CRANE case: research could not identify the business from any public source, so there
 * is no identity, no trade, no platform and therefore no buyer question to ask. Everything the
 * email may say comes from the CRM row plus the fact that the search came back empty.
 */
const NO_RESEARCH: MiniCheck = {
  identity: null,
  researched: false,
  city: "Charlotte, NC",
  results: [],
  enginesAnswered: false,
  platform: null,
};

/** Claims that are only true if an engine actually answered. */
const ENGINE_CLAIM_RE =
  /\b(i asked|i ran|i checked|i searched|came up|came back|i put .* into|chatgpt (said|gave|named|returned))\b/i;

/**
 * ‼️ ENGINE_CLAIM_RE IS THE WRONG GUARD FOR THE UNRESEARCHED CASE, and the first run of this
 * probe proved it: the draft said "I went looking for a description ... and came back with
 * nothing I could read" and tripped on "came back". That sentence is TRUE. researchViaClaude
 * really did run a web search, so claiming to have LOOKED is claiming work that was done.
 *
 * What is false on that lane is narrower and this list is exactly it: that a buyer question was
 * put to an engine, that an engine answered, and that we saw who came up instead. "Offer to look,
 * never claim to have looked" is not the rule here — we did look. The rule is "never claim to
 * have measured".
 */
const NO_RESEARCH_ENGINE_CLAIM_RE = new RegExp(
  [
    "i asked (chatgpt|an? (ai )?engine|perplexity|claude|it)",
    "(chatgpt|the engine|an engine|the engines) (said|gave|named|returned|recommended|listed|came back)",
    "came up instead",
    "(named|returned|recommended|suggested) (other|another|three|two|several|a few)",
    "you were not (in|on|among)",
  ].join("|"),
  "i"
);

/**
 * Overclaims available ONLY when research found something, plus the two absolutes this angle is
 * most likely to reach for. "No listing" and "invisible" are sentences a prospect with a Google
 * Business Profile disproves from his own phone in ten seconds.
 */
const NO_RESEARCH_OVERCLAIM_RE = new RegExp(
  "\\b(invisible|do not exist|don't exist|nowhere to be found|" +
    "no (google )?(listing|profile|reviews|presence)|nobody can find|" +
    "not listed anywhere|no one can find)\\b",
  "i"
);

async function one(
  name: string,
  check: MiniCheck,
  mustNotClaimEngines: boolean,
  first: string | null,
  expectAngle?: string
): Promise<boolean> {
  console.log(`\n${"=".repeat(70)}\n${name}\n${"=".repeat(70)}`);
  const angle = pickAngle(check).id;
  console.log(`angle picked: ${angle}`);

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
  const claimRe = check.researched ? ENGINE_CLAIM_RE : NO_RESEARCH_ENGINE_CLAIM_RE;
  if (mustNotClaimEngines && claimRe.test(all)) {
    problems.push("CLAIMS AN ENGINE WAS ASKED, but no engine call returned data");
  }
  if (expectAngle && angle !== expectAngle) problems.push(`angle is "${angle}", want "${expectAngle}"`);
  if (!check.researched && NO_RESEARCH_OVERCLAIM_RE.test(all)) {
    problems.push("OVERCLAIMS: research finding nothing is not the same as them being absent everywhere");
  }

  const firstLine = draft.body.split("\n")[0].trim();
  // The greeting is appended by ensureGreeting(), so it is a CONSTANT shape now, not whatever
  // the model felt like. Hey + first name + comma, exactly, on every email that has a name.
  if (first && firstLine !== `Hey ${first},`)
    problems.push(`first line should be "Hey ${first}," but is "${firstLine}"`);
  // ‼️ THIS TESTED FOR A MENTION AND THE RULE IS ABOUT A GREETING. includes("michoacana")
  // failed a perfectly good draft that opened "I was looking at what AI search engines can pull
  // up for Michoacana 3mendos Tacos in Charlotte" - a first sentence, not a salutation, and
  // naming the prospect in it is normal cold-email prose. A greeting has a SHAPE: a salutation
  // word, or a short line ending in a comma. Testing the shape is both stricter about what it
  // catches and quieter about what it does not.
  const salutation = /^(hi|hello|hey|dear|good (morning|afternoon|evening))\b/i.test(firstLine);
  const bareNameGreeting = /,\s*$/.test(firstLine) && firstLine.split(/\s+/).length <= 8;
  if (!first && salutation) problems.push(`greeted with no name to use: "${firstLine}"`);
  if (!first && bareNameGreeting) problems.push(`greeted the BUSINESS: "${firstLine}"`);

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
  const a = await one(
    "WITH engine results, named contact (should open 'Guadalupe,')",
    WITH_ENGINES, false, "Guadalupe", "substitute"
  );
  const b = await one(
    "NO engine results, NO contact name (must not greet the business)",
    NO_ENGINES, true, null, "written-by-others"
  );
  const c = await one(
    "NO RESEARCH AT ALL (the JBR CRANE case: nothing public describes them)",
    NO_RESEARCH, true, "Rafael", "nothing-to-find"
  );

  // The gate must hold in BOTH directions. An unresearched angle handed to a prospect we DID
  // research throws away everything the research found, the mirror of the bug above.
  const wrongWay =
    pickAngle(WITH_ENGINES).id === "nothing-to-find" || pickAngle(NO_ENGINES).id === "nothing-to-find";
  if (wrongWay) console.log(`\n❌ "nothing-to-find" was picked for a RESEARCHED check`);
  const ok = a && b && c && !wrongWay;
  console.log(`\n${ok ? "✅ all three cases pass" : "❌ FAILURES above"}`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error("\n💥 probe threw:", e);
  process.exit(1);
});
