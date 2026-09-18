// Does the context database refuse what it claims to refuse, and does the new verb stay anchored?
//
// Run:
//   bunx tsx scripts/_probe-policy-scan.ts        (pure, offline, no env, no network, no database)
//
// Everything here is a constant or a pure function, and proving it must not need a connection: the
// same discipline _probe-post-formats.ts and _probe-scraper.ts keep.
//
// ‼️ THE FIXTURES IN SECTION 2 ARE THE POINT OF THIS FILE. The page studio appends anything it does
// not match to the page VERBATIM, and two live captures were swallowed that way. A verb one
// character too loose does not throw: it silently files a sentence of somebody's dictation as a
// command and puts nothing on screen to say it did.

import { GUIDELINE_RULES, GUIDELINE_RULES_MAX, GUIDELINE_SOURCES, RATER_GUIDELINES_KIND } from "../src/config/guideline-rules";
import { SCAN_COMMAND } from "../src/lib/clients/policy-scan";
import { diffLines, hashPolicyText, normalizePolicyText } from "../src/lib/clients/policy-documents";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string) {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? `  (${detail})` : ""}`);
  }
}

// ── 1. The rules that bind ──────────────────────────────────────────────────
console.log("\n1. GUIDELINE_RULES is a compiled rule set, not the corpus");

ok(
  `it is bounded, under ${GUIDELINE_RULES_MAX} characters`,
  GUIDELINE_RULES.length > 0 && GUIDELINE_RULES.length <= GUIDELINE_RULES_MAX,
  `${GUIDELINE_RULES.length} characters`
);
ok("it has no em dash", !GUIDELINE_RULES.includes("—"));
ok(
  "it names experience as the thing that is a matter of fact",
  /EXPERIENCE/.test(GUIDELINE_RULES) && /not of taste/i.test(GUIDELINE_RULES)
);
ok(
  "and it marks the rest as taste, so nothing else can argue its way to a block",
  (GUIDELINE_RULES.match(/\(taste/gi) ?? []).length >= 2
);

// ── 2. The verb is anchored at BOTH ends ────────────────────────────────────
console.log("\n2. `scan for latest` is a command, and a sentence about scanning is not");

const COMMANDS = ["scan", "scan for latest", "scan for latest guidance", "Scan For Latest Guidelines", "scan policies", "  scan for latest  "];
for (const c of COMMANDS) ok(`"${c.trim()}" is a command`, SCAN_COMMAND.test(c.trim()));

// ‼️ EVERY ONE OF THESE WOULD BE APPENDED TO THE OPEN PAGE VERBATIM, which is correct, and an
// unanchored pattern would eat the front of it and drop the rest.
const DICTATION = [
  "scan for latest changes in the copy",
  "scan the reviews before you write",
  "scanning the page now",
  "rescan",
  "scan for latest updates to our pricing",
  "we should scan",
];
for (const d of DICTATION) ok(`"${d}" is body text, not a command`, !SCAN_COMMAND.test(d));

// ── 3. The sources ──────────────────────────────────────────────────────────
console.log("\n3. The source list is fixed, in code, and is Google's own");

ok("there are five fetched sources", GUIDELINE_SOURCES.length === 5, String(GUIDELINE_SOURCES.length));
ok("every kind is distinct", new Set(GUIDELINE_SOURCES.map((s) => s.kind)).size === GUIDELINE_SOURCES.length);
ok("every url is https", GUIDELINE_SOURCES.every((s) => s.url.startsWith("https://")));
ok(
  "every url is on a google host, so no SSRF boundary is needed while the list stays in code",
  GUIDELINE_SOURCES.every((s) => new URL(s.url).hostname.endsWith("google.com"))
);
ok(
  "the rater guidelines are NOT in the fetched list: they are a PDF and are pasted by hand",
  !GUIDELINE_SOURCES.some((s) => s.kind === RATER_GUIDELINES_KIND)
);

// ── 4. An unchanged fetch writes nothing ────────────────────────────────────
console.log("\n4. The content hash is what makes an unchanged fetch silent");

const page = "Helpful content\n\nWrite for people, not engines.\n";
ok("the same bytes hash the same", hashPolicyText(normalizePolicyText(page)) === hashPolicyText(normalizePolicyText(page)));
ok(
  "a re-wrapped page is NOT a new version, so a reflow posts no card",
  hashPolicyText(normalizePolicyText("Helpful   content\n\n\n\nWrite for people, not engines.")) ===
    hashPolicyText(normalizePolicyText(page))
);
ok(
  "a changed word IS a new version",
  hashPolicyText(normalizePolicyText("Helpful content\n\nWrite for engines.\n")) !==
    hashPolicyText(normalizePolicyText(page))
);

// ── 5. The diff a person reads ──────────────────────────────────────────────
console.log("\n5. The diff answers 'did the rules change', in whole lines");

const d = diffLines("one\ntwo\nthree", "one\ntwo and a half\nthree");
ok("an added line is reported", d.added.includes("two and a half"), JSON.stringify(d.added));
ok("a removed line is reported", d.removed.includes("two"), JSON.stringify(d.removed));
ok("an unchanged line is not", !d.added.includes("one") && !d.removed.includes("one"));

const same = diffLines("one\ntwo", "one\ntwo");
ok("an identical pair has no diff at all", same.addedTotal === 0 && same.removedTotal === 0);

const big = diffLines("", Array.from({ length: 50 }, (_, i) => `line ${i}`).join("\n"));
ok("the shown lines are capped", big.added.length <= 12, String(big.added.length));
ok("and the TOTAL is still reported honestly", big.addedTotal === 50, String(big.addedTotal));

console.log(`\n${fail === 0 ? "All checks passed." : `${fail} of ${pass + fail} checks failed.`}`);
process.exitCode = fail === 0 ? 0 : 1;
