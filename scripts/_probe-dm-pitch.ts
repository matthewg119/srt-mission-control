// Probe for the Instagram DM lane's PURE logic — angle selection, the fixed finding lines, the
// `dm` lint stage, and the profile parsers the extension feeds it.
//
// These are the parts that decide what a stranger is told about their own business in a message
// that goes out from a phone in about four seconds, and all of them are pure, so they are
// checkable without spending an engine call. The model-facing half (draftDmVariants) needs live
// keys and is verified by pressing the button.
//
//   bunx tsx --env-file=.env.local scripts/_probe-dm-pitch.ts

import {
  pickDmAngle,
  dmSubjectOf,
  dmContext,
  stripVariantLabel,
  findingWarningFor,
  type DmFacts,
} from "../src/lib/audit-engine/dm-pitch";
import type { HookCheck } from "../src/lib/audit-engine/hook-pitch";
import type { MiniCheck } from "../src/lib/audit-engine/no-website-pitch";
import { lintDraft } from "../src/lib/audit-engine/draft-linter";
import { PERMISSION_CLOSE } from "../src/lib/audit-engine/email-assistant";
import { dmRivalLine, DM_ASK_LINE, DM_CLOSE_LINE, DM_MAX_SENTENCES } from "../src/config/pitch";
import {
  normalizeHandle,
  firstNameFrom,
  cityFromBio,
  unwrapInstagramLink,
  isAggregator,
  businessNameFrom,
} from "../src/lib/instagram/profile";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) console.log(`        expected ${JSON.stringify(expected)}\n        got      ${JSON.stringify(actual)}`);
}

function hook(over: Partial<HookCheck> = {}): DmFacts {
  return {
    kind: "hook",
    check: {
      businessName: "Hairthetics",
      trade: "hair transplant surgery",
      buyerPersona: "a man in his thirties researching a hair transplant",
      city: "Hallandale Beach, FL",
      website: "https://www.hairthetics.com",
      results: [],
      measuredCount: 0,
      appearedCount: 0,
      topRival: null,
      siteSignals: [],
      robots: null,
      readTheirPages: true,
      ...over,
    } as HookCheck,
  };
}

const MISS = { prompt: "who does hair transplants in Hallandale Beach", appeared: false, named: ["Foundation Hair"] };
const HIT = { prompt: "best hair transplant clinic near Hallandale Beach", appeared: true, named: [] };
const NODATA = { prompt: "top hair restoration Hallandale", appeared: null, named: [] };

// ── The angle gates ──────────────────────────────────────────────────────────

check(
  "a miss plus a real rival gives the reference angle",
  pickDmAngle(hook({ results: [MISS, HIT], measuredCount: 2, appearedCount: 1, topRival: { name: "Foundation Hair", count: 1 } })).id,
  "rival-substitute"
);

check(
  "a miss with NO extracted rival never names one",
  pickDmAngle(hook({ results: [MISS, HIT], measuredCount: 2, appearedCount: 1, topRival: null })).id,
  "buying-question"
);

check(
  "a clean sweep can never get an absence angle",
  pickDmAngle(hook({ results: [HIT, HIT], measuredCount: 2, appearedCount: 2, topRival: { name: "Foundation Hair", count: 2 } })).id,
  "present-but-thin"
);

check(
  "nothing measured falls through to the no-site angle rather than claiming a miss",
  pickDmAngle(hook({ results: [NODATA, NODATA], measuredCount: 0, appearedCount: 0 })).id,
  "no-site"
);

// ── The no-website lane ──────────────────────────────────────────────────────

function mini(over: Partial<MiniCheck> = {}): DmFacts {
  return {
    kind: "nowebsite",
    businessName: "Hairthetics",
    check: {
      identity: null,
      researched: false,
      city: "Hallandale Beach, FL",
      results: [],
      enginesAnswered: false,
      platform: null,
      ...over,
    } as MiniCheck,
  };
}

check(
  "the no-website lane only ever reaches the no-site angle",
  pickDmAngle(mini({ results: [MISS, HIT], enginesAnswered: true })).id,
  "no-site"
);

check(
  "the no-website lane NEVER carries a rival, even when the check names one",
  dmSubjectOf(mini({ results: [MISS], enginesAnswered: true })).topRival,
  null
);

check(
  "and so its brief tells the drafter it may not name a competitor",
  dmContext(mini({ results: [MISS], enginesAnswered: true }), pickDmAngle(mini({ results: [MISS] })))
    .includes("You may NOT name any competitor in this message."),
  true
);

// ── The fixed line, and the warning that catches a reworded one ──────────────

const RIVAL_FACTS = hook({
  results: [MISS, HIT],
  measuredCount: 2,
  appearedCount: 1,
  topRival: { name: "Foundation Hair", count: 1 },
});

check(
  "the reference line reads exactly as Matthew wrote it",
  dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", "Foundation Hair", "Hairthetics"),
  "I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up. Hairthetics doesn't."
);

check(
  "the state is dropped from the city, so the sentence does not carry two commas in four words",
  dmRivalLine("laser hair removal", "Bakersfield, CA", "X", "Y").includes("in Bakersfield,"),
  true
);

check(
  "the brief hands the finished sentence over rather than asking for a fraction",
  dmContext(RIVAL_FACTS, pickDmAngle(RIVAL_FACTS)).includes("Foundation Hair shows up. Hairthetics doesn't."),
  true
);

check(
  "a body that reproduced the fixed line raises no warning",
  findingWarningFor(
    "Hey Han,\n\nI ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up. Hairthetics doesn't.\n\n" + DM_ASK_LINE,
    dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", "Foundation Hair", "Hairthetics")
  ),
  null
);

check(
  "a curly apostrophe still counts as reproduced",
  findingWarningFor(
    "I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up. Hairthetics doesn’t.",
    dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", "Foundation Hair", "Hairthetics")
  ),
  null
);

check(
  "a REWORDED fixed line is caught",
  findingWarningFor(
    "I checked and Foundation Hair ranks above you for hair transplants.",
    dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", "Foundation Hair", "Hairthetics")
  ) !== null,
  true
);

// ── The `dm` lint stage ──────────────────────────────────────────────────────

const GOOD_DM = `Hey Han,

I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up. Hairthetics doesn't.

${DM_ASK_LINE}

${DM_CLOSE_LINE}`;

check("a well-formed DM passes the dm stage", lintDraft({ body: GOOD_DM, stage: "dm" }).ok, true);

check(
  "‼️ the DM is NOT failed for missing the email's permission close",
  lintDraft({ body: GOOD_DM, stage: "dm" }).findings.some((f) => f.rule === "missing-close"),
  false
);

check(
  "...but the SAME body still fails draft-1, so the email lane's gate is untouched",
  lintDraft({ body: GOOD_DM, stage: "draft-1" }).findings.some((f) => f.rule === "missing-close"),
  true
);

check(
  "and an email carrying the close still passes draft-1's close check",
  lintDraft({ body: `Hello,\n\nOne finding here.\n\n${PERMISSION_CLOSE[0]}\n\n${PERMISSION_CLOSE[1]}`, stage: "draft-1" })
    .findings.some((f) => f.rule === "missing-close"),
  false
);

const LONG_DM = `Hey Han,

${Array.from({ length: DM_MAX_SENTENCES + 2 }, (_, i) => `Sentence number ${i + 1} is here.`).join(" ")}

${DM_ASK_LINE}`;

check(
  "a DM over the sentence ceiling is rejected",
  lintDraft({ body: LONG_DM, stage: "dm" }).findings.some((f) => f.rule === "dm-length"),
  true
);

check(
  "a DM that asks twice is rejected",
  lintDraft({ body: `Hey Han,\n\nDid you know this? ${DM_ASK_LINE}`, stage: "dm" }).findings.some(
    (f) => f.rule === "double-ask"
  ),
  true
);

check(
  "banned jargon still rejects on the dm stage",
  lintDraft({ body: `Hey Han,\n\nYour schema markup is missing.\n\n${DM_ASK_LINE}`, stage: "dm" }).ok,
  false
);

check(
  "an unbacked site tease still rejects on the dm stage",
  lintDraft({
    body: `Hey Han,\n\nThere is one thing on your site working against you.\n\n${DM_ASK_LINE}`,
    stage: "dm",
    siteSignals: [],
    robots: null,
  }).findings.some((f) => f.rule === "robots-tease"),
  true
);

// ── The profile parsers ──────────────────────────────────────────────────────

check("a handle is normalized off a profile URL", normalizeHandle("https://www.instagram.com/hairthetics_fl/"), "hairthetics_fl");
check("an @ prefix is stripped and the case dropped", normalizeHandle("@Hairthetics_FL"), "hairthetics_fl");
check("a DM path is not mistaken for a handle", normalizeHandle("https://www.instagram.com/direct/t/12345"), null);
check("junk is refused rather than guessed at", normalizeHandle("not a handle!"), null);

check("a person's first name is found", firstNameFrom("Han MD, PHD. Hairthetics | Hair & Ear Surgery FL"), "Han");
check("a bare person's name works", firstNameFrom("Sarah Whitfield"), "Sarah");
check("‼️ a brand is NOT greeted as a person", firstNameFrom("Hairthetics | Hair Restoration"), null);
check("...nor is a service word", firstNameFrom("Laser Skin Studio"), null);
check("...nor a shouted brand", firstNameFrom("GLOWHOUSE MEDSPA"), null);
check("a bare credential returns nothing rather than 'Dr'", firstNameFrom("Dr. "), null);

check(
  "the city is read off a bio address line",
  cityFromBio("601 N Federal Hwy Suite 411, Hallandale Beach, Florida 33009"),
  "Hallandale Beach, FL"
);
check("a two-letter state works too", cityFromBio("Now open in Austin, TX"), "Austin, TX");
check("a bio with no address gives null rather than a guess", cityFromBio("Board certified. DM to book."), null);

check(
  "Instagram's link wrapper is unwrapped",
  unwrapInstagramLink("https://l.instagram.com/?u=https%3A%2F%2Fwww.hairthetics.com%2F&e=ABC"),
  "https://www.hairthetics.com/"
);
check("a plain URL passes through", unwrapInstagramLink("hairthetics.com"), "https://hairthetics.com/");
check("a linktree is recognised as an aggregator", isAggregator("https://linktr.ee/hairthetics"), true);
check("a real site is not", isAggregator("https://www.hairthetics.com"), false);

check(
  "the business name is taken over the person",
  businessNameFrom("Han MD, PHD. Hairthetics | Hair & Ear Surgery FL"),
  "Hairthetics"
);
check("a plain business name passes through", businessNameFrom("Glow Med Spa"), "Glow Med Spa");
check(
  "‼️ an honorific is never returned as the business name",
  businessNameFrom("Dr. Sarah Whitfield"),
  "Sarah Whitfield"
);
check("nothing in, empty out, so the classifier reads the name off their pages", businessNameFrom(""), "");

check("a stray version label is stripped", stripVariantLabel("Version 2 (pretext): Hey Han,"), "Hey Han,");
check("a real first sentence is left alone", stripVariantLabel("Hey Han, I ran a quick check."), "Hey Han, I ran a quick check.");

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
