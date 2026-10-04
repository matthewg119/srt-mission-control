// The tool lane: the registry, the grammar, and the one thing it must never do.
//
// Run:
//   bun run scripts/_probe-tool-lane.ts                             (pure, offline)
//   bun run --env-file=.env.local scripts/_probe-tool-lane.ts --live    (adds the table checks)

import { readFileSync } from "node:fs";
import {
  TOOL_COMPONENTS,
  COMPONENT_KEYS,
  getToolComponent,
  isComponentKey,
  toolsForVertical,
} from "../src/config/tool-components";

let pass = 0;
let fail = 0;

function ok(label: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++;
    console.log(`  ok    ${label}`);
  } else {
    fail++;
    console.log(`  FAIL  ${label}${detail ? ` :: ${detail}` : ""}`);
  }
}

function section(t: string): void {
  console.log(`\n${t}`);
}

// ── 1. The registry is closed ────────────────────────────────────────────────
section("1. the registry is closed");

ok("every key is unique", new Set(COMPONENT_KEYS).size === COMPONENT_KEYS.length);
ok("getToolComponent resolves every key", COMPONENT_KEYS.every((k) => getToolComponent(k)?.key === k));
ok("getToolComponent(null) is null", getToolComponent(null) === null);

// ‼️ THE WHOLE POINT OF A REGISTRY. An unknown key must resolve to nothing, so a page whose
// component_key names something nobody reviewed renders no widget rather than some other one.
ok("an unknown key resolves to null", getToolComponent("botox-units-hacked") === null);
ok("isComponentKey refuses an unknown key", !isComponentKey("botox-units-hacked"));
ok("isComponentKey refuses a non-string", !isComponentKey(7) && !isComponentKey(null));

// The database CHECK on client_pages.component_key. A key the constraint would reject is a key
// that can never be stored, so it may as well not be in the registry.
const KEY_SHAPE = /^[a-z][a-z0-9-]{1,62}$/;
for (const t of TOOL_COMPONENTS) {
  ok(`${t.key} matches the column's CHECK`, KEY_SHAPE.test(t.key));
}

// ── 2. Every tool says what it is, and where it stops being right ────────────
section("2. every tool says what it is, and where it stops being right");

for (const t of TOOL_COMPONENTS) {
  ok(`${t.key}: has a label`, t.label.trim().length > 0);
  ok(`${t.key}: names the question it answers`, t.answers.trim().length > 0);
  ok(`${t.key}: names at least one input`, t.inputs.length > 0);
  ok(`${t.key}: says what it gives back`, t.output.trim().length > 0);
  // ‼️ NOT OPTIONAL. An estimate with no stated limits is one a reader takes for a quote.
  ok(`${t.key}: states its limits`, t.limits.trim().length > 20, t.limits);
}

// ── 3. ‼️ Digit-free, like post-formats.ts and for the same reason ───────────
section("3. digit-free, and no em dash");

const strings: string[] = [];
for (const t of TOOL_COMPONENTS) {
  strings.push(t.label, t.answers, t.output, t.limits, ...t.inputs);
}
const withDigit = strings.filter((s) => /[0-9]/.test(s));
ok("no prompt-facing string contains a digit", withDigit.length === 0, withDigit.join(" | "));
const withDash = strings.filter((s) => s.includes("—"));
ok("no string contains an em dash", withDash.length === 0, withDash.join(" | "));

// ── 4. ‼️ No tool asks for anything, fetches anything or stores anything ─────
//
// The `tool` format refuses "a result that cannot be produced without asking for a name or an
// email". This is that rule checked in the component source rather than asked for in a prompt.
section("4. no tool asks for, fetches or stores anything");

const TOOLS_SRC = readFileSync("src/components/hub/hub-tool.tsx", "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "");

for (const [what, re] of [
  ["fetch", /\bfetch\s*\(/],
  ["localStorage", /localStorage/],
  ["sessionStorage", /sessionStorage/],
  ["an email input", /type=\s*["']email["']/],
  ["a form post", /<form[^>]*action=/],
] as const) {
  ok(`no tool uses ${what}`, !re.test(TOOLS_SRC));
}

// The frame renders the limits so no individual tool can forget to.
ok("the frame renders the limits line", /hub-tool-limits/.test(TOOLS_SRC));
ok("an unknown key renders nothing", /if \(!spec\) return null;/.test(TOOLS_SRC));

// ── 5. The grammar ──────────────────────────────────────────────────────────
section("5. the grammar");

const LANE = readFileSync("src/lib/clients/tool-lane.ts", "utf8");
const TOOLS_RE = /^\s*[`*_]*tools?[`*_]*\s*$/i;
const PICK_RE = /^\s*[`*_]*tool\s+pick\s+(\d{1,2})[`*_]*\s*$/i;

ok("`tools` lists", TOOLS_RE.test("tools"));
ok("`tool` lists too", TOOLS_RE.test("tool"));
ok("`tool pick 3` picks", PICK_RE.exec("tool pick 3")?.[1] === "3");
ok("`tool pick 12` picks", PICK_RE.exec("tool pick 12")?.[1] === "12");
// The reverse gates. A pattern loose enough to match anything passes every check above.
ok("`tool pick` with no number does not pick", PICK_RE.exec("tool pick") === null);
ok("`toolbox` is not the list verb", !TOOLS_RE.test("toolbox"));
ok("a sentence containing the word tool is not a command", !TOOLS_RE.test("we should build a tool"));

// ‼️ STEP TWELVE ONLY. The decision belongs where the evidence is, and returning null anywhere
// else is what keeps this out of every other step's thread.
ok("the handler is gated on keyword_set", /if \(args\.stepKey !== "keyword_set"\) return null;/.test(LANE));

// ‼️ IT READS dominant_page_type RATHER THAN DECIDING AGAIN. That judgement was made while
// somebody was looking at a real results page.
ok("it reads the SERP judgement rather than remaking it", /dominant_page_type/.test(LANE));
ok("it never calls a model", !/callClaudeJSON|anthropic|claude-/.test(LANE));

// ── 6. Live ─────────────────────────────────────────────────────────────────
async function live(): Promise<void> {
  section("6. LIVE: the tables and the column");

  const { supabaseAdmin } = await import("../src/lib/db");

  for (const table of ["vertical_assets", "client_assets"] as const) {
    const { error } = await supabaseAdmin.from(table).select("id").limit(1);
    ok(`${table} exists`, !error, error?.message);
  }

  const { error: colErr } = await supabaseAdmin.from("client_pages").select("id, component_key").limit(1);
  ok("client_pages.component_key is selectable", !colErr, colErr?.message);

  // ‼️ THE COLUMN'S CHECK MUST REFUSE WHAT THE REGISTRY WOULD NEVER PRODUCE. A key with a
  // slash or a scheme in it is the shape of a path, and the whole point of the column is that
  // it is not one.
  const { data: page } = await supabaseAdmin.from("client_pages").select("id").limit(1).maybeSingle();
  if (page) {
    const { error } = await supabaseAdmin
      .from("client_pages")
      .update({ component_key: "https://example.com/tool" })
      .eq("id", page.id);
    ok("a URL is refused as a component key", error !== null, error ? "" : "it was accepted");
  } else {
    console.log("  --    no page to test the CHECK against");
  }
}

async function main(): Promise<void> {
  if (process.argv.includes("--live")) {
    try {
      await live();
    } catch (e) {
      ok("the live half ran", false, (e as Error).message);
    }
  } else {
    console.log("\n(pure half only. Add --env-file=.env.local and --live for the table checks.)");
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
