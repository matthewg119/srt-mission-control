/**
 * Probe: the Launch Lane and the Slack delivery lane stay separate.
 *
 *   bun run scripts/_probe-launch-isolation.ts
 *
 * Needs no database and no network. It reads source text.
 *
 * WHY THIS EXISTS. The whole value of a second lane is that editing one cannot change the
 * other, and that property has no type to defend it. One `import { postStep }` added in a hurry
 * six months from now silently makes the Launch Lane post to Slack, at which point there are not
 * two lanes any more, there is one lane with twice the surface area and nobody noticing.
 *
 * ‼️ IT BANS THE ENGINE, NOT THE DATA, AND THE DISTINCTION IS THE POINT.
 * Sharing the data layer is the design: clients, client_audiences, client_offers,
 * audience_documents, page_sources, client_pages, client_hosts, concierge_configs, day-zero.ts
 * and publishPage() are all meant to be shared, because both lanes sell the same product. What
 * must not be shared is the Slack board's ENGINE and REGISTRY: step-engine, step-verify,
 * step-board, delivery-checklist, and the 41-step list itself.
 *
 * ‼️ DIRECT IMPORTS ONLY, DELIBERATELY. src/lib/clients/day-zero.ts imports
 * config/delivery-steps for DAY_ZERO_STEP_KEY, and the Launch Lane imports day-zero because the
 * Day-0 wall is one wall guarding both lanes. Banning transitive reach would ban that, which
 * would mean a second implementation of the one check in this codebase that must never have two.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");

/** Files that belong to the Launch Lane and must stay clear of the Slack engine. */
const LANE_ROOTS = [
  join(ROOT, "src", "lib", "launch"),
  join(ROOT, "src", "app", "api", "launch"),
];
const LANE_FILES = [join(ROOT, "src", "config", "launch-steps.ts")];

/**
 * The Slack board's engine and registry, as they appear in an import specifier.
 *
 * `delivery-steps` IS on the list for files under src/lib/launch: the Launch Lane has its own
 * registry and has no business reading the other one. day-zero.ts is not in LANE_ROOTS, so its
 * own legitimate import is untouched.
 */
const BANNED = [
  "clients/step-engine",
  "clients/step-verify",
  "clients/step-board",
  "clients/step-commands",
  "clients/step-grammar",
  "clients/delivery-checklist",
  "config/delivery-steps",
  "lib/slack",
];

let failures = 0;

function fail(message: string): void {
  failures += 1;
  console.error(`  FAIL  ${message}`);
}

function walk(dir: string): string[] {
  let out: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // A lane folder that does not exist yet is not a failure.
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out = out.concat(walk(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

function relative(path: string): string {
  return path.slice(ROOT.length + 1).replace(/\\/g, "/");
}

/**
 * Every import specifier in a file, from both `import ... from "x"` and `await import("x")`.
 * A dynamic import is how the Slack lane already breaks its own cycles, so a probe that only
 * read static imports would be trivially and accidentally bypassable.
 */
function importsOf(source: string): string[] {
  const specs: string[] = [];
  const staticRe = /(?:^|\n)\s*(?:import|export)[\s\S]*?from\s+["']([^"']+)["']/g;
  const sideEffectRe = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
  const dynamicRe = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const re of [staticRe, sideEffectRe, dynamicRe]) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) specs.push(m[1]);
  }
  return specs;
}

console.log("\nLaunch Lane isolation\n");

const files = [...LANE_ROOTS.flatMap(walk), ...LANE_FILES];

if (files.length === 0) {
  fail("no Launch Lane files found at all — the probe is pointing at the wrong place");
}

let checked = 0;
for (const file of files) {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue; // LANE_FILES entries that do not exist yet.
  }
  checked += 1;

  for (const spec of importsOf(source)) {
    const hit = BANNED.find((b) => spec.includes(b));
    if (hit) {
      fail(`${relative(file)} imports "${spec}" — "${hit}" belongs to the Slack lane`);
    }
  }
}

console.log(`  checked ${checked} file(s) against ${BANNED.length} banned specifiers`);

// ── The one deliberate bridge ───────────────────────────────────────────────
//
// ‼️ THE BAN ABOVE IS ON SPECIFIERS, SO A LANE FILE CAN REACH THE SLACK LANE THROUGH ANY MODULE
// THAT IS NOT ON THE LIST. That is a real hole and this is what keeps it one hole wide.
//
// lane-summary.ts imports config/delivery-steps legitimately (it is not a lane file) and returns
// TEXT. The launch conversation imports it so it can answer "what about step 21" with the truth
// instead of "there is no step 21", which is what it said in production on 2026-10-03. That is a
// summary, not an engine: it ticks nothing and verifies nothing.
//
// This asserts the bridge stays single. A second file doing the same thing is how the ban above
// becomes decorative.
const BRIDGE = "clients/lane-summary";
const bridgeUsers = files.filter((file) => {
  try {
    return importsOf(readFileSync(file, "utf8")).some((spec) => spec.includes(BRIDGE));
  } catch {
    return false;
  }
});

if (bridgeUsers.length > 1) {
  fail(
    `${bridgeUsers.length} lane files import the cross-lane bridge: ${bridgeUsers.map(relative).join(", ")}. ` +
      "One is deliberate; two is the ban going decorative. Widen lane-summary.ts instead."
  );
} else {
  console.log(
    `  the cross-lane bridge is used by ${bridgeUsers.length} lane file(s)` +
      (bridgeUsers.length === 1 ? ` (${relative(bridgeUsers[0])}), which is the documented one` : "")
  );
}

/**
 * The reverse direction. The Slack lane must not learn about this one either: a delivery step
 * that read a launch step would make the 41-step board's behaviour depend on a lane its own
 * verifiers know nothing about.
 */
const slackFiles = [
  join(ROOT, "src", "config", "delivery-steps.ts"),
  join(ROOT, "src", "lib", "clients", "step-engine.ts"),
  join(ROOT, "src", "lib", "clients", "step-verify.ts"),
  join(ROOT, "src", "lib", "clients", "step-board.ts"),
  join(ROOT, "src", "lib", "clients", "delivery-checklist.ts"),
];

for (const file of slackFiles) {
  let source: string;
  try {
    source = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const spec of importsOf(source)) {
    if (spec.includes("launch-steps") || spec.includes("lib/launch")) {
      fail(`${relative(file)} imports "${spec}" — the Slack lane must not know this lane exists`);
    }
  }
}

console.log(failures === 0 ? "\nAll checks passed.\n" : `\n${failures} FAILED.\n`);
process.exit(failures === 0 ? 0 : 1);
