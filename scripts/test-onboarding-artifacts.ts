// Unit tests for the pure functions behind the onboarding artifacts.
//
//   bun run scripts/test-onboarding-artifacts.ts
//
// There is no test framework in this repo and this does not add one — it is a script that
// exits non-zero, which is all a CI step or a pre-push check needs.
//
// WHY THESE FUNCTIONS AND NOT OTHERS. Everything here decides something a client is then told
// about their own business: whether a listing matches, which engine count goes in the footer,
// who counts as a competitor. Runner v3 section 6 asks for the normalization specifically to be
// "pure functions, unit tested", and the phone case below is why: the first implementation
// turned "(336) 555-0142 ext 2" into +13655501422, a different and entirely plausible-looking
// number, which would have been reported to a client as a mismatch on a correct listing.

import {
  normalizeAddressForCompare,
  normalizePhoneForCompare,
  compareNames,
  compareListing,
  type Canonical,
} from "../src/lib/clients/nap-compare";
import { isExcludedFromShortlist, CORE_SIX, EXTENDED, PLATFORM_COUNT } from "../src/config/presence-platforms";
import { fingerprintCms, detectMailProvider, detectCdn } from "../src/lib/clients/site-intel";
import { fidelityLine, sniffImageFormat, namedLabel } from "../src/lib/pdf/kit";
import { clickPathFor } from "../src/lib/clients/dns-records";
import { renderPresencePdf } from "../src/lib/clients/artifacts/presence-pdf";
import { renderReviewCard } from "../src/lib/clients/artifacts/review-card";
import { ALL_PLATFORMS } from "../src/config/presence-platforms";
import type { SweepRow } from "../src/lib/clients/presence-sweep";
import zlib from "node:zlib";
import {
  extractPhrases,
  mergePhrases,
  commercialIntent,
  isObjection,
  textFromHtml,
} from "../src/lib/clients/harvest";
import { buildDeepResearchBrief } from "../src/lib/clients/artifacts/deep-research-brief";
import {
  AUTO_RUNNERS,
  unimplementedAutoSteps,
  unreachableAutoSteps,
  ROUTE_COMPLETED,
  IMPLEMENTED_THIS_SESSION,
} from "../src/lib/clients/artifacts/registry";
import { DELIVERY_STEPS } from "../src/lib/clients/delivery-checklist";
import { formatSweepCard } from "../src/lib/clients/presence-sweep";
import {
  formatShortlistCard,
  tieAtCutoff,
  REQUIRED_SELECTIONS,
} from "../src/lib/clients/competitors";
import { analyse, gradeLevel, sentences as splitSentences } from "../src/lib/hub/readability";
import { PHASE_BEFORE, PHASE_DURING, PHASE_AFTER } from "../src/config/delivery-steps";
import fs from "node:fs";
import path from "node:path";
import {
  isResearchPaste,
  stripPrefix,
  unwrapSlackMarkup,
} from "../src/lib/clients/research-intake";

let failures = 0;
let checks = 0;

function eq(label: string, got: unknown, want: unknown) {
  checks += 1;
  const a = JSON.stringify(got);
  const b = JSON.stringify(want);
  if (a === b) return;
  failures += 1;
  console.error(`FAIL  ${label}\n      got:  ${a}\n      want: ${b}`);
}

function ok(label: string, cond: boolean) {
  eq(label, cond, true);
}

// ─────────────────────────────────────────────────────────────────────────────
// Address normalization — both directions, per Runner v3 section 6
// ─────────────────────────────────────────────────────────────────────────────

const sameAddr = (a: string, b: string) =>
  normalizeAddressForCompare(a) === normalizeAddressForCompare(b);

ok("St and Street", sameAddr("1200 W Market St", "1200 West Market Street"));
ok("Ste and Suite", sameAddr("1200 Market St Ste 200", "1200 Market Street Suite 200"));
ok("# is a suite", sameAddr("1200 Market St #200", "1200 Market Street Suite 200"));
ok("Ave and Avenue", sameAddr("55 N Elm Ave", "55 North Elm Avenue"));
ok("Blvd and Boulevard", sameAddr("9 Sunset Blvd", "9 Sunset Boulevard"));
ok("trailing punctuation", sameAddr("1200 W. Market St., Ste 200", "1200 West Market Street Suite 200"));
ok("different suite is NOT the same", !sameAddr("1200 Market St Ste 200", "1200 Market St Ste 300"));
ok("different number is NOT the same", !sameAddr("1200 Market St", "1300 Market St"));
eq("empty is empty", normalizeAddressForCompare(null), "");

// ─────────────────────────────────────────────────────────────────────────────
// Phone — the regression that started this file
// ─────────────────────────────────────────────────────────────────────────────

eq("phone punctuation", normalizePhoneForCompare("(336) 555-0142"), "+13365550142");
eq("phone leading 1", normalizePhoneForCompare("1-336-555-0142"), "+13365550142");
eq("phone already E.164", normalizePhoneForCompare("+13365550142"), "+13365550142");
eq("phone ext word", normalizePhoneForCompare("336.555.0142 ext 2"), "+13365550142");
eq("phone extension word", normalizePhoneForCompare("336 555 0142 extension 12"), "+13365550142");
eq("phone bare x", normalizePhoneForCompare("(336) 555-0142 x204"), "+13365550142");
eq("international kept whole", normalizePhoneForCompare("+44 20 7946 0958"), "+442079460958");
eq("phone empty", normalizePhoneForCompare(null), "");
// A business name ending in x must not be treated as an extension marker.
eq("Onyx is not an extension", normalizePhoneForCompare("Onyx 336 555 0142"), "+13365550142");

// ─────────────────────────────────────────────────────────────────────────────
// Entity suffix — a finding, not noise
// ─────────────────────────────────────────────────────────────────────────────

const suffix = compareNames("Acme Med Spa", "Acme Med Spa LLC");
eq("LLC is not an exact match", suffix.exact, false);
eq("LLC matches without the suffix", suffix.withoutSuffix, true);
eq("LLC is reported as a suffix difference", suffix.suffixDiffers, true);

const identical = compareNames("Acme Med Spa", "acme med spa");
eq("case insensitive exact", identical.exact, true);
eq("exact match is not a suffix difference", identical.suffixDiffers, false);

const different = compareNames("Acme Med Spa", "Bright Skin Clinic");
eq("different names do not match", different.withoutSuffix, false);

// ─────────────────────────────────────────────────────────────────────────────
// The verdict
// ─────────────────────────────────────────────────────────────────────────────

const canonical: Canonical = {
  name: "Acme Med Spa",
  addressLine1: "1200 W. Market St.",
  addressLine2: "Ste 200",
  city: "Greensboro",
  state: "NC",
  postalCode: "27403",
  phone: "+13365550142",
};

eq(
  "a differently-abbreviated listing still matches",
  compareListing(canonical, {
    name: "Acme Med Spa",
    address: "1200 West Market Street, Suite 200, Greensboro, NC, 27403",
    phone: "(336) 555-0142",
  }).status,
  "match"
);

const wrongPhone = compareListing(canonical, {
  name: "Acme Med Spa",
  address: "1200 W. Market St., Ste 200, Greensboro, NC, 27403",
  phone: "(336) 555-0199",
});
eq("a wrong phone is a mismatch", wrongPhone.status, "mismatch");
eq("and it is the phone that is reported", wrongPhone.diffs.map((d) => d.field), ["phone"]);
eq("reported RAW, not normalized", wrongPhone.diffs[0].listed, "(336) 555-0199");

eq("no listing at all is missing", compareListing(canonical, null).status, "missing");

// ─────────────────────────────────────────────────────────────────────────────
// Integrity Law 7 — a consensus lock is not a competitor
// ─────────────────────────────────────────────────────────────────────────────

ok("Yelp is excluded", isExcludedFromShortlist("Yelp").excluded);
ok("a listicle is excluded", isExcludedFromShortlist("10 Best Med Spas in Greensboro").excluded);
ok("Groupon is excluded", isExcludedFromShortlist("Groupon").excluded);
ok("a national chain is excluded", isExcludedFromShortlist("Ideal Image").excluded);
ok("a real local clinic is kept", !isExcludedFromShortlist("Bright Skin Clinic of Greensboro").excluded);
ok("a local name containing 'best' in context is judged", isExcludedFromShortlist("Top 10 Med Spas").excluded);

eq("six core platforms", CORE_SIX.length, 6);
// LANE 1, 2026-08-25: thirteen since Trustpilot joined the extended tier. The TIER is
// unchanged in meaning; this is one more extended directory, not a promotion.
eq("thirteen extended platforms", EXTENDED.length, 13);
eq("nineteen in total", PLATFORM_COUNT, 19);
ok("nothing is keyed yet", [...CORE_SIX, ...EXTENDED].every((p) => p.api === false));

// ─────────────────────────────────────────────────────────────────────────────
// Site intelligence fingerprints
// ─────────────────────────────────────────────────────────────────────────────

eq("WordPress from asset paths", fingerprintCms('<link href="/wp-content/themes/x.css">').cms, "WordPress");
eq("GoHighLevel from its CDN", fingerprintCms('<script src="//cdn.leadconnectorhq.com/a.js">').cms, "GoHighLevel");
eq("Wix from static assets", fingerprintCms('<img src="https://static.wixstatic.com/a.png">').cms, "Wix");
eq("Squarespace", fingerprintCms('<script src="https://static1.squarespace.com/a.js">').cms, "Squarespace");
// Nothing matching means NOTHING MATCHED. Not "custom", which is a different claim.
eq("no fingerprint is null, not 'custom'", fingerprintCms("<html><body>hi</body></html>").cms, null);

eq("Google Workspace from MX", detectMailProvider(["1 aspmx.l.google.com"]), "Google Workspace");
eq("Microsoft 365 from MX", detectMailProvider(["0 srt-com.mail.protection.outlook.com"]), "Microsoft 365");
eq("no MX is null", detectMailProvider([]), null);

eq("Cloudflare from cf-ray", detectCdn({ "cf-ray": "abc123" }), "Cloudflare");
eq("Vercel from x-vercel-id", detectCdn({ "x-vercel-id": "iad1::x" }), "Vercel");
eq("no CDN header is null", detectCdn({}), null);

// ─────────────────────────────────────────────────────────────────────────────
// Provider click paths — Runner v3 section 5 and section 13
// ─────────────────────────────────────────────────────────────────────────────

ok(
  "GoDaddy path names the domain",
  (clickPathFor("GoDaddy", "acme.com") ?? "").includes("acme.com")
);
ok(
  "Cloudflare path says DNS only",
  (clickPathFor("Cloudflare", "acme.com") ?? "").includes("DNS only")
);
// An unknown provider gets NOTHING rather than a guess. The call sheet prints the nameservers.
eq("unknown provider has no click path", clickPathFor(null, "acme.com"), null);
eq("unmapped provider has no click path", clickPathFor("Some Registrar Ltd", "acme.com"), null);

// ─────────────────────────────────────────────────────────────────────────────
// The fidelity footer — Artifact Templates section 1
// ─────────────────────────────────────────────────────────────────────────────

const oneEngine = fidelityLine({
  questions: 20,
  engines: ["chatgpt_web"],
  date: new Date("2026-08-19T00:00:00Z"),
  questionSetVersions: ["universal_v1@med_spa"],
});
// ‼️ M is what ACTUALLY ran. The offer names four engines; one is keyed. This must say 1.
ok("one engine prints as 1 engine", oneEngine.includes("20 questions x 1 engine"));
ok("and names it", oneEngine.includes("ChatGPT"));
ok("and carries the frozen version", oneEngine.includes("universal_v1@med_spa"));
ok("and the date", oneEngine.includes("2026-08-19"));

const noVersion = fidelityLine({
  questions: 20,
  engines: ["chatgpt_web"],
  date: new Date("2026-08-19T00:00:00Z"),
  questionSetVersions: [],
});
ok("an unfrozen set says so", noVersion.includes("question set not frozen"));

const four = fidelityLine({
  questions: 40,
  engines: ["chatgpt_web", "perplexity", "gemini", "ai_overviews"],
  date: new Date("2026-08-19T00:00:00Z"),
  questionSetVersions: ["universal_v1@med_spa", "custom_v1"],
});
ok("plural engines", four.includes("40 questions x 4 engines"));

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary and image sniffing
// ─────────────────────────────────────────────────────────────────────────────

eq("named", namedLabel(true), "named");
eq("not named", namedLabel(false), "not named");
// null means the prompt was never measured. It must NEVER collapse to "not named", which is a
// claim about what an engine said.
eq("null is not measured, never 'not named'", namedLabel(null), "not measured");

eq("PNG magic bytes", sniffImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10, 0])), "PNG");
eq("JPEG magic bytes", sniffImageFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0])), "JPEG");
eq("a PDF is not an image", sniffImageFormat(Buffer.from("%PDF-1.4")), null);
eq("empty buffer", sniffImageFormat(Buffer.from([])), null);


// ─────────────────────────────────────────────────────────────────────────────
// Rendered output — the honesty rules, asserted against the actual PDF text
// ─────────────────────────────────────────────────────────────────────────────
//
// These render a real document and read the text back out of it. Asserting on the FUNCTION
// would prove the branch was taken; asserting on the PDF proves the words a client will read.

/** Inflate the content streams and return the drawing operators as text. */
function pdfText(buf: Buffer): string {
  // Deliberately regex-free. Scanning for the literal stream markers is both simpler to read
  // and immune to the escaping accidents that a pattern this shape invites.
  const raw = buf.toString("latin1");
  let out = "";
  let at = 0;
  for (;;) {
    const start = raw.indexOf("stream", at);
    if (start === -1) break;
    const end = raw.indexOf("endstream", start);
    if (end === -1) break;

    // Skip the newline (or CRLF) that follows the "stream" keyword.
    let bodyStart = start + "stream".length;
    if (raw[bodyStart] === "\r") bodyStart += 1;
    if (raw[bodyStart] === "\n") bodyStart += 1;

    const body = raw.slice(bodyStart, end);
    try {
      out += zlib.inflateSync(Buffer.from(body, "latin1")).toString("latin1");
    } catch {
      out += body;
    }
    at = end + "endstream".length;
  }
  return out;
}

const canonicalFixture = {
  name: "Acme Med Spa",
  addressLine1: "1200 W Market St",
  addressLine2: "Ste 200",
  city: "Greensboro",
  state: "NC",
  postalCode: "27403",
  phone: "+13365550142",
};

// The dangerous case: a client whose sweep has not been done. Every row untouched, and every
// row carrying a PROPOSED status of 'match' that nobody confirmed.
const untouched: SweepRow[] = ALL_PLATFORMS.map((p, i) => ({
  id: `id-${i}`,
  platform: p.key,
  tier: p.tier,
  source: "manual",
  status: "not_checked",
  rawName: null,
  rawAddress: null,
  rawPhone: null,
  listingUrl: null,
  claimed: null,
  screenshotRef: null,
  proposedStatus: "match",
  confirmedStatus: null,
  skipReason: null,
  checkedBy: null,
  checkedAt: null,
}));

const untouchedPdf = await renderPresencePdf({
  clientName: "Acme Med Spa",
  canonical: canonicalFixture,
  rows: untouched,
  engines: ["chatgpt_web"],
  questionSetVersions: ["universal_v1@med_spa"],
});
const untouchedText = pdfText(untouchedPdf);

ok("an unswept report renders", untouchedPdf.subarray(0, 5).toString() === "%PDF-");
ok("it says 'not checked'", /not checked/i.test(untouchedText));
// ‼️ THE RULE. An unconfirmed proposal must never surface as a clean bill of health.
ok("it never says 'no issues found'", !/no issues found/i.test(untouchedText));
ok("it does not claim anything matches", !/matches your record/i.test(untouchedText));
ok("the fidelity footer says one engine", /1 engine/i.test(untouchedText));

// ‼️ A SKIPPED SWEEP MUST SAY SO ON THE FACE OF THE DOCUMENT. With the gate now at the six core
// platforms, twelve extended will routinely be unchecked, so "why is half of this blank" is the
// normal state of the page and a row-level count cannot answer it: the rows look identical
// whether somebody skipped the step or simply has not finished it. The step is the only thing
// that knows. This is also the case that proves the wording rule survives the addition, because
// the Slack copy for a skip contains the exact phrase this document may never print.
const skippedPdf = await renderPresencePdf({
  clientName: "Acme Med Spa",
  canonical: canonicalFixture,
  rows: untouched,
  engines: ["chatgpt_web"],
  questionSetVersions: ["universal_v1@med_spa"],
  manualSweep: {
    status: "skipped",
    skippedReason: "The client has no listings outside Google and said so on the call.",
    completedAt: "2026-08-24T10:00:00.000Z",
    completedBy: "Matthew",
  },
});
const skippedText = pdfText(skippedPdf);

ok("a skipped sweep says it was not applicable", /not applicable/i.test(skippedText));
ok("a skipped sweep names the step as skipped", /skipped/i.test(skippedText));
ok("a skipped sweep prints the reason", /no listings outside Google/i.test(skippedText));
// The invariant, re-asserted on the new branch: the Slack copy for a skip says "never as no
// issues found", and copying it verbatim into this file would put the phrase on a client PDF.
ok("a skipped sweep still never says 'no issues found'", !/no issues found/i.test(skippedText));

// Confirmed findings DO render, with the raw published values.
const confirmed: SweepRow[] = untouched.map((r, i) =>
  i === 0
    ? { ...r, confirmedStatus: "duplicate", rawName: "Acme Med Spa LLC", rawAddress: "900 Old Rd, Greensboro NC", rawPhone: "(336) 555-0199", listingUrl: "https://example.com/g" }
    : r
);
const confirmedText = pdfText(
  await renderPresencePdf({
    clientName: "Acme Med Spa",
    canonical: canonicalFixture,
    rows: confirmed,
    engines: ["chatgpt_web"],
    questionSetVersions: ["universal_v1@med_spa"],
  })
);
ok("a confirmed duplicate is reported", /DUPLICATE/i.test(confirmedText));
ok("the RAW published phone is shown, not the normalized one", /555-0199/.test(confirmedText));

// ─────────────────────────────────────────────────────────────────────────────
// The review card
// ─────────────────────────────────────────────────────────────────────────────

const cardText = pdfText(
  await renderReviewCard({
    clinicName: "Acme Med Spa",
    reviewsUrl: "https://reviews.acme.example",
    accent: [0, 201, 167],
  })
);

ok("the card carries the clinic name", /Acme Med Spa/.test(cardText));
ok("and the promise", /Ninety seconds/.test(cardText));
ok("and the four questions come from REVIEW_QUESTIONS", /worried about before you came in/.test(cardText));
ok("and the reassurance", /Nothing is posted unless you post it/.test(cardText));
// ‼️ Every one of these is a rule from the build spec, not a style preference.
ok("no star rating", !/star/i.test(cardText));
ok("no sentiment pre-screen", !/if you loved/i.test(cardText));
ok("nothing is offered", !/(gift|discount|free|reward)/i.test(cardText));


// ─────────────────────────────────────────────────────────────────────────────
// The harvest — deterministic scoring, no model
// ─────────────────────────────────────────────────────────────────────────────

eq("booking language is intent 3", commercialIntent("where can i book botox near me"), 3);
eq("price language is intent 3", commercialIntent("how much does botox cost in greensboro"), 3);
eq("best-of language is intent 2", commercialIntent("who is the best injector in town"), 2);
eq("safety language is intent 1", commercialIntent("is botox safe for a first timer"), 1);
eq("neutral language is intent 0", commercialIntent("i went for a walk yesterday afternoon"), 0);

ok("a fear is an objection", isObjection("I am scared it will look frozen and fake"));
ok("a bad outcome is an objection", isObjection("my last one went wrong and I regret it"));
ok("a plain question is not an objection", !isObjection("how long does the appointment take"));

eq(
  "tags and scripts are stripped",
  textFromHtml("<script>var x=1;</script><p>Hello <b>there</b></p>").trim(),
  "Hello there"
);

const page = `
  Is Botox safe if you have sensitive skin? I have been putting this off for years.
  How much does lip filler cost in a place like this?
  I am terrified it will look overdone and everyone will notice.
  The weather today is quite pleasant and I walked to the shops.
  Accept cookies to continue using this website please.
`;
const extracted = extractPhrases(page, "https://forum.example/thread/1");

ok("question-shaped sentences are kept", extracted.some((p) => /Is Botox safe/i.test(p.phrase)));
ok("objection-shaped sentences are kept", extracted.some((p) => /terrified/i.test(p.phrase)));
ok("ordinary prose is dropped", !extracted.some((p) => /weather today/i.test(p.phrase)));
ok("cookie boilerplate is dropped", !extracted.some((p) => /cookies/i.test(p.phrase)));
ok("the source url rides along", extracted.every((p) => p.sourceUrl === "https://forum.example/thread/1"));
// ‼️ The market's own wording survives verbatim, typos and all. That is the whole point.
ok("phrases are kept verbatim", extracted.some((p) => p.phrase.includes("I am terrified")));

const merged = mergePhrases([
  ...extractPhrases("How much does lip filler cost?", "https://a.example"),
  ...extractPhrases("How much does lip filler cost?", "https://b.example"),
]);
eq("the same phrase merges to one row", merged.length, 1);
eq("and its frequency rises", merged[0].frequencyScore, 2);

// ─────────────────────────────────────────────────────────────────────────────
// The deep research brief — deterministic, verbatim, honest about Reddit
// ─────────────────────────────────────────────────────────────────────────────

const briefInput = {
  clinicName: "Acme Med Spa",
  city: "Greensboro",
  state: "NC",
  primaryTreatment: "Morpheus8",
  services: ["Botox", "filler", "laser hair removal"],
  objections: "its too expensive, im scared itll look fake, i dont trust who does it",
  targetPatient: "women 35 to 55 with disposable income",
  notWanted: "groupon shoppers",
  triedBefore: "drugstore serums and at home devices",
  citedDomains: ["realself.com", "reddit.com", "yelp.com"],
  namedInstead: ["Bright Skin Clinic", "Elm Street Aesthetics"],
};

const brief = buildDeepResearchBrief(briefInput);
const briefAgain = buildDeepResearchBrief(briefInput);

// ‼️ Deterministic. Same input, same brief, byte for byte. A model would not give this.
eq("the brief is deterministic", brief === briefAgain, true);

ok("it names the clinic", brief.includes("Acme Med Spa"));
ok("it names the city", brief.includes("Greensboro"));
ok("it names the money treatment", brief.includes("Morpheus8"));
// ‼️ The owner's objections appear VERBATIM, typos included. Never summarised.
ok("the objections are verbatim", brief.includes("im scared itll look fake"));
ok("the seed sites come from real citations", brief.includes("realself.com"));
ok("the competitors are the ones actually named", brief.includes("Elm Street Aesthetics"));
ok("it asks for six pages minimum", /minimum six pages/i.test(brief));
ok("it asks for the exact words", /word for word/i.test(brief));
ok("it forbids cleaning the phrasings up", /Do not clean these up/i.test(brief));
ok("it ends on the ranked list", /ranked list/i.test(brief));
ok("it asks about reading level", /reading level/i.test(brief));
// The framework's own sections, so a change to the template is caught rather than silent.
ok("part 1: who the customer is", /Who the customer is/i.test(brief));
ok("part 2: what they already use", /What they are already using/i.test(brief));
ok("part 3: curiosity and history", /Curiosity and history/i.test(brief));
ok("external forces they blame", /external forces/i.test(brief));
ok("prejudices", /prejudices/i.test(brief));
ok("horror stories", /horror stories/i.test(brief));

// A client with nothing recorded still produces a usable brief rather than a broken one.
const bare = buildDeepResearchBrief({
  ...briefInput,
  primaryTreatment: null,
  objections: null,
  targetPatient: null,
  notWanted: null,
  triedBefore: null,
  services: [],
  citedDomains: [],
  namedInstead: [],
});
ok("a bare client still gets a brief", bare.length > 1000);
ok("and missing values say so", bare.includes("not recorded"));
ok("and it admits it has no seed sites", /no cited sources recorded yet/i.test(bare));


// ─────────────────────────────────────────────────────────────────────────────
// The wiring — is `_auto_` actually true?
// ─────────────────────────────────────────────────────────────────────────────
//
// delivery-checklist.ts's header: a checklist that lies about what has happened is worse than
// no checklist. These assert the five rows this session was about now have code behind them,
// and that the ones which still do not are a KNOWN list rather than a surprise.

for (const key of IMPLEMENTED_THIS_SESSION) {
  ok(`${key} has a runner`, typeof AUTO_RUNNERS[key] === "function");
  ok(`${key} is a real step`, DELIVERY_STEPS.some((s) => s.key === key));
}

// avatar_harvest generates AND waits, so it must not be plain 'auto' — an auto step completes
// itself, and this one needs a person to run the brief.
eq(
  "avatar_harvest waits for a person",
  DELIVERY_STEPS.find((s) => s.key === "avatar_harvest")?.mode,
  "auto_then_manual"
);

const stillUnimplemented = unimplementedAutoSteps();
// Every auto step with no runner is now completed by a ROUTE instead. Nothing is merely missing.
//
// The five that used to be on this list — review_audit, custom_question_set, page_candidates,
// citation_cleanup_list, review_tool_preview — have real runners as of 2026-08-22, which is what
// took unreachableAutoSteps() to empty. The four that remain are here because a runner would be
// the WRONG shape for them, not because nobody got to them:
const expectedUnimplemented = [
  "intake_received", // ticked by the intake route itself
  "baseline_scan", // ticked by startBaselineScan when the pipeline returns
  // Predicates about ongoing behaviour, not documents. A runner is called once and parks a
  // failure in `error`, so one here would report a permanent failure for work that had simply
  // not happened yet.
  "time_log_entries", // ticked by /api/clients/[id]/time-log on the first entry
  "weekly_report", // ticked by runWeeklyReports on the first report that posts
  // day_zero_archive is NOT here: it carries `gate: true` rather than `auto: true`, so it never
  // claimed to run itself in the first place. That distinction is the point of this assertion.
];
eq(
  "the remaining auto steps are exactly the known ones",
  stillUnimplemented.slice().sort(),
  expectedUnimplemented.slice().sort()
);

// ‼️ THE INVARIANT THIS FILE EXISTS TO PROTECT.
// An auto step with no runner AND no route is a step whose `_auto_` tag in Slack is a lie, and
// its blockers become dead ends rather than waits. Two of the four artifacts were behind exactly
// that and could never have generated for any client.
eq("no auto step is unreachable", [...unreachableAutoSteps()].sort(), []);

// Every unimplemented auto step must be accounted for by a route, with nothing left over.
for (const key of stillUnimplemented) {
  ok(`${key} is completed by a route rather than merely missing`, ROUTE_COMPLETED.has(key));
}

// The four artifacts this session was commissioned to build, by checklist row number.
for (const key of ["presence_pdf", "findings_doc", "review_card_pdf", "call_sheet"]) {
  ok(`${key} no longer renders _auto_ falsely`, !stillUnimplemented.includes(key));
}


// ─────────────────────────────────────────────────────────────────────────────
// The sweep card — one platform vocabulary, real search strings
// ─────────────────────────────────────────────────────────────────────────────
//
// step-engine.ts used to carry its own copy of the platform names and print the SAME generic
// query against all eighteen. Runner v3 section 3: never "check the listing", always the exact
// string. These assert the card a person actually reads is built from the config list.

const sweepCard = formatSweepCard(
  { name: "Acme Med Spa", city: "Greensboro", state: "NC" },
  canonicalFixture
);

ok("the card names every platform", ALL_PLATFORMS.every((p) => sweepCard.includes(p.label)));
ok("core six is separated from extended", /CORE SIX/i.test(sweepCard) && /EXTENDED/i.test(sweepCard));
ok("it carries a real composed search string", sweepCard.includes("Acme Med Spa Greensboro NC"));
ok("it carries per-platform links", sweepCard.includes("yelp.com") && sweepCard.includes("realself.com"));
ok("it says the empty result IS the evidence", /empty search result/i.test(sweepCard));
// ‼️ The honesty rule, restated on the card the human reads.
ok("it warns that a skip prints as not checked", /not checked/i.test(sweepCard));
ok("it is honest that nothing is automated", /0 of 18|no presence provider is keyed/i.test(sweepCard));

// ─────────────────────────────────────────────────────────────────────────────
// The shortlist card — it must not describe a board that does not exist
// ─────────────────────────────────────────────────────────────────────────────

const shortlist = formatShortlistCard(
  "Acme Med Spa",
  [
    {
      id: "1", name: "Bright Skin Clinic", normalizedName: "bright skin clinic",
      website: "https://bright.example", address: null, source: "baseline_named",
      timesNamed: 11, engines: ["openai"], sampleQuestions: ["Who does the best lip filler in Greensboro?"],
      selected: false,
    },
    {
      id: "2", name: "Elm Street Aesthetics", normalizedName: "elm street aesthetics",
      website: null, address: null, source: "client_intake",
      timesNamed: 0, engines: [], sampleQuestions: [], selected: false,
    },
  ],
  20
);

ok("the shortlist ranks by how many named them", shortlist.includes("named in 11 of 20"));
// ‼️ A competitor the client guessed that NO engine named is a finding, not a blank row.
ok("a client guess nobody named is called out", /NOT named by any engine/i.test(shortlist));
// The card no longer says "pick exactly 3": the top three are pre-picked by
// applyDefaultSelection before it renders, so its job is to say WHICH three are picked and that
// they are a changeable default. With nothing selected — as in this fixture, where the only
// engine-named candidate would be the single default — it says there is no default rather than
// describing a pick that does not exist.
ok("with nothing picked, the card says so", /Nothing is pre-picked/.test(shortlist));
ok("and still names the number to pick", /Pick 3 on the board/.test(shortlist));
ok("it explains the exclusions", /consensus lock|aggregator/i.test(shortlist));

// ─────────────────────────────────────────────────────────────────────────────
// Research paste-back — explicit trigger, Slack markup stripped
// ─────────────────────────────────────────────────────────────────────────────

ok("the prefix triggers it", isResearchPaste("research: here is the dump"));
ok("case does not matter", isResearchPaste("RESEARCH:  x"));
ok("leading space is fine", isResearchPaste("  research: x"));
// ‼️ Sniffing is not acceptable. Ordinary thread chatter must never be filed as market evidence.
ok("ordinary chatter does not trigger it", !isResearchPaste("I did some research on this"));
ok("a question does not trigger it", !isResearchPaste("did the research come back yet?"));
eq("the prefix is stripped", stripPrefix("research:  the body"), "the body");

eq(
  "slack link syntax is unwrapped",
  unwrapSlackMarkup("see <https://realself.com|realself.com> for this"),
  "see realself.com for this"
);
eq("bare links are unwrapped", unwrapSlackMarkup("<https://a.example>"), "https://a.example");
eq("bold markers are stripped", unwrapSlackMarkup("*is botox safe* really"), "is botox safe really");
eq("entities are decoded", unwrapSlackMarkup("cost &gt; value &amp; time"), "cost > value & time");


// ─────────────────────────────────────────────────────────────────────────────
// No artifact may be deadlocked behind a step that can never complete
// ─────────────────────────────────────────────────────────────────────────────
//
// ‼️ THE REGRESSION THIS PINS ACTUALLY HAPPENED, AND IT WAS SILENT.
//
// findings_doc is blockedBy [presence_pdf, review_audit] and call_sheet by
// [findings_doc, custom_question_set, page_candidates, hub_preview]. review_audit,
// custom_question_set and page_candidates are all declared `auto` with no implementation, so
// they never tick — and runReadyAutoSteps would not start a step with an incomplete blocker.
// The findings report and the call sheet could not have generated for any client, ever, and
// nothing would have errored: the rows would just have sat at `pending` under a checklist
// showing them as work the system was going to do.
//
// This asserts every implemented artifact is reachable through blockers that CAN complete —
// a runner, a route, or a human. Adding a blockedBy entry pointing at an unbuilt auto step
// fails here instead of in production three weeks later.

const unreachable = unreachableAutoSteps();

// Sanity: the set is the unbuilt auto steps, and none of the three route-ticked ones.
for (const key of ROUTE_COMPLETED) {
  ok(`${key} is not treated as unreachable`, !unreachable.has(key));
}
ok("day_zero_archive is never waived", !unreachable.has("day_zero_archive"));

for (const key of IMPLEMENTED_THIS_SESSION) {
  const step = DELIVERY_STEPS.find((s) => s.key === key)!;
  // A blocker is satisfiable when something can actually complete it: a runner, a route, or a
  // person. Anything else is a dead end.
  const deadEnds = (step.blockedBy ?? []).filter((k) => unreachable.has(k));
  const satisfiable = (step.blockedBy ?? []).filter((k) => {
    const b = DELIVERY_STEPS.find((s) => s.key === k);
    return Boolean(AUTO_RUNNERS[k]) || ROUTE_COMPLETED.has(k) || (b && b.mode !== "auto");
  });
  eq(
    `${key}: every blocker is satisfiable or waived`,
    satisfiable.length + deadEnds.length,
    (step.blockedBy ?? []).length
  );
}

// ‼️ THE TWO THAT WERE ACTUALLY DEADLOCKED, NAMED SO A REGRESSION READS PLAINLY.
//
// These used to assert that the dead ends were WAIVED, which was the holding fix: waiving let
// the generators run past blockers that could never complete. As of 2026-08-22 the blockers are
// real, so the assertion inverts — every one of them is now satisfiable for a reason we can name.
//
// review_audit is `auto_then_manual`: no review provider is keyed, so its runner seeds the grid
// and a person reads the listings. That IS satisfiable; it just is not automatic.
for (const [step, blockers] of [
  ["findings_doc", ["presence_pdf", "review_audit"]],
  ["call_sheet", ["findings_doc", "custom_question_set", "page_candidates", "hub_preview"]],
] as const) {
  for (const b of blockers) {
    ok(`${step}: blocker ${b} can actually complete`, !unreachable.has(b));
  }
}

// review_audit specifically: it must NOT be plain `auto`. Ticking it automatically would mark a
// measurement complete that measured nothing, and it lands in a client-facing PDF.
eq(
  "review_audit waits for a person",
  DELIVERY_STEPS.find((s) => s.key === "review_audit")?.mode,
  "auto_then_manual"
);

// And the unimplemented list still matches the unreachable set plus the route-ticked ones,
// so the two functions cannot drift apart.
eq(
  "unimplemented = unreachable + route-completed",
  unimplementedAutoSteps().slice().sort(),
  [...unreachable, ...[...ROUTE_COMPLETED].filter((k) => !AUTO_RUNNERS[k] && DELIVERY_STEPS.find((s) => s.key === k)?.auto)]
    .sort()
);

// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// The step board is RUNNABLE — 2026-08-25
// ─────────────────────────────────────────────────────────────────────────────

// ‼️ NO REACHABLE STEP THAT WAITS FOR A PERSON MAY POST AN EMPTY CARD.
// blocks() adds no body section when instructionsFor returns null, so such a step renders as a
// label and three buttons — which is what six of them did. instructionsFor cannot be called
// here (it reaches Supabase), so this asserts on the switch's covered keys, read out of the
// source. A source read is the only way to check a switch's coverage without a database.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "clients", "step-engine.ts"),
    "utf8"
  );
  const body = src.slice(
    src.indexOf("async function instructionsFor"),
    src.indexOf("\n    default:")
  );
  const covered = new Set([...body.matchAll(/case "([a-z0-9_]+)"/g)].map((m) => m[1] as string));
  // The Day-0 case is `case DAY_ZERO_STEP_KEY:`, by constant rather than by literal.
  if (/case DAY_ZERO_STEP_KEY:/.test(body)) covered.add("day_zero_archive");

  const silent = DELIVERY_STEPS.filter((s) => s.mode !== "auto" && !covered.has(s.key)).map(
    (s) => s.key
  );
  eq("every step that waits for a person has an instruction card", silent, []);
}

// ‼️ THE WIDENED REACHABILITY CHECK. first_page declared mode auto_then_manual with no `auto`
// and no runner, so the old `s.auto === true` predicate could not see it and its card could
// never post. Empty means every step declaring automation has something behind it.
eq("no step declares automation with nothing behind it", [...unreachableAutoSteps()], []);

// The specific regression: a step may not be auto_then_manual without a runner, because the
// only writer of `ready` is the runner and postReadySteps waits for `ready`.
for (const step of DELIVERY_STEPS) {
  if (step.mode !== "auto_then_manual") continue;
  ok(
    `${step.key}: auto_then_manual has a runner to reach 'ready'`,
    Boolean(AUTO_RUNNERS[step.key])
  );
}
eq(
  "first_page is manual, so its card can post",
  DELIVERY_STEPS.find((s) => s.key === "first_page")?.mode,
  "manual"
);

// ── Phases: three, and contiguous ────────────────────────────────────────────
// delivery-checklist-form.tsx groups with a running-string sentinel rather than a groupBy, so a
// phase reappearing after an interruption renders its header twice.
{
  const order: string[] = [];
  for (const s of DELIVERY_STEPS) if (order[order.length - 1] !== s.phase) order.push(s.phase);
  eq("three phases, in order, each appearing once", order, [
    PHASE_BEFORE,
    PHASE_DURING,
    PHASE_AFTER,
  ]);
  ok(
    "the gate is in the after-the-call phase",
    DELIVERY_STEPS.find((s) => s.gate)?.phase === PHASE_AFTER
  );
  // Nothing may key on the old literal again. The wall keys on `gate` and DAY_ZERO_STEP_KEY.
  ok("no step still carries a 'Day 0' phase", DELIVERY_STEPS.every((s) => s.phase !== "Day 0"));
}

// ── The competitor tie-break is never dressed as a ranking ───────────────────
{
  const cand = (
    name: string,
    timesNamed: number,
    extra: { selected?: boolean; source?: "baseline_named" | "client_intake" | "both" } = {}
  ) => ({
    id: name,
    name,
    normalizedName: name.toLowerCase(),
    website: null,
    address: null,
    source: extra.source ?? ("baseline_named" as const),
    timesNamed,
    engines: ["openai"],
    sampleQuestions: [],
    selected: extra.selected ?? false,
  });

  // The live shape on the first real client: two at 2, then five level at 1. The third pick is
  // a coin toss, and the card has to say so.
  const live = [
    cand("Posirank", 2, { selected: true }),
    cand("D3 Corp", 2, { selected: true }),
    cand("KailxLabs", 1, { selected: true }),
    cand("AEO Agents", 1),
    cand("EVOIX", 1),
    cand("Magna", 1),
    cand("Hook Agency", 1),
    cand("a", 0, { source: "client_intake" }),
  ];
  const tie = tieAtCutoff(live, REQUIRED_SELECTIONS);
  ok("a tie at the cutoff is detected", tie.tied);
  eq("and counts everyone level with the last pick", tie.among, 5);

  const card = formatShortlistCard("Test Co", live, 20, null);
  ok("the card says the cut is a tie-break", /tie-break, not a ranking/.test(card));
  ok("and names how many are level", card.includes("5 businesses are level"));
  ok("and says the pick is a default", /DEFAULT, not a decision/.test(card));

  // A clean ranking must NOT claim a tie.
  const clean = [
    cand("A", 9, { selected: true }),
    cand("B", 6, { selected: true }),
    cand("C", 4, { selected: true }),
    cand("D", 1),
  ];
  ok("a clean ranking reports no tie", !tieAtCutoff(clean, REQUIRED_SELECTIONS).tied);
  ok(
    "and its card does not cry tie-break",
    !/tie-break/.test(formatShortlistCard("Test Co", clean, 20, null))
  );
}

// ── Readability: it POINTS, it never rewrites ────────────────────────────────
// ‼️ FTC 16 CFR Part 465. See the header of src/lib/hub/readability.ts. This is the structural
// half of that promise: the module may not gain a function that returns edited text.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "hub", "readability.ts"),
    "utf8"
  );
  ok("readability.ts imports nothing", !/^\s*import\s/m.test(src));
  ok(
    "readability.ts has no rewrite/simplify/suggest export",
    !/export\s+(async\s+)?function\s+(rewrite|simplify|suggest|improve|fix|shorten)/i.test(src)
  );

  const short = analyse("The staff were kind. I felt calm. It went well.");
  eq("three short sentences are all easy", short.hard.length, 0);
  eq("and they are counted", short.sentences, 3);

  const long = analyse(
    "I was really worried about whether the treatment would hurt at all because I have had a " +
      "genuinely bad experience somewhere else before and I did not want to go through anything " +
      "like that again in my life."
  );
  eq("one long sentence is flagged", long.hard.length, 1);
  eq("as long, not dense", long.hard[0]?.reason, "long");
  ok("with offsets into the original text", (long.hard[0]?.end ?? 0) > (long.hard[0]?.start ?? 0));

  eq("empty text has no complaints", analyse("").hard.length, 0);
  eq("and no words", analyse("   ").words, 0);
  ok("a simple sentence reads low", gradeLevel("The staff were kind to me.") < 8);
  eq(
    "sentence splitting keeps offsets in order",
    splitSentences("One. Two.").map((s) => s.start),
    [0, 5]
  );
}

// ── The review path still has no model in it ─────────────────────────────────
// review-assemble.ts importing nothing is the enforcement, not the comment above it.
{
  const src = fs.readFileSync(
    path.join(__dirname, "..", "src", "lib", "hub", "review-assemble.ts"),
    "utf8"
  );
  ok("review-assemble.ts imports nothing", !/^\s*import\s/m.test(src));
  ok(
    "assembleLabelled and assemblePlain are both declared",
    /function assembleLabelled/.test(src) && /function assemblePlain/.test(src)
  );

  const client = fs.readFileSync(
    path.join(__dirname, "..", "src", "app", "hub", "[host]", "reviews", "review-client.tsx"),
    "utf8"
  );
  // The whisper transcriber must never be wired into the customer-facing tool: review_tool_
  // submissions has nowhere to put an identity and a voice is more identifying than any column
  // it refuses.
  //
  // Matched on the IMPORT LINE ONLY, deliberately. The file header names transcribeAudio() at
  // length to explain why it is not used, and a check that fired on the mention would force
  // somebody to delete the explanation to make the test pass — which is how the reasoning gets
  // lost and the helper gets wired in a year later.
  ok(
    "the review tool never imports the transcriber",
    !/^\s*import[^\n]*voice-notes/m.test(client)
  );
}


// ---- LANE 3 ----------------------------------------------------------------
// The call, and the close. Pure functions only: no network, no database, no model.

import {
  UNIVERSAL_V1_MED_SPA,
  MATERIALIZATION_FALLBACKS,
  applySubstitutions,
  materializeSet,
  materializeAll,
  composeTrackedSet,
  intakeQuestions,
  usableCompetitorName,
  ORIGIN_LABEL,
  type SubProvenance,
  type Substitutions,
} from "../src/lib/clients/question-sets";
import {
  questionProblems,
  buildAfterTheCard,
  renderCallQuestions,
  CLOSER_SECTIONS as CLOSER,
  factsBlock,
  CLOSER_SECTIONS,
  TOTAL_QUESTIONS,
  MAX_QUESTION_WORDS,
  type QuestionFacts,
} from "../src/lib/clients/artifacts/call-questions";
import { paymentLine, paymentFrom, isRecorded as paymentIsRecorded } from "../src/lib/clients/payment";

// ── 3A · the med spa twenty are the shipped PDF and nothing may move them ────
// A2 section 4: "the tracked set must be the questions the public actually received, because
// Beat 11 says so on camera." Four anchors rather than all twenty: enough that a reflow, a
// re-wording or a re-ordering fails, without turning this file into a second copy of the set.
{
  eq("the universal set is twenty", UNIVERSAL_V1_MED_SPA.length, 20);
  eq(
    "question 1 is verbatim",
    UNIVERSAL_V1_MED_SPA[0],
    "What's the best med spa near me for [Botox / filler / laser]?"
  );
  eq("question 2 is verbatim", UNIVERSAL_V1_MED_SPA[1], "Who does the best lip filler in [city]?");
  eq(
    "question 17 still carries the concern placeholder",
    UNIVERSAL_V1_MED_SPA[16],
    "What med spa in [city] specializes in [specific concern — e.g., melasma, acne scars]?"
  );
  eq(
    "question 19 still carries the device placeholder",
    UNIVERSAL_V1_MED_SPA[18],
    "Which med spa near me offers [specific device / brand — e.g., Morpheus8, CoolSculpting]?"
  );
}

const SUBS_FULL: Substitutions = {
  city: "Greensboro",
  state: "NC",
  treatmentPrimary: "lip filler",
  clientName: "Acme Med Spa",
  competitorIntake1: "Beta Aesthetics",
  concern: MATERIALIZATION_FALLBACKS.concern,
  devicePrimary: MATERIALIZATION_FALLBACKS.devicePrimary,
};

const PROV_MED_SPA: SubProvenance = {
  city: "intake",
  state: "intake",
  treatmentPrimary: "intake",
  clientName: "intake",
  competitorIntake1: "selected_competitor",
  concern: "fallback",
  devicePrimary: "fallback",
};

// ── applySubstitutions still does exactly what the chain did ────────────────
// Its signature and behaviour are relied on by page-candidates.ts and custom-question-set.ts,
// neither of which is this lane's. The table it now reads from must not have changed the output.
{
  eq(
    "the compound placeholder is filled before [treatment] can eat it",
    applySubstitutions("What's the best med spa near me for [Botox / filler / laser]?", SUBS_FULL),
    "What's the best med spa near Greensboro, NC for lip filler?"
  );
  eq(
    "[city] becomes city, state",
    applySubstitutions("Who does the best lip filler in [city]?", SUBS_FULL),
    "Who does the best lip filler in Greensboro, NC?"
  );
  eq(
    "the two clinics are the client and the competitor",
    applySubstitutions("Compare [Clinic A] vs [Clinic B] in [city].", SUBS_FULL),
    "Compare Acme Med Spa vs Beta Aesthetics in Greensboro, NC."
  );
  eq(
    "materializeAll is unchanged for the med spa lane",
    materializeAll(SUBS_FULL)[6],
    "I'm in Greensboro, NC. How do I know if a med spa is legit / has licensed injectors?"
  );
}

// ── med_spa keeps every question and drops nothing ──────────────────────────
{
  const set = materializeSet(UNIVERSAL_V1_MED_SPA, SUBS_FULL, PROV_MED_SPA, { vertical: "med_spa" });

  eq("med_spa keeps all twenty", set.questions.length, 20);
  eq("med_spa drops nothing, ever", set.dropped.length, 0);
  eq(
    "med_spa still prefixes the location onto question 7",
    set.questions[6].text,
    "I'm in Greensboro, NC. How do I know if a med spa is legit / has licensed injectors?"
  );
  eq(
    "materializeSet and materializeAll agree on the med spa lane",
    set.questions.map((q) => q.text),
    materializeAll(SUBS_FULL)
  );
  ok(
    "the fallback nouns are reported as fallbacks",
    set.fallbacksUsed.includes("concern") && set.fallbacksUsed.includes("devicePrimary")
  );
  eq("question 2 is labelled as coming from intake", set.questions[1].origin, "intake");
  eq(
    "a question filled from a fallback is never labelled from intake",
    set.questions[16].origin,
    "universal"
  );
  eq("the labels are the two printed on the call sheet", Object.keys(ORIGIN_LABEL).sort(), [
    "intake",
    "universal",
  ]);
}

// ── outside med_spa, an unfillable question is DROPPED, never guessed at ────
// This is the whole of 3A. The live call sheet asked an AI-visibility marketing agency
// "What med spa in Greensboro, NC specializes in melasma?" because melasma is a fallback and
// nothing stopped it being substituted into a business that has never heard of the word.
{
  const agencySubs: Substitutions = {
    ...SUBS_FULL,
    treatmentPrimary: "AI visibility",
    clientName: "SRT Agency LLC",
  };
  const agencyProv: SubProvenance = { ...PROV_MED_SPA };

  const set = materializeSet(
    [
      "Who does the best lip filler in [city]?",
      "What med spa in [city] specializes in [specific concern — e.g., melasma, acne scars]?",
      "Which med spa near me offers [specific device / brand — e.g., Morpheus8, CoolSculpting]?",
      "Which AEO agency in [city] gets clients cited in ChatGPT?",
    ],
    agencySubs,
    agencyProv,
    { vertical: "aeo-agency" }
  );

  eq("the two fallback questions are dropped", set.dropped.length, 2);
  eq("and the rest survive", set.questions.length, 2);
  ok(
    "melasma never reaches an agency's question set",
    !set.questions.some((q) => /melasma/i.test(q.text))
  );
  ok(
    "and neither does Morpheus8",
    !set.questions.some((q) => /Morpheus8/i.test(q.text))
  );
  ok(
    "the drop says which value was missing",
    set.dropped.every((d) => d.reason.includes("concern") || d.reason.includes("devicePrimary"))
  );
  eq(
    "the surviving question keeps its position in the source set",
    set.questions.map((q) => q.index),
    [1, 4]
  );
}

// A missing value drops a question outside med_spa too. Empty is not "fill it with nothing".
{
  const thin: Substitutions = { ...SUBS_FULL, treatmentPrimary: "" };
  const prov: SubProvenance = { ...PROV_MED_SPA, treatmentPrimary: "missing" };
  const set = materializeSet(["What is the average price for [treatment] near me?"], thin, prov, {
    vertical: "law-firm",
  });
  eq("an empty intake value drops the question", set.questions.length, 0);
  ok("and says so", set.dropped[0].reason.includes("treatmentPrimary"));
}

// ── questions 1 and 2 are the client's own, outside med_spa ────────────────
// Matthew: "question 1 and 2 are custom (unless they grabbed it from intake form) which i dont
// believe they did." They did not: the universal twenty were materialized for every vertical.
{
  const agencySubs: Substitutions = {
    ...SUBS_FULL,
    treatmentPrimary: "Chatgpt ads",
    clientName: "SRT Agency LLC",
  };
  const audit = Array.from({ length: 20 }, (_, i) => `audit question ${i + 1}`);

  const set = composeTrackedSet(audit, agencySubs, PROV_MED_SPA, { vertical: "aeo-agency" });

  eq("the set is still twenty", set.questions.length, 20);
  eq("question 1 comes from intake", set.questions[0].origin, "intake");
  eq("question 2 comes from intake", set.questions[1].origin, "intake");
  ok("and both carry the client's own service", set.questions.slice(0, 2).every((q) => q.text.includes("Chatgpt ads")));
  ok("and their own city", set.questions.slice(0, 2).every((q) => q.text.includes("Greensboro, NC")));
  eq("the audit's questions start at 3", set.questions[2].text, "audit question 1");
  eq("and the indexes are the printed positions", set.questions.map((q) => q.index).slice(0, 4), [1, 2, 3, 4]);

  // The two shapes are lifted from the frozen twenty rather than invented, which is the whole
  // safety argument for building a question at all.
  ok(
    "shape 1 is the shipped question 2 with the category taken out",
    set.questions[0].text === "Who does the best Chatgpt ads in Greensboro, NC?"
  );

  // med_spa is pinned and gets exactly the twenty, with nothing prepended.
  const medSpa = composeTrackedSet(UNIVERSAL_V1_MED_SPA, SUBS_FULL, PROV_MED_SPA, {
    vertical: "med_spa",
  });
  eq("med_spa is still exactly the shipped twenty", medSpa.questions.length, 20);
  eq(
    "and nothing was prepended to it",
    medSpa.questions.map((q) => q.text),
    materializeAll(SUBS_FULL)
  );
}

// A fallback or a missing value builds NOTHING rather than something falsely labelled.
{
  eq(
    "no intake questions without a real service",
    intakeQuestions({ ...SUBS_FULL, treatmentPrimary: "" }, { ...PROV_MED_SPA, treatmentPrimary: "missing" }),
    []
  );
  eq(
    "no intake questions without a city",
    intakeQuestions(SUBS_FULL, { ...PROV_MED_SPA, city: "missing" }),
    []
  );
  eq("two when both are real", intakeQuestions(SUBS_FULL, PROV_MED_SPA).length, 2);
  ok(
    "and neither is a half-filled sentence",
    intakeQuestions(SUBS_FULL, PROV_MED_SPA).every((q) => !/\s{2}|\sin \?/.test(q))
  );
}

// ── the competitor guard, and it exists because the client typed "a" ────────
{
  eq('"a" is never put to an engine', usableCompetitorName("a"), null);
  eq("neither is a blank", usableCompetitorName("   "), null);
  eq("nor is a number", usableCompetitorName("12"), null);
  eq("a real name survives", usableCompetitorName(" Beta Aesthetics "), "Beta Aesthetics");
  eq("null in, null out", usableCompetitorName(null), null);
}

// ── 3B · the validator, and describeInvalid covering all of it ──────────────
// booking-script.ts records what happens when describeInvalid describes only the shape: the
// correction retry gets a rejection with no reason and answers in prose, which is not JSON, so
// the parse throws on every run. Every branch below has to produce a sentence naming the defect.
{
  const good = CLOSER_SECTIONS.flatMap((s, i) =>
    Array.from({ length: i === 0 ? 8 : 5 }, (_, n) => ({
      section: s.key,
      question: `Question ${n} for ${s.key}?`,
    }))
  );
  eq("the fixture is the right size", good.length, TOTAL_QUESTIONS);
  eq("a well formed set has no problems", questionProblems({ questions: good }), []);

  ok(
    "a missing questions array is named",
    questionProblems({}).join(" ").includes("questions")
  );

  const short = { questions: good.slice(0, 30) };
  ok(
    "a wrong count is named with both numbers",
    questionProblems(short).join(" ").includes("30") &&
      questionProblems(short).join(" ").includes(String(TOTAL_QUESTIONS))
  );

  const missingSection = {
    questions: good.map((q) => (q.section === "reinforce" ? { ...q, section: "clarify" } : q)),
  };
  ok(
    "an empty section is named by key",
    questionProblems(missingSection).join(" ").includes("reinforce")
  );

  const wordy = {
    questions: good.map((q, i) =>
      i === 0 ? { ...q, question: `${"word ".repeat(MAX_QUESTION_WORDS + 4)}?` } : q
    ),
  };
  const wordyReason = questionProblems(wordy).join(" ");
  ok("a long line is named as a word count", wordyReason.includes(String(MAX_QUESTION_WORDS)));
  ok("and the offending line is quoted back", wordyReason.includes("word word"));

  const promised = {
    questions: good.map((q, i) =>
      i === 1 ? { ...q, question: "Would more customers help you this quarter?" } : q
    ),
  };
  const promisedReason = questionProblems(promised).join(" ");
  ok("a promise of customers fails the generation", promisedReason.length > 0);
  ok("and the offending question is quoted", promisedReason.includes("more customers"));

  const guaranteed = {
    questions: good.map((q, i) =>
      i === 2 ? { ...q, question: "What would a guarantee need to cover for this to work?" } : q
    ),
  };
  ok(
    "so does the word guarantee",
    questionProblems(guaranteed).join(" ").includes("guarantee")
  );

  const badSection = { questions: good.map((q, i) => (i === 3 ? { ...q, section: "close" } : q)) };
  ok(
    "an invented section is named",
    questionProblems(badSection).join(" ").includes("section")
  );
}

// ── 3B · the facts block states an absence rather than staying silent ───────
// Absent beats forbidden: the same move the price gate and miniCheckContext make. A model that
// is told nothing about the score supplies one.
{
  const bare: QuestionFacts = {
    clientName: "SRT Agency LLC",
    city: "Greensboro, NC",
    vertical: "aeo-agency",
    score: null,
    enginesRun: [],
    absentPrompts: [],
    presentPrompts: [],
    unmeasured: 0,
    namedInstead: [],
    confirmedCompetitors: [],
    presence: { coreMismatch: [], coreMissing: [], coreNotChecked: [], coreMatch: 0, coreTotal: 6 },
    reviews: { clientRecorded: [], competitorRecorded: [], outstanding: 0, total: 0 },
    technical: {
      registrar: null,
      dnsProvider: null,
      cms: null,
      mailProvider: null,
      resolverHealthy: true,
      robotsBlocks: [],
      siteSignals: [],
    },
  };

  const block = factsBlock(bare);
  ok("a missing score is stated as NONE", block.includes("SCORE: NONE"));
  ok("and the model is told not to cite one", block.includes("Do not cite a score"));
  ok("an unseeded review audit says no number exists", block.includes("No review number exists"));
  ok("nothing named instead is stated too", block.includes("NAMED INSTEAD: NONE"));

  const measured = factsBlock({
    ...bare,
    score: 10,
    enginesRun: ["openai"],
    absentPrompts: ["Who is the best AEO agency in Greensboro, NC?"],
    namedInstead: [{ name: "Rival Co", timesNamed: 4 }],
    presence: { ...bare.presence, coreNotChecked: ["Yelp"], coreMatch: 2 },
  });
  ok("a real score prints with its denominator", measured.includes("10 out of 100"));
  ok("each rival carries its own count", measured.includes("Rival Co, named in 4"));
  ok(
    "not_checked is never reported as correct",
    measured.includes("NOT CHECKED (this is not a finding that they are correct)")
  );
}

// ── 3B · AFTER THE CARD prints what the record holds, and refuses to guess ──
{
  const facts: QuestionFacts = {
    clientName: "Acme",
    city: "Greensboro, NC",
    vertical: "med_spa",
    score: 40,
    enginesRun: ["openai"],
    absentPrompts: [],
    presentPrompts: [],
    unmeasured: 0,
    namedInstead: [],
    confirmedCompetitors: [],
    presence: {
      coreMismatch: ["Yelp"],
      coreMissing: [],
      coreNotChecked: [],
      coreMatch: 5,
      coreTotal: 6,
    },
    reviews: { clientRecorded: [], competitorRecorded: [], outstanding: 0, total: 0 },
    technical: {
      registrar: "GoDaddy",
      dnsProvider: "GoDaddy",
      cms: null,
      mailProvider: null,
      resolverHealthy: true,
      robotsBlocks: [],
      siteSignals: [],
    },
  };

  const withValues = buildAfterTheCard({
    facts,
    domain: "acme.com",
    hubHost: "learn.acme.com",
    reviewsHost: "reviews.acme.com",
    cnameTarget: "4fddd1b501fe6565.vercel-dns-017.com",
    searchConsoleTxt: null,
    bookingSoftware: "Boulevard",
    reviewMode: "card_only",
    reviewOwner: "Dana",
  });

  ok(
    "the seeded CNAME target is printed, not a default",
    withValues.technical.some((l) => l.includes("4fddd1b501fe6565.vercel-dns-017.com"))
  );
  ok(
    "the real click path is read out rather than asked for",
    withValues.technical[0].includes("GoDaddy")
  );
  ok(
    "a booking system on the record is confirmed, not asked from scratch",
    withValues.funnel.some((l) => l.includes("Boulevard"))
  );
  ok(
    "the named person is read back",
    withValues.reviews.some((l) => l.includes("Dana"))
  );
  ok(
    "a mismatching listing becomes a login question",
    withValues.presence.some((l) => l.includes("Yelp"))
  );
  ok(
    "registrar credentials are never asked for",
    withValues.technical.some((l) => l.includes("Never ask for registrar credentials"))
  );

  const bare = buildAfterTheCard({
    facts: { ...facts, technical: { ...facts.technical, dnsProvider: null, registrar: null } },
    domain: null,
    hubHost: null,
    reviewsHost: null,
    cnameTarget: null,
    searchConsoleTxt: null,
    bookingSoftware: null,
    reviewMode: null,
    reviewOwner: null,
  });

  // ‼️ HUB_CNAME_TARGET's default is measured WRONG for this project, so an unseeded row prints
  // a sentence saying so rather than a value somebody reads down the phone.
  ok(
    "an unseeded CNAME says so instead of guessing a target",
    bare.technical.some((l) => l.includes("not seeded yet"))
  );
  ok(
    "an unknown DNS provider reads the nameservers out instead of naming one",
    bare.technical[0].includes("could not identify")
  );
  ok(
    "no booking software on the record is asked rather than assumed",
    bare.funnel.some((l) => l.includes("Nothing was recorded at intake"))
  );
}

// ── 3B · the document renders, and the divider really separates the halves ──
// Same shape as the presence-PDF checks above: render real bytes and read the text back out,
// because a PDF that throws on one field is a step that silently produces nothing.
{
  const facts: QuestionFacts = {
    clientName: "SRT Agency LLC",
    city: "Greensboro, NC",
    vertical: "aeo-agency",
    score: 10,
    enginesRun: ["openai"],
    absentPrompts: ["best AEO agency for local businesses"],
    presentPrompts: [],
    unmeasured: 0,
    namedInstead: [{ name: "D3 Corp", timesNamed: 4 }],
    confirmedCompetitors: ["D3 Corp"],
    presence: { coreMismatch: [], coreMissing: [], coreNotChecked: [], coreMatch: 6, coreTotal: 6 },
    reviews: { clientRecorded: [], competitorRecorded: [], outstanding: 0, total: 0 },
    technical: {
      registrar: "GoDaddy",
      dnsProvider: "GoDaddy",
      cms: null,
      mailProvider: null,
      resolverHealthy: true,
      robotsBlocks: [],
      siteSignals: [],
    },
  };

  const drafted = CLOSER.flatMap((sec, i) =>
    Array.from({ length: i === 0 ? 8 : 5 }, (_, n) => ({
      section: sec.key,
      question: `A ${sec.key} question number ${n}?`,
    }))
  );

  const pdf = renderCallQuestions({
    clientName: facts.clientName,
    facts,
    questions: drafted,
    after: buildAfterTheCard({
      facts,
      domain: "srtagency.com",
      hubHost: "learn.srtagency.com",
      reviewsHost: "reviews.srtagency.com",
      cnameTarget: "cname.example.com",
      searchConsoleTxt: null,
      bookingSoftware: null,
      reviewMode: null,
      reviewOwner: null,
    }),
  });

  const text = pdfText(pdf);
  ok("the closing questions render to real bytes", pdf.length > 1000);
  ok("every CLOSER section is on the page", CLOSER.every((sec) => text.includes(sec.title)));
  ok("the divider is there in words", text.includes("AFTER THE CARD"));
  ok(
    "and it says why nothing below it is asked first",
    text.includes("None of this is asked before the commitment")
  );
  ok("the document names itself internal", text.includes("internal"));

  // ‼️ test-onboarding-artifacts asserts "no issues found" appears in NO rendered client
  // PDF, in any casing, including inside a sentence disclaiming it. This one is internal, but it
  // is rendered by the same kit and the invariant is cheaper to keep than to reason about.
  ok("it never says no issues found", !/no issues found/i.test(text));
}

// ── 3C · it is an assertion, and the wording may never say otherwise ────────
// Same distinction day_0_source draws between photograph_2 and manual_step. This check is a grep
// for the same reason test-onboarding-artifacts greps a client PDF for "no issues found".
{
  const none = paymentFrom({});
  ok("nothing recorded is not recorded", !paymentIsRecorded(none));
  eq("and says so plainly", paymentLine(none), "No payment has been recorded.");

  const recorded = paymentFrom({
    payment_recorded_at: "2026-08-25T14:00:00.000Z",
    payment_recorded_by: "Matthew Garcia",
    payment_terms: "card on file, first invoice day 30",
    payment_note: "wants the invoice to the LLC",
  });
  ok("a stamped row is recorded", paymentIsRecorded(recorded));

  const line = paymentLine(recorded);
  ok("the line attributes it to a person", line.includes("Matthew Garcia"));
  ok("and dates it", line.includes("2026-08-25"));
  ok("and quotes the terms", line.includes("card on file"));
  ok("it says RECORDED BY", /payment recorded by/i.test(line));
  ok("it never says received", !/received/i.test(line));

  // The whole lane, in any casing, including inside a sentence disclaiming it.
  //
  // ‼️ COMMENTS ARE STRIPPED FIRST, AND THAT IS THE SAME LESSON AS THE TRANSCRIBER CHECK.
  // Every one of these files EXPLAINS at length that it must never say "payment received" and
  // must never reach for Stripe. A grep over the raw source fires on the explanation, so passing
  // the test would mean deleting the reasoning, which is how the reasoning gets lost and the
  // thing gets built anyway a year later. What is checked is the code and the strings: the words
  // that can actually reach a screen.
  const stripComments = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

  const lane3Sources = [
    "src/lib/clients/payment.ts",
    "src/app/api/clients/[id]/payment/route.ts",
    "src/app/dashboard/clients/[id]/payment-form.tsx",
  ].map((f) => stripComments(fs.readFileSync(path.join(__dirname, "..", f), "utf8")));

  ok(
    'no lane 3 payment surface can render the words "payment received"',
    lane3Sources.every((src) => !/payment\s+received/i.test(src))
  );
  ok(
    "and none of them reaches for a payment processor",
    lane3Sources.every((src) => !/stripe|checkout\.session|createCharge/i.test(src))
  );
}


// ---- LANE 4 ----------------------------------------------------------------
// Writing and publishing the pages. Pure functions and source greps only: no network, no
// database, no model. Everything with a Supabase call in it is exercised by the probes.

import { themeOf, scoreCandidate, DERIVED_CAP } from "../src/lib/clients/artifacts/page-candidates";
import { pageSlug } from "../src/lib/hub/pages";

{
  // ── themeOf: the two new arms, and the one they must not steal from ────────
  ok('themeOf finds a Tool', themeOf("botox cost calculator") === "Tool");
  ok('and a session-count question is a Tool', themeOf("how many sessions does laser take") === "Tool");
  ok('themeOf finds a Guide', themeOf("how do i prepare for a consultation") === "Guide");
  ok('and aftercare is a Guide', themeOf("what to expect after treatment") === "Guide");
  ok('Comparison is unchanged', themeOf("botox vs dysport") === "Comparison");

  // ‼️ THE REGRESSION THE ORDERING EXISTS TO STOP. "how much does X cost" opens with "how" and
  // contains "cost". A Tool arm keyed on \bhow\b, or a Guide arm placed above Price, swallows
  // the entire pricing theme and the call then picks from a list of calculators nobody asked
  // for. Both new arms are written narrowly for this one case.
  ok('"how much does it cost" is still Price', themeOf("how much does botox cost") === "Price");
  ok('and so is a financing question', themeOf("do you offer financing") === "Price");
  ok('an objection still outranks everything', themeOf("is botox worth it or a waste of money").length > 0);

  // ── scoreCandidate: the tri-state the derived pass depends on ──────────────
  const base = { frequency: 4, intent: 0.5, objection: false, inOwnReviews: false };
  const gap = scoreCandidate({ ...base, currentlyNamed: false });
  const named = scoreCandidate({ ...base, currentlyNamed: true });
  const unmeasured = scoreCandidate({ ...base, currentlyNamed: null });

  ok("a measured gap scores highest", gap > unmeasured && gap > named);
  ok(
    "and an unmeasured question scores exactly like a named one, never like a gap",
    unmeasured === named
  );

  // ‼️ THIS IS WHY DERIVED IDEAS PASS currentlyNamed: null RATHER THAN false. No engine has
  // ever been asked about a page that does not exist, so there is no answer. Passing false
  // would hand every idea we invented the largest term in the formula and rank our own guesses
  // above the client's measured gaps.
  ok("so a derived idea cannot buy the gap bonus by being a guess", unmeasured < gap);
  ok("the derived cap is a real cap", DERIVED_CAP > 0 && DERIVED_CAP <= 25);

  // ── the page studio opens usable drafts ────────────────────────────────────
  ok(
    "a claimed question produces a usable slug",
    pageSlug("How much does Botox cost in Greensboro, NC?") === "how-much-does-botox-cost-in-greensboro-nc"
  );
  ok("and a derived idea's longer title still slugs", pageSlug("A guide covering \"what to expect\" and 4 related questions").length > 0);
  ok("a question with no letters produces nothing rather than a bare dash", pageSlug("?? !!") === "");

  // ── the digit parser, which is what a bare number in the thread goes through ─
  const digit = (t: string) => /^([0-9]{1,2})$/.exec(t.trim());
  ok("a bare digit is a claim", digit("3")?.[1] === "3");
  ok("two digits are a claim", digit("12")?.[1] === "12");
  ok("a sentence starting with a number is not", digit("3 things to say here") === null);
  ok("and neither is a decimal", digit("3.5") === null);

  // 1-based against the frozen menu, the way pickFitWorkflow reads fit_menu.
  const menu = ["a", "b", "c"];
  ok("item 1 is the first", menu[1 - 1] === "a");
  ok("item 3 is the last", menu[3 - 1] === "c");
  ok("item 4 is out of range rather than wrapping", menu[4 - 1] === undefined);
  ok("and so is item 0", menu[0 - 1] === undefined);

  // ── the Day 0 wall still has exactly one door ──────────────────────────────
  //
  // ‼️ THIS IS day-zero.ts's OWN HOLE CHECK, RUN AS A TEST. Its comment says to verify with
  // `grep -rn "setPublished" src/`, which is a thing somebody has to remember to do. The wall
  // holds because there is ONE caller and it runs assertDay0Archived first; a second caller
  // added anywhere is the failure this catches. Comments are stripped for the same reason the
  // lane 3 check strips them: every one of these files explains the rule at length.
  // ‼️ LINE COMMENTS FIRST, THEN BLOCK COMMENTS, AND THAT ORDER IS NOT COSMETIC.
  // The hub route's auth header contains the path "/dashboard/*". Stripping block comments
  // first, the way the obvious version does, latches onto that "/*" and eats everything up to
  // the next "*/" — which swallowed `await setPublished(...)` and made this check report ZERO
  // callers, i.e. the wall looking safer than it is. A hole check that fails open is worse than
  // no hole check. Found by this test disagreeing with the grep it is a copy of.
  const stripLane4Comments = (src: string) =>
    src.replace(/^\s*\/\/.*$/gm, " ").replace(/\/\*[\s\S]*?\*\//g, " ");

  const srcRoot = path.join(__dirname, "..", "src");
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory() ? walk(full) : /\.tsx?$/.test(e.name) ? [full] : [];
    });

  const callers = walk(srcRoot).filter((f) => {
    if (f.endsWith(path.join("lib", "hub", "pages.ts"))) return false;
    return /\bsetPublished\s*\(/.test(stripLane4Comments(fs.readFileSync(f, "utf8")));
  });

  ok("setPublished has exactly one caller outside its own module", callers.length === 1);
  ok(
    "and that caller is the hub route, which asserts Day 0 first",
    callers[0]?.includes(path.join("api", "clients", "[id]", "hub")) ?? false
  );

  if (callers[0]) {
    const route = fs.readFileSync(callers[0], "utf8");
    ok(
      "the Day 0 assertion is written BEFORE the publish, not after",
      route.indexOf("assertDay0Archived") < route.indexOf("await setPublished")
    );
  }

  // ── the page body is markdown, never raw HTML ──────────────────────────────
  //
  // ‼️ THE EDITOR IS A SECOND react-markdown CALL SITE BESIDE hub-bodies.tsx, AND THE ONE
  // THING THAT MAY NEVER DRIFT BETWEEN THEM IS THIS FLAG. Per-page font and size is the
  // obvious next request and rehype-raw is the obvious way to build it, on the one surface in
  // this app that a client's own customers visit.
  const renderers = [
    "src/components/hub/hub-bodies.tsx",
    "src/app/dashboard/clients/[id]/hub-form.tsx",
  ].map((f) => stripLane4Comments(fs.readFileSync(path.join(__dirname, "..", f), "utf8")));

  ok(
    "no page-body renderer imports rehype-raw",
    renderers.every((src) => !/rehype-?raw/i.test(src))
  );
  ok(
    "and none of them passes a rehypePlugins array",
    renderers.every((src) => !/rehypePlugins/.test(src))
  );

  // ── the page studio never quietly rewrites him ─────────────────────────────
  const studio = stripLane4Comments(
    fs.readFileSync(path.join(__dirname, "..", "src/lib/clients/page-studio.ts"), "utf8")
  );
  ok(
    "the page studio reaches a model in exactly one place",
    (studio.match(/draftPage\(/g) ?? []).length === 1
  );
  ok(
    "and that place is the polish command",
    /polish/.test(studio) && /existingBody/.test(studio)
  );
  ok(
    "appending never routes through a model",
    /appendPageBody\(/.test(studio)
  );
}

// ‼️ EVERY LANE APPENDS ABOVE THIS SUMMARY, NEVER BELOW IT. scripts/_probe-dm-pitch.ts
// records what happens otherwise: five checks once sat under the process.exit and never ran.

// ─────────────────────────────────────────────────────────────────────────────
// ---- LANE 1 ---- screenshots become evidence (2026-08-25)
// ─────────────────────────────────────────────────────────────────────────────
{
  const {
    resolvePlatformFromUrl,
    SWEEP_GATE_COUNT,
    RECOMMENDED_KEYS,
    CORE_SIX: CORE,
    EXTENDED: EXT,
    ALL_PLATFORMS: ALL,
    PLATFORM_COUNT: COUNT,
  } = require("../src/config/presence-platforms") as typeof import("../src/config/presence-platforms");
  const { REVIEW_PLATFORM_KEYS, namesLikelySame } =
    require("../src/lib/clients/review-audit") as typeof import("../src/lib/clients/review-audit");
  const { formatSweepCard } =
    require("../src/lib/clients/presence-sweep") as typeof import("../src/lib/clients/presence-sweep");

  // ── The gate and the tiers are different facts ─────────────────────────────
  //
  // ‼️ THIS IS THE TRAP THE WHOLE LANE IS WRITTEN AROUND. CORE_SIX and EXTENDED are the
  // REMEDIATION tiers: citation-cleanup.ts sorts core-six first and multiplies effort by it,
  // presence-pdf.ts renders them separately, and findings section 3 goes to the client. Cutting
  // CORE_SIX to four to make the gate four would quietly redefine what "week one cleanup" means
  // in a document somebody reads.
  eq("the gate is four distinct platforms", SWEEP_GATE_COUNT, 4);
  eq("the core six is still six", CORE.length, 6);
  ok("trustpilot is an EXTENDED directory, not a promotion", EXT.some((p) => p.key === "trustpilot"));
  eq("nineteen platforms", COUNT, 19);
  eq("PLATFORM_COUNT matches the list", COUNT, ALL.length);

  // ── The recommended four are a display concept and nothing else ────────────
  eq("the recommended four", [...RECOMMENDED_KEYS], ["google", "yelp", "trustpilot", "bbb"]);
  ok(
    "every recommended key is a real platform",
    RECOMMENDED_KEYS.every((k) => ALL.some((p) => p.key === k))
  );
  // The review grid is those same four, and it is NOT a filter of CORE_SIX: trustpilot and bbb
  // are extended rows, so a CORE_SIX.filter() would silently return two platforms out of four.
  eq("the review grid is the same four", [...REVIEW_PLATFORM_KEYS], ["google", "yelp", "trustpilot", "bbb"]);

  // ── The address bar resolver, and the collision it exists for ──────────────
  eq("google maps is Google Business Profile", resolvePlatformFromUrl("https://www.google.com/maps/place/x"), ["google"]);
  eq("a google WEB search is nothing", resolvePlatformFromUrl("https://www.google.com/search?q=chamber+of+commerce"), []);
  eq("a bing WEB search is nothing", resolvePlatformFromUrl("https://www.bing.com/search?q=x"), []);
  eq("bing maps is Bing Places", resolvePlatformFromUrl("https://www.bing.com/maps?q=x"), ["bing"]);
  eq("trustpilot", resolvePlatformFromUrl("trustpilot.com/review/srtagency.com"), ["trustpilot"]);
  eq("a suffix is not a substring", resolvePlatformFromUrl("https://notyelp.com/biz/x"), []);
  eq("nothing legible is nothing", resolvePlatformFromUrl(""), []);

  // ‼️ chamber MUST STAY UNMAPPABLE. Its search surface IS a Google search page, so its address
  // bar is indistinguishable from any other Google search. Unmappable from a screenshot is the
  // honest answer, and a domains entry for it would file every Google search as a chamber.
  ok(
    "the chamber of commerce has no domain map, on purpose",
    !ALL.find((p) => p.key === "chamber")?.domains
  );

  // ── Matching a listing to a subject ────────────────────────────────────────
  ok("an entity suffix does not stop a match", namesLikelySame("Acme Med Spa", "Acme Med Spa LLC"));
  // The city is noise FOR THIS CLIENT and the caller says so, which is how a directory that
  // prints the city against a record that does not still matches.
  ok(
    "a listing that prints the city still matches when the caller declares it",
    namesLikelySame("Acme Med Spa", "Acme Med Spa of Greensboro", ["Greensboro", "NC"])
  );
  // ...and without that declaration it is a MISS rather than a guess. A miss costs one
  // message; a false match writes a competitor's review count onto the client.
  ok(
    "an undeclared extra word is a miss, not a match",
    !namesLikelySame("Acme Med Spa", "Acme Med Spa of Greensboro")
  );
  ok("a different business does not match", !namesLikelySame("Acme Med Spa", "Acme Dental"));
  ok("nothing matches nothing", !namesLikelySame(null, "Acme Med Spa"));
  // Category words alone are not identity: every med spa in the county would match every other.
  ok("category words alone are not a match", !namesLikelySame("Med Spa", "Greensboro Med Spa"));

  // ── The card still fits Slack ──────────────────────────────────────────────
  //
  // ‼️ A SECTION OVER 3,000 CHARACTERS FAILS THE WHOLE MESSAGE, and this card was already at
  // 2,988 for a SHORT business name before a nineteenth platform was added to it. bodySections()
  // splits on line boundaries at 2,900; what this checks is that no single LINE is over the
  // limit, because a line cannot be split and would take the card down with it.
  const card = formatSweepCard(
    { name: "Greensboro Aesthetic and Wellness Institute", city: "Greensboro", state: "NC" },
    {
      name: "Greensboro Aesthetic and Wellness Institute",
      addressLine1: "1200 W Market St",
      addressLine2: "Ste 200",
      city: "Greensboro",
      state: "NC",
      postalCode: "27403",
      phone: "+13368332303",
    }
  );
  const cardLines = card.split("\n");
  ok("no sweep card line can break a Slack section", Math.max(...cardLines.map((l) => l.length)) < 2900);
  ok("the sweep card says the gate is four", /any 4 DISTINCT platforms/.test(card));
  ok("the sweep card offers the address bar as the second route", /address bar/i.test(card));
  ok("the sweep card still says an empty search result is the evidence", /empty search result/i.test(card));
  ok("the sweep card leads with the recommended four", card.indexOf("START WITH THESE FOUR") < card.indexOf("THE REST OF THE CORE SIX"));
  ok("every platform is still on the card", ALL.every((p) => card.includes(p.label)));
}


if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
