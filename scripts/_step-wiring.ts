// Write the two generated board docs: docs/STEP-WIRING.md and docs/ONBOARDING-MAP.md.
//
// Matthew, 2026-09-16: "make sure the MD file specified which step is wired with each step so we can read that md
// file before doing anything else."
//
//   bunx tsx scripts/_step-wiring.ts                       write both static docs
//   bunx tsx scripts/_step-wiring.ts --check                fail when either is out of date (used by the probe)
//   bunx tsx --env-file=.env.local scripts/_step-wiring.ts --live   write docs/ONBOARDING-MAP-MEASURED.md
//
// ‼️ GENERATED, NEVER HAND-EDITED. Step numbers are array positions, so inserting a step renumbers everything
// after it; a hand-written table would be wrong the first time that happened and would keep being read anyway.
// Everything here is read out of the code: the registry, the runners, the verifiers, the card bodies, the extra
// buttons and the thread commands each step's handler accepts.
//
// ‼️ THE TWO STATIC DOCS ARE PRODUCED BY SYNCHRONOUS FUNCTIONS, AND THAT IS THE ENFORCEMENT. You cannot read a
// database synchronously, so no live number can reach a --check'ed file by accident. `--live` is the only async
// arm and the only dynamic import in this file. A measured number inside a --check'ed doc would fail the probe
// every time production changed, which is how a probe becomes something people learn to skip.

import fs from "node:fs";
import path from "node:path";
import { DELIVERY_STEPS, stepNumber, type StepKey } from "../src/config/delivery-steps";
import { STEP_NEEDS, fieldsForStep, stepsBlockedBy, type FieldRef } from "../src/lib/clients/step-needs";
import { gapsFrom, gapLines } from "../src/lib/clients/step-gaps";
import { DATASET_FIELDS, NOTHING_ON_FILE, evaluateDatasets } from "../src/lib/clients/dataset-spec";
import { RESEARCH_SECTION_KEYS } from "../src/lib/clients/artifacts/deep-research-run";
import { held, type LeadContext } from "../src/lib/clients/lead-context";

const root = path.resolve(__dirname, "..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");

/** ‼️ THE ONLY DOCS --check MAY READ. A live number in either fails the probe forever. */
const CHECKED_DOCS = ["docs/STEP-WIRING.md", "docs/ONBOARDING-MAP.md"] as const;
/** ‼️ NEVER IN CHECKED_DOCS. Line 1 carries the measurement date, so a byte compare is a lie by design. */
const LIVE_DOC = "docs/ONBOARDING-MAP-MEASURED.md";

const REGISTRY_PATH = "src/lib/clients/artifacts/registry.ts";
const VERIFY_PATH = "src/lib/clients/step-verify.ts";

const registry = read(REGISTRY_PATH);
const verify = read(VERIFY_PATH);
const engine = read("src/lib/clients/step-engine.ts");

/**
 * One entry of a `Record<StepKey, async ...>` table: its own body and nothing else.
 *
 * ‼️ IT STOPS AT THE ENTRY'S OWN CLOSING BRACE, NOT AT THE NEXT KEY, AND THE DIFFERENCE IS A
 * DOC-SIZED LIE. Stopping at the next key swallows the comment block written ABOVE that key, and
 * those comments name helpers on purpose: step-verify.ts explains at length why `weekly_report`
 * STOPPED using `artifactOnRecord`, so reading to the next key made step 39 (`time_log_entries`,
 * a plain count query) report "an artifact on record". Measured 2026-09-17, on the first run of
 * this refactor.
 *
 * This replaced a 1400-character window in the registry and a 700-character one in the verifiers.
 * Those numbers were not wrong so much as unfalsifiable: 700 happened to stop before that comment,
 * and nothing said it would keep doing so. An entry at two-space indent closes with `\n  },`; a
 * nested literal inside it closes deeper, so that marker is the entry boundary. The next key is
 * still consulted, for an entry with no block body, and whichever comes first wins.
 */
function bodyOf(source: string, key: string): string | null {
  const start = source.indexOf(`\n  ${key}: async`);
  if (start < 0) return null;
  const rest = source.slice(start + 1);
  const close = rest.indexOf(`\n  },`);
  const next = /\n {2}[A-Za-z0-9_]+: async/.exec(rest);
  const end = Math.min(close < 0 ? rest.length : close, next ? next.index : rest.length);
  return rest.slice(0, end);
}

/** The runner a step has, as the registry names it: the first function its arrow body awaits. */
function runnerFor(key: string): string | null {
  const body = bodyOf(registry, key);
  if (body === null) return null;
  // The imports come first in every arrow body, so they are stripped before the first real call is read.
  const call = /(?:await|return)\s+([A-Za-z0-9_]+)\(/.exec(body.replace(/await\s+import\([^)]*\)/g, ""));
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
  const body = bodyOf(verify, key);
  if (body === null) return verify.includes(`\n  ${key}:`) ? "yes" : "none";
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

// ─────────────────────────────────────────────────────────────────────────────
// The onboarding map: what each step reads, writes, refuses on, and would ask
// ─────────────────────────────────────────────────────────────────────────────

/** Every .ts under src/, read once, so "who else reads this table" is one pass and not 41. */
function sourceFiles(): Array<{ rel: string; text: string }> {
  const out: Array<{ rel: string; text: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(rel);
      else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push({ rel, text: read(rel) });
    }
  };
  walk("src");
  return out;
}

const SRC = sourceFiles();

/** `${...}` is a value this generator cannot know, so it is named as a hole rather than guessed. */
function tidy(s: string): string {
  return s
    .replace(/\$\{[^}]*\}/g, "<...>")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The module a step's runner delegates to, as the registry's own dynamic import names it.
 *
 * Every registry entry is two lines: a dynamic import and a call. The tables a step touches are in
 * THAT module, not in the entry, so the entry is only useful as a pointer to it.
 */
function runnerModule(key: string): string | null {
  const body = bodyOf(registry, key);
  if (body === null) return null;
  const m = /await\s+import\(\s*["']([^"']+)["']\s*\)/.exec(body);
  if (!m) return null;
  const spec = m[1];
  const base = path.posix.dirname(REGISTRY_PATH);
  const rel = spec.startsWith("@/") ? `src/${spec.slice(2)}` : spec.startsWith(".") ? path.posix.normalize(`${base}/${spec}`) : null;
  if (!rel) return null;
  for (const ext of [".ts", ".tsx", "/index.ts"]) {
    if (fs.existsSync(path.join(root, rel + ext))) return rel + ext;
  }
  return null;
}

/**
 * Tables a module touches, split by whether it writes to them.
 *
 * ‼️ MODULE-WIDE, NOT FUNCTION-WIDE, AND THE DOC SAYS SO. Following one exported function's call
 * graph would need a type checker; naming the module's tables is coarser and true. A table counted
 * as written wherever it is also read, because "this step can change this table" is the fact a
 * reader of this map is after.
 */
function tablesIn(source: string): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const re = /\.from\(\s*["'`]([a-z_]+)["'`]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const after = source.slice(m.index, m.index + 240);
    if (/\.\s*(insert|update|upsert|delete)\s*\(/.test(after)) writes.add(m[1]);
    else reads.add(m[1]);
  }
  for (const w of writes) reads.delete(w);
  return { reads: [...reads].sort(), writes: [...writes].sort() };
}

/**
 * What a verifier says it looked at when it refuses.
 *
 * notYet(checked, found, todo): the first argument is the system's own words for the evidence it
 * went looking for, which is a better answer to "what does this step refuse on" than anything this
 * generator could compose. A ternary is read through to its first branch.
 */
function refusalsIn(body: string): string[] {
  const out: string[] = [];
  const re = /notYet\(/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const tail = body.slice(m.index + m[0].length, m.index + 500);
    const lit = /^[\s(]*(?:[A-Za-z0-9_.]+\s*\?\s*)?(["'`])([\s\S]*?)\1/.exec(tail);
    if (lit) out.push(tidy(lit[2]));
  }
  return [...new Set(out)].filter(Boolean);
}

/** Files other than the writer that select from a table. A table nobody reads is a finding. */
function readersOf(table: string, exclude: readonly string[]): string[] {
  const needle = new RegExp(`\\.from\\(\\s*["'\`]${table}["'\`]\\s*\\)`);
  return SRC.filter((f) => !exclude.includes(f.rel) && needle.test(f.text) && /\.select\(/.test(f.text)).map((f) => f.rel);
}

/**
 * A context carrying nothing but what gapsFrom reads, with nothing on file.
 *
 * ‼️ gapsFrom TOUCHES EXACTLY TWO FIELDS: `board.steps` for the label and `gaps` for what is
 * missing. Building a whole LeadContext by hand would be forty lines of fiction, so this names the
 * two and casts, and the cast is the documentation. _probe-gaps.ts makes the same cast and runs
 * gapsFrom for real, so a third field would break there loudly rather than here silently.
 */
function everyQuestionContext(): LeadContext {
  return {
    board: { steps: DELIVERY_STEPS.map((s) => ({ key: s.key as StepKey, label: s.label })) },
    gaps: held(evaluateDatasets(NOTHING_ON_FILE, RESEARCH_SECTION_KEYS), {
      source: "dataset-spec",
      why: "no dataset could be evaluated",
    }),
  } as unknown as LeadContext;
}

/** Which step fills which declared field, inverted once so "what does this unblock" is a lookup. */
const DATASET_FILLERS = (() => {
  const out = new Map<string, FieldRef[]>();
  for (const f of DATASET_FIELDS) {
    if (f.filledBy.kind !== "step") continue;
    const list = out.get(f.filledBy.step) ?? [];
    list.push(`${f.dataset}.${f.key}` as FieldRef);
    out.set(f.filledBy.step, list);
  }
  return out;
})();

function mapSections(): string {
  const ctx = everyQuestionContext();
  const blocks: string[] = [];

  for (const step of DELIVERY_STEPS) {
    const key = step.key as StepKey;
    const n = stepNumber(key);
    const modulePath = runnerModule(step.key);
    const runner = runnerFor(step.key);
    const tables = modulePath ? tablesIn(read(modulePath)) : { reads: [], writes: [] };
    const vBody = bodyOf(verify, step.key);
    const vTables = vBody ? tablesIn(vBody) : { reads: [], writes: [] };
    const refusals = vBody ? refusalsIn(vBody) : [];
    const need = STEP_NEEDS[key];
    const { needs, wants } = fieldsForStep(key);

    const waitedOnBy = DELIVERY_STEPS.filter((s) => (s.blockedBy ?? []).includes(step.key)).map((s) => `${stepNumber(s.key as StepKey)} \`${s.key}\``);
    const fills = DATASET_FILLERS.get(step.key) ?? [];
    const unlocks = [...new Set(fills.flatMap((ref) => stepsBlockedBy(ref)))]
      .filter((k) => k !== key)
      .map((k) => `${stepNumber(k)} \`${k}\``)
      .sort();

    const downstream: string[] = [];
    if (waitedOnBy.length) {
      downstream.push(
        waitedOnBy.length === 1
          ? `step ${waitedOnBy[0]} declares it waits on this`
          : `steps ${waitedOnBy.join(", ")} declare they wait on this`
      );
    }
    if (unlocks.length) {
      downstream.push(`the fields it fills unblock step${unlocks.length === 1 ? "" : "s"} ${unlocks.join(", ")}`);
    }
    for (const t of tables.writes) {
      const others = readersOf(t, modulePath ? [modulePath] : []);
      downstream.push(
        others.length
          ? `\`${t}\` is selected in ${others.length} other file(s), e.g. \`${others.slice(0, 3).join("`, `")}\``
          : `‼️ \`${t}\` is written here and **selected nowhere else**`
      );
    }
    if (!downstream.length) downstream.push("nothing downstream declares a dependency on it");

    const questions = gapLines(gapsFrom(ctx, key), Infinity);

    blocks.push(
      [
        `### ${n}. \`${step.key}\``,
        "",
        `${step.label}`,
        "",
        "| | |",
        "| --- | --- |",
        `| Phase, mode | ${step.phase}, ${step.mode ?? (step.auto ? "auto" : "manual")} |`,
        `| Waits on | ${(step.blockedBy ?? []).map((b) => `\`${b}\``).join(", ") || "nothing"} |`,
        `| Runner | ${runner ? `\`${runner}()\`${modulePath ? ` in \`${modulePath}\`` : ""}` : "none"} |`,
        `| Writes | ${tables.writes.map((t) => `\`${t}\``).join(", ") || "nothing"} |`,
        `| Reads | ${cell(tables.reads.map((t) => `\`${t}\``).join(", ") || "nothing")} |`,
        `| [Done] reads | ${vTables.reads.concat(vTables.writes).map((t) => `\`${t}\``).join(", ") || "no table"} |`,
        `| Dataset fields | ${need.kind === "nothing" ? "none: " + need.why : `${needs.length} needed, ${wants.length} wanted`} |`,
        `| Downstream | ${cell(downstream.join("; "))} |`,
        "",
        "**[Done] refuses on:**",
        "",
        refusals.length ? refusals.map((r) => `- ${r}`).join("\n") : "- nothing: this verifier never calls `notYet`",
        "",
        "**What it would have to ask, with nothing on file:**",
        "",
        "```",
        questions.join("\n"),
        "```",
      ].join("\n")
    );
  }

  return blocks.join("\n\n");
}

const MAP_DOC = `# The onboarding map

**Generated by \`bunx tsx scripts/_step-wiring.ts\`. Do not edit by hand.** Its companion
\`docs/STEP-WIRING.md\` says what runs each step; this file says what each step needs, what it
touches, what it refuses on, and every question it would have to ask to become completable.

Nothing here is authored. The questions are \`gapLines()\` run against a client who has answered
nothing, so this file and a step's Slack card cannot disagree: they are the same function. The
fields come from \`STEP_NEEDS\` in \`src/lib/clients/step-needs.ts\`, which is
\`Record<StepKey, StepNeed>\` and therefore fails the build until a new step says what it needs.

**Read this before adding a step, a field or a question.** A step whose output nothing reads is
either dead or a gap, and both are findings; the Downstream row is where that shows up.

## How to read it

- **Writes / Reads** are the tables the runner's MODULE touches, not just the function the registry
  names. Following one function's call graph would need a type checker; naming the module is
  coarser and true. A table appears under Writes wherever it is also read.
- **[Done] refuses on** is the first argument of every \`notYet()\` in that step's verifier: the
  system's own words for the evidence it went looking for.
- **What it would have to ask** is every ask, not the first five. A card prints at most five; this
  file passes \`Infinity\` because it has no card to overflow.
- Live row counts are NOT here. They are in \`docs/ONBOARDING-MAP-MEASURED.md\`, which carries its
  measurement date on line 1 and is deliberately not checked for drift.

## The steps

${mapSections()}
`;

// ─────────────────────────────────────────────────────────────────────────────

const DOC = `# The board, step by step

**Generated by \`bunx tsx scripts/_step-wiring.ts\`. Do not edit by hand.** Step numbers are positions in
\`src/config/delivery-steps.ts\`, so inserting a step renumbers every step after it. Read this file before
changing anything about a step: it says what runs it, what its [Done] checks, and what its thread accepts.

What each step NEEDS, and every question it would have to ask, is its companion \`docs/ONBOARDING-MAP.md\`.

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

/** Write it, or report whether it is current. Returns false only when --check found drift. */
function writeOrCheck(rel: string, body: string, checking: boolean): boolean {
  const out = path.join(root, rel);
  if (!checking) {
    fs.writeFileSync(out, body);
    console.log(`wrote ${rel}`);
    return true;
  }
  const current = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (!sameText(current, body)) {
    console.error(`${rel} is out of date. Run: bunx tsx scripts/_step-wiring.ts`);
    return false;
  }
  console.log(`${rel} is current`);
  return true;
}

const BODIES: Record<(typeof CHECKED_DOCS)[number], string> = {
  "docs/STEP-WIRING.md": DOC,
  "docs/ONBOARDING-MAP.md": MAP_DOC,
};

async function main(): Promise<void> {
  const checking = process.argv.includes("--check");
  const live = process.argv.includes("--live");

  if (live && checking) {
    console.error(`${LIVE_DOC} is never checked: it changes every time production does.`);
    process.exit(2);
  }

  if (live) {
    // ‼️ THE ONLY ASYNC ARM AND THE ONLY DYNAMIC IMPORT. Everything above is synchronous, which is
    // what makes it impossible for a live number to reach a --check'ed doc.
    const { measuredMap } = await import("./_onboarding-map-live");
    const got = await measuredMap();
    if (!got.ok) {
      console.error(got.error);
      process.exit(1);
    }
    fs.writeFileSync(path.join(root, LIVE_DOC), got.body);
    console.log(`wrote ${LIVE_DOC}`);
    return;
  }

  // ‼️ BOTH DOCS ARE REPORTED BEFORE EXITING. A check that stops at the first failure teaches people
  // to regenerate twice and read neither verdict.
  let ok = true;
  for (const rel of CHECKED_DOCS) ok = writeOrCheck(rel, BODIES[rel], checking) && ok;
  if (!ok) process.exit(1);
  if (!checking) console.log(`${DELIVERY_STEPS.length} steps`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
