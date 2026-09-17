// The re-run command's grammar, and that the two generated board docs still describe the board.
// No network.
//
//   bunx tsx scripts/_probe-step-rerun.ts

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseRerun } from "../src/lib/clients/step-rerun";
import { DELIVERY_STEPS } from "../src/config/delivery-steps";

let failed = 0;
function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
  if (!ok) failed++;
}

const here = (t: string) => {
  const r = parseRerun(t);
  return r !== null && "here" in r;
};
const range = (t: string) => {
  const r = parseRerun(t);
  return r && !("here" in r) ? `${r.from}-${r.to}` : null;
};

for (const t of ["rerun", "re-run", "restart", "  `rerun`  ", "RERUN", "rerun this step"]) {
  check(`bare: ${t}`, here(t));
}
check("rerun step 13", range("rerun step 13") === "13-13");
check("start step 13", range("start step 13") === "13-13");
check("rerun 18-21", range("rerun 18-21") === "18-21");
check("rerun steps 18 to 21", range("rerun steps 18 to 21") === "18-21");
check("rerun #18 through #21", range("rerun #18 through #21") === "18-21");
check("restart 21", range("restart 21") === "21-21");

// ‼️ CONSERVATIVE: this fires inside a client's channel, where people also type sentences.
check("a sentence is not a command", parseRerun("can we rerun the audit for this client") === null);
check("start 13 without the word step is not a command", parseRerun("start 13") === null);
check("a step past the end is refused", parseRerun(`rerun step ${DELIVERY_STEPS.length + 1}`) === null);
check("a backwards range is refused", parseRerun("rerun 21-18") === null);
check("zero is refused", parseRerun("rerun step 0") === null);

// ── A re-run carries the board on, and cannot post a wall of cards doing it ──
const rerunSrc = readFileSync(path.resolve(__dirname, "../src/lib/clients/step-rerun.ts"), "utf8");

/**
 * The same source with comments blanked out.
 *
 * ‼️ THE GREPS BELOW MUST NOT READ THE DOC COMMENTS. step-rerun.ts documents its rules by naming the
 * very thing it defers to, so "it does not re-implement reachability" failed on a file that is
 * correct BECAUSE it says `reachableCursor` is what bounds it. Same preamble _probe-lead-context.ts
 * carries, for the same reason. Newlines are preserved so line numbers still point at real lines.
 */
const RERUN_CODE = rerunSrc
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
  .replace(/\/\/[^\n]*/g, "");

check("a re-run walks the board on when it is done", /if \(args\.advance !== false\) await continueBoard/.test(RERUN_CODE));

// ‼️ THE SAME CASCADE A TRANSITION RUNS, IN THE SAME ORDER. Anchors before runners before cards:
// postReadySteps skips a step that already has a message, so running it first loses the auto step.
const cascade = ["ensureReachableAnchors", "runReadyAutoSteps", "postReadySteps"];
const at = cascade.map((fn) => RERUN_CODE.indexOf(`await ${fn}(`));
check("it runs the whole cascade", at.every((i) => i > 0), cascade.filter((_, i) => at[i] < 0).join(", "));
check("in anchors, runners, cards order", at[0] < at[1] && at[1] < at[2]);

// ‼️ reachableCursor IS WHAT STOPS IT AT ONE. The cascade is deferred to rather than re-implemented,
// so there is no second opinion about what is reachable. A guard for "the step is still pending"
// would be exactly that second opinion.
check("it does not re-implement reachability", !/reachableCursor\s*\(/.test(RERUN_CODE));

// ‼️ ONLY THE LAST HOP OF A RANGE KICKS. Otherwise rerun 18-21 posts step 19's card, then re-runs
// 19, then posts it again.
check("a range does not kick after every hop", /advance: false/.test(RERUN_CODE));
check("a range kicks once at the end", /^\s*await continueBoard\(args\.clientId\);\s*$/m.test(RERUN_CODE));

// ── The generated docs have to match the board as it is now ──
const WIRING = path.resolve(__dirname, "_step-wiring.ts");
const generator = readFileSync(WIRING, "utf8");

for (const doc of ["docs/STEP-WIRING.md", "docs/ONBOARDING-MAP.md"]) {
  check(`${doc} exists`, existsSync(path.resolve(__dirname, "..", doc)));
  check(`${doc} is in CHECKED_DOCS`, generator.includes(`"${doc}"`));
}

// ‼️ THE MEASURED MAP MUST NEVER JOIN THE CHECK. It carries its measurement date on line 1, so a
// byte compare against it would fail every time production changed, on a tree nobody has touched.
const checkedList = /const CHECKED_DOCS = \[([^\]]*)\]/.exec(generator)?.[1] ?? "";
check("the measured map is not one of the checked docs", checkedList.length > 0 && !checkedList.includes("MEASURED"));
check("the generator has a --live arm", generator.includes(`"--live"`));

// ‼️ THE STATIC PATH CANNOT READ A DATABASE, AND THIS IS THE PROOF. Both checked docs are built by
// synchronous functions; the live half lives in its own module, dynamically imported. Put a query
// in here and a live number can reach a --check'ed doc, which is how this probe starts crying drift.
check("no database call in the generator itself", !/supabaseAdmin|\.from\(/.test(generator));

try {
  execFileSync("bunx", ["tsx", WIRING, "--check"], { stdio: "pipe", shell: process.platform === "win32" });
  check("both generated docs are current", true);
} catch (e) {
  check("both generated docs are current", false, (e as Error).message.split("\n")[0]);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall re-run checks pass");
