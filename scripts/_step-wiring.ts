// Write docs/STEP-WIRING.md: what every board step runs, checks, says and takes.
//
// Matthew, 2026-09-16: "make sure the MD file specified which step is wired with each step so we can read that md
// file before doing anything else."
//
//   bunx tsx scripts/_step-wiring.ts          write docs/STEP-WIRING.md
//   bunx tsx scripts/_step-wiring.ts --check   fail when it is out of date (used by the probe)
//
// ‼️ GENERATED, NEVER HAND-EDITED. Step numbers are array positions, so inserting a step renumbers everything
// after it; a hand-written table would be wrong the first time that happened and would keep being read anyway.
// Everything here is read out of the code: the registry, the runners, the verifiers, the card bodies, the extra
// buttons and the thread commands each step's handler accepts.

import fs from "node:fs";
import path from "node:path";
import { DELIVERY_STEPS } from "../src/config/delivery-steps";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

const registry = read("src/lib/clients/artifacts/registry.ts");
const verify = read("src/lib/clients/step-verify.ts");
const engine = read("src/lib/clients/step-engine.ts");

/** The runner a step has, as the registry names it: the first function its arrow body awaits. */
function runnerFor(key: string): string | null {
  const start = registry.indexOf(`
  ${key}: async (clientId)`);
  if (start < 0) return null;
  // The imports come first in every arrow body, so they are stripped before the first real call is read.
  const body = registry.slice(start, start + 1400).replace(/await\s+import\([^)]*\)/g, "");
  const call = /(?:await|return)\s+([A-Za-z0-9_]+)\(/.exec(body);
  return call ? call[1] : "an inline runner";
}

/** Which thread commands reach which step. Hand-kept, because a handler decides it in code, not in a table. */
const COMMANDS: Record<string, string[]> = {
  avatar_confirmed: ["`avatar: <label>`", "[Avatar] buttons"],
  avatar_harvest: ["`research:` or a dropped file", "`prompt`, `prompt short`, `run`", "`avatar sheet:`, `short offer:`, `beliefs:`", "`share research`, `share sheet`"],
  offer_locked: ["`offer:`", "`terms:`", "`outcome:`", "`price:`", "[Call now]", "`review platform: <name>`, `review link: <url>`"],
  keyword_set: ["`keywords approve`", "`keywords drop N`", "`keywords add:`", "`keywords more <category>`"],
  custom_question_set: ["`objection: <what they said>`", "`objection: ... | belief: <key>`"],
  hub_preview: ["`universe <name>`", "`template <name>`", "`skin reset`", "`pick 1|2|3`", "paste a screenshot"],
  review_tool_preview: ["`review link: <url>`", "[Paste review link]", "`universe <name>`"],
  review_card_pdf: ["`review link: <url>`", "[Paste review link]"],
  concierge_preview: ["[Include concierge (add-on)] / [Not now, install later]", "[Patient lane] / [Owner lane]", "`concierge install`", "[Character menu] / [Skip, keep the default]", "`mascot`, `mascot concepts`", "`mascot pick a, b, c`, `mascot <key>`, `mascot skip`", "`mascot corner bottom-left`", "paste art with `mascot <key> <state>`"],
  site_replica: ["`universe <name>`", "paste a screenshot"],
  pre_call_pages: [
    "`ladder`, `ladder pick <1-5>`, `anchor at <1-5>`, `ladder problem aware`",
    "`headlines`, `headlines pick 4, 9, 12, ...` (seven)",
    "`emotional:` then one question per line",
    "[Anchor at N], [Pillar N], [Supports: pick for me]",
    "`pillar: <rank>` / `pillar: auto`",
    "`supports: 3, 7, 12` / `supports auto`",
    "`guarantee:`, `outcome:`, `price:`",
    "`plan`, `plan new`, `plan approve`, `plan swap N`, `plan drop N`, `plan edit N: ...`",
    "`anchor`, `anchor: <key>`",
    "`research:` (page batch)",
    "`headline N`, `skeleton N`",
  ],
  concierge_live: ["`concierge install`"],
};

/** A pipe inside a cell ends the cell, so every one is escaped. */
function cell(v: string): string {
  return v.replace(/\|/g, "\\|");
}

function cardCase(key: string): boolean {
  return engine.includes(`case "${key}":`);
}

function verifierKind(key: string): string {
  const i = verify.indexOf(`\n  ${key}: async`);
  if (i < 0) return verify.includes(`\n  ${key}:`) ? "yes" : "none";
  const body = verify.slice(i, i + 700);
  if (/artifactOnRecord/.test(body)) return "an artifact on record";
  if (/threadHas|uploadsFor/.test(body)) return "evidence in its thread";
  return "a system check";
}

function table(): string {
  const rows = DELIVERY_STEPS.map((s, i) => {
    const runner = runnerFor(s.key);
    return [
      `| ${i + 1} | \`${s.key}\` | ${s.label} | ${s.phase} | ${s.mode ?? (s.auto ? "auto" : "manual")} |`,
      `${runner ? `\`${runner}()\`` : "none"} | ${verifierKind(s.key)} | ${cardCase(s.key) ? "yes" : "default"} |`,
      `${cell((COMMANDS[s.key] ?? []).join("<br>") || "Done / Skip / I hit a problem")} |`,
      `${(s.blockedBy ?? []).map((b) => `\`${b}\``).join(", ") || "nothing"} |`,
    ].join(" ");
  });
  return [
    "| # | key | label | phase | mode | runner | [Done] checks | card body | what its thread takes | waits on |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

const DOC = `# The board, step by step

**Generated by \`bunx tsx scripts/_step-wiring.ts\`. Do not edit by hand.** Step numbers are positions in
\`src/config/delivery-steps.ts\`, so inserting a step renumbers every step after it. Read this file before
changing anything about a step: it says what runs it, what its [Done] checks, and what its thread accepts.

## Re-running a step

| where | what to type | what happens |
| --- | --- | --- |
| in a step's thread | \`rerun\` | that step runs again, its card updates in place, notes land in the same thread |
| anywhere in the client's channel | \`rerun step 13\` | step 13 runs again with a NEW card at the bottom of the channel |
| anywhere in the client's channel | \`rerun 18-21\` | each step in the range, in order, each with a new card at the bottom |

The old thread is kept and gets one line linking to the new card. A re-run clears the tick, the verification and
any error, then runs the step's runner; it never deletes a decision a person made (approved keywords, a picked
anchor, a frozen \`custom_v1\`). Steps with no runner just get their card again.

Behind it: \`src/lib/clients/step-rerun.ts\` and \`/api/internal/rerun-steps\` (one step per request, because a
range is minutes of work).

## Every step

${table()}

## The files a step touches

- **The list itself:** \`src/config/delivery-steps.ts\` (order, phase, mode, blockedBy). \`stepNumber()\` is the
  only honest source of a step's number.
- **Runners:** \`src/lib/clients/artifacts/registry.ts\` maps a step key to the function that generates it.
- **[Done]:** \`src/lib/clients/step-verify.ts\`, one verifier per step key, and the build fails without one.
- **Cards:** \`src/lib/clients/step-engine.ts\` (\`instructionsFor\` for the body, \`extraActionsFor\` for buttons).
- **Threads:** \`src/app/api/slack/events/route.ts\` dispatches to each step's handler; a command typed in the
  wrong thread gets a pointer from \`src/lib/clients/step-commands.ts\`.
- **The board in Slack:** \`src/lib/clients/step-board.ts\` (anchors, marks, \`notifyStep\`).
`;

const out = path.join(root, "docs/STEP-WIRING.md");

/**
 * Compare the TEXT, not the line endings.
 *
 * ‼️ core.autocrlf=true MAKES THIS CHECK FAIL ON EVERY WINDOWS CHECKOUT OTHERWISE, and it fails
 * claiming drift that does not exist. Git materialises the file with CRLF, writeFileSync produces LF,
 * so a byte comparison reports all 77 lines changed on a file nobody has touched. Measured 2026-09-17:
 * 11,925 bytes on disk against 11,848 generated, a difference of exactly one byte per line. A probe
 * that cries drift on a clean tree is one people learn to skip, which is worse than not having it.
 */
const CR = String.fromCharCode(13);
const sameText = (a: string, b: string) => a.split(CR).join("") === b.split(CR).join("");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (!sameText(current, DOC)) {
    console.error("docs/STEP-WIRING.md is out of date. Run: bunx tsx scripts/_step-wiring.ts");
    process.exit(1);
  }
  console.log("docs/STEP-WIRING.md is current");
} else {
  fs.writeFileSync(out, DOC);
  console.log(`wrote docs/STEP-WIRING.md (${DELIVERY_STEPS.length} steps)`);
}
