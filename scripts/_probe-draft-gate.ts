// The four documents as a precondition on `draft`, offline.
//
// ‼️ THE HALF MOST WORTH PROVING IS WHAT IS **NOT** GATED. A gate that also caught `ask`, `add:` or
// dictation would push people out of the lane entirely, and the damage would not look like a bug:
// it would look like nobody using the studio. So the source checks below are as important as the
// behavioural ones, and they read the code with comments stripped so a promise in a comment cannot
// pass for the code that keeps it.
//
//   bun run scripts/_probe-draft-gate.ts        (offline: no DB, no key, no network)

import { readFileSync } from "fs";
import {
  GATED_DOCUMENTS,
  missingPreconditions,
  refusalLines,
  type DraftContext,
} from "../src/lib/clients/draft-gate";
import { kindBelongsToOffer } from "../src/lib/clients/audience-documents";

let failed = 0;
function check(what: string, ok: boolean, detail = ""): void {
  if (!ok) failed++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${what}${detail && !ok ? `  (${detail})` : ""}`);
}

const CR = String.fromCharCode(13);
/** ‼️ THE \r FIRST. core.autocrlf is true here, and `.` does not match \r, so `//.*$` strips nothing. */
const stripComments = (s: string) =>
  s
    .split(CR)
    .join("")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map((l) => l.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");

const FULL: DraftContext = {
  avatarConfirmed: true,
  offerLocked: true,
  deepResearch: true,
  avatarSheet: true,
  shortOffer: true,
  necessaryBeliefs: true,
};
const EMPTY: DraftContext = {
  avatarConfirmed: false,
  offerLocked: false,
  deepResearch: false,
  avatarSheet: false,
  shortOffer: false,
  necessaryBeliefs: false,
};

// ─── 1. The gate opens and closes ─────────────────────────────────────────────
console.log("\n1. draft is refused until the client has what a page is written from");

check("a client with everything is not blocked", missingPreconditions(FULL).length === 0);
check("a client with nothing is blocked on all six", missingPreconditions(EMPTY).length === 6);
check("and an unblocked client gets no refusal card at all", refusalLines([]).length === 0);

// ‼️ EVERY SINGLE MISSING FACT BLOCKS ON ITS OWN. Six one-at-a-time cases, because a gate that only
// fires when several are missing is a gate that lets the common case through.
for (const key of Object.keys(FULL) as Array<keyof DraftContext>) {
  const one = { ...FULL, [key]: false };
  const missing = missingPreconditions(one);
  check(`missing ${key} alone blocks draft`, missing.length === 1, JSON.stringify(missing.map((m) => m.key)));
}

// ─── 2. The order is a dependency order ───────────────────────────────────────
console.log("\n2. the four are asked for in the order they can be answered");

const order = missingPreconditions(EMPTY).map((m) => m.key);
check(
  "‼️ never beliefs first: the belief chain is written from the sheet and the short offer",
  order.indexOf("necessary_beliefs") > order.indexOf("avatar_sheet") &&
    order.indexOf("necessary_beliefs") > order.indexOf("short_offer"),
  order.join(" -> ")
);
check(
  "the avatar comes before any document, because documents are addressed by audience",
  order.indexOf("avatar") < order.indexOf("deep_research"),
  order.join(" -> ")
);
check(
  "‼️ the offer comes before the offer-scoped documents, because storeDocument refuses them without it",
  order.indexOf("offer") < order.indexOf("short_offer") &&
    order.indexOf("offer") < order.indexOf("necessary_beliefs"),
  order.join(" -> ")
);
check(
  "the research comes before the sheet, which is the order his own prompt chain runs in",
  order.indexOf("deep_research") < order.indexOf("avatar_sheet"),
  order.join(" -> ")
);
check(
  "a partial client keeps the same relative order",
  missingPreconditions({ ...EMPTY, avatarConfirmed: true, offerLocked: true, deepResearch: true })
    .map((m) => m.key)
    .join(",") === "avatar_sheet,short_offer,necessary_beliefs"
);

// ‼️ THE TWO OFFER-SCOPED KINDS ARE THE ONES audience-documents ALREADY CALLS OFFER-SCOPED. If
// kindBelongsToOffer ever changes, this gate's ordering argument stops being true and this fails.
check(
  "short_offer and necessary_beliefs are offer-scoped, research and the sheet are not",
  kindBelongsToOffer("short_offer") &&
    kindBelongsToOffer("necessary_beliefs") &&
    !kindBelongsToOffer("deep_research") &&
    !kindBelongsToOffer("avatar_sheet")
);
check("the gate reads exactly the four documents", GATED_DOCUMENTS.length === 4);

// ─── 3. The card says the next move ───────────────────────────────────────────
console.log("\n3. the refusal hands back the next move, not a complaint");

const card = refusalLines(missingPreconditions(EMPTY)).join("\n");
check("it names every missing thing", missingPreconditions(EMPTY).every((m) => card.includes(m.label)));
check("and the exact verb for each", /`research:`/.test(card) && /`avatar sheet:`/.test(card) && /`short offer:`/.test(card) && /`beliefs:`/.test(card));
check("it points at step 11's thread rather than printing a second copy of the templates", /step 11/.test(card));
check("‼️ it says out loud that the other commands still work", /`ask`/.test(card) && /`add:`/.test(card));
check("it explains why the order is what it is", /invented from nothing/.test(card));
check("no em dash", !card.includes("—"));
check("every chunk stays inside a Slack body", card.length < 3000, String(card.length));

// ─── 4. ‼️ WHAT IS NOT GATED ──────────────────────────────────────────────────
console.log("\n4. only draft is gated, and nothing else is");

const studio = stripComments(readFileSync("src/lib/clients/page-studio.ts", "utf8"));
// Counting `draftReadiness(` rather than the bare name, so the destructuring import does not read
// as a second call site.
const gateCalls = [...studio.matchAll(/draftReadiness\(/g)].length;
check(
  "‼️ draftReadiness is CALLED exactly once in the studio",
  gateCalls === 1,
  `${gateCalls} call sites: a second one is a command that got gated by accident`
);

// The gate must sit inside draft() and nowhere near the writers. Find the function bodies by their
// declarations and assert the call is in the right one.
const bodyOf = (name: string): string => {
  const at = studio.indexOf(`async function ${name}(`);
  if (at < 0) return "";
  const next = studio.indexOf("\nasync function ", at + 1);
  return studio.slice(at, next < 0 ? undefined : next);
};

check("the gate is inside draft()", /draftReadiness/.test(bodyOf("draft")));

// ‼️ A MISSING FUNCTION FAILS RATHER THAN SKIPS, AND THAT IS NOT PEDANTRY. The first version of
// this loop did `if (!body) continue`, and `askCommand` does not exist under that name: the check
// that `ask` is ungated passed by testing nothing at all. That is the same vacuous-truth trap
// _probe-list-prep.ts recorded when one of its assertions turned out to be `x.length >= 0`. An
// assertion that cannot fail is worse than no assertion, because it reads like cover.
for (const fn of ["append", "replaceCommand", "undoCommand", "startInterview", "handleVoice", "polish"]) {
  const body = bodyOf(fn);
  check(`${fn}() exists to be checked`, body.length > 0, "renamed or removed, so the check below tests nothing");
  check(`${fn}() is NOT gated`, body.length > 0 && !/draftReadiness/.test(body));
}

// ‼️ NO FOURTH client_pages.status. CLAUDE.md refuses one twice, and a precondition on a command is
// not a state a page moves through.
const gate = stripComments(readFileSync("src/lib/clients/draft-gate.ts", "utf8"));
check("the gate never writes a page status", !/client_pages/.test(gate));
check("and writes nothing at all", !/\.insert\(|\.update\(|\.upsert\(|\.delete\(/.test(gate));

// ‼️ UNREADABLE IS NOT EMPTY. A failed select must not be reported as a missing document, or
// somebody is told to paste a file they already pasted.
check(
  "an unreadable documents table is an error, not six missing documents",
  /unknown rather than empty/.test(readFileSync("src/lib/clients/draft-gate.ts", "utf8"))
);

console.log(failed === 0 ? "\nAll checks passed.\n" : `\n${failed} FAILED\n`);
process.exit(failed === 0 ? 0 : 1);
