// The report pivots to the free tool, and it never invents a finding about a real business.
//
//   bun --no-env-file run scripts/_probe-report-pivot.ts
//
// ‼️ THIS IS THE ONE THAT MATTERS MOST IN THE LANE. The pivot is a sales pitch that cites a measurement
// about somebody's own business, thirty seconds after they paid us three minutes of attention to make
// it. A made-up number there is not a cosmetic bug: it is a false claim about a real company, in
// writing, in a pitch. Every check below exists to make that impossible rather than unlikely.
//
// ‼️ AND IT PROVES THE DECISION, NOT JUST THE CODE. The choice was (a) build the line deterministically
// in the executor and hand the model a finished sentence, or (b) feed the report into the prompt. (a) was
// chosen, so tools.ts's "THE MODEL IS HANDED NO BUSINESS NAMES AND NO NUMBERS" must still be true and
// afterAudit() must still be frame code with no model turn in it. Section 4 checks both.

import fs from "node:fs";
import path from "node:path";

import type { BlockStat } from "../src/lib/audit-engine/report-view";
import { REPORT_PIVOT, weakestFinding } from "../src/lib/concierge/report-pivot";

let failures = 0;

function check(ok: boolean, label: string, detail?: string): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (detail) console.log(`      ${detail}`);
  if (!ok) failures += 1;
}

function read(file: string): string {
  return fs.readFileSync(path.join(process.cwd(), file), "utf8");
}

const frame = read("src/app/w/[slug]/route.ts");
const action = read("src/app/api/concierge/action/route.ts");
const tools = read("src/lib/concierge/tools.ts");

// ── 1. It says nothing when it knows nothing ────────────────────────────────
console.log("\n1. no finding rather than a guessed one");

const NOTHING: Array<[string, BlockStat[] | null | undefined]> = [
  ["the view failed to load", null],
  ["the payload carried nothing", undefined],
  ["there are no blocks", []],
  ["every block is empty", [{ block: "SERVICIO", mentioned: 0, total: 0 }]],
  ["a block this code does not know", [{ block: "INVENTED", mentioned: 0, total: 4 }]],
];
for (const [label, stats] of NOTHING) {
  check(weakestFinding(stats) === null, `${label}: no sentence`);
}
check(
  weakestFinding([
    { block: "SERVICIO", mentioned: 6, total: 6 },
    { block: "MARCA", mentioned: 4, total: 4 },
  ]) === null,
  "a business that came up in everything has no weakest anything",
  "picking one anyway to have something to say would be inventing a weakness"
);

// ── 2. When it does speak, the number is real and the denominator travels ───
console.log("\n2. the number and its denominator");

const line = weakestFinding([
  { block: "SERVICIO", mentioned: 1, total: 6 },
  { block: "MARCA", mentioned: 3, total: 4 },
  { block: "INFO", mentioned: 2, total: 3 },
]);
check(line !== null, "the weakest block produces a sentence", line ?? "(none)");
check(!!line && line.includes("1 times out of 6") === false && /\b1\b/.test(line) && /\b6\b/.test(line),
  "carrying both its count and its total",
  line ?? "");
check(
  !!line && /treatments you offer/.test(line),
  "and naming the weakest block, which is SERVICIO at 1 of 6",
  "MARCA is 3 of 4 and INFO is 2 of 3, so neither is weakest"
);

const zero = weakestFinding([{ block: "MARCA", mentioned: 0, total: 5 }]);
check(!!zero && /did not come up once/.test(zero) && /\b5\b/.test(zero), "none at all reads as words, not as 0 of 5", zero ?? "");

// Ties and ordering: the lowest ratio wins, not the lowest count.
const tie = weakestFinding([
  { block: "SERVICIO", mentioned: 2, total: 4 },
  { block: "INFO", mentioned: 1, total: 10 },
]);
check(!!tie && /still deciding/.test(tie), "the lowest RATIO wins, not the lowest count", tie ?? "");

// ── 3. No pillar is ever named ──────────────────────────────────────────────
//
// Findable, Familiar and Fresh exist nowhere in the data: audit_reports carries one aggregate score, and
// the only per-dimension breakdown is the audit block. A pivot naming a pillar would be promising a
// scorecard shape the report does not have.
console.log("\n3. it names a block, never a pillar");

const pivotSrc = read("src/lib/concierge/report-pivot.ts");
const strings = [...pivotSrc.matchAll(/guard\(\s*"[^"]+",\s*\n?\s*"([^"]*)"/g)].map((m) => m[1]);
check(strings.length >= 8, "the pivot's copy was found to read", `${strings.length} guarded strings`);
for (const copy of [...strings, ...Object.values(REPORT_PIVOT)]) {
  check(!/\b(findable|familiar|fresh)\b/i.test(copy), `no pillar named: ${copy.slice(0, 44)}...`);
}
check(
  !/\bscore\b|\bout of 100\b|\d+\s*%/i.test(Object.values(REPORT_PIVOT).join(" ")),
  "and the pivot itself quotes no score",
  "the aggregate score is on the report the link opens, and this is the bubble before it"
);

// ── 4. The model is not in this path, so tools.ts's rule still holds ───────
console.log("\n4. the model still sees no business names and no numbers");

check(
  tools.includes("THE MODEL IS HANDED NO BUSINESS NAMES AND NO NUMBERS"),
  "tools.ts still states the rule",
  "option (a) was chosen precisely so this header did not have to change"
);
const after = frame.slice(frame.indexOf("function afterAudit("), frame.indexOf("function afterAudit(") + 1400);
check(!after.includes("/turn"), "afterAudit reaches no model turn");
check(after.includes("bubble('a',weakest)"), "it prints the server's sentence verbatim");
check(
  !/weakest\s*\.(replace|slice|split|toUpperCase|concat)/.test(after),
  "and never alters it",
  "it is a finished sentence about a real business, not a fragment to reword"
);
check(after.includes("if(weakest)"), "and it is optional, so the sequence reads without one");

// ── 5. It is built in the executor, and cannot cost the report link ────────
console.log("\n5. the finding can never cost the report");

const status = action.slice(action.indexOf('if (action === "audit_status")'));
const branch = status.slice(0, status.indexOf("// A subset:"));
check(branch.includes("loadReportView"), "the finding is computed server side from the report's own rows");
check(branch.includes("try {") && branch.includes("} catch"), "wrapped, because loadReportView reads every audit_runs row");
check(
  branch.indexOf("reportUrl = claimed.reportUrl") < branch.indexOf("loadReportView"),
  "and the report URL is resolved BEFORE it",
  "losing the link to a failed sales line would be the worst trade in the lane"
);
check(/let weakest: string \| null = null;/.test(branch), "no finding is a supported state, not an error");

// ── 6. The chip drops into the existing walk ────────────────────────────────
console.log("\n6. one referral walk, not two");

check(after.includes("choose('referral')"), "the yes chip calls the same walk the second door opens");
check(
  (frame.match(/function walkRef\(/g) ?? []).length === 1,
  "and there is exactly one walker in the frame",
  "a second copy of the script is how the door and the pivot start saying different things"
);
check(after.includes("startTyping()"), "the no chip opens the composer rather than asking again");

console.log("");
if (failures) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log("All checks passed. The pivot cites the report or cites nothing.");

export {};
