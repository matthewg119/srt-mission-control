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
eq("twelve extended platforms", EXTENDED.length, 12);
eq("eighteen in total", PLATFORM_COUNT, 18);
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

if (failures > 0) {
  console.error(`\n${failures} of ${checks} checks failed.`);
  process.exit(1);
}
console.log(`All ${checks} checks passed.`);
