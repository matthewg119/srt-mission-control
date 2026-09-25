// Every column the board writes, and whether anything reads it back. Proved offline.
//
//   bun run scripts/_probe-dead-wires.ts
//   bun run scripts/_probe-dead-wires.ts --inventory    also list the non-failing lanes
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

import { readFileSync, readdirSync, statSync, existsSync } from "fs";
import { join } from "path";

let failures = 0;

function check(name: string, ok: boolean, detail = ""): void {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${name}${ok || !detail ? "" : `\n          ${detail}`}`);
  if (!ok) failures++;
}

const SHOW_INVENTORY = process.argv.includes("--inventory");

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
  for (const m of chunk.matchAll(/\.or\(\s*"([^"\n]*)"/g)) {
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
// ‼️ THIS PIN ALSO MOVED, for the same reason the one above did: it was `approved_at`, which this
// build wired up. `rationale` is the honest replacement and a sharper demonstration of the rule:
// `page_angles.rationale` is in ANGLE_COLUMNS and read constantly, while `keyword_clusters.rationale`
// is written by persistClusters and never selected back. The card does print a rationale, and it is
// the RECOMPUTED one off clusterFinalists, which is exactly the confusion table-scoping prevents.
check(
  "an explicit-list table is not covered by another table's property: keyword_clusters.rationale",
  !isRead("keyword_clusters", "rationale"),
  "page_angles.rationale is read constantly; this one is not"
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

/**
 * Tables whose dead wires have been resolved, and which must therefore stay clean.
 *
 * ‼️ ADDING A TABLE HERE IS A CLAIM THAT SOMEBODY LOOKED AT EVERY UNREAD COLUMN ON IT. Do not add one
 * to make a finding go away, and do not remove one to make this probe green: removing a table from
 * this set is how a cleaned lane silently rots back, which is the exact failure the file is about.
 */
const SCANNED = new Set(["avatar_briefs", "client_audiences", "keyword_clusters"]);

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
};

/** Individual columns written and never read, ON PURPOSE. Each entry is a SENTENCE, not a name. */
const WRITE_ONLY: Record<string, string> = {
  // Row bookkeeping. Every table in this lane carries these by convention, the DEFAULT writes
  // created_at rather than the app, and nothing selects either: they are for a person reading the
  // table in the console and for ordering in ad-hoc SQL. Naming them individually rather than
  // exempting the pattern, so a `*_at` column that IS a decision cannot hide behind the convention.
  "client_audiences.updated_at": "row bookkeeping, written by every update and selected by nothing.",
  "keyword_clusters.updated_at": "row bookkeeping, written by every update and selected by nothing.",
  "keyword_clusters.created_at":
    "row bookkeeping, and it reads as untouched because the column DEFAULT writes it rather than the app.",
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
  // Exactly the shape of keyword_clusters.rejected_by, which this build wired into the strategy card.
  // These two need the same treatment on the audience card, which has no provenance line yet.
  "client_audiences.confirmed_by":
    "the who beside confirmed_at, which IS read. Same shape as keyword_clusters.rejected_by; the audience card has no provenance line yet.",
  "client_audiences.vocabulary_confirmed_by":
    "the who beside vocabulary_confirmed_at, which IS read. Owed the same provenance line.",
  "client_audiences.seeded_at": "the when beside seeded_from, which IS read. Owed the same provenance line.",

  // ── keyword_clusters: stored, and the card prints the recomputed value ────
  // ‼️ THE SUBTLEST SHAPE IN THIS FILE, and worth reading before "fixing" any of the three. The card
  // DOES print a rationale and an awareness pair, from the RECOMPUTED ProposedCluster off
  // clusterFinalists, never from the stored row. So the information is on screen and the column is
  // still dead, and the two can disagree after an offer change. Reading the stored values is a real
  // improvement and a behaviour change, which is why it is not smuggled in here.
  "keyword_clusters.rationale": "stored by persistClusters; the card prints the recomputed rationale instead. The two can disagree after an offer change.",
  "keyword_clusters.awareness_entry": "stored by persistClusters; the card prints the recomputed pair instead.",
  "keyword_clusters.awareness_target": "stored by persistClusters; the card prints the recomputed pair instead.",
  "keyword_clusters.offer_fingerprint":
    "written for the staleness check its own migration comment argues for, and that check still does not read it. Wiring it is the point of the column.",
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
 * reached is held. Measured 2026-09-25 on feat/keyword-decisions.
 */
const BOARD_BASELINE = 957;

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

for (const [key, d] of DECLARED) {
  if (WRITE_ONLY_TABLES[d.table] || WRITE_ONLY[key] || READ_DYNAMICALLY[key]) continue;
  if (isRead(d.table, d.column)) continue;

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

// ‼️ FUNDING IS CALLED OUT SEPARATELY RATHER THAN LEFT IN A LANE TOTAL, because it is the one lane
// whose columns are being DELETED rather than triaged, so its count is work owed rather than a
// backlog being tolerated.
/** Funding vocabulary. Deliberately narrow: these are the words no AEO feature has any reason to use. */
const FUNDING_WORDS = /factor_rate|underwriting|\blenders?\b|buy_rate|sell_rate|statement_months|positions_funded|repayment_frequency/i;

const fundingCols = counted.filter((f) => f.lane === "funding");
console.log(`\n6b. funding: SRT does no business funding. ${fundingCols.length} unread funding column(s) still declared.`);
if (SHOW_INVENTORY) for (const f of fundingCols.sort(byKey)) console.log(`          ${f.key}`);

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

console.log(failures ? `\n${failures} FAILED\n` : "\nAll checks passed.\n");
process.exit(failures ? 1 : 0);
