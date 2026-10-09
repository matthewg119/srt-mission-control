/**
 * The sendable addresses out of a run, as a CSV you can upload straight to ReachInbox.
 *
 *   bun run scripts/export-sendable.ts                      the most recent run with addresses
 *   bun run scripts/export-sendable.ts --run=<uuid>         one run
 *   bun run scripts/export-sendable.ts --out="C:\path.csv"  write it somewhere else
 *   bun run scripts/export-sendable.ts --held               also write held-back.csv beside it
 *
 * ‼️ IT CALLS sendableRows RATHER THAN RE-QUERYING, AND THAT IS THE WHOLE POINT. The rule that
 * decides what ships is not "status is valid or catch_all": it is per SOURCE. A crawled address may
 * ship as `catch_all`, because somebody published it and catch-all only means the verifier could not
 * add to what the page already said. A GUESSED address must be `valid`, because catch-all is
 * evidence about the domain and none at all about the mailbox, and mailing an invented address
 * charges the bounce to our sending domain. Re-spelling that filter in SQL here would be a second
 * copy of the rule, free to drift from the one the pipeline publishes. The CSV this writes is
 * byte-identical to the `sendable.csv` the lane posts to Slack.
 *
 * ‼️ bun run, NOT bunx tsx. Bun auto-loads .env.local; this needs DATABASE_URL for the run lookup
 * and the Supabase service key for sendableRows.
 */

import { writeFileSync } from "node:fs";
import { SQL } from "bun";
import { sendableRows, heldBackRows } from "@/lib/scraper/listprep";

type Row = Record<string, unknown>;
interface TagSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

const argv = process.argv.slice(2);
const runArg = argv.find((a) => a.startsWith("--run="))?.slice(6) ?? null;
const outArg = argv.find((a) => a.startsWith("--out="))?.slice(6) ?? null;
const wantHeld = argv.includes("--held");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. It lives in .env.local; run this with `bun run`, not tsx.");
  process.exit(1);
}
// Validated rather than escaped, same as export-cold-call-leads.ts: it is interpolated as text.
if (runArg !== null && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runArg)) {
  console.error("--run= must be a uuid, and `" + runArg + "` is not one. Nothing was read.");
  process.exit(1);
}

/** RFC 4180: quote everything, double the quotes inside. Never hand-roll this per column. */
function csv(rows: ReadonlyArray<ReadonlyArray<string>>): string {
  return rows.map((r) => r.map((c) => '"' + String(c ?? "").replace(/"/g, '""') + '"').join(",")).join("\r\n");
}

const sql = new SQL(url) as unknown as TagSQL;

let runId = runArg;
if (!runId) {
  const found = (await sql.unsafe(`
    select r.id, r.label, r.started_at
    from list_pipeline_runs r
    where exists (select 1 from sendable_leads s where s.run_id = r.id)
    order by r.started_at desc
    limit 1
  `)) as Array<Record<string, string | null>>;
  if (!found.length) {
    console.error("No run has any sendable_leads rows yet. Nothing to export.");
    await sql.end();
    process.exit(1);
  }
  runId = String(found[0].id);
  console.log("No --run= given, so this is the most recent run with addresses: " + runId);
}

const rows = await sendableRows(runId);
if (!rows.length) {
  console.error(
    "Run " + runId + " has no sendable addresses.\n" +
      "That is a real answer, not an error: either the crawl found nothing, or everything it found\n" +
      "was held back. Re-run with --held to see what was held and why."
  );
}

// Derived from the row shape rather than restated, so a column added to SendableExportRow cannot
// silently fall out of this file.
const header = Object.keys(rows[0] ?? {
  email: "", first_name: "", last_name: "", company: "", owner_name: "", website: "",
  domain: "", city: "", state: "", phone: "", email_status: "", provider: "", qualify_reason: "",
});

const out = outArg ?? "C:\\Users\\matth\\Downloads\\sendable-" + runId.slice(0, 8) + ".csv";
writeFileSync(
  out,
  csv([header, ...rows.map((r) => header.map((h) => String((r as unknown as Row)[h] ?? "")))]),
  "utf8"
);

const valid = rows.filter((r) => r.email_status === "valid").length;
const catchAll = rows.filter((r) => r.email_status === "catch_all").length;
const crawled = rows.filter((r) => r.provider === "site-scrape").length;
const guessed = rows.filter((r) => r.provider === "permute-guess" || r.provider === "domain-people").length;
const named = rows.filter((r) => (r.first_name ?? "").trim().length > 0).length;

console.log("\nsendable addresses : " + rows.length);
console.log("  valid            : " + valid + "   decisive, safest to send first");
console.log("  catch_all        : " + catchAll + "   domain accepts everything; crawled only, never guessed");
console.log("  found by crawl   : " + crawled);
console.log("  guessed + proven : " + guessed);
console.log("  carry a first name: " + named + "   the merge variable; the rest need a generic greeting");
console.log("\nwrote " + out);

if (wantHeld) {
  const held = await heldBackRows(runId);
  const heldOut = out.replace(/\.csv$/i, "") + "-held-back.csv";
  const heldHeader = Object.keys(held[0] ?? { email: "", email_status: "", suppressed_reason: "" });
  writeFileSync(
    heldOut,
    csv([heldHeader, ...held.map((r) => heldHeader.map((h) => String(r[h] ?? "")))]),
    "utf8"
  );
  console.log("held back          : " + held.length);
  console.log("wrote " + heldOut);
}

await sql.end();
