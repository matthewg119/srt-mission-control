// THE CARD PREVIEW'S RULES, EXECUTABLE.
//
//   bun --no-env-file run scripts/_probe-card-preview.ts
//
// ‼️ NO MODEL CALL, NO DATABASE, NO NETWORK. Pure reads of the config plus greps over the files
// that carry the page.
//
// WHAT IT PROVES, and every one of these is a thing that would be silently wrong otherwise:
//  1. A DESIGN NAMES ONE OF A FIXED SET OF WORDINGS AND CAN NEVER INVENT ONE.
//     src/config/card-designs.ts contains no prose at all; CARD_COPY_SETS is the registry.
//  2. The default card IS the printed card, byte for byte, read out of one module.
//  3. No card is a pre-screen, no card says a deal is for a REVIEW, and the one invented figure
//     lives in one named constant. Read section 3: this was loosened on 2026-10-09.
//  4. The page sells nothing. No price, no plan name, no offer key.
//  5. The route validates what the client validates, because a browser check is not a boundary.
//  6. The token is identity and not authority: its own scope, and every refusal looks the same.
//  7. Every lead goes through ingestLead(), so Matthew is notified.
//  8. Nothing claims a PDF was sent, because nothing sends one yet, and the two promises with a
//     clock on them (the PDF, and the 2 hour custom design) both shout on the Slack card.

import fs from "node:fs";
import path from "node:path";

import {
  CARD_COPY_SETS,
  CARD_PREVIEW_SOURCE,
  PREVIEW_CLOSE,
  PREVIEW_CUSTOM,
  PREVIEW_DAY,
  PREVIEW_DAYPART,
  PREVIEW_IDS,
  PREVIEW_INSIDE,
  PREVIEW_OFFER_SAMPLE,
  PREVIEW_SCAN,
  PREVIEW_SCRIPT,
} from "../src/config/card-preview";
import { CARD_DESIGNS, OFFERED_DESIGNS, designByKey } from "../src/config/card-designs";
import { REVIEW_CARD_COPY } from "../src/lib/hub/review-card-copy";
import { CARD_QUESTIONS } from "../src/lib/hub/review-script";

const CONFIG = "src/config/card-preview.ts";
const DESIGNS = "src/config/card-designs.ts";
const ART = "src/app/cards/p/card-art.tsx";
const CLIENT = "src/app/cards/p/preview-client.tsx";
const ROUTE = "src/app/api/cards/preview/route.ts";
const PAGE = "src/app/cards/p/[[...token]]/page.tsx";
const LINK = "src/lib/cards/preview-link.ts";
const PRINTER = "src/lib/clients/artifacts/review-card.ts";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  // ‼️ SPLIT THE CARRIAGE RETURNS OUT. This repo is mixed CRLF/LF and `.` never matches a \r, so
  // a comment stripper that does not do this leaves every line ending in one and passes on a
  // checkout that fails on the same commit elsewhere. _probe-lead-card.ts carries the scar.
  const CR = String.fromCharCode(13);
  return fs.readFileSync(path.join(process.cwd(), file), "utf8").split(CR).join("");
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const configSrc = stripComments(read(CONFIG));
const designSrc = stripComments(read(DESIGNS));
const artSrc = stripComments(read(ART));
const clientSrc = stripComments(read(CLIENT));
const routeSrc = stripComments(read(ROUTE));
const pageSrc = stripComments(read(PAGE));
const linkSrc = stripComments(read(LINK));
const printerSrc = stripComments(read(PRINTER));

// ── 1. A DESIGN IS A PALETTE, NEVER A WORDING. ──────────────────────────────
//
// ‼️ review-card.ts: "VISUAL THEME PER CLIENT. COPY IDENTICAL FOR EVERY CLIENT. FOREVER." That
// held literally until 2026-10-09, when Matthew asked for an offer-led card. What is left of it,
// and what this section holds, is that the SET of wordings is fixed, small and checked: a design
// names a key, the registry owns the strings, and nothing can grow a headline of its own inside a
// palette file. See CARD_COPY_SETS for what the loosening costs.
console.log("\n1. a design picks a wording and can never invent one");

check(CARD_DESIGNS.length >= 2, `there are ${CARD_DESIGNS.length} designs`);
check(
  new Set(CARD_DESIGNS.map((d) => d.key)).size === CARD_DESIGNS.length,
  "no two designs share a key"
);
check(
  OFFERED_DESIGNS.length === 2,
  "exactly two are offered on the landing",
  `offered: ${OFFERED_DESIGNS.join(", ")}`
);
check(
  !CARD_DESIGNS.some((d) => d.key === "ink"),
  "the ink design is deleted, not merely unlisted",
  "a card kept in the registry and shown to nobody is a fourth thing to keep working"
);
// Every design names a copy set that exists. This is what replaced "a design carries no wording":
// it may PICK one of a fixed, checked set and may never invent one.
check(
  CARD_DESIGNS.every((d) => Boolean(CARD_COPY_SETS[d.copy])),
  "every design names a copy set that exists",
  CARD_DESIGNS.map((d) => `${d.key}=${d.copy}`).join(", ")
);
check(
  OFFERED_DESIGNS.every((k) => CARD_DESIGNS.some((d) => d.key === k)),
  "and every offered key names a design that exists"
);
check(
  designByKey("nonsense-not-a-design").key === OFFERED_DESIGNS[0],
  "an unknown key falls back rather than throwing",
  "?d= reaches this from a URL, so a typo must not be a 500"
);

// ‼️ THE TEETH. A design's only strings are a key and a one-word label; anything with a space in
// it, or longer than a label could be, is prose and prose does not belong in a palette.
{
  const strings = CARD_DESIGNS.flatMap((d) => [d.key, d.label]);
  const prose = strings.filter((s) => s.includes(" ") || s.length > 16);
  check(prose.length === 0, "no design carries a sentence", prose.join(" | ") || "keys and one-word labels only");
}
// And the file itself holds no sentence outside its comments, which is what would survive a
// future design object gaining a `headline` field.
{
  // ‼️ `[^"\n]` AND NOT `[^"]`. A dot-less character class still matches newlines, so the first
  // version of this paired a quote on the import line with one twenty lines later and reported
  // the whole file as a sentence. A string literal does not span lines; a false positive here
  // would have been "fixed" by loosening the check, which is how a probe stops meaning anything.
  const sentences = (designSrc.match(/"[^"\n]{18,}"/g) ?? []).filter(
    // Hex colours and import paths are the two long strings a palette legitimately contains.
    (s) => !/^"#/.test(s) && !/^"[@.]/.test(s)
  );
  check(
    sentences.length === 0,
    "and the design config contains no long string at all",
    sentences.join(" | ") || "colours, keys and labels"
  );
}

// ── 2. THE CARD'S WORDS ARE THE PRINTER'S WORDS. ────────────────────────────
console.log("\n2. the preview and the printer read one copy of the card");

// ‼️ THE ARTWORK NO LONGER READS REVIEW_CARD_COPY DIRECTLY, AND MUST NOT. Since the second copy
// set existed it takes whichever one it is handed, so reaching for the printed card's words in
// here would be a card that ignores the design it was asked to draw. The registry is the only
// reader, which is what keeps one place to look.
check(
  !/review-card-copy/.test(artSrc) && /copy\.promise/.test(artSrc) && /copy\.scanLine/.test(artSrc),
  "the artwork renders the copy set it is handed and reaches for nothing else"
);
check(
  /review-card-copy/.test(configSrc),
  "the copy-set registry is what reads REVIEW_CARD_COPY"
);
check(
  /review-card-copy/.test(printerSrc),
  "and so does the printed PDF, which is the whole point of the module"
);
// ‼️ ASSERT THE ABSENCE IN THE ARTWORK, because the failure mode is somebody "just tidying up"
// one line of the preview and shipping a screen that disagrees with the card stock.
for (const line of [REVIEW_CARD_COPY.promise, REVIEW_CARD_COPY.scanLine]) {
  check(
    !artSrc.includes(line),
    `the artwork does not restate "${line.slice(0, 28)}..."`,
    "it renders the constant, so the two cannot drift"
  );
}
// ‼️ AND THE DEFAULT CARD IS STILL THE PRINTER'S, BYTE FOR BYTE. The `offer` set below is the
// deliberate exception; `neutral` must never become a second copy of the same words, because the
// moment it is typed out here it can be edited here.
check(
  CARD_COPY_SETS.neutral.promise === REVIEW_CARD_COPY.promise &&
    CARD_COPY_SETS.neutral.scanLine === REVIEW_CARD_COPY.scanLine,
  "the neutral copy set IS the printed card's copy, not a transcription of it"
);
check(
  CARD_COPY_SETS.neutral.carriesOffer === false,
  "and the neutral card carries no offer"
);
// The count is derived from the walk, because the card is printed and the walk is not.
check(
  REVIEW_CARD_COPY.promise.startsWith(
    ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight"][CARD_QUESTIONS.length] ?? ""
  ),
  "the question count on the card is derived from CARD_QUESTIONS",
  `${CARD_QUESTIONS.length} questions, card says "${REVIEW_CARD_COPY.promise}"`
);

// ── 3. THE CARD IS NOT A PRE-SCREEN, AND THE OFFER IS FENCED. ──────────────
//
// ‼️ THIS SECTION WAS LOOSENED ON 2026-10-09 AND THE LOOSENING IS THE POINT OF THE COMMENT.
// It used to forbid any mention of a discount on any card surface, because review-card.ts bans an
// incentive by name and the in-clinic lane's position was that the ban "was NOT reversed". Matthew
// asked for a second card reading "Scan for 80% off ...", which reverses it. See CARD_COPY_SETS
// for the exposure in full.
//
// What is still enforced, because these are the parts that actually bite:
//   - the PRINTED card copy carries no offer, no stars and no sentiment gate. Untouched.
//   - no card surface says the deal is for a REVIEW. An offer for a referral is a referral
//     programme; an offer for a review is a paid review, and one word is the whole difference.
//   - no sentiment gate anywhere. "if you loved your visit" sorts patients before they scan, and
//     that is the thing this system exists to refuse. An offer does not sort anybody.
//   - the mockup figure is ONE named constant, never prose in the artwork.
console.log("\n3. the card is not a pre-screen, and the offer is fenced");

const CARD_SURFACES = [
  ["the printed copy", Object.values(REVIEW_CARD_COPY).join(" ")],
  ["the artwork", artSrc],
  ["the design config", designSrc],
] as const;

for (const [label, src] of CARD_SURFACES) {
  check(!/loved your visit|if you enjoyed|happy with/i.test(src), `${label} contains no sentiment gate`);
  check(!/\bstars?\b|\brating\b/i.test(src), `${label} draws no stars`);
  check(
    !/discount|% off|free gift|voucher|entry into|prize/i.test(src),
    `${label} offers nothing at all`
  );
}

// Every copy set, including the offer one, on the two rules that did not move.
for (const set of Object.values(CARD_COPY_SETS)) {
  const words = `${set.promise} ${set.scanLine}`;
  check(
    !/loved your visit|if you enjoyed|happy with|only if/i.test(words),
    `the "${set.key}" card contains no sentiment gate`,
    words
  );
  // ‼️ THE ONE WITH TEETH. A card may carry a deal; it may never say the deal is for a review.
  check(
    !/\breview/i.test(words),
    `and the "${set.key}" card never ties anything to leaving a review`
  );
}

// The offer lives in exactly one named constant, and the artwork hardcodes no figure.
check(
  CARD_COPY_SETS.offer.carriesOffer === true,
  "the offer card declares that it carries an offer",
  "the Slack card reads this, so whoever makes the PDF knows it is not the generator's one"
);
check(
  CARD_COPY_SETS.offer.promise.includes(PREVIEW_OFFER_SAMPLE),
  "and its figure comes from PREVIEW_OFFER_SAMPLE rather than being typed into the set",
  CARD_COPY_SETS.offer.promise
);
{
  // ‼️ COUNTED ACROSS WHAT A PATIENT READS, NOT ACROSS THE FILE. The config also carries "20%
  // off, a free consult..." as the PLACEHOLDER in the offer question's text box, which is an
  // example of the shape of an answer shown to a clinic owner typing one. That is a different
  // object from a figure printed on card stock, and a check that conflated the two would have to
  // be switched off the first time somebody improved a hint.
  const printed = Object.values(CARD_COPY_SETS)
    .map((c) => `${c.promise} ${c.scanLine}`)
    .join(" ");
  const figures = (printed.match(/\d+\s*%/g) ?? []).length;
  check(
    figures === 1,
    "exactly ONE invented figure reaches a card",
    figures === 1 ? PREVIEW_OFFER_SAMPLE : `${figures} found in: ${printed}`
  );
}
// ‼️ "N% off" AND NOT A BARE "%", because the artwork is full of percentages: they are the
// widths of the QR plate in each of the three layouts. A check that could not tell a CSS width
// from a discount would be switched off within a week, and a probe nobody trusts is worse than
// no probe. What is actually forbidden is a DEAL written into the drawing.
check(
  !/\d+\s*%\s*off/i.test(artSrc),
  "and the artwork writes no deal of its own",
  "it renders whichever copy set it is handed"
);

// ── 4. IT SELLS NOTHING. ────────────────────────────────────────────────────
//
// Same rule /cards carries: the email that got them here offered a free batch of cards, and a
// price on the page that shows them the cards would make that email a bait.
console.log("\n4. it sells nothing");

for (const [label, src] of [
  ["the config", configSrc],
  ["the client", clientSrc],
  ["the route", routeSrc],
  ["the page", pageSrc],
] as const) {
  const money = (src.match(/\$\d/g) ?? []).length;
  check(money === 0, `${label} quotes no price`, money ? `${money} figures found` : "no figures at all");
  check(
    !/review_free|year_3300|month_349|OFFER_KEYS|offer-cards/.test(src),
    `${label} does not reach for the offer picker`
  );
  check(!/hipaa/i.test(src), `${label} never says HIPAA`);
}

// ── 5. THE ROUTE VALIDATES WHAT THE CLIENT VALIDATES. ───────────────────────
console.log("\n5. a browser check is a courtesy and never a boundary");

for (const rule of ["validEmail", "validName"]) {
  check(clientSrc.includes(rule), `the client checks ${rule}`);
  check(routeSrc.includes(rule), `and so does the route`);
}
check(
  /slice\(0, ?160\)|clean\(body\.referralOffer, ?160\)/.test(routeSrc),
  "the free-text answers are length-bounded on the server",
  "they reach a Slack card and, later, a service row"
);

// ── 6. THE TOKEN IS IDENTITY AND NOT AUTHORITY. ─────────────────────────────
console.log("\n6. the token names a conversation and grants nothing");

check(
  /"card"/.test(linkSrc) && /verifyOnboardingToken\(token, "card"\)/.test(linkSrc),
  "it has its own scope, so it cannot open /onboarding or a client preview"
);
check(
  /return null/.test(linkSrc) && (linkSrc.match(/return null/g) ?? []).length >= 4,
  "and every refusal returns the same null",
  "a bad signature, an expiry and a deleted contact are indistinguishable from outside"
);
// ‼️ THE PAGE MUST NOT DEAD-END. Somebody we asked to click a link reading "invalid link" is a
// worse outcome than a page that simply does not know their name.
check(
  !/notFound\(\)|redirect\(/.test(pageSrc),
  "a bad token renders the generic page rather than a 404"
);
check(
  /PREVIEW_FALLBACK_NAME/.test(pageSrc),
  "and the generic page names a placeholder rather than a real clinic",
  "a recorded walkthrough of a clinic that does not exist is a fabricated case study"
);

// ── 7. EVERY LEAD IS NOTIFIED, AND NOTHING CLAIMS TO HAVE SENT A PDF. ───────
console.log("\n7. the lead lands, and nobody is told a card was emailed");

check(/ingestLead\(/.test(routeSrc), "the route goes through ingestLead()");
check(!/from\("contacts"\)\s*\n?\s*\.insert|\.update\(/.test(routeSrc), "and never writes contacts itself");
check(
  routeSrc.includes("headline,") && routeSrc.includes("detailLines:"),
  "and it fills in the card"
);
check(
  routeSrc.includes("OWES THEM THE PDF"),
  "the card shouts that a PDF is owed, because a person has to send it"
);
// ‼️ "shortly" IS LOAD BEARING. Nothing in this lane renders or emails a card, so copy promising
// an instant delivery is the one lie this page could tell that somebody sits and waits for.
check(
  /shortly/i.test(PREVIEW_CLOSE.sent) && !/now|instantly|check your inbox/i.test(PREVIEW_CLOSE.sent),
  "and the closing line says shortly rather than now",
  PREVIEW_CLOSE.sent
);

// ── 8. HOUSEKEEPING. ────────────────────────────────────────────────────────
console.log("\n8. housekeeping");

check(CARD_PREVIEW_SOURCE === "card_preview", "the lead source tag is 'card_preview'", CARD_PREVIEW_SOURCE);
check(
  new Set(PREVIEW_IDS).size === PREVIEW_IDS.length,
  "no two steps share an id",
  PREVIEW_IDS.join(", ")
);
check(PREVIEW_SCRIPT.length === 5, `the walk asks five questions`, `${PREVIEW_SCRIPT.length}`);
// His order, and the probe holds it because it is the thing most likely to be "tidied" back to
// the house order: they tapped a button that says email me the card, so the address comes first.
check(
  PREVIEW_SCRIPT[0].kind === "ask" && PREVIEW_SCRIPT[0].key === "email",
  "and the email is the first of them"
);
check(
  PREVIEW_DAYPART.options.length === 2 && PREVIEW_DAY.count === 2,
  "two half-days and two days, then the calendar"
);
check(
  /PREVIEW_DAY.other/.test(clientSrc) && /showCalendar/.test(clientSrc),
  "and the escape from the two days is what reveals the whole calendar"
);
// ‼️ THE OFFER QUESTION HAS A WAY OUT. Most clinics being shown this have never run a referral
// programme, so "I have not worked that out" is the likeliest honest answer and a text box is the
// wrong shape for it. It stores a SENTENCE, because "not decided" and "never asked" are different
// facts on a card somebody reads before a call.
{
  const offerStep = PREVIEW_SCRIPT.find((x) => x.kind === "ask" && x.key === "referralOffer");
  const skip = offerStep?.kind === "ask" ? offerStep.skip : undefined;
  check(Boolean(skip), "the offer question can be answered with I do not know");
  check(
    Boolean(skip?.value && skip.value.trim().length > 0),
    "and that answer is a real value, never an empty string",
    skip?.value
  );
  check(
    PREVIEW_SCRIPT.filter((x) => x.kind === "ask" && x.skip).length === 1,
    "and it is the only question with one",
    "a clinic that cannot name its own best seller is not a state worth designing for"
  );
}
// The grey door, and the two buttons that went with the link it replaced.
check(
  Boolean(PREVIEW_CUSTOM.opener) && /2 hours/.test(PREVIEW_CUSTOM.opener),
  "the custom-design door promises a time",
  PREVIEW_CUSTOM.opener
);
check(
  PREVIEW_CUSTOM.flag.includes("2h") && routeSrc.includes("PREVIEW_CUSTOM.flag"),
  "and the Slack card shouts it, because a person has to keep that promise"
);
check(
  /cp-mini/.test(clientSrc) && /setWantsCustom/.test(clientSrc),
  "it is a button into the funnel rather than a link out of it"
);
for (const gone of ["insideHref", "openOut", "altCta", "cp-back"]) {
  check(
    !clientSrc.includes(gone),
    `"${gone}" is gone from the screen`,
    "removed 2026-10-09: full screen, email me the PDF, and back to the card"
  );
}
check(
  /robots: \{ index: false/.test(pageSrc),
  "the page is noindex, because it is the middle of an outbound conversation"
);
// Two screens before anything is asked for. The order IS the argument; see the config header.
// ‼️ String() ON BOTH SIDES, AND IT IS NOT NOISE. `as const` narrows these to their literals, so
// a direct !== is a comparison tsc can settle at compile time and it refuses to emit ("no
// overlap"). Widening to string is what keeps this an assertion about the VALUES, which is the
// point: the two screens must be numbered differently, and somebody copy-pasting the block is
// exactly how they would stop being.
check(
  Boolean(PREVIEW_SCAN.title) &&
    Boolean(PREVIEW_INSIDE.title) &&
    String(PREVIEW_SCAN.eyebrow) !== String(PREVIEW_INSIDE.eyebrow),
  "there are two numbered screens before the chat",
  `${PREVIEW_SCAN.eyebrow} then ${PREVIEW_INSIDE.eyebrow}`
);
check(
  /insideLive/.test(clientSrc) && /cp-veil/.test(clientSrc),
  "and the live frame starts inert, so going inside is a decision"
);

console.log("");
if (failures > 0) {
  console.error(`${failures} check(s) failed. A design is a palette, and the card's words are the printer's.`);
  process.exit(1);
}
console.log("All checks passed. Two screens, two wordings, and only one of them invented.");
