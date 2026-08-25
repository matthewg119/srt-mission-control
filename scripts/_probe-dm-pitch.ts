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
import {
  dmRivalLine,
  dmReasonLine,
  DM_ASK_LINE,
  DM_CLOSE_LINE,
  DM_MAX_SENTENCES,
} from "../src/config/pitch";
import { buildAliases, isMentioned } from "../src/lib/audit-engine/mention-match";
import { isNeverTheirSite, isBookingHost } from "../src/lib/audit-engine/web-hosts";

/** 1 of 4 for the business: the shape Matthew asked the DM to state. */
const RIVAL_COUNTS = { appeared: 1, measured: 4 };
/** The same run with a clean miss, which is the wording that carries an apostrophe. */
const ZERO_COUNTS = { appeared: 0, measured: 4 };
/** Each rival carries its OWN count. Two names under one count is a false claim about one of them. */
const ONE_RIVAL = [{ name: "Foundation Hair", count: 3 }];
const TWO_RIVALS = [
  { name: "Foundation Hair", count: 3 },
  { name: "Bogat Aesthetics", count: 2 },
];
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
      trade: "hair transplant surgery",
      tradeSource: "bio",
      results: [],
      enginesAnswered: false,
      topRivals: [],
      platform: null,
      bookingHost: null,
      ...over,
    } as MiniCheck,
  };
}

check(
  "the no-website lane reaches rival-substitute once it has measured rivals",
  pickDmAngle(mini({ results: [MISS, HIT], enginesAnswered: true, topRivals: ONE_RIVAL })).id,
  "rival-substitute"
);

check(
  "‼️ with no rivals extracted it falls to the absence angle rather than inventing one",
  pickDmAngle(mini({ results: [MISS, HIT], enginesAnswered: true, topRivals: [] })).id,
  "buying-question"
);

check(
  "‼️ and with nothing measured at all it still falls to the no-site floor",
  pickDmAngle(mini({ results: [], enginesAnswered: false, topRivals: [] })).id,
  "no-site"
);

check(
  "the no-website lane carries at most two rivals",
  dmSubjectOf(
    mini({
      results: [MISS],
      enginesAnswered: true,
      topRivals: [...TWO_RIVALS, { name: "Third Place", count: 1 }],
    })
  ).topRivals.length,
  2
);

check(
  "‼️ the trade is the SHORT one the questions were asked with, never identity.whatTheyDo",
  dmSubjectOf(mini({ trade: "laser skin treatments" })).trade,
  "laser skin treatments"
);

check(
  "a run with no rivals still tells the drafter it may not name a competitor",
  dmContext(
    mini({ results: [MISS], enginesAnswered: true, topRivals: [] }),
    pickDmAngle(mini({ results: [MISS], enginesAnswered: true, topRivals: [] }))
  ).includes("You may NOT name any competitor in this message."),
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
  dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", ONE_RIVAL, "Hairthetics", RIVAL_COUNTS),
  "I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up in 3 of the 4 searches I ran, and Hairthetics in 1."
);

check(
  "‼️ two rivals print SEPARATE counts, because one count over two names is false about one of them",
  dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", TWO_RIVALS, "Hairthetics", ZERO_COUNTS),
  "I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up in 3 of the 4 searches I ran and Bogat Aesthetics in 2, and Hairthetics doesn't come back in any of them."
);

check(
  "‼️ the finding stays ONE sentence, so the reason line and an opener both fit inside the budget",
  (dmRivalLine("x", "Y, ZZ", TWO_RIVALS, "B", ZERO_COUNTS).match(/[.!?]+(?=\s|$)/g) ?? []).length,
  1
);

check(
  "the state is dropped from the city, so the sentence does not carry two commas in four words",
  dmRivalLine("laser hair removal", "Bakersfield, CA", ONE_RIVAL, "Y", RIVAL_COUNTS).includes("in Bakersfield,"),
  true
);

check(
  "‼️ a cityless run drops the location clause rather than reaching for 'in your area'",
  dmRivalLine("laser hair removal", null, ONE_RIVAL, "Y", RIVAL_COUNTS),
  "I ran a quick check and when someone asks ChatGPT for laser hair removal, Foundation Hair shows up in 3 of the 4 searches I ran, and Y in 1."
);

check(
  "the brief hands the finished sentence over rather than asking for a fraction",
  dmContext(RIVAL_FACTS, pickDmAngle(RIVAL_FACTS)).includes("Foundation Hair shows up in 1 of the 2 searches I ran, and Hairthetics in 1."),
  true
);

check(
  "a body that reproduced the fixed line raises no warning",
  findingWarningFor(
    "Hey Han,\n\nI ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up in 3 of the 4 searches I ran, and Hairthetics in 1.\n\n" + DM_ASK_LINE,
    dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", ONE_RIVAL, "Hairthetics", RIVAL_COUNTS)
  ),
  null
);

check(
  "a curly apostrophe still counts as reproduced",
  findingWarningFor(
    "I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up in 3 of the 4 searches I ran, and Hairthetics doesn’t come back in any of them.",
    dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", ONE_RIVAL, "Hairthetics", ZERO_COUNTS)
  ),
  null
);

check(
  "a REWORDED fixed line is caught",
  findingWarningFor(
    "I checked and Foundation Hair ranks above you for hair transplants.",
    dmRivalLine("hair transplant surgery", "Hallandale Beach, FL", ONE_RIVAL, "Hairthetics", RIVAL_COUNTS)
  ) !== null,
  true
);

// ── The `dm` lint stage ──────────────────────────────────────────────────────

const GOOD_DM = `Hey Han,

I ran a quick check and when someone asks ChatGPT for hair transplant surgery in Hallandale Beach, Foundation Hair shows up in 3 of the 4 searches I ran. Hairthetics comes back in 1.

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

// ── The borrowed-domain alias ────────────────────────────────────────────────
//
// A live run on hairthetics_fl took the threads.com bio link as the clinic's website, so
// buildAliases produced the token "threads" and every answer mentioning a thread lift scored as
// an appearance. The clinic came back "present in 4 of 4" in searches it was absent from.

check(
  "a platform link contributes NO alias, so the business name carries the match alone",
  buildAliases("Hairthetics", "https://www.threads.com/@hairthetics_fl?xmt=AQG0AE"),
  ["Hairthetics"]
);

check(
  "...and an answer about thread lifts is therefore no longer an appearance",
  isMentioned(
    "Aesthetemed Beauty & Wellness Clinic offers PDO threads and facial rejuvenation.",
    buildAliases("Hairthetics", "https://www.threads.com/@hairthetics_fl")
  ),
  false
);

check(
  "a link-in-bio host is refused the same way",
  buildAliases("Hairthetics", "https://linktr.ee/hairthetics"),
  ["Hairthetics"]
);

check(
  "a REAL site still contributes its bare domain, which is the strong alias",
  buildAliases("Hairthetics", "https://www.hairthetics.com/contact").includes("hairthetics"),
  true
);

check(
  "the business is still found when it genuinely is named",
  isMentioned(
    "In Hallandale Beach, Hairthetics is well reviewed for FUE.",
    buildAliases("Hairthetics", "https://www.threads.com/@hairthetics_fl")
  ),
  true
);

// ── Booking platforms are not a website ──────────────────────────────────────
//
// leahskinmethod's only bio link is theplumproom.myaestheticrecord.com/online-booking. Unlisted,
// that page was crawled as her site, judged thin, and the run died with "too little on it to work
// out what they sell" on a page that was never hers.

check(
  "a booking subdomain is recognised as never the business's own site",
  isNeverTheirSite("https://theplumproom.myaestheticrecord.com/online-booking"),
  true
);

check(
  "...so it contributes no alias, and the platform name cannot score as a mention",
  buildAliases("The Plump Room", "https://theplumproom.myaestheticrecord.com/online-booking").includes(
    "myaestheticrecord"
  ),
  false
);

check(
  "...while the business name is still matched normally",
  isMentioned(
    "In Hallandale Beach, The Plump Room is well reviewed.",
    buildAliases("The Plump Room", "https://theplumproom.myaestheticrecord.com/online-booking")
  ),
  true
);

// ── The reason line, and the sentence budget it has to fit inside ────────────
//
// Matthew's draft said "because your website is not visible". For a prospect with no site at all
// that is false in the way it reads, so the reason is picked from what the scan could actually
// reach. These check that each version is one sentence and that each says only its own thing.

for (const [state, must] of [
  ["none", "you do not have a site of your own"],
  ["booking_only", "belongs to your booking software"],
  ["not_surfacing", "not showing up in what it pulls back"],
] as const) {
  check(`the ${state} reason line says the thing only IT may say`, dmReasonLine(state).includes(must), true);
  check(
    `the ${state} reason line is exactly one sentence`,
    (dmReasonLine(state).match(/[.!?]+(?=\s|$)/g) ?? []).length,
    1
  );
  check(`the ${state} reason line carries no em dash`, /[—–]/.test(dmReasonLine(state)), false);
}

check(
  "‼️ the no-site reason says there is nothing to cite, NOT that a site is invisible",
  /not visible|invisible/.test(dmReasonLine("none")),
  false
);

// ‼️ THE WHOLE ANGLE, ASSEMBLED, AGAINST THE REAL GATE. The finding is now two sentences (the
// measured absence plus the reason), the ask and the close are two more, and an opener is the
// fifth. If any of them grows, every pretext variant starts failing dm-length, and this is the
// check that says so before a live run does.
const NOSITE_FACTS = mini({
  results: [MISS, MISS, HIT],
  enginesAnswered: true,
  topRivals: TWO_RIVALS,
  trade: "laser skin treatments",
});
const NOSITE_ANGLE = pickDmAngle(NOSITE_FACTS);
const ASSEMBLED = [
  NOSITE_ANGLE.finding(dmSubjectOf(NOSITE_FACTS)),
  DM_ASK_LINE,
  DM_CLOSE_LINE,
].join("\n\n");

check("the assembled no-site DM picks the rival angle", NOSITE_ANGLE.id, "rival-substitute");

check(
  "‼️ finding + reason + ask + close is FOUR sentences, leaving exactly one for the opener",
  lintDraft({ body: ASSEMBLED, stage: "dm", siteSignals: [], robots: null }).findings.map((f) => f.rule),
  []
);

check(
  "...and it still passes with a one-sentence pretext opener in front of it",
  lintDraft({
    body: "Was running queries for another client and your name came up.\n\n" + ASSEMBLED,
    stage: "dm",
    siteSignals: [],
    robots: null,
  }).ok,
  true
);

check(
  "...while a second opener sentence is over budget and IS caught",
  lintDraft({
    body: "Was running queries for another client. Your name came up in what came back.\n\n" + ASSEMBLED,
    stage: "dm",
    siteSignals: [],
    robots: null,
  }).findings.map((f) => f.rule),
  ["dm-length"]
);

check(
  "the assembled DM names both rivals with their own counts",
  ASSEMBLED.includes("Foundation Hair shows up in 3 of the 3 searches I ran and Bogat Aesthetics in 2"),
  true
);

check(
  "...and carries the no-site reason rather than the hook lane's",
  ASSEMBLED.includes(dmReasonLine("none")),
  true
);

// ── The cityless gate ────────────────────────────────────────────────────────
//
// "I don't know" on the city prompt runs the questions with no location in them. A message that
// then says "in your area" describes a local search nobody ran, on a pitch whose whole basis is
// that the reader can reproduce it.

check("a cityless check reports itself as cityless", dmSubjectOf(mini({ city: null })).cityless, true);

check("...and a run with a city does not", dmSubjectOf(mini({ city: "Coral Gables, FL" })).cityless, false);

check(
  "‼️ the brief tells a cityless run to say nothing at all about where",
  dmContext(mini({ city: null, results: [MISS], enginesAnswered: true }), NOSITE_ANGLE).includes(
    "THESE QUESTIONS WERE NOT TIED TO A PLACE"
  ),
  true
);

for (const phrase of ["in your area", "near you", "locally", "in the area", "in town"]) {
  check(
    `"${phrase}" is rejected on a cityless run`,
    lintDraft({
      body: `I ran a quick check on what ChatGPT recommends ${phrase}. ` + DM_ASK_LINE,
      stage: "dm",
      cityless: true,
      siteSignals: [],
      robots: null,
    }).findings.map((f) => f.rule),
    ["dm-cityless"]
  );
}

check(
  "‼️ ...and the SAME body passes when a city WAS known, so this is a gate and not a word ban",
  lintDraft({
    body: "I ran a quick check on what ChatGPT recommends in your area. " + DM_ASK_LINE,
    stage: "dm",
    cityless: false,
    siteSignals: [],
    robots: null,
  }).ok,
  true
);

check(
  "a cityless draft that says nothing about where passes",
  lintDraft({ body: ASSEMBLED, stage: "dm", cityless: true, siteSignals: [], robots: null }).ok,
  true
);

// ── Rows written before topRivals existed ────────────────────────────────────
//
// check_json is whatever shape MiniCheck had the day it was written, and Regenerate rehydrates it
// unchanged. A redraft of an old run must degrade to "no rivals, no trade" rather than throw.

check(
  "an old-shape stored check degrades to no rivals rather than throwing",
  dmSubjectOf({
    kind: "nowebsite",
    businessName: "Hairthetics",
    check: {
      identity: null,
      researched: false,
      city: null,
      results: [],
      enginesAnswered: false,
    } as unknown as MiniCheck,
  }).topRivals,
  []
);

// ── Only a booking link ──────────────────────────────────────
//
// The third answer to the website question. It is the SAME lane and the same scan as "no website":
// what the flag buys is one sentence, dmReasonLine("booking_only"), which had no producer until
// now. A page that ranks and was written by a vendor is a different prospect from a page that does
// not exist, and the two sentences say so.

check(
  "a booking-only run says the page belongs to the software",
  dmSubjectOf(mini({ bookingHost: "myaestheticrecord.com" })).siteState,
  "booking_only"
);
check("...and without the flag it still says there is nothing at all", dmSubjectOf(mini()).siteState, "none");
check(
  "a stored row written before the field existed degrades to none",
  dmSubjectOf({
    kind: "nowebsite",
    businessName: "The Plump Room",
    check: {
      identity: null,
      researched: false,
      city: null,
      results: [],
      enginesAnswered: false,
    } as unknown as MiniCheck,
  }).siteState,
  "none"
);

// The sentence itself reaches the brief, which is the only way it reaches a prospect.
const bookingCtx = dmContext(
  mini({ bookingHost: "myaestheticrecord.com", results: [MISS, HIT], enginesAnswered: true, topRivals: ONE_RIVAL }),
  pickDmAngle(mini({ bookingHost: "myaestheticrecord.com", results: [MISS, HIT], enginesAnswered: true, topRivals: ONE_RIVAL }))
);
check("the booking sentence is pinned into the brief", bookingCtx.includes(dmReasonLine("booking_only")), true);
check("the no-site sentence is not also in it", bookingCtx.includes(dmReasonLine("none")), false);

// ‼️ THE FLAG DOES NOT LOOSEN A GATE. The finding is still that they did not come back, so a
// booking-only prospect who DID come back everywhere gets the clean-sweep angle exactly as before.
check(
  "a booking-only prospect who came back everywhere still gets present-but-thin",
  pickDmAngle(mini({ bookingHost: "myaestheticrecord.com", results: [HIT, HIT], enginesAnswered: true })).id,
  "present-but-thin"
);

// What licenses the claim, one layer down: only real booking software, never any dead-end host.
check("a booking subdomain is a booking host", isBookingHost("https://theplumproom.myaestheticrecord.com/online-booking"), true);
check("a facebook page is not booking software", isBookingHost("https://facebook.com/theplumproom"), false);
check("...but it is still not their site", isNeverTheirSite("https://facebook.com/theplumproom"), true);

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
