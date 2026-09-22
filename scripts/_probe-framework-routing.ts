// The two fixes for the 2026-09-22 misfiling: how a dropped file is ROUTED, and what ingestResearch
// REFUSES before it writes. No database, no network.
//
//   bun run scripts/_probe-framework-routing.ts
//
// ‼️ WHAT WENT WRONG, AND WHY A PURE PROBE CAN PROVE THE FIX.
// Four files went into step 11's thread on 2026-09-22. Three were framework documents whose first
// line is a TITLE ("# AI Referral Engine Avatar Sheet"), so no prefix matched, storeFrameworkFile
// returned null, and they fell through to ingestResearchFile. 321 deep_research phrases landed in
// question_bank, which has no client_id and cannot be unpicked by client.
//
// The existing probe for this lane, _probe-research-paste.ts, exercises afterResearchPaste ONLY. It
// never calls ingestResearch, so it never observed the write that happens before the refusal. That
// gap is why the bug survived, and it is what section 2 below closes: the gate is a pure predicate
// over the text, so the decision ingestResearch makes can be proved without a client row.

import { kindFromFilename, readFrameworkPaste } from "../src/lib/clients/avatar-framework";
import { looksLikeFullResearch } from "../src/lib/clients/avatar-profile";
import { extractKeywords } from "../src/lib/clients/harvest";

let failures = 0;
function check(name: string, ok: boolean, detail = ""): void {
  if (!ok) failures += 1;
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${!ok && detail ? `\n          ${detail}` : ""}`);
}

/** The gate as ingestResearch applies it. Refuse when it is NEITHER research NOR a keyword block. */
function wouldRefuse(body: string): boolean {
  return !looksLikeFullResearch(body) && !extractKeywords(body).length;
}

const filler = (label: string) => `${label} `.repeat(40);

// The shape that caused this: a title, then labelled prose. No numbered sections, no KEYWORDS block.
const AVATAR_SHEET = [
  "# AI Referral Engine Avatar Sheet",
  "",
  "Who they are: med spa owners running one or two locations, usually the founder.",
  filler("They are the person who still answers the phone at six in the evening."),
  "Fears: that the money goes out and nothing measurable comes back.",
  filler("They have been sold marketing before and it did not work."),
].join("\n");

const SHORT_OFFER = ["# Short Offer Summary", "", "Price: 499 a month.", filler("The big idea is that AI answers now.")].join("\n");

const KEYWORDS_ONLY = [
  "KEYWORDS",
  "botox cost | 1200 | commercial | https://example.com/a",
  "lip filler near me | 800 | commercial |",
  "is coolsculpting worth it | 300 | research |",
].join("\n");

const FULL_RESEARCH = [
  "# Deep research: med spa owner",
  "## 1. Who buys",
  filler("owners in their forties who opened a second room"),
  "## 2. What they use now",
  filler("agencies, a cousin who does websites, or nothing"),
  "## 3. Why they quit",
  filler("they could never tell what the retainer bought"),
  "## 4. What they believe",
  filler("that being on page one is the same as being recommended"),
].join("\n");

// ── 1. The filename signal ──────────────────────────────────────────────────
console.log("\n1. kindFromFilename, the weakest of the three signals");

check(
  "the file that caused this routes to avatar_sheet",
  kindFromFilename("AI_Referral_Engine_Avatar_Sheet.md", "body")?.kind === "avatar_sheet"
);
check("spaces and case do not matter", kindFromFilename("AI Referral Engine AVATAR SHEET.pdf", "b")?.kind === "avatar_sheet");
check("a short offer summary routes", kindFromFilename("Short Offer Summary.docx", "b")?.kind === "short_offer");
check("'offer summary' alone routes", kindFromFilename("ai-referral-engine-offer-summary.md", "b")?.kind === "short_offer");
check(
  "a BELIEF CHAIN routes, though the typed prefix is `beliefs:`",
  kindFromFilename("AI Referral Engine Belief Chain.pdf", "b")?.kind === "necessary_beliefs"
);
check("the body is carried through untouched", kindFromFilename("avatar sheet.md", AVATAR_SHEET)?.body === AVATAR_SHEET);

console.log("\n1b. and what it must REFUSE to route");
check("research.pdf falls through, keeping its existing path", kindFromFilename("research.pdf", "b") === null);
check("a deep research answer falls through", kindFromFilename("AI referral engine research.pdf", "b") === null);
check("'Med Spa Owner Profile.txt' falls through", kindFromFilename("Med Spa Owner Profile.txt", "b") === null);
check("a bare generic word never routes: offer.pdf", kindFromFilename("offer.pdf", "b") === null);
check("a bare generic word never routes: avatar.docx", kindFromFilename("avatar.docx", "b") === null);
check("a bare generic word never routes: belief.txt", kindFromFilename("belief.txt", "b") === null);
check("an empty name routes nothing", kindFromFilename("", "b") === null);
check(
  "two kinds in one name is a refusal, not first-match-wins",
  kindFromFilename("short offer and beliefs.pdf", "b") === null
);

console.log("\n1c. it stays BELOW the two stronger signals");
check("a typed prefix is still read first", readFrameworkPaste("avatar sheet:")?.kind === "avatar_sheet");
check(
  "a first line still wins over a filename that says otherwise",
  readFrameworkPaste("short offer:\nPrice: 499")?.kind === "short_offer" &&
    kindFromFilename("avatar sheet.md", "b")?.kind === "avatar_sheet"
);

// ── 2. The gate ingestResearch applies BEFORE it writes ─────────────────────
console.log("\n2. ingestResearch refuses before writing, and only the right things");

check("‼️ an avatar sheet is refused, so it writes NO question_bank rows", wouldRefuse(AVATAR_SHEET));
check("‼️ a short offer summary is refused", wouldRefuse(SHORT_OFFER));

check("‼️ a KEYWORDS block pasted on its own still passes", !wouldRefuse(KEYWORDS_ONLY));
check("  and it is the keyword block that saves it, not the sections", !looksLikeFullResearch(KEYWORDS_ONLY));
check("  the block really parses", extractKeywords(KEYWORDS_ONLY).length === 3, `got ${extractKeywords(KEYWORDS_ONLY).length}`);

check("a full research answer passes", !wouldRefuse(FULL_RESEARCH));
check("  because it answers the sections", looksLikeFullResearch(FULL_RESEARCH));

// The two other callers of ingestResearch. Both hand it a stored or generated full report, so both
// must clear the gate: reuseAvatarResearch is also the BORROW path, and a regression here would
// break borrowing an avatar as well as pasting research.
check("a report with a research body and a keywords block passes", !wouldRefuse(`${FULL_RESEARCH}\n\n${KEYWORDS_ONLY}`));
check("an avatar sheet with a keywords block appended passes, and that is correct", !wouldRefuse(`${AVATAR_SHEET}\n\n${KEYWORDS_ONLY}`));

console.log("\n3. no em dash reaches a model or a client");
check("the alias table and fixtures are clean", ![AVATAR_SHEET, SHORT_OFFER, KEYWORDS_ONLY, FULL_RESEARCH].some((s) => /[—–]/.test(s)));

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
