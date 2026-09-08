// A step number written into a sentence goes quietly wrong the day somebody inserts a step.
//
// ‼️ THIS EXISTS BECAUSE IT ALREADY HAPPENED, ON 2026-09-08, TO THIRTY-ODD SENTENCES AT ONCE.
//
// `offer_proposed` was inserted at position 10 and `offer_locked` before `call_held`. Every step
// after them moved by one: hub_preview 15 to 16, page_candidates 13 to 14, avatar_harvest 10 to
// 11, call_held 22 to 24. Nothing errored. What happened instead is that every card, panel and
// PDF carrying a literal "step 15" started naming a different step than the one it meant, in the
// one place a person reads to find out what to do next.
//
// delivery-steps.ts already says why the number is derived:
//
//   "stepNumber() computes the 1-based position from the array. No step number is hardcoded
//    anywhere."
//
// That was true of the CODE and never of the COPY.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ IT CHECKS STRINGS, NOT COMMENTS, AND THE DIFFERENCE IS WHO READS THEM.
//
// A comment saying "step 15's card" is documentation that drifts, which is a cost paid by
// whoever reads the file next. A Slack card saying "step 15's [Done] was waiting on it" is a
// sentence told to Matthew about a step that is now numbered 16, while he is trying to work out
// what to do. Only one of those is a lie, so only one of those fails this.
//
// Comments are stripped first, the same technique _probe-review-gating.ts uses and for the same
// reason: intent in a comment is not evidence, and a check that fires on the prose explaining
// the rule teaches somebody to delete the explanation.
//
//   bunx tsx scripts/_probe-step-numbers.ts
//   bunx tsx scripts/_probe-step-numbers.ts --list     every offender, with its line
//
// The fix at each site is the same: interpolate stepNumber("the_key") instead of typing a digit.

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "src");

/**
 * Files where a literal step number is the SUBJECT rather than a reference.
 *
 * delivery-steps.ts prints the count of steps and describes its own history ("33 -> 35 -> 37").
 * The probes assert counts on purpose. Neither is a sentence naming a step by position.
 */
const EXEMPT = new Set([
  path.join("config", "delivery-steps.ts"),
]);

/** Strip comments so prose explaining the rule cannot fail the rule. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Every string literal in a line, roughly.
 *
 * Deliberately approximate: this is looking for a digit inside quotes, not parsing TypeScript. A
 * false positive costs one interpolation; a false negative costs a card that names the wrong
 * step, so it errs toward noticing.
 */
const STRINGS = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

/** "step 15", "Step 15", "steps 29 and 30". Not "step_key", not "stepNumber". */
const STEP_LITERAL = /\bsteps?\s+(\d{1,2})\b/i;

/**
 * ‼️ "INTAKE STEP 2" IS A DIFFERENT NUMBERING AND IT DID NOT MOVE.
 *
 * src/config/client-intake.ts is a SIX-step form the client fills in and its numbers are its own.
 * DELIVERY_STEPS is the forty-one operational steps SRT works through. CLAUDE.md calls these
 * "two step lists at different altitudes, and they are not the same thing", so a check that
 * conflated them would send somebody to interpolate stepNumber() into a sentence about a form
 * field.
 */
const OTHER_NUMBERING = new RegExp(String.raw`(intake|onboarding|pilot|form)\s+steps?\s+\d`, "i");

interface Offender {
  file: string;
  line: number;
  text: string;
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

const offenders: Offender[] = [];

for (const file of walk(ROOT, [])) {
  const rel = path.relative(ROOT, file);
  if (EXEMPT.has(rel)) continue;

  const lines = code(fs.readFileSync(file, "utf8")).split("\n");
  lines.forEach((line, i) => {
    // ‼️ THE EXEMPTION IS CHECKED ON THE WHOLE LINE, NOT ON ONE LITERAL, and that is not a
    // shortcut. A sentence is routinely split across two concatenated strings, so "Intake" can
    // sit in one literal and "step 2" in the next, and a per-literal check reads the second half
    // as a delivery step. Cheap and slightly wide: the cost of being wide here is one sentence
    // about a form field going unchecked, and the cost of being narrow is a false alarm that
    // sends somebody to interpolate stepNumber() into copy about the intake form.
    if (OTHER_NUMBERING.test(line)) return;

    for (const literal of line.match(STRINGS) ?? []) {
      if (STEP_LITERAL.test(literal)) {
        offenders.push({ file: rel, line: i + 1, text: literal.trim().slice(0, 110) });
        break;
      }
    }
  });
}

const list = process.argv.includes("--list");

if (list) {
  const byFile = new Map<string, Offender[]>();
  for (const o of offenders) {
    if (!byFile.has(o.file)) byFile.set(o.file, []);
    byFile.get(o.file)!.push(o);
  }
  for (const [file, rows] of [...byFile].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`\n${file}  (${rows.length})`);
    for (const r of rows) console.log(`  ${String(r.line).padStart(5)}  ${r.text}`);
  }
  console.log("");
}

if (offenders.length === 0) {
  console.log("PASS  no step number is written into a sentence.");
  console.log("      Every one is interpolated from stepNumber(), so inserting a step moves them all.");
  process.exit(0);
}

console.log(
  `FAIL  ${offenders.length} string${offenders.length === 1 ? "" : "s"} name a step by a literal ` +
    `number, in ${new Set(offenders.map((o) => o.file)).size} file(s).`
);
console.log("      Each one names a different step the moment anybody inserts one, and nothing errors.");
console.log("      Fix: interpolate stepNumber(\"the_key\"). Run with --list to see them all.");
process.exit(1);

export {};
