// The re-run command's grammar, and that docs/STEP-WIRING.md still describes the board. No network.
//
//   bunx tsx scripts/_probe-step-rerun.ts

import { execFileSync } from "node:child_process";
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

// The generated doc has to match the board as it is now.
try {
  execFileSync("bunx", ["tsx", path.resolve(__dirname, "_step-wiring.ts"), "--check"], { stdio: "pipe", shell: process.platform === "win32" });
  check("docs/STEP-WIRING.md is current", true);
} catch (e) {
  check("docs/STEP-WIRING.md is current", false, (e as Error).message.split("\n")[0]);
}

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nall re-run checks pass");
