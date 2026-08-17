/**
 * Direct Postgres runner for the migrations in docs/.
 *
 * WHY THIS EXISTS
 * The Supabase SQL editor runs a pasted script as ONE implicit transaction, so an
 * error anywhere — including in a verification SELECT at the bottom — rolls back
 * the whole file, shows only the last statement's result, and looks exactly like
 * "the migration did nothing". Four rounds were lost to that.
 *
 * This runner sends statements ONE AT A TIME over a normal connection, where each
 * one autocommits. A failure stops at the statement that failed and prints it with
 * its SQLSTATE; everything before it is already committed. Verification can then
 * live in the same file as the DDL, because a failing SELECT can no longer undo it.
 *
 * Uses Bun's built-in SQL client — there is no pg/postgres dependency in this repo
 * and this is not worth adding one for.
 *
 *   bun run scripts/db.ts --file=docs/2026-08-18-crm-readonly-role.sql
 *   bun run scripts/db.ts --sql="select count(*) from contacts"
 *   bun run scripts/db.ts --file=docs/x.sql --dry     # split only, run nothing
 *
 * DATABASE_URL comes from .env.local (gitignored). Use the SESSION pooler URI, not
 * the transaction pooler: crm_readonly_query is SECURITY DEFINER ... SET ROLE, and
 * SET ROLE does not survive transaction-level connection multiplexing.
 */

import { SQL } from "bun";
import { readFileSync } from "node:fs";

interface Args {
  file?: string;
  sql?: string;
  dry: boolean;
  quiet: boolean;
}

function parseArgs(): Args {
  const out: Args = { dry: false, quiet: false };
  for (const a of process.argv.slice(2)) {
    if (a === "--dry" || a === "--dry-run") out.dry = true;
    else if (a === "--quiet" || a === "-q") out.quiet = true;
    else if (a.startsWith("--file=")) out.file = a.slice("--file=".length);
    else if (a.startsWith("--sql=")) out.sql = a.slice("--sql=".length);
    else {
      console.error(`Unknown argument "${a}"`);
      console.error("Usage: bun run scripts/db.ts --file=<path> | --sql=<query> [--dry] [--quiet]");
      process.exit(1);
    }
  }
  if (!out.file && !out.sql) {
    console.error("Nothing to do. Pass --file=<path> or --sql=<query>.");
    process.exit(1);
  }
  return out;
}

/**
 * Split a SQL script into individual statements.
 *
 * A naive split on ";" shreds this repo's migrations: 2026-08-18-crm-readonly-role.sql
 * has five `do $$ ... end $$;` blocks, each full of semicolons, and the dynamic view
 * builder nests quoted identifiers inside format() strings inside those blocks. So the
 * splitter tracks every construct in which a ";" is not a terminator:
 *
 *   'single quoted'   ''-escaped, per the SQL standard (backslashes are NOT escapes
 *                     in standard_conforming_strings, which is on by default)
 *   "quoted ident"    ""-escaped
 *   $$ ... $$         and $tag$ ... $tag$ — the important one
 *   -- line comment
 *   \/* block *\/     nestable, per Postgres
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let start = 0;
  let i = 0;
  let blockDepth = 0;

  const n = sql.length;
  while (i < n) {
    const c = sql[i];

    // Block comments nest in Postgres.
    if (blockDepth > 0) {
      if (c === "*" && sql[i + 1] === "/") {
        blockDepth--;
        i += 2;
        continue;
      }
      if (c === "/" && sql[i + 1] === "*") {
        blockDepth++;
        i += 2;
        continue;
      }
      i++;
      continue;
    }

    if (c === "-" && sql[i + 1] === "-") {
      const nl = sql.indexOf("\n", i);
      i = nl === -1 ? n : nl + 1;
      continue;
    }

    if (c === "/" && sql[i + 1] === "*") {
      blockDepth = 1;
      i += 2;
      continue;
    }

    if (c === "'" || c === '"') {
      const quote = c;
      i++;
      while (i < n) {
        if (sql[i] === quote) {
          if (sql[i + 1] === quote) {
            i += 2; // doubled quote is an escaped quote, not the end
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    // Dollar quoting: $$ or $tag$ where tag is [A-Za-z_][A-Za-z0-9_]*
    if (c === "$") {
      const m = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        i = close === -1 ? n : close + tag.length;
        continue;
      }
    }

    if (c === ";") {
      const stmt = sql.slice(start, i).trim();
      if (stmt) out.push(stmt);
      start = i + 1;
      i++;
      continue;
    }

    i++;
  }

  const tail = sql.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/** First meaningful line of a statement, for progress output. */
function label(stmt: string): string {
  const line = stmt
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("--"));
  const text = (line ?? stmt).replace(/\s+/g, " ");
  return text.length > 88 ? `${text.slice(0, 85)}...` : text;
}

function printRows(rows: unknown): void {
  if (!Array.isArray(rows) || rows.length === 0) {
    console.log("  (no rows)");
    return;
  }
  const objects = rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  if (objects.length !== rows.length) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const cols = [...new Set(objects.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };

  // A wide jsonb blob in a column destroys an aligned table; fall back to JSON.
  const widest = Math.max(...cols.map((c) => Math.max(c.length, ...objects.map((r) => cell(r[c]).length))));
  if (widest > 140) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const width: Record<string, number> = {};
  for (const c of cols) {
    width[c] = Math.max(c.length, ...objects.map((r) => cell(r[c]).length));
  }
  const line = (cells: string[]) => cells.map((v, idx) => v.padEnd(width[cols[idx]])).join("  ");
  console.log(`  ${line(cols)}`);
  console.log(`  ${cols.map((c) => "-".repeat(width[c])).join("  ")}`);
  for (const r of objects) console.log(`  ${line(cols.map((c) => cell(r[c])))}`);
  console.log(`  (${objects.length} row${objects.length === 1 ? "" : "s"})`);
}

function errDetail(err: unknown): string {
  if (!err || typeof err !== "object") return String(err);
  const e = err as Record<string, unknown>;
  const parts = [
    e.message ?? String(err),
    e.errno || e.code ? `SQLSTATE ${e.errno ?? e.code}` : null,
    e.detail ? `detail: ${e.detail}` : null,
    e.hint ? `hint: ${e.hint}` : null,
    e.where ? `where: ${e.where}` : null,
  ].filter(Boolean);
  return parts.join("\n    ");
}

async function main() {
  const args = parseArgs();

  const url = process.env.DATABASE_URL;
  if (!url && !args.dry) {
    console.error("DATABASE_URL is not set.");
    console.error("Supabase Dashboard -> Project Settings -> Database -> Connection string -> URI");
    console.error("Use the SESSION pooler. Put it in .env.local as DATABASE_URL=postgresql://...");
    process.exit(1);
  }

  const source = args.file ? readFileSync(args.file, "utf8") : args.sql!;
  const statements = splitStatements(source);

  if (args.file) {
    console.log(`${args.file}: ${statements.length} statement${statements.length === 1 ? "" : "s"}`);
  }

  if (args.dry) {
    statements.forEach((s, idx) => console.log(`  ${String(idx + 1).padStart(3)}. ${label(s)}`));
    return;
  }

  const sql = new SQL(url!);
  let ran = 0;

  try {
    for (const [idx, stmt] of statements.entries()) {
      const num = `${String(idx + 1).padStart(3)}/${statements.length}`;
      try {
        const rows = await sql.unsafe(stmt);
        ran++;

        const returnsRows = Array.isArray(rows) && rows.length > 0;
        if (args.file) {
          if (!args.quiet) console.log(`  ${num} ok   ${label(stmt)}`);
          // Verification SELECTs inside a migration are the whole point of running
          // it here rather than in the console, so always show what they returned.
          if (returnsRows) printRows(rows);
        } else {
          printRows(rows);
        }
      } catch (err) {
        console.error(`\n  ${num} FAILED`);
        console.error(`    ${errDetail(err)}`);
        console.error(`\n  Statement:\n${stmt.replace(/^/gm, "    ")}`);
        console.error(
          `\n  ${ran} statement${ran === 1 ? "" : "s"} committed before this one. Fix and re-run — these files are idempotent.`
        );
        process.exitCode = 1;
        return;
      }
    }

    if (args.file) console.log(`\nDone. ${ran}/${statements.length} statements committed.`);
  } finally {
    await sql.end();
  }
}

main().catch((err) => {
  console.error(errDetail(err));
  process.exit(1);
});
