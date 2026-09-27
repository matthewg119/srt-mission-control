// Every column the board writes, and whether anything reads it back. Proved offline.
//
//   bun run scripts/_probe-dead-wires.ts
//   bun run scripts/_probe-dead-wires.ts --inventory    also list the non-failing lanes
//   bun run scripts/_probe-dead-wires.ts --write         rewrite scripts/_dead-wires-baseline.ts
//
// ‼️ --write IS NEVER RUN IN CI. A probe that regenerates its own baseline on failure always passes.
// Run it after deliberately resolving columns, and lower BOARD_BASELINE in the same commit.
//
// NO MODEL CALL, NO WRITES, NO NETWORK AND NO DATABASE. It reads docs/*.sql and src/ + scripts/ off
// disk, which is the only reason it can be gated in CI: a probe that needs production is a probe
// that passes vacuously against a placeholder Supabase URL.
//
// ─────────────────────────────────────────────────────────────────────────────
// WHY THIS EXISTS
//
// The curated-20 bug was not a forgotten line. It was a CLASS:
//
//   A decision is written to a column. Nothing ever reads that column back. The write succeeds, the
//   card renders, the row is there if you go looking. The only thing missing is a consumer, and
//   nothing in a type system or a test suite notices an absence.
//
// `_probe-serp-gate.ts` §6b enforced the rule for ONE migration and caught five columns. It would
// not have caught three of the findings that produced this file, because `missing_pictures`,
// `rejected_at` and `approved_at` live in a different migration and §6b only ever read
// docs/2026-09-26-keyword-serp.sql. A scan run once tells you about the day it ran. This is the
// standing version.
//
// ─────────────────────────────────────────────────────────────────────────────
// ‼️ THE QUESTION IS WRITES AGAINST READS, NOT "IS THE NAME ANYWHERE"
//
// The first cut of this file asked whether any select list names the column. That reports
// `avatar_briefs.avatar_label` as dead, and it is not: `avatarBriefFor` selects `*` and its mapper
// reads `data.avatar_label`. It also passes `keyword_clusters.approved_at`, which IS dead, because
// `page_plan.approved_at` is selected constantly. Both answers were wrong, in opposite directions.
//
// ‼️ THE RULE THAT MAKES IT EXACT: PostgREST RETURNS ONLY THE COLUMNS THE SELECT NAMED. So
//
//   a table read with an EXPLICIT select list -> that list is the COMPLETE authority on what can be
//     in the row. A property access adds nothing, because a column outside the list is not there.
//   a table read with `select("*")`            -> the row carries everything, so a property access
//     is the ONLY evidence a column was read.
//
// That is what separates the two cases above. `avatar_briefs` is selected with `*`, so
// `data.avatar_label` counts and `keyword_categories`, absent from the same mapper, does not.
// `keyword_clusters` is only ever selected by explicit list, so a stray `.approved_at` belonging to
// `page_plan` cannot speak for it.
//
// Three verdicts follow, and the middle one is the bug class this file is named after:
//
//   READ           the column is selected, filtered on, or read off a `select("*")` row.
//   WRITE_ONLY     something writes it and nothing reads it. The curated-20 shape.
//   NEVER_TOUCHED  no writer either. Dead DDL, and a different finding worth its own wording:
//                  `avatar_briefs.keyword_categories` is this, and the scan doc that commissioned
//                  the fix called it write-only, which sent the first fix at the wrong problem.
//
// A FILTER KEY IS A READ. `.eq("col", v)` never returns the column and is still the code asking the
// database about it. `client_keywords.selected_at` is read exactly that way, and calling it dead
// would have this probe demand the removal of a column the keyword cards depend on.
//
// ‼️ MATCHING IS TABLE-SCOPED, and the scan doc is the argument. It claimed `avatar_briefs`' sibling
// columns were "read 4 to 15 times". They are not: those are reads of the same column NAMES on
// `client_audiences`, whose COLUMNS list really does carry `lane_name` and `hard_lines`. Not one of
// them is ever read from `avatar_briefs`. `_probe-serp-gate.ts` survives a table-agnostic `\bcol\b`
// only because `ai_overview_satisfies` and `query_on_screen` are unique strings; board-wide,
// `status`, `city`, `source`, `rank` and `theme` all match some other table and pass.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { UNREAD_COLUMNS } from "./_dead-wires-baseline";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

const SHOW_INVENTORY = process.argv.includes("--inventory");
/**
 * Rewrite scripts/_dead-wires-baseline.ts from what this run measured.
 *
 * ‼️ NEVER IN CI, AND NEVER AS THE DEFAULT. A probe that regenerates its own baseline when it fails is
 * a probe that always passes, which is precisely the ratchet being filed off. It is a command somebody
 * runs after deliberately resolving columns, and the commit is the record.
 */
const WRITE_BASELINE = process.argv.includes("--write");

// ─────────────────────────────────────────────────────────────────────────────
// The corpus
//
// ‼️ PATH AND CONTENT, NOT ONE JOINED STRING. `_probe-serp-gate.ts` joins src/ into a single blob,
// which is enough to ask "does anything read this". It is not enough to ask "does anything OTHER
// than the writer read this", which is the curated-20 question §8 asks, and it cannot name the file
// a column was read in.
// ─────────────────────────────────────────────────────────────────────────────

function sourceFiles(dir: string, acc: Array<[string, string]> = []): Array<[string, string]> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, acc);
    else if (/\.tsx?$/.test(p)) acc.push([p.split("\\").join("/"), readFileSync(p, "utf8")]);
  }
  return acc;
}

/**
 * Comments stripped, conservatively.
 *
 * ‼️ FULLY-COMMENTED LINES ONLY, NEVER A TRAILING `//`. A commented-out `.select("col")` counting as
 * a read is a false GREEN, which is the direction that matters, and commented-out code lives on its
 * own line. Stripping every trailing `//` would cut `const x = "https://y"` in half and leave an
 * unbalanced quote for every later regex to run past, which is a worse bug than the one it fixes.
 *
 * `[\s\S]` rather than the dotAll flag: tsconfig targets ES2017 and `s` needs ES2018, which fails
 * `next build` rather than this probe. Same note `_probe-serp-gate.ts` carries.
 */
function stripTsComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * SQL comments stripped.
 *
 * ‼️ LOAD-BEARING, NOT TIDINESS. docs/2026-08-17-funding-decommission.sql has a whole block
 * commented out after it was reversed, and without this its statements are collected as live DDL. A
 * census over the raw files also reports tables called `above` and `in`, lifted out of prose.
 * _probe-list-prep.ts's normalize() only fixes CRLF and does not strip comments, and its own note
 * records what that costs: an absence check over a commented file tests the prose, not the program.
 */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n\r]*/g, "");
}

const SRC_FILES = sourceFiles("src");
const SCRIPT_FILES: Array<[string, string]> = readdirSync("scripts")
  .filter((f) => /\.ts$/.test(f))
  .map((f) => [`scripts/${f}`, readFileSync(join("scripts", f), "utf8")]);

const READER_FILES = [...SRC_FILES, ...SCRIPT_FILES].map(([p, c]) => [p, stripTsComments(c)] as [string, string]);

const SQL_FILES: Array<[string, string]> = readdirSync("docs")
  .filter((f) => /\.sql$/.test(f))
  .map((f) => [`docs/${f}`, readFileSync(join("docs", f), "utf8")]);

// ─────────────────────────────────────────────────────────────────────────────
// 1. The SQL side: every column this repo declares, attributed to its table
//
// Five defects in `_probe-serp-gate.ts` §6b's single regex, each a live miss:
//
//   /add column if not exists ([a-z_]+)/g
//
//   1. No `i` flag. 66 hits across 20 files are uppercase ADD COLUMN IF NOT EXISTS.
//   2. `[a-z_]+` stops at a digit, so `day_0_source` is collected as `day_` and `phone_last10`,
//      `mobile_last10` and `page_sha256` are missed entirely.
//   3. `create table` bodies are not parsed at all: ~2,100 columns, and 35 files declare columns
//      only that way, `keyword_serp_reads` among them.
//   4. No table attribution, which the table-scoping rule above makes mandatory. A multi-column
//      `alter table contacts / add column a, / add column b` names the table once.
//   5. `drop column` is not subtracted, so a column added in an old migration and dropped by a
//      newer one reads as write-only for ever.
// ─────────────────────────────────────────────────────────────────────────────

const COL = "[a-z_][a-z0-9_]*";

interface Declared {
  table: string;
  column: string;
  file: string;
}

/**
 * Names that are never a column: the words that can follow `add column` in no real DDL, and the
 * table-level constraint keywords that open a clause inside a `create table` body.
 */
const NOT_A_COLUMN = new Set([
  "if", "primary", "unique", "foreign", "constraint", "check", "exclude", "like", "index",
]);

function tableOf(raw: string): string {
  return raw.replace(/^public\./, "").toLowerCase();
}

function declaredColumns(): { declared: Declared[]; dropped: Set<string> } {
  const declared: Declared[] = [];
  const dropped = new Set<string>();

  for (const [file, rawSql] of SQL_FILES) {
    const sql = stripSqlComments(rawSql);

    // ── alter table ... add column / drop column ──────────────────────────
    //
    // ‼️ THE TABLE NAME IS CARRIED FORWARD ACROSS CLAUSES. One `alter table` can own many
    // `add column` clauses on their own lines, separated by commas. Re-reading the nearest table
    // name per clause is what makes `table.column` pairs possible, and the pair is mandatory.
    const alterRe = new RegExp(
      `alter\\s+table\\s+(?:if\\s+exists\\s+)?((?:public\\.)?${COL})([\\s\\S]*?)` +
        `(?=alter\\s+table|create\\s+table|create\\s+(?:unique\\s+)?index|comment\\s+on|insert\\s+into|update\\s+|select\\s|do\\s+\\$|grant\\s|revoke\\s|$)`,
      "gi"
    );
    for (const m of sql.matchAll(alterRe)) {
      const table = tableOf(m[1]);
      const body = m[2] ?? "";
      for (const a of body.matchAll(new RegExp(`add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?(${COL})`, "gi"))) {
        const column = a[1].toLowerCase();
        if (!NOT_A_COLUMN.has(column)) declared.push({ table, column, file });
      }
      for (const d of body.matchAll(new RegExp(`drop\\s+column\\s+(?:if\\s+exists\\s+)?(${COL})`, "gi"))) {
        dropped.add(`${table}.${d[1].toLowerCase()}`);
      }
    }

    // ── create table ( ... ) ──────────────────────────────────────────────
    //
    // Balanced to the matching paren, because a column can carry `references x (id)`, a
    // `check (a in ('b','c'))` or a `numeric(10,2)`, and stopping at the first `)` truncates the
    // body. Only depth 1 is read: anything deeper belongs to a constraint or a type.
    const createRe = new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?((?:public\\.)?${COL})\\s*\\(`, "gi");
    for (const m of sql.matchAll(createRe)) {
      const table = tableOf(m[1]);
      const open = (m.index ?? 0) + m[0].length;
      let depth = 1;
      let i = open;
      while (i < sql.length && depth > 0) {
        const ch = sql[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === "'") {
          i++;
          while (i < sql.length && sql[i] !== "'") i++;
        }
        i++;
      }
      const body = sql.slice(open, i - 1);

      let d = 0;
      let clause = "";
      const clauses: string[] = [];
      for (const ch of body) {
        if (ch === "(") d++;
        else if (ch === ")") d--;
        if (ch === "," && d === 0) {
          clauses.push(clause);
          clause = "";
        } else clause += ch;
      }
      clauses.push(clause);

      for (const c of clauses) {
        const t = new RegExp(`^\\s*(${COL})`, "i").exec(c);
        if (!t) continue;
        const column = t[1].toLowerCase();
        if (!NOT_A_COLUMN.has(column)) declared.push({ table, column, file });
      }
    }
  }

  return { declared, dropped };
}

const { declared, dropped } = declaredColumns();

const DECLARED = new Map<string, { table: string; column: string; files: Set<string> }>();
for (const d of declared) {
  const key = `${d.table}.${d.column}`;
  if (dropped.has(key)) continue;
  const seen = DECLARED.get(key);
  if (seen) seen.files.add(d.file);
  else DECLARED.set(key, { table: d.table, column: d.column, files: new Set([d.file]) });
}

console.log("\n1. the SQL census");
check("every docs/*.sql was read", SQL_FILES.length >= 195, `${SQL_FILES.length} files`);
check("columns were found at all", DECLARED.size > 1500, `${DECLARED.size} table.column pairs`);
check("drop column is subtracted", dropped.size >= 4, `${dropped.size} dropped`);
check(
  "comment stripping kept prose out of the table list",
  ![...DECLARED.values()].some((d) => d.table === "above" || d.table === "in"),
  "a census over the raw files reports tables called `above` and `in`"
);

// ─────────────────────────────────────────────────────────────────────────────
// 2. The parser, against answers known by hand
//
// ‼️ A SCANNER WITH A SILENT PARSER BUG REPORTS A CLEAN BOARD, which is indistinguishable from a
// clean board and considerably worse. Every check is one of the five defects above, pinned to a real
// column so it cannot regress into passing for the wrong reason.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n2. the parser finds what the old regex could not");

const has = (k: string): boolean => DECLARED.has(k);

check("digits survive: clients.day_0_source", has("clients.day_0_source"), "[a-z_]+ collects this as `day_`");
check("digits survive: contacts.phone_last10", has("contacts.phone_last10"));
check("an UPPERCASE ADD COLUMN is seen: lenders.min_deal_size", has("lenders.min_deal_size"));
check(
  "a create-table body is parsed: keyword_serp_reads.ai_overview",
  has("keyword_serp_reads.ai_overview"),
  "35 files declare columns only inside create table"
);
check("and its neighbours: keyword_serp_reads.top_domains", has("keyword_serp_reads.top_domains"));
check(
  "a multi-column alter attributes every clause: contacts.do_not_contact_reason",
  has("contacts.do_not_contact_reason"),
  "the table name appears once, on the first line"
);
check("the table is right, not just the column: client_keywords.selected_at", has("client_keywords.selected_at"));
check("a dropped column is gone: medspa_orders.bump_scripts", !has("medspa_orders.bump_scripts"));

// ─────────────────────────────────────────────────────────────────────────────
// 3. The reader side
//
// Six shapes make a live column look dead. `_probe-serp-gate.ts` handles two.
// ─────────────────────────────────────────────────────────────────────────────

/** A string literal chain: `"a, b" + "c, d"`. The concatenation is the half that gets lost. */
const STRING_CHAIN = `"(?:[^"\\\\\\n]|\\\\.)*"(?:\\s*\\+\\s*"(?:[^"\\\\\\n]|\\\\.)*")*`;

function chainText(chain: string): string {
  return [...chain.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)].map((m) => m[1]).join(" ");
}

/** Object-literal keys, at depth 1 only, out of an `.insert({...})` / `.update({...})` payload. */
function payloadKeys(chunk: string): Set<string> {
  const out = new Set<string>();
  for (const m of chunk.matchAll(/\.(?:insert|update|upsert)\(\s*(\[?\s*\{)/g)) {
    const open = (m.index ?? 0) + m[0].length - 1;
    let depth = 0;
    let i = open;
    let body = "";
    while (i < chunk.length) {
      const ch = chunk[i];
      if (ch === "{" || ch === "[" || ch === "(") depth++;
      else if (ch === "}" || ch === "]" || ch === ")") {
        depth--;
        if (depth === 0) break;
      }
      body += ch;
      i++;
    }
    // Depth-1 keys only: a nested object is a jsonb value, not a column list.
    let d = 0;
    let clause = "";
    const clauses: string[] = [];
    for (const ch of body.slice(1)) {
      if (ch === "{" || ch === "[" || ch === "(") d++;
      else if (ch === "}" || ch === "]" || ch === ")") d--;
      if (ch === "," && d === 0) {
        clauses.push(clause);
        clause = "";
      } else clause += ch;
    }
    clauses.push(clause);
    for (const c of clauses) {
      const t = new RegExp(`^\\s*(?:"|')?(${COL})(?:"|')?\\s*:`, "i").exec(c);
      if (t) out.add(t[1].toLowerCase());
      else {
        // Shorthand `{ selected_at }` and spread-free bare identifiers.
        const bare = new RegExp(`^\\s*(${COL})\\s*$`, "i").exec(c);
        if (bare) out.add(bare[1].toLowerCase());
      }
    }
  }
  return out;
}

/**
 * Column names READ in one chunk of source: select lists, filter keys and order keys.
 *
 * ‼️ A FILTER KEY IS A READ, and `client_keywords.selected_at` is the case that proves it matters.
 */
function readsIn(chunk: string, constValues: Map<string, string>): Set<string> {
  const out = new Set<string>();
  const add = (text: string): void => {
    for (const m of text.matchAll(new RegExp(COL, "gi"))) out.add(m[0].toLowerCase());
  };

  for (const m of chunk.matchAll(new RegExp(`\\.select\\(\\s*(${STRING_CHAIN})`, "g"))) add(chainText(m[1]));
  for (const m of chunk.matchAll(/\.select\(\s*`([^`]*)`/g)) {
    add(m[1].replace(/\$\{[^}]*\}/g, " "));
    for (const id of m[1].matchAll(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g)) {
      const v = constValues.get(id[1]);
      if (v) add(v);
    }
  }
  for (const m of chunk.matchAll(/\.select\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
    const v = constValues.get(m[1]);
    if (v) add(v);
  }

  const FILTERS = "eq|neq|gt|gte|lt|lte|like|ilike|is|in|contains|containedBy|overlaps|order|filter|not";
  for (const m of chunk.matchAll(new RegExp(`\\.(?:${FILTERS})\\(\\s*"([^"\\n]*)"`, "g"))) {
    const first = m[1].split(",")[0].trim();
    if (new RegExp(`^${COL}$`, "i").test(first)) out.add(first.toLowerCase());
  }
  // ‼️ BOTH QUOTE STYLES, AND THE BACKTICK ONE IS THE COMMON CASE. An `.or()` filter almost always
  // interpolates a value, so it is written as a template literal: 22 of them in src/, against a handful
  // in double quotes. Reading only the double-quoted form reported `page_plan.draft_lease_at` as
  // write-only when pre-call-pages.ts:567 filters on it directly, which is a FALSE POSITIVE, and those
  // are worse than a miss: an exemption written for a column that is genuinely read is a sentence
  // asserting something untrue, and it stays in the file being believed.
  for (const m of chunk.matchAll(/\.or\(\s*["`]([^"`\n]*)["`]/g)) {
    for (const part of m[1].split(",")) {
      const lead = new RegExp(`^\\s*(${COL})\\.`, "i").exec(part);
      if (lead) out.add(lead[1].toLowerCase());
    }
  }
  for (const m of chunk.matchAll(/onConflict:\s*"([^"\n]*)"/g)) {
    for (const part of m[1].split(",")) {
      const t = new RegExp(`^\\s*(${COL})\\s*$`, "i").exec(part);
      if (t) out.add(t[1].toLowerCase());
    }
  }
  return out;
}

interface Corpus {
  reads: Map<string, Set<string>>;
  writes: Map<string, Set<string>>;
  /** Tables somewhere queried with `select("*")`, where a property access is the only evidence. */
  star: Set<string>;
  /** file -> tables it queries, and file -> property names it reads. For the star rule. */
  props: Map<string, Set<string>>;
  filesByTable: Map<string, Set<string>>;
}

function into(map: Map<string, Set<string>>, key: string, values: Iterable<string>): void {
  let set = map.get(key);
  if (!set) {
    set = new Set<string>();
    map.set(key, set);
  }
  for (const v of values) set.add(v);
}

function collect(): Corpus {
  const reads = new Map<string, Set<string>>();
  const writes = new Map<string, Set<string>>();
  const star = new Set<string>();
  const props = new Map<string, Set<string>>();
  const filesByTable = new Map<string, Set<string>>();

  // ‼️ CONST SELECT LISTS ARE RESOLVED BY NAME, NOT BY A NAME PATTERN. §6b matched
  // `const [A-Za-z_]*COLUMNS[A-Za-z_]*`, which finds KW_COLUMNS and misses `COLUMNS` in
  // audiences.ts, `LEAD_COLS` in crm.ts, `SELECT` in hub/resolve.ts, `COLS` in reel/jobs.ts and a
  // lowercase function-local `columns` in avatars.ts, about twenty in all. A const actually handed
  // to `.select(...)` is a select list whatever it is called; one that is not handed to `.select(...)`
  // is some other string that must not be mistaken for a read.
  //
  // ‼️ AND THEY ARE RESOLVED PER FILE, WHICH THE FIRST CUT GOT WRONG AND IT COST SIX OF THEM. There
  // are SEVEN different `const COLUMNS` in this repo (audiences, field-values, page-evidence,
  // hub/pages, magnets, replica-pages, send-agreement), two `ROW_COLUMNS`, two `SESSION_COLUMNS` and
  // two `AUDIT_COLS`. One global map is last-writer-wins, so six of the seven were silently replaced
  // and every column they name read as dead: twenty false failures on `client_audiences` alone.
  // Consts are file-scoped in a TS module, so the resolution has to be too.
  const perFile = new Map<string, Map<string, string>>();
  const globalCount = new Map<string, number>();
  for (const [path, src] of READER_FILES) {
    const mine = new Map<string, string>();
    for (const m of src.matchAll(
      new RegExp(`const\\s+([A-Za-z_$][\\w$]*)\\s*(?::[^=\\n]+)?=\\s*(${STRING_CHAIN})`, "g")
    )) {
      mine.set(m[1], chainText(m[2]));
      globalCount.set(m[1], (globalCount.get(m[1]) ?? 0) + 1);
    }
    perFile.set(path, mine);
  }
  // An exported select list used in another file (PROSPECT_COLUMNS, LEAD_COLUMNS) resolves globally,
  // but ONLY when the name is unique across the repo. An ambiguous name resolves to nothing rather
  // than to whichever file happened to be read last.
  const unique = new Map<string, string>();
  for (const [, mine] of perFile) {
    for (const [name, value] of mine) if (globalCount.get(name) === 1) unique.set(name, value);
  }
  const constsFor = (path: string): Map<string, string> => {
    const merged = new Map(unique);
    for (const [k, v] of perFile.get(path) ?? []) merged.set(k, v);
    return merged;
  };

  for (const [path, src] of READER_FILES) {
    const constValues = constsFor(path);
    // Property accesses in this file: `data.avatar_label`, `row?.selected_at`, `["selected_at"]`.
    const names = new Set<string>();
    for (const m of src.matchAll(new RegExp(`\\.\\s*(${COL})\\b`, "g"))) names.add(m[1].toLowerCase());
    for (const m of src.matchAll(new RegExp(`\\[\\s*"(${COL})"\\s*\\]`, "g"))) names.add(m[1].toLowerCase());
    props.set(path, names);

    for (const m of src.matchAll(/\.from\(\s*"([a-z_][a-z0-9_]*)"\s*\)/g)) {
      const table = m[1].toLowerCase();
      into(filesByTable, table, [path]);

      // A window over the builder chain rather than a parse: the chain is one expression and the
      // next `.from(` is the honest boundary.
      const start = (m.index ?? 0) + m[0].length;
      const rest = src.slice(start, start + 1500);
      const next = rest.search(/\.from\(\s*"/);
      const window = next === -1 ? rest : rest.slice(0, next);

      if (/\.select\(\s*"\*"/.test(window)) star.add(table);
      into(reads, table, readsIn(window, constValues));
      into(writes, table, payloadKeys(window));

      // An embedded relation reads the OTHER table: `clients!inner(slug, legal_name)`.
      for (const r of window.matchAll(/([a-z_][a-z0-9_]*)(?:!\w+)*\s*\(([^)"`]*)\)/g)) {
        const rel = r[1].toLowerCase();
        if (rel === table) continue;
        const cols: string[] = [];
        for (const c of r[2].split(",")) {
          const t = new RegExp(`^\\s*(${COL})\\s*$`, "i").exec(c);
          if (t) cols.push(t[1].toLowerCase());
        }
        if (cols.length) into(reads, rel, cols);
      }
    }
  }

  return { reads, writes, star, props, filesByTable };
}

const C = collect();

/**
 * Is this column read?
 *
 * ‼️ THE STAR RULE IS THE WHOLE PRECISION OF THIS PROBE. A property access only counts for a table
 * somewhere selected with `*`, and only in a file that actually queries that table. For a table read
 * by explicit list, the list is the complete authority on what the row contains, so a matching
 * property name elsewhere in the repo is a different table's column.
 */
function isRead(table: string, column: string): boolean {
  if (C.reads.get(table)?.has(column)) return true;
  if (!C.star.has(table)) return false;
  for (const file of C.filesByTable.get(table) ?? []) {
    if (C.props.get(file)?.has(column)) return true;
  }
  return false;
}

const isWritten = (table: string, column: string): boolean => C.writes.get(table)?.has(column) === true;

console.log("\n3. the reader side sees every shape a select list is written in");

check("a plain inline select: client_keywords.phrase", isRead("client_keywords", "phrase"));
check(
  "a CONCATENATED inline select: scraper_rows.optimization_components",
  isRead("scraper_rows", "optimization_components"),
  "the old regex captured only the fragment before the first +"
);
check(
  "a const NOT named *COLUMNS*: client_audiences.buyer_noun_singular",
  isRead("client_audiences", "buyer_noun_singular"),
  "audiences.ts calls it COLUMNS, crm.ts calls it LEAD_COLS"
);
check(
  "a lowercase function-local const: clients.primary_avatar_confirmed_by",
  isRead("clients", "primary_avatar_confirmed_by"),
  "avatars.ts uses `const columns = ...`"
);
check(
  "a filter key is a read: client_keywords.selected_at",
  isRead("client_keywords", "selected_at"),
  'read via .not("selected_at", "is", null), never returned'
);
check(
  "the star rule counts a mapper: avatar_briefs.avatar_label",
  isRead("avatar_briefs", "avatar_label"),
  "avatarBriefFor selects * and the mapper reads data.avatar_label"
);
// ‼️ THIS PIN MOVED ONCE, AND THE REASON IS WORTH KEEPING. It was `keyword_categories`, which is
// exactly the column this build wired up, so fixing the bug turned the check red: the assertion was
// pinned to a defect rather than to the RULE. `business_noun` is a redundant copy of a column
// `client_audiences` owns and reads, it is still dropped by the same `select("*")` mapper, and it is
// the honest demonstration that arriving over the wire is not being read.
check(
  "and the star rule does NOT cover what the mapper drops: avatar_briefs.business_noun",
  !isRead("avatar_briefs", "business_noun"),
  "it arrives over the wire and is discarded, which is the finding"
);
// ‼️ THIS PIN HAS NOW MOVED TWICE, AND THE REASON IS THE SAME BOTH TIMES: a fixture chosen BECAUSE it
// was dead stops being a fixture the moment somebody wires it. It was `approved_at`, then `rationale`,
// which 2026-09-27 wired into the strategy card. `updated_at` is the replacement, and it is a better
// one than either because nothing will ever wire it: it is row bookkeeping with a sentence in
// WRITE_ONLY, while `srt_playbook.updated_at` is selected by name in api/call-coach/playbook.
//
// ‼️ `card_ts` WAS TRIED AND IS WRONG, which is worth recording so nobody tries it again: it LOOKS
// like the ideal fixture, and docs/2026-09-25-drop-missing-pictures.sql:42 reinforces that by listing
// it among "the three the card and the gate actually read". But serp-cards.ts:324 really does
// `.from("keyword_clusters").select("card_ts")`, so the column is read and the pin failed immediately.
// The probe was right and the assumption was wrong, which is the whole reason this pin exists.
//
// ‼️ IF THIS EVER FAILS, WIRE-UP IS THE LIKELY CAUSE, NOT A BROKEN PROBE. Check whether something began
// reading keyword_clusters.updated_at before concluding the rule is broken, then move the pin again.
check(
  "an explicit-list table is not covered by another table's property: keyword_clusters.updated_at",
  !isRead("keyword_clusters", "updated_at"),
  "srt_playbook.updated_at is selected by name; this one is written by every update and read by nothing"
);
// ‼️ AND THE OTHER HALF OF THE SAME RULE, which the pin above cannot show on its own: the column whose
// name it borrows really IS read somewhere. Without this, a bug that made isRead() return false for
// EVERYTHING would leave the pin above passing for the wrong reason, which is exactly the failure §8
// catches one check over. Proving a check can fail is not enough; it also has to be able to pass.
check(
  "and the borrowed name IS read on its own table: srt_playbook.updated_at",
  isRead("srt_playbook", "updated_at"),
  "api/call-coach/playbook selects it by name, so a false here means the reader side is broken"
);
check("a payload key is a WRITE, not a read: client_audiences.emotional_source", isWritten("client_audiences", "emotional_source"));

// ─────────────────────────────────────────────────────────────────────────────
// 4. What is gated, and what is merely counted
//
// ‼️ THE FIRST CUT FAILED ON 378 COLUMNS AND WAS THEREFORE WORTH NOTHING. Every one was real: run it
// and `client_archives.slug` is genuinely written at archive.ts:269 and genuinely never selected. But
// a probe that reports 378 problems reports none, and the honest reading is worse than that: most of
// the 378 are THE SAME BUG this build exists to fix, so an allowlist entry calling them deliberate
// would be a lie in a file whose whole value is that its sentences are true.
//
// So there are two mechanisms, and the difference between them is a decision somebody made:
//
//   SCANNED tables    ZERO TOLERANCE. Every column is read, or dropped, or carries a sentence in
//                     WRITE_ONLY. A table joins this set when its findings have actually been
//                     resolved, which is a commit somebody makes on purpose.
//   everything else   COUNTED against a checked-in baseline. A new dead wire ANYWHERE raises the
//                     count and fails immediately; a fix lowers it. The backlog is printed per lane.
//
// ‼️ THE RATCHET IS WHAT MAKES THIS A STANDING CHECK RATHER THAN A LIST. The doc that commissioned
// this file wanted the curated-20 bug caught "the day selected_at was added". The baseline does that
// for the whole board today, without pretending the board is clean, and it cannot be satisfied by
// deleting the check: the number only goes down.
//
// FUNDING IS NEVER ALLOWLISTED. Matthew, 2026-09-25: "everything regarding funding must be deleted
// from the code, srt agency doesnt do any type of business funding". A funding column is deleted, so
// it leaves the count by leaving the schema.
// ─────────────────────────────────────────────────────────────────────────────

/** The onboarding board and everything it reads. */
const ONBOARDING = new Set([
  "clients", "client_archives", "client_audiences", "client_avatar_runs", "client_datasets",
  "client_delivery_steps", "client_dns_records", "client_docs", "client_events",
  "client_field_proposals", "client_field_values", "client_headlines", "client_hosts",
  "client_keyword_strategy", "client_keywords", "client_messages", "client_offers",
  "client_onboarding_steps", "client_pages", "client_query_state", "client_question_sets",
  "client_replica_pages", "client_url_inventory", "client_weekly_reports", "client_workflow_runs",
  "audience_documents", "avatar_briefs", "competitor_candidates", "dataset_suggestions",
  "harvest_runs", "keyword_clusters", "keyword_decisions", "keyword_runs", "keyword_serp_reads",
  "nap_discrepancies", "page_angles", "page_candidates", "page_dataset", "page_gate_runs",
  "page_magnet_candidates", "page_plan", "page_plan_runs", "page_sources", "page_studio_sessions",
  "policy_documents", "question_bank", "question_set_versions", "review_audit_rows",
  "review_tool_submissions", "time_log",
]);

/**
 * Tables whose dead wires have been resolved, and which must therefore stay clean.
 *
 * ‼️ MEMBERSHIP IS A CLAIM THAT SOMEBODY LOOKED AT EVERY UNREAD COLUMN ON IT. Do not add a table to
 * make a finding go away, and do not remove one to make this probe green: removing a table from this
 * set is how a cleaned lane silently rots back, which is the exact failure this file is about.
 *
 * ‼️ IT IS THE WHOLE ONBOARDING LANE AS OF 2026-09-27, and it is written as `new Set(ONBOARDING)`
 * rather than fifty copied names on purpose. The lane went from 182 unread columns to zero: every one
 * is read, dropped, in WRITE_ONLY with a sentence, or in OWED with what it owes. Re-listing the names
 * here would be a second source of truth for lane membership, and the two would drift the first time a
 * table was added to one and not the other — which would silently un-hold part of the lane.
 *
 * The consequence, which is the point: a NEW unread column on any onboarding table now fails
 * IMMEDIATELY and BY NAME in §5, rather than being counted against a baseline.
 */
const SCANNED = new Set(ONBOARDING);

/**
 * Funding, decommissioned 2026-08-17 and deleted on sight.
 * ‼️ Do not move a table out of here to make this probe green. The fix is deleting the column.
 */
const FUNDING = new Set([
  "deal_submissions", "email_submissions", "email_submission_funders", "statement_drops",
  "standalone_applications", "lenders", "deals", "deal_notes", "deal_events",
]);

/** Lanes that inventory rather than fail. Each entry is a SENTENCE saying why, not a name. */
const LANES_NOT_SCANNED: Record<string, string> = {
  crm: "the CRM and Zoho sync ledger, whose cutover replaced Zoho; those columns describe a system being retired.",
  scraper: "its own lane with its own probes (_probe-scraper, _probe-score, _probe-gbp-audit), which already prove the columns they spend money on.",
  content: "the content and reel lanes are prompt-first, and several of their formats are superseded.",
  medspa: "the med spa pipeline was shut down; its tables are kept for the order history only.",
  trt: "the TRT vertical is a scraper lane with its own rotation tables.",
  sim: "the SMS simulator is a test harness, not a lane anything reads from.",
  sequences: "the email sequence stack is disabled stubs, deliberately left inert rather than deleted.",
  audit: "the audit engine and its funnels have their own probes, and several columns there are tri-state by design.",
  infra: "infrastructure bookkeeping: RLS, roles, guardian runs and webhook ledgers.",
};

function laneOf(table: string): string | null {
  if (ONBOARDING.has(table) || FUNDING.has(table)) return null;
  if (/^(scraper_|raw_leads|sendable_leads|list_pipeline_runs|outreach_|query_index|market_|zip_centroids)/.test(table)) return "scraper";
  if (/^(content_|reel_|pov_|broll_|style_rules|workflows|vertical_formats|verticals|bug_reveal|mascot_|voice_examples|fine_tune|coaching_)/.test(table)) return "content";
  if (/^(med_spa_|medspa_|stripe_events)/.test(table)) return "medspa";
  if (/^trt_/.test(table)) return "trt";
  if (/^sim_/.test(table)) return "sim";
  if (/^(email_sequence|sequence_|sms_|cadence_state|marketing_sends|pending_slack_actions|ig_dm_runs)/.test(table)) return "sequences";
  if (/^(audit_|scan_sessions|niche_briefs|chatgpt_ads_leads|onboarding2_|funnel_relay_sends|attribution_|fanout_|colonies|colony_members|concierge_|lead_magnets|hub_hits)/.test(table)) return "audit";
  if (/^(users|tenants|tasks|ai_decisions|code_|bot_persona|reachinbox_|ext_feedback|dnc_list|crm_sync_state|reference_asks|call_log|in$|above$)/.test(table)) return "infra";
  return "crm";
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. The scan
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whole tables that are written wide and read narrow ON PURPOSE. Each entry is a SENTENCE.
 *
 * ‼️ A TABLE-LEVEL ENTRY, BECAUSE THE DECISION IS ABOUT THE TABLE. `page_dataset` is written with
 * about thirty-seven columns and read with seven (page-corpus.ts:94, dataset-suggestions.ts:176), and
 * thirty separate column sentences would all say the same thing worse. CLAUDE.md says that table "IS
 * read", which is true of the table and not of each column: this probe is the more precise claim, and
 * the table is still the right unit for the exemption.
 *
 * It is the narrowest exemption that is honest. Do NOT add a table here because it has many findings.
 */
const WRITE_ONLY_TABLES: Record<string, string> = {
  page_dataset:
    "a training corpus, written wide and read narrow on purpose. Its rows exist to be studied in bulk rather than queried column by column, and there is no ranking, traffic or citation signal it could be joined to. dataset-spec.ts stays the authority on what any of it means.",
  client_archives:
    "the archive of a deleted client. It is restored by hand with `Import data from duplicate`, so its columns are a record for a person to read rather than inputs this app selects.",
  keyword_runs:
    "the keyword-set archive, snapshotted before `keywords delete all`. It exists to be exported and diffed, and reading a snapshot back in app code is the bug keyword_clusters.missing_pictures records.",
  // ‼️ THE TWIN OF keyword_runs, BUILT IN THE SAME COMMIT AND FOR THE SAME REASON. Exempting one and
  // failing the other would be an accident of which got a sentence first.
  keyword_decisions:
    "one row per approve / drop / add / pick, with the phrase as it was then. keyword-dataset.ts's own header states the purpose in Matthew's words: the keyword history is kept 'to train our own model in the future'. self-review.ts reads `action` and `created_at` to measure the drop rate, which is the page_dataset shape exactly: written wide, read narrow, on purpose.",
  page_plan_runs:
    "what the plan was before a rerun replaced it. proposePreCallPlan deletes every proposed row, so without this the decisions that produced a page body were gone the moment somebody typed `rerun`. Its own header says it is keyword_runs' solution applied to the plan, deliberately, and that it is a research artifact rather than the product.",
  // ‼️ MEASURED, NOT ASSUMED: this table has no `.select()` ANYWHERE in src/. Not a narrow read, none.
  // DATA-AND-WORKFLOWS §5.9 already lists it as a single writer with zero readers.
  client_avatar_runs:
    "the history of which avatar was confirmed, when, and by whom. `clients.primary_avatar` is the CURRENT answer and is read (it is step 7's declared output); this is the trail behind it, and nothing selects a single column of it. Keep it or drop the table, but do not wire a reader to a history row: confirmedAvatarFor() is the one answer.",
  client_messages:
    "the client-draft send ledger, written wide and read narrow. The BODY went to Slack at write time for a person to send by hand, so `body`, `channel`, `recipient`, `vars`, `wa_link` and `slack_ts` are the record of what was drafted rather than inputs anything selects. What IS read is `draft_key`, `generated_at` and `sent_at`, which is what makes `unique (client_id, draft_key)` load-bearing: a step ticked, unticked and re-ticked must not post the same message three times.",
  harvest_runs:
    "a run ledger for the phrase harvest. `id` and `sources` are read; `vertical`, `seed_terms`, `results_count` and `error` are the record of one run. The per-client evidence step 11 is confirmed on is `output_ref`, which its own refusal leads with, precisely because question_bank has no client_id.",
};

/** Individual columns written and never read, ON PURPOSE. Each entry is a SENTENCE, not a name. */
const WRITE_ONLY: Record<string, string> = {
  // Row bookkeeping on the two tables that were cleaned before BOOKKEEPING_NAMES existed. Kept as
  // named entries rather than folded into the rule, because they are also the worked example of what
  // that rule covers.
  "client_audiences.updated_at": "row bookkeeping, written by every update and selected by nothing.",
  "keyword_clusters.updated_at": "row bookkeeping, written by every update and selected by nothing.",
  "keyword_clusters.created_at":
    "row bookkeeping, and it reads as untouched because the column DEFAULT writes it rather than the app.",

  // ── PROVENANCE: the who, beside a flag that IS read ────────────────────────────────────────────
  //
  // ‼️ ENUMERATED, NOT PATTERN-MATCHED, AND THE ENUMERATION IS THE POINT. BOOKKEEPING_NAMES warns
  // against adding `*_by` as a fourth name, and this is why the warning stands: each entry below is an
  // assertion that somebody checked WHICH read flag the column sits beside. A `/_by$/` rule would make
  // that claim automatically and therefore make it worthless. The decision itself is read in every
  // case; what nothing reads is who made it, and no card renders that yet.
  "client_keywords.approved_at": "who/when beside `approved`, which IS read: client-keywords.ts filters `r.approved && !r.dropped`.",
  "client_keywords.approved_by": "who/when beside `approved`, which IS read: client-keywords.ts filters `r.approved && !r.dropped`.",
  "client_keywords.picked_at": "who/when beside `role`, the anchor the ladder picked, which IS read. anchor-ladder.ts writes all three together.",
  "client_keywords.picked_by": "who/when beside `role`, the anchor the ladder picked, which IS read. anchor-ladder.ts writes all three together.",
  "client_headlines.approved_at": "who/when beside `approved`, which IS selected by client-headlines.ts and gates whether a headline can become a page.",
  "client_headlines.approved_by": "who/when beside `approved`, which IS selected by client-headlines.ts and gates whether a headline can become a page.",
  "client_field_proposals.decided_at": "who/when beside `status`, which IS selected and is what the proposal card branches on.",
  "client_field_proposals.decided_by": "who/when beside `status`, which IS selected and is what the proposal card branches on.",
  "dataset_suggestions.decided_at": "who/when beside `status`, which IS selected. dataset_suggestions proposes a field and never declares one.",
  "dataset_suggestions.decided_by": "who/when beside `status`, which IS selected. dataset_suggestions proposes a field and never declares one.",
  "page_angles.decided_at": "who/when beside the angle row itself, which is selected by id and idea.",
  "page_angles.decided_by": "who/when beside the angle row itself, which is selected by id and idea.",
  "page_magnet_candidates.decided_at": "who/when beside `status`, which IS selected alongside title, promise and cta_label.",
  "page_magnet_candidates.decided_by": "who/when beside `status`, which IS selected alongside title, promise and cta_label.",
  "competitor_candidates.selected_by": "who, beside `selected`, which IS read and is step 6's declared output in STEP_PRODUCES.",
  "client_question_sets.approved_by": "who, beside `status` and `approved_at`, both of which ARE selected.",
  "client_keyword_strategy.locked_by": "who, beside the lock itself. isLocked() reads the fingerprint, which is what decides whether the set is frozen.",
  "page_plan.approved_by": "who, beside `status`, which every plan read filters on.",
  "page_gate_runs.run_by": "who ran the gate. assertGatePassed reads the verdict and the body hash, which is what a pass describes.",
  "policy_documents.created_by": "who ingested the document. policy-scan.ts keys idempotency on the content hash, which is the stronger key and the one read.",
  "time_log.logged_by": "who logged the hours. The step is confirmed by counting rows, which is what its verifier reads.",
  "client_delivery_steps.verified_at": "when the evidence was found, beside `verified_source`, which IS read and is what renders the two honest tiers.",
  "client_audiences.confirmed_by": "who, beside `confirmed_at`, which IS read through the COLUMNS list and is what the card branches on.",
  "client_audiences.vocabulary_confirmed_by": "who, beside `vocabulary_confirmed_at`, which IS read and gates whether the vocabulary is usable.",
  "client_audiences.seeded_at": "when the audience was seeded, beside `seeded_from`, which IS read and is the provenance that matters: which preset it came from, not what time.",
  "client_field_values.superseded_by": "the link back to the row this one replaced, held true by a CHECK against `superseded_at`. The live index is what reads supersession.",

  // ── MODEL PROVENANCE: which model produced the row ────────────────────────────────────────────
  "page_angles.model": "which model wrote the angle. Recorded so a bad batch can be traced to a model, not read by anything that branches.",
  "page_magnet_candidates.model": "which model wrote the magnet candidate. Same trace-only purpose as page_angles.model.",
  "page_gate_runs.model": "which model did the read-through. A failed model read is a SKIP by design, so nothing branches on which one it was.",
  "keyword_serp_reads.model": "which model read the SERP. bestVerdict() decides on `source` and recency, never on the model name.",
  "keyword_serp_reads.actor": "who or what filed the reading. bestVerdict() prefers a typed correction by `source`, which is the field that carries that meaning.",
  "keyword_serp_reads.confidence": "the vision pass's own confidence. Deliberately not a gate: a low-confidence reading is still a reading, and `source` plus doc_id is what makes one authoritative.",

  // ── SUPERSEDED: a newer column or table carries the decision now ───────────────────────────────
  "client_keywords.serp_verdict":
    "‼️ A TRAP, NOT A CACHE. keyword-strategy.ts:198 says it in capitals: this column 'was a bug wearing a cache', because recordVerdict overwrote it on EVERY reading regardless of source, so a re-run of the vision pass silently replaced a correction a person had typed. attachReadings() now merges from keyword_serp_reads through bestVerdict(). NOBODY MAY READ THIS COLUMN AGAIN. It is still written, so it is available to be dropped once a deploy that stops writing it has landed.",
  "client_keywords.serp_checked_at":
    "the timestamp half of serp_verdict above, and the same trap. keyword_serp_reads.created_at is the honest answer to when a phrase was last looked at.",
  "page_candidates.selected_at":
    "superseded by the page_plan table on 2026-09-11, whose migration states the reason: page_candidates is REGENERATED and pruned, so 'a decision stored on a candidate row is a decision the next re-run deletes'. docs/2026-08-22-prepare-steps.sql:155 records that the upsert deliberately stops touching it. Nothing writes it and nothing reads it.",
  "page_candidates.selected_by": "the who half of page_candidates.selected_at above, superseded by page_plan for the same stated reason.",
  "page_plan.secondary_keyword_ids":
    "the id form of page_plan.secondary_keywords, which IS read and whose comment says each phrase is stored 'verbatim from an approved client_keywords row'. Storing ids instead is exactly what client_pages.question refuses: a reference into a regenerated table lets a re-run turn an approved plan into a different page.",

  // ── THE COLONY / FANOUT LANE, on tables that are otherwise live ───────────────────────────────
  //
  // ‼️ THE TABLES ARE IN AWAITING_CODE; THESE ARE THE SAME UNMERGED LANE REACHING INTO LIVE TABLES,
  // which is why they cannot be exempted at the table level. Same rule: do not drop them to tidy up.
  "page_candidates.colony_id": "the colony / fanout lane, whose code is not on main. See AWAITING_CODE for client_query_state.",
  "page_candidates.query_id": "the colony / fanout lane, whose code is not on main. See AWAITING_CODE for client_query_state.",
  "page_candidates.source_step": "same unmerged lane, added by docs/2026-08-31-colony-and-fanout.sql:192 alongside colony_id and query_id.",
  "page_candidates.quotable_format": "same unmerged lane, added by docs/2026-08-31-colony-and-fanout.sql:193 alongside source_step.",

  // ── A COPY OF A DECISION THAT IS READ ON ITS OWN TABLE ────────────────────────────────────────
  "page_plan.page_kind": "the plan's copy of keyword_clusters.page_kind, which IS read by strategyView. The cluster is where the service-page-or-post decision is made and read.",
  "page_plan.angle_id": "which angle the plan was built from. page_angles is read by id and idea when the angle itself is rendered; the plan reads its own target_keyword and working_title.",
  "page_plan.cluster_id": "which cluster the plan came from. client_keywords.cluster_id carries the same link on the side that is read, and the plan stores its keyword verbatim rather than by reference for the client_pages.question reason.",
  "page_magnet_candidates.angle_id": "which angle the magnet was built from, beside `plan_id`, which IS selected.",
  "page_magnet_candidates.post_format":
    "the magnet candidate's copy of the post format. page_angles.post_format IS read (it is in the angle select list), which is where the format axis is decided.",
  "page_candidates.question_bank_id": "the harvested phrase this candidate came from. question_bank has no client_id, so `question` is stored verbatim on the candidate and that is what every reader selects.",
  "page_candidates.derived_from":
    "for a derived row, what it was built out of, in words, per its column comment. `origin` is the field that IS read, and the honest distinction it carries (harvested = a phrase a buyer typed, derived = an idea this system assembled) is what stops a derived idea collecting the visibility-gap bonus.",
  "page_candidates.avatar":
    "deliberately left NULL, and the reason is about the corpus rather than the column. The honest per-row tag is question_bank.avatar, which records which buyer a phrase was harvested FOR and is null on every row written before an avatar could be confirmed. Stamping the client's current avatar onto rows harvested before anybody chose it is inventing the tag and then treating it as evidence.",
  "client_pages.scope": "the page's scope. The hub reads a page by slug and host; scope is carried for the magnet lane's three-scope model and nothing branches on it here.",
  "client_pages.source_report_id": "which audit report the question came from. `question` is stored VERBATIM precisely so a regenerated audit cannot turn a published page into the answer to a question nobody asked, which is what makes the reference redundant.",
  "client_keywords.audience": "which buyer the phrase was collected for. The audience model is keyed through client_audiences and audience_id; this is the earlier free-text form.",
  "client_field_proposals.slack_channel": "where the proposal card posted. The thread is resolved from the step anchor, which is what every later reply is keyed to.",
  "competitor_candidates.place_id": "the Google place id, kept so a candidate can be re-resolved by hand. The shortlist is decided on `name`, `times_named` and `selected`, all of which are read.",
  "client_headlines.awareness_entry":
    "‼️ THE SAME SHAPE AS keyword_clusters.awareness_entry, one table over. client-headlines.ts:831 updates the pair and nothing selects it back, so a stored awareness decision and whatever the reader recomputes can disagree with nothing saying which is on screen. Left as a named finding rather than fixed in this pass: the keyword_clusters instance is the one a person reads on a card.",
  "client_headlines.awareness_target": "the target half of client_headlines.awareness_entry above, and the same finding.",

  // ── CAPTURED ON PURPOSE, AND ROUTING IT WOULD BE THE BUG ──────────────────────────────────────
  "review_tool_submissions.rating":
    "‼️ CAPTURED, NEVER ROUTED, AND A PROBE ENFORCES IT. Its own column comment says so, and scripts/_probe-review-gating.ts fails the build if any code path branches on this value: a tool that shows the public link to happy customers and a private box to unhappy ones is the gating funnel this feature refuses to be. An unread column here is the feature working.",
  "review_tool_submissions.private_note":
    "offered to EVERY rating and never posted anywhere, per its column comment. Reading it to decide anything would rebuild the gating funnel rating refuses.",
  "review_tool_submissions.attested_at":
    "when she confirmed the words are her own. Its comment says it gates the Copy button and nothing else, and that gate runs in the browser before the row exists; the column is the evidence afterwards.",
  "review_tool_submissions.posted_destination": "which destination she said she posted to, self-reported. Nothing verifies or branches on it: no code path can observe a Google review being published.",
  "review_tool_submissions.question_set_version": "which wording she answered, so a later reading of the corpus knows what was asked. The answers themselves are what the tool reads back.",

  // ── WRITTEN FOR THE RECORD, READ BY A PERSON ───────────────────────────────────────────────────
  "client_pages.section_keywords":
    "per-H2 long-tail phrases. Its comment states where they go: copied into the page_dataset corpus snapshot and passed to the body prompt as 'what the reader typed to get here'. It also states the negative, which is the part worth keeping: NOT read by keyword-placement.ts.",
  "client_events.payload": "the event's detail, for a person reading the timeline. client_events.ts's rule is that the event is a record and never an input.",
  "client_datasets.params": "what the dataset build was asked for. client_datasets is a CACHE that REPLACES on conflict, so it structurally cannot answer 'what changed since last week' and nothing tries.",
  "client_workflow_runs.inputs": "what a workflow run was given, for a person reconstructing a run. The run's product is the artifact it wrote.",
  "client_workflow_runs.slack_ts": "where the run posted. The step's own anchor is what every later post is threaded under.",
  "client_weekly_reports.body": "the rendered report. Step 32 is a predicate about ongoing behaviour and is confirmed by COUNTING these rows, which is what its verifier reads.",
  "client_weekly_reports.posted_at": "when the report went out, beside the row whose existence is the evidence step 32 counts.",
  "client_delivery_steps.note": "free text about one step, for a person reading the board. The tick is decided by verifyStep, never by a note.",
  "client_onboarding_steps.note": "free text on the eight client-facing pilot stages, same shape as client_delivery_steps.note.",
  "client_docs.step_id": "the step row a document was filed against. uploadsFor resolves documents by `delivery_step_key` and the thread they were dropped in, which is the lookup that was broken once and fixed by keying on the anchor.",
  "client_docs.web_url": "the OneDrive link. The board links documents through docLink, which composes from the stored path rather than trusting a URL that expires.",
  "review_audit_rows.source": "where a competitor's review count was read from, kept so a number on the findings document can be traced. The counts are what §3 renders.",
  "page_studio_sessions.claimed_at": "when a digit claimed a candidate. The claim itself is `page_id` being set, which is what the studio reads to decide whether a bare digit is a claim or something he said about the page.",
  "question_set_versions.frozen_at": "when the tracked set was frozen. The freeze is the version row existing, which is what composeTrackedSet reads.",
  "question_set_versions.materialization": "which substitution ruleset rendered this version, per its comment: changing a rule starts materialization_v2. It labels the row for a reader rather than selecting behaviour.",
  "question_set_versions.note": "free text on why a version was cut.",
  "question_bank.speaker": "who said the phrase, where the harvest could tell. The phrase itself and its scores are what the question set is built from.",
  "question_bank.excluded_reason": "why a harvested phrase was held back. question_bank has no client_id and is shared across every client in a vertical, so this is a note on the corpus rather than a per-client decision.",
  "client_field_values.extracted_confidence": "the extractor's own confidence. Its sibling comment on confirmed_by states the rule that makes this unreadable by design: there is no unconfirmed value in this table, because a low-confidence extraction is shown as a question on the proposal card and never written as a value.",
  "client_field_values.origin": "how the value arrived. The proposal card is the only writer and every row it writes is confirmed, so nothing downstream branches on origin.",
  "client_question_sets.composition": "how the tracked set was composed, kept beside the questions themselves. `questions`, `version` and `status` are what is read.",
  "client_question_sets.sources": "which corpora fed the set. Same record-not-input rule as composition above.",
  "client_keyword_strategy.summary": "the strategy as prose, for a person. The clusters and the lock are what code reads.",

  // ── THE CLIENT ROW ─────────────────────────────────────────────────────────────────────────────
  "clients.market_conflict_with":
    "which subscription a market overlap was against. The market check is FLAGS, NEVER BLOCKS, so `market_conflict` is the boolean the board renders and this is the pointer behind it.",
  "clients.market_locked_at": "when the market centre was locked. `market_center_lat`/`lng` and market_conflict are what the overlap check reads.",
  "clients.onboarding_token_expires_at": "when the /onboarding link stops working. The token itself is what the route resolves, and an expired token fails on the lookup.",
  "clients.pilot_started_at":
    "when the pilot began. Deliberately NOT the measurement anchor: day 0 is day_zero_archive's completed_at, falling back to intake_completed_at and SAYING SO in the reminder, because the archive is what the day 30/60/90 numbers are measured against.",
  "clients.testimonial_disclosure_required":
    "whether a testimonial needs a disclosure line. It is carried through archive and restore and nothing branches on it; the AI Referral Engine's standing rule is stronger than a flag, since it never generates review content at all.",
};

/**
 * Row bookkeeping, exempted by EXACT column name.
 *
 * ‼️ THIS REVERSES A DELIBERATE DECISION, AND THE REASONING THAT WAS REVERSED IS WHY IT IS SAFE. The
 * three entries above carried the note "naming them individually rather than exempting the pattern, so
 * a `*_at` column that IS a decision cannot hide behind the convention." That objection is exactly
 * right about a PATTERN — `/_at$/` would have swallowed `approved_at`, `decided_at`, `verified_at`,
 * `selected_at` and `confirmed_at`, every one of which is a decision somebody recorded and the precise
 * shape of the curated-20 bug.
 *
 * It is not an argument against an EXACT-NAME allowlist of three. `created_at`, `updated_at` and `id`
 * mean the same thing on all fifty tables in this lane: the DEFAULT writes them, not the app, and they
 * exist for a person reading the table in the console. No decision has ever been recorded under one of
 * those three names, and §4b asserts the set never grows past them, so a decision column CANNOT hide
 * here — which is a stronger guarantee than a convention that relies on somebody noticing.
 *
 * The alternative was ~40 entries reading "row bookkeeping, written by every update and selected by
 * nothing", which is the same sentence forty times and buries the entries that say something.
 *
 * ‼️ DO NOT ADD A FOURTH NAME. Every candidate (`*_at`, `*_by`, `note`, `payload`, `model`) is a place
 * a decision or an input gets recorded. If a fourth ever looks justified, that is the signal to write a
 * named WRITE_ONLY entry instead.
 */
const BOOKKEEPING_NAMES = new Set(["created_at", "updated_at", "id"]);

/**
 * Tables whose storage is on main and whose CODE IS NOT.
 *
 * ‼️ A FOURTH CATEGORY, AND COLLAPSING IT INTO ANY OF THE OTHER THREE WOULD BE A LIE. These are not
 * write-only (nothing writes them at all), not dead DDL to drop (the code that fills them exists, on
 * another branch), and not per-column deferrals (the unit is the whole table). The colony / fanout gap
 * map was migrated on 2026-08-31 and its lane has never been merged, which is recorded in memory as
 * "tables in prod DB; code NOT on main".
 *
 * ‼️ DROPPING THESE IS THE EXPENSIVE MISTAKE, and it is the one a column scan invites: every column
 * reads as never_touched, which looks exactly like dead DDL. Dropping them breaks the market-dataset
 * branch the day it lands, and the evidence that they are wanted is not in this repo's main branch at
 * all. The only thing keeping them visible is this entry.
 *
 * They are reachable dynamically today, through `CLIENT_TABLES` in src/lib/clients/archive.ts, which
 * does `.from(table)` on a runtime string — so archive and restore already copy them, and that is
 * table-agnostic plumbing rather than a consumer. It is why the scan cannot see a reader.
 *
 * An entry here is a CLAIM THAT THE CODE IS COMING. If a lane is abandoned, drop the tables instead.
 */
const AWAITING_CODE: Record<string, string> = {
  client_query_state:
    "the per-client gap map from docs/2026-08-31-colony-and-fanout.sql (`matched_url` / `title_match` are the video's layer 1 and layer 2). Nothing in src/ touches it: the colony / fanout lane's code is not on main. Drop it only if that lane is abandoned.",
  client_url_inventory:
    "the client's own pages, so a fanout query can be matched against what already exists. Same unmerged lane as client_query_state, same reason it reads as dead DDL.",
};

/**
 * Findings that are REAL, understood, and deliberately not fixed yet. Each entry says what is owed.
 *
 * ‼️ A THIRD CATEGORY, BECAUSE THE OTHER TWO WOULD BOTH BE LIES. WRITE_ONLY means "somebody decided
 * this is fine for ever", and none of these are fine: they are the same bug class this build fixed
 * five instances of. Leaving them in the fail tier makes the probe red for ever, which is how a check
 * gets ignored. So they are enumerated, counted, printed, and NOT failed.
 *
 * The difference from WRITE_ONLY is the sentence: one records an approval, this records a deferral.
 * A NEW dead wire is in neither map and still fails, which is the property that matters.
 */
const OWED: Record<string, string> = {
  // ── avatar_briefs: the shared-preset nouns ────────────────────────────────
  // Six copies of nouns `client_audiences` owns and reads through its COLUMNS list. They were
  // migrated for a per-vertical inheritance path, were never seeded by the migration's own update,
  // and are NULL on every row. A drop is the likely answer and it is Matthew's call, not this
  // build's: the alternative is seeding them and having avatarBriefFor feed seedClientAudience.
  "avatar_briefs.buyer_noun_singular": "shared-preset noun, never seeded and never read. Drop or seed: Matthew's call.",
  "avatar_briefs.buyer_noun_plural": "shared-preset noun, never seeded and never read. Drop or seed: Matthew's call.",
  "avatar_briefs.offer_noun_singular": "shared-preset noun, never seeded and never read. Drop or seed: Matthew's call.",
  "avatar_briefs.offer_noun_plural": "shared-preset noun, never seeded and never read. Drop or seed: Matthew's call.",
  "avatar_briefs.business_noun": "shared-preset noun, never seeded and never read. Drop or seed: Matthew's call.",
  "avatar_briefs.visit_noun": "shared-preset noun, never seeded and never read. Drop or seed: Matthew's call.",

  // ── the WHO beside a WHEN that is read ────────────────────────────────────
  //
  // ‼️ MOVED TO WRITE_ONLY ON 2026-09-27, AND THE MOVE IS THE DECISION THE PROMPT ASKED FOR. These
  // three sat here reading "owed the same provenance line", i.e. owed a rendering on a card. That is a
  // product decision somebody may or may not ever want, not a bug, and an OWED entry is a promise that
  // the code is coming. Audit provenance is the same class as the ~25 `*_by` columns the onboarding
  // sweep enumerated in WRITE_ONLY: the decision itself is read in every case, and who made it is kept
  // so a person can ask later. They are in WRITE_ONLY now, with the same sentence shape.
  //
  // ── keyword_clusters: WIRED, so these four are gone from this list ────────
  //
  // ‼️ THE FOUR keyword_clusters ENTRIES WERE RESOLVED RATHER THAN RE-WORDED, and what they said is
  // worth keeping because it is the subtlest shape this file recorded: the card DID print a rationale
  // and an awareness pair, from the recomputed ProposedCluster off clusterFinalists, never from the
  // stored row. So the information was on screen and the columns were dead, and the two could disagree
  // with nothing saying which you were looking at. `strategyLines` now prefers the stored values and
  // compares `offer_fingerprint` against the offer the card is being drawn against, printing the
  // disagreement rather than silently correcting it. Wiring `offer_fingerprint` was load-bearing, not
  // a bonus: reading the stored values WITHOUT it would have made the card more wrong than recomputing,
  // because a stale decision shown with no warning is worse than a fresh derivation.

  // ── THE AUDIENCE COLUMNS, WHICH LANDED BEFORE THEIR CODE ON PURPOSE ───────────────────────────
  //
  // ‼️ OWED RATHER THAN WRITE_ONLY, BECAUSE THE MIGRATION SAYS SO IN ADVANCE.
  // docs/2026-09-24-audience-on-pages.sql is explicit on all three points that decide the tier:
  // "RUN THIS BEFORE THE CODE THAT SELECTS THESE COLUMNS DEPLOYS, NOT AFTER", because PostgREST fails
  // the WHOLE select on one unknown column and hub/pages.ts builds its read as a single string
  // literal, so deploying first 500s every hub page. "NULLABLE, AND EVERY EXISTING ROW STAYS NULL",
  // because backfilling to the client's current primary audience would be inventing which buyer a page
  // written weeks ago was aimed at and then treating that invention as evidence. And the composite
  // foreign key exists so a row carrying both ids can never name another client's audience.
  //
  // So these are not columns somebody forgot to read. They are the schema half of a change whose code
  // half is owed, and a null means "nobody recorded it", which is the truth about every row today.
  // ‼️ A FAILURE NOBODY CAN SEE IS THE ONE FINDING ON THIS TABLE THAT COSTS SOMEBODY AN AFTERNOON.
  // pre-call-pages.ts:578 records why a draft failed and releases the lease; nothing selects it back,
  // so the page simply has no draft and the reason is in a column. The `draftError` in hub-form.tsx is
  // local React state for a different thing, which is what makes this look wired when it is not.
  "page_plan.draft_error": "a failed draft's reason, written and never surfaced. Owed a line on the step card, beside the page it failed to draft.",
  // ‼️ FUNDING, ON THE AEO CLIENT ROW. Dropped by the funding decommission rather than excused: Matthew
  // 2026-09-27, "my onboarding for AEO has nothing to do with funding so make sure they dont even see
  // each other". It carries no foreign key (docs/2026-08-17-crm-core.sql:134 says so deliberately), so
  // the drop is a column drop and nothing cascades.
  "clients.deal_id": "a funding deal link on the AEO client row. Owed its drop, in the funding decommission SQL.",
  "client_pages.audience_id": "which buyer a page is aimed at. Owed its writer: the migration deliberately landed first so the reader could not 500 the hub on deploy.",
  "client_headlines.audience_id": "which buyer a headline is aimed at, from the same audience model. Owed the same writer.",
  "page_magnet_candidates.audience_id": "which buyer a magnet is aimed at, from the same audience model. Owed the same writer.",
};

/**
 * Columns whose only read is through a runtime string, so no static scan can see it.
 * ‼️ A NAMED EXCEPTION WITH A SENTENCE, never a blanket rule about dynamic selects.
 */
const READ_DYNAMICALLY: Record<string, string> = {
  "page_dataset.magnet_candidates":
    "page-dataset.ts reads it through readOne(table, column), whose column argument is a runtime string.",
};

/**
 * How many unread columns the rest of the board carried when this was last measured.
 *
 * ‼️ A RATCHET, AND IT MAY ONLY EVER GO DOWN. Raise it and the next dead wire is invisible, which is
 * the whole bug. Lower it when a lane is cleaned, and move that table into SCANNED so the zero it
 * reached is held.
 *
 * Measured 2026-09-27 on feat/keyword-decisions. It was 957. The onboarding lane went from 182 unread
 * columns to ZERO and is now held by SCANNED; the row-bookkeeping rule, four write-only ledgers, two
 * tables whose code is not on main and one false positive in the `.or()` filter parser account for the
 * rest. 293 columns, and not one of them was fixed by raising a number.
 *
 * ‼️ AND IT IS NO LONGER THE AUTHORITY, `UNREAD_COLUMNS` IS. A count going up by one told you a dead
 * wire had arrived and nothing about WHICH, so the only way to find it was to bisect. The list names
 * every one of them, so a new column fails by name and with the migration that declared it. This
 * number is kept because it is the thing a person reads, and §6c asserts the two cannot disagree.
 */
const BOARD_BASELINE = 664;

type Verdict = "write_only" | "never_touched";
interface Finding {
  key: string;
  verdict: Verdict;
  files: string;
  lane: string;
}

const gated: Finding[] = [];
const counted: Finding[] = [];
const owed: Finding[] = [];

const bookkeepingExempt: string[] = [];

for (const [key, d] of DECLARED) {
  if (WRITE_ONLY_TABLES[d.table] || WRITE_ONLY[key] || READ_DYNAMICALLY[key]) continue;
  if (isRead(d.table, d.column)) continue;
  if (AWAITING_CODE[d.table]) continue;
  if (BOOKKEEPING_NAMES.has(d.column)) {
    bookkeepingExempt.push(key);
    continue;
  }

  const f: Finding = {
    key,
    verdict: isWritten(d.table, d.column) ? "write_only" : "never_touched",
    files: [...d.files].join(", "),
    lane: laneOf(d.table) ?? (FUNDING.has(d.table) ? "funding" : "onboarding"),
  };
  if (OWED[key]) owed.push(f);
  else if (SCANNED.has(d.table)) gated.push(f);
  else counted.push(f);
}

const byKey = (a: Finding, b: Finding): number => a.key.localeCompare(b.key);

// ─────────────────────────────────────────────────────────────────────────────
// 4b. The bookkeeping rule stays narrow, and the unshipped lanes stay visible
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n4b. ${bookkeepingExempt.length} row-bookkeeping column(s) exempted by exact name`);

// ‼️ THE RULE IS ASSERTED, NOT TRUSTED. A pattern like /_at$/ would swallow approved_at, decided_at,
// verified_at and selected_at, every one of which is a decision somebody recorded and the exact shape
// of the curated-20 bug. This proves the exemption never reached a name outside the three.
const strayBookkeeping = bookkeepingExempt.filter((k) => !BOOKKEEPING_NAMES.has(k.split(".").slice(-1)[0] ?? ""));
check(
  `the bookkeeping exemption only ever covers ${[...BOOKKEEPING_NAMES].join(", ")}`,
  strayBookkeeping.length === 0,
  `it also exempted ${strayBookkeeping.join(", ")}, which is a decision hiding behind a convention`
);
check(
  "the bookkeeping rule has not been widened",
  BOOKKEEPING_NAMES.size === 3,
  "a fourth name was added. Every candidate is a place a decision gets recorded: write a named WRITE_ONLY entry instead."
);
if (SHOW_INVENTORY) for (const k of bookkeepingExempt.sort()) console.log(`          ${k}`);

for (const [table, why] of Object.entries(AWAITING_CODE)) {
  // ‼️ NOT SILENT. These read as dead DDL to any column scan, so the one thing that must never happen
  // is them passing without being named: that is how somebody drops them next quarter.
  console.log(`  --    ${table}: storage on main, code is not. ${why}`);
  const stillDeclared = [...DECLARED.values()].some((d) => d.table === table);
  check(`${table} still exists to be filled`, stillDeclared, "the table is gone: remove the AWAITING_CODE entry");
}

console.log(`\n5. the ${SCANNED.size} cleaned tables stay clean`);

// ‼️ TWO WORDINGS, BECAUSE THEY SEND YOU SOMEWHERE ELSE. A write-only column needs a READER. A column
// nothing writes either is DDL that was migrated and never wired at all, and needs a WRITER or a
// drop. The scan doc called `avatar_briefs.keyword_categories` write-only and was wrong, so a fix
// aimed at "find who writes it" would have looked for a writer that never existed.
for (const f of gated.sort(byKey)) {
  if (f.verdict === "write_only") {
    check(`${f.key} is read back by something`, false, `written and never read: wire it, drop it, or give it a sentence in WRITE_ONLY. ${f.files}`);
  } else {
    check(`${f.key} is wired to anything at all`, false, `no writer and no reader: dead DDL. ${f.files}`);
  }
}
if (gated.length === 0) console.log(`  ok    every column on ${[...SCANNED].join(", ")} is read, dropped, or has a sentence`);

// ‼️ PRINTED EVERY RUN, NOT HIDDEN BEHIND --inventory. An OWED entry is a finding somebody chose not
// to fix, and the whole reason it is allowed to exist is that it stays visible. A deferral nobody sees
// again is the same as the bug.
console.log(`
5b. known and owed on the cleaned tables (${owed.length}), not failed`);
for (const f of owed.sort(byKey)) console.log(`  --    ${f.key}: ${OWED[f.key]}`);

// An OWED entry for a column that is now read, or that no longer exists, is stale bookkeeping. It
// would quietly excuse a future regression of the same name.
for (const key of Object.keys(OWED)) {
  const d = DECLARED.get(key);
  const stale = !d ? "that column no longer exists" : isRead(d.table, d.column) ? "it is read now" : "";
  check(`OWED still describes a real finding: ${key}`, stale === "", `${stale}: remove the OWED entry`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. The rest of the board, counted
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n6. the rest of the board, against the baseline");

const perLane = new Map<string, Finding[]>();
for (const f of counted) {
  const list = perLane.get(f.lane) ?? [];
  list.push(f);
  perLane.set(f.lane, list);
}
for (const lane of [...perLane.keys()].sort()) {
  const list = perLane.get(lane) ?? [];
  const why = LANES_NOT_SCANNED[lane];
  console.log(`  --    ${lane}: ${list.length} unread column(s).${why ? ` ${why}` : ""}`);
  if (SHOW_INVENTORY) {
    for (const x of list.sort(byKey)) console.log(`          ${x.key} (${x.verdict})`);
  }
}

check(
  `the board's unread-column count has not grown (${counted.length} against a baseline of ${BOARD_BASELINE})`,
  counted.length <= BOARD_BASELINE,
  `${counted.length - BOARD_BASELINE} new dead wire(s). Wire the column, drop it, or give it a sentence. ` +
    "Do NOT raise BOARD_BASELINE: that is how the next one becomes invisible."
);
if (counted.length < BOARD_BASELINE) {
  console.log(`  --    ${BOARD_BASELINE - counted.length} fewer than the baseline. Lower BOARD_BASELINE to ${counted.length}.`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 6c. A LIST, NOT A LOWER NUMBER
//
// ‼️ THE COUNT ABOVE CANNOT NAME THE COLUMN THAT BROKE IT, AND THAT WAS THE WHOLE COMPLAINT. A new
// column on a SCANNED table already fails by name, in §5. A new column anywhere else raised
// BOARD_BASELINE by one and the probe said only "the count grew", so finding it meant bisecting the
// migrations by hand. Diffed against a checked-in list of the keys instead, the failure says which
// column, and `files` already carries the migration that declared it, so it says that too.
//
// ‼️ A LIST, NOT A LOWER NUMBER. The point is not to make the list short. 957 keys is the backlog as
// measured; shrinking it is W4's job, one lane at a time, and every reduction is locked in by
// regenerating this file. Do not fix columns to make the list look better.
//
// ‼️ A MODULE, NOT A TEXT FILE, AND THAT IS DELIBERATE. A diffed .txt would have to normalise line
// endings or this check would cry wolf on every Windows checkout, which is exactly what happened to
// `_step-wiring.ts --check` and cost it a `sameText` helper. An imported module has no line endings to
// disagree about. It also gets typechecked by the same CI step that typechecks everything else, and it
// sits in scripts/ rather than src/ so it never reaches the app bundle.
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n6c. every unread column is named, so a new one fails by name");

const countedKeys = new Set(counted.map((f) => f.key));
const declaredUnread = new Set(UNREAD_COLUMNS);

const arrived = counted.filter((f) => !declaredUnread.has(f.key)).sort(byKey);
const resolvedKeys = UNREAD_COLUMNS.filter((k) => !countedKeys.has(k));

if (WRITE_BASELINE) {
  // ‼️ REFUSES TO WRITE AN EMPTY LIST. A parse that silently collected nothing would otherwise write a
  // file asserting the board has no dead wires at all, and every real one would then be invisible
  // until somebody noticed the file was 0 lines long. Same guard refresh-disposable-domains.ts carries.
  if (!counted.length) throw new Error("refusing to write an empty baseline: the census collected nothing");
  const body = [
    "// GENERATED FILE. Do not edit by hand.",
    "//",
    "// Every column the board writes that nothing reads back, outside the SCANNED tables and the",
    "// WRITE_ONLY / OWED / READ_DYNAMICALLY declarations. _probe-dead-wires.ts diffs against this, so a",
    "// column added by a migration and read by nothing fails BY NAME and names its own migration.",
    "//",
    "// ‼️ IT MAY ONLY GET SHORTER. Regenerate: bun run scripts/_probe-dead-wires.ts --write",
    `// Columns: ${counted.length}`,
    "",
    "export const UNREAD_COLUMNS: readonly string[] = [",
    ...counted
      .map((f) => f.key)
      .sort((a, b) => a.localeCompare(b))
      .map((k) => `  ${JSON.stringify(k)},`),
    "];",
    "",
  ].join("\n");
  writeFileSync("scripts/_dead-wires-baseline.ts", body);
  console.log(`  --    wrote scripts/_dead-wires-baseline.ts with ${counted.length} column(s)`);
  if (counted.length !== BOARD_BASELINE) {
    console.log(`  --    now set BOARD_BASELINE to ${counted.length} (it is ${BOARD_BASELINE})`);
  }
}

// ‼️ THE DIFF IS SKIPPED ON A --write RUN, AND ONLY THERE. The module was imported before the file was
// rewritten, so `UNREAD_COLUMNS` in memory is the list that was just REPLACED: diffing against it would
// report all 957 as new on the bootstrap run and every deliberately resolved column as a failure on
// every later one. A regeneration reports what it wrote; the next ordinary run is what judges it.
if (WRITE_BASELINE) {
  console.log("  --    diff skipped: --write replaced the list this run compared against. Re-run without --write.");
}

// ‼️ ONE FAILURE PER COLUMN, BY NAME, WITH ITS MIGRATION. The whole value of this check is the last
// part: "the count grew" makes somebody bisect, "these two columns, added by docs/2026-10-xx-foo.sql,
// are read by nothing" does not.
for (const f of WRITE_BASELINE ? [] : arrived) {
  check(
    `${f.key} is read by something, or declared`,
    false,
    `NEW unread column. ${f.verdict === "write_only" ? "Written and never read" : "No writer and no reader"}. ` +
      `Declared in ${f.files}. Wire it, drop it, or give it a sentence in WRITE_ONLY or OWED. ` +
      "Do NOT add it to _dead-wires-baseline.ts to make this pass."
  );
}
if (!WRITE_BASELINE) {
  check(`no unread column arrived unnamed (${counted.length} counted, ${UNREAD_COLUMNS.length} declared)`, arrived.length === 0);
}

// ‼️ A RESOLVED COLUMN FAILS TOO, AND THAT IS THE RATCHET RATHER THAN A NUISANCE. The list may only get
// shorter, and a gain that is not written down is a gain the next change can silently undo. This is the
// same discipline `--check` applies to the generated docs: the fix is one command, and it is a commit
// somebody makes on purpose.
if (resolvedKeys.length && !WRITE_BASELINE) {
  console.log(`  --    ${resolvedKeys.length} column(s) in the list are no longer unread:`);
  for (const k of resolvedKeys.slice(0, 40)) console.log(`          ${k}`);
  if (resolvedKeys.length > 40) console.log(`          ... and ${resolvedKeys.length - 40} more`);
}
if (!WRITE_BASELINE) {
  check(
    "the named list is current",
    resolvedKeys.length === 0,
    `${resolvedKeys.length} column(s) were resolved. Lock it in: bun run scripts/_probe-dead-wires.ts --write, ` +
      `and lower BOARD_BASELINE to ${counted.length}.`
  );
}

// ‼️ ONE FACT, TWO RENDERINGS, AND THEY CANNOT DRIFT. The count is what a person reads and the list is
// what the check uses, so a baseline lowered without regenerating the list (or the reverse) would leave
// the probe asserting two different things about the same board.
if (!WRITE_BASELINE) {
  check(
    `BOARD_BASELINE matches the named list (${BOARD_BASELINE} against ${UNREAD_COLUMNS.length})`,
    BOARD_BASELINE === UNREAD_COLUMNS.length,
    "the count and the list disagree. Regenerate the list with --write and set BOARD_BASELINE to its length."
  );
}

// ‼️ FUNDING IS CALLED OUT SEPARATELY RATHER THAN LEFT IN A LANE TOTAL, because it is the one lane
// whose columns are being DELETED rather than triaged, so its count is work owed rather than a
// backlog being tolerated.
/** Funding vocabulary. Deliberately narrow: these are the words no AEO feature has any reason to use. */
const FUNDING_WORDS = /factor_rate|underwriting|\blenders?\b|buy_rate|sell_rate|statement_months|positions_funded|repayment_frequency/i;

/**
 * Unread funding columns still declared, measured 2026-09-25.
 *
 * ‼️ ITS OWN RATCHET, SEPARATE FROM THE BOARD'S, and it may only go DOWN. Matthew's standing rule is
 * that funding code is deleted rather than excused, so no funding column may be ADDED, and none of
 * these may be moved into WRITE_ONLY or OWED: neither of those is available to a lane that should not
 * exist. Failing on all 116 today would hold this probe red for work that is deliberately a separate
 * sweep, and a check that is always red is a check nobody reads.
 *
 * ‼️ ALL EIGHT TABLES ARE WHOLLY FUNDING, which is the finding worth acting on rather than the count:
 * standalone_applications, deal_submissions, statement_drops, lenders, email_submissions,
 * email_submission_funders, deals, deal_events. Dropping 116 individual columns would leave eight
 * crippled tables, so the real question is whether the funding HISTORY is archived and the tables
 * dropped. That is Matthew's call, not this probe's.
 */
const FUNDING_BASELINE = 116;

const fundingCols = counted.filter((f) => f.lane === "funding");
console.log(`\n6b. funding: SRT does no business funding. ${fundingCols.length} unread funding column(s) still declared.`);
if (SHOW_INVENTORY) for (const f of fundingCols.sort(byKey)) console.log(`          ${f.key}`);
check(
  `no funding column was added (${fundingCols.length} against a baseline of ${FUNDING_BASELINE})`,
  fundingCols.length <= FUNDING_BASELINE,
  "SRT does no business funding. Delete the column rather than declaring it, and never allowlist one."
);

// ‼️ THE OUTSTANDING FUNDING SWEEP, PRINTED ONCE SO ITS SIZE IS ON THE RECORD. The standing rule is
// that funding code is deleted, not excused. The funding COLUMNS are in the fail tier above; this
// counts the source that still mentions funding at all, which is a separate and much larger pass.
const fundingFiles = SRC_FILES.filter(([, c]) => FUNDING_WORDS.test(c)).map(([p]) => p);
console.log(`       and ${fundingFiles.length} file(s) under src/ still mention funding at all, which is a separate sweep.`);
if (SHOW_INVENTORY) for (const f of fundingFiles) console.log(`          ${f}`);

// ─────────────────────────────────────────────────────────────────────────────
// 7. A column dropped for being dead stays dropped
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n7. a column dropped for being dead does not come back");

// ‼️ MIRRORS `_probe-serp-gate.ts`'s device check, the precedent this build cites: "a dead column
// that looks like provenance is worse than no column". A string assertion rather than a verdict,
// because the point is that nothing reintroduces the DDL.
// ‼️ COMMENT-STRIPPED, AND THAT IS THE POINT RATHER THAN A CONVENIENCE. The migration now carries a
// tombstone comment saying the column was dropped and why, which is exactly what a reader needs and
// exactly what a raw string test would fail on. _probe-list-prep.ts's normalize() only fixes CRLF and
// its own note records what that costs: an absence check over a commented file tests the prose, not
// the program. This asserts there is no DDL, not that nobody may mention it.
const STRATEGY_SQL = existsSync("docs/2026-09-26-keyword-strategy.sql")
  ? stripSqlComments(readFileSync("docs/2026-09-26-keyword-strategy.sql", "utf8"))
  : "";
check(
  "missing_pictures is gone rather than a cache nothing reads",
  STRATEGY_SQL !== "" && !/\bmissing_pictures\b/.test(STRATEGY_SQL),
  "gateClusters recomputes it every time, and serp-gate.ts refuses to decide a refusal on a cache"
);

// ─────────────────────────────────────────────────────────────────────────────
// 8. Declared outputs have a consumer OUTSIDE the file that writes them
//
// ‼️ THE HALF EVERYTHING ABOVE CANNOT FIND, and the reason this section is the point of the file.
// §5 asks whether any select list names a column. The curated-20 bug PASSES that:
// `client_keywords.selected_at` was written by keyword-decisions.ts and read back by the card in
// keyword-decisions.ts, so a column scan sees a healthy write and a healthy read. The gap was that
// step 21 drew from a different pool, and no amount of column scanning can see that.
//
// So the question changes shape: does the symbol that hands this artifact downstream have a call site
// in a file OTHER than the one that writes it. A reader referenced only by its own writer IS "the card
// that wrote it".
// ─────────────────────────────────────────────────────────────────────────────

console.log("\n8. every declared output has a consumer outside its writer");

const { STEP_PRODUCES, allOutputs, stepsProducingNothing, outputsConsumedTooEarly, fieldsNoStepFills } = await import(
  "../src/lib/clients/step-needs"
);
const { DELIVERY_STEPS } = await import("../src/config/delivery-steps");

check(
  "every step declares what it produces",
  Object.keys(STEP_PRODUCES).length === DELIVERY_STEPS.length,
  `${Object.keys(STEP_PRODUCES).length} declared against ${DELIVERY_STEPS.length} steps`
);

const outputs = allOutputs();
check("outputs were declared at all", outputs.length > 0, "an empty set turns this whole section green");

for (const { step, output } of outputs) {
  const writer = READER_FILES.find(([p]) => p === output.writtenIn);

  check(`${step}: ${output.writtenIn} exists`, Boolean(writer), "writtenIn names a file that is not there");
  if (!writer) continue;

  // The column, in the file that claims to write it. A path that drifted is worse than no path.
  const col = output.records.split(".")[1] ?? "";
  check(
    `${step}: ${output.writtenIn} names ${col}`,
    new RegExp(`\\b${col}\\b`).test(writer[1]),
    "the writer does not mention the column it is declared to write"
  );

  // The artifact is real DDL, so a produces entry cannot name a column that does not exist.
  check(`${step}: ${output.records} is a declared column`, DECLARED.has(output.records), "no migration declares it");

  // ‼️ THE CHECK. A call site outside the writer.
  //
  // ‼️ AND THE DECLARATION FILE IS EXCLUDED, WITHOUT WHICH THIS CHECK IS WORTHLESS. step-needs.ts
  // contains the reader's NAME, in `reader:` and again in the `feeds` prose, so it matched the grep and
  // counted as its own consumer. Every output passed, including a deliberately broken one: tested by
  // pointing `keyword_set` at `selectKeyword`, which has zero references outside its own file, and the
  // check still went green. A check that its own declaration satisfies is the exact shape of bug this
  // file exists to catch, one level up.
  const DECLARATION = "src/lib/clients/step-needs.ts";
  const elsewhere = READER_FILES.filter(
    ([p, src]) =>
      p !== output.writtenIn &&
      p !== DECLARATION &&
      p.startsWith("src/") &&
      new RegExp(`\\b${output.reader}\\b`).test(src)
  ).map(([p]) => p);
  check(
    `${step}: ${output.reader}() is called outside ${output.writtenIn.replace("src/lib/clients/", "")}`,
    elsewhere.length > 0,
    "a reader referenced only by its own writer is the curated-20 bug: the card that wrote it is the only thing that reads it"
  );
}

// ‼️ THE CHECK ABOVE IS ITSELF CHECKED, because it was green for the wrong reason once. A reader name
// that exists NOWHERE in src/ must be rejected: if it is not, the grep is matching the declaration or
// something equally worthless, and every output passes no matter how broken. Proved with a name nothing
// could ever define rather than by trusting the exclusion list.
const IMPOSSIBLE = "zzzNoSuchReaderExistsAnywhere";
const impossibleHits = READER_FILES.filter(
  ([p, src]) => p.startsWith("src/") && p !== "src/lib/clients/step-needs.ts" && new RegExp(`\\b${IMPOSSIBLE}\\b`).test(src)
);
check(
  "the consumer grep can actually fail",
  impossibleHits.length === 0,
  "a name nothing defines was found, so the grep proves nothing"
);

const tooEarly = outputsConsumedTooEarly();
for (const b of tooEarly) {
  check(`${b.step}: ${b.consumer} is later in board order`, false, `${b.records} cannot be consumed by an earlier step`);
}
if (tooEarly.length === 0) check("every consumedBy step is real and later in board order", true);

// ‼️ custom_question_set MUST NOT CONSUME THE KEPT KEYWORD SET. It and photograph.ts stay on
// planKeywords deliberately: they are MEASUREMENT and the Day 0 set is frozen. Another probe asserts
// they stay broad, and this one must not contradict it.
const measurementLeak = outputs.filter(
  (o) => o.output.records.startsWith("client_keywords.") && o.output.consumedBy.includes("custom_question_set")
);
check(
  "custom_question_set is not declared a consumer of the kept keyword set",
  measurementLeak.length === 0,
  "step 12's question set is MEASUREMENT and stays on planKeywords; a probe already asserts it stays broad"
);

// The backlog, printed rather than hidden. Same job stepsWithNothing() does for `needs`.
const producingNothing = stepsProducingNothing();
console.log(`\n8b. steps that record no non-field artifact (${producingNothing.length} of ${DELIVERY_STEPS.length})`);
for (const s of producingNothing) check(`${s.key} says why`, s.why.trim().length > 20, "the sentence is the point");

// ── The interconnection, from dataset-spec's own relation ──────────────────
//
// ‼️ NO NEW DECLARATION. dataset-spec.ts already says which step fills each field, and rerun-gaps.ts
// already consumes it. This inverts that one relation rather than adding a second.
const holes = fieldsNoStepFills();
console.log(`\n8c. dataset fields nothing on the board fills yet (${holes.length})`);
if (SHOW_INVENTORY) for (const h of holes) console.log(`          ${h.ref}: ${h.why}`);
check(
  "the unfilled-field list has not grown past what dataset-spec declares",
  holes.length <= 12,
  `${holes.length} fields have no built writer. Each is a field a step needs and nothing produces.`
);

console.log(failures ? `\n${failures} FAILED\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);
