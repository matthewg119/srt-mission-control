/**
 * Put every callable business this lane has ever found onto the CRM call list.
 *
 *   bun run scripts/backfill-call-list.ts            report only, writes nothing
 *   bun run scripts/backfill-call-list.ts --write    apply it
 *
 * ‼️ bun run, NOT bunx tsx. It needs the Supabase service key out of .env.local.
 *
 * WHY THIS EXISTS. `recordCallList` now runs at the end of every run, so from here on the board
 * fills itself. It cannot reach backwards: the runs already finished never called it, and the four
 * Dallas chunks pulled on 2026-10-08 were qualified by the OLD code, which had no `route` column at
 * all. Measured 2026-10-09 before this ran: 376 businesses with no website, 323 of them with a
 * phone number, 106 in `contacts`, every one of those 106 from the dead med spa pipeline rather
 * than from Workflow C.
 *
 * ‼️ IT CALLS recordCallList PER RUN RATHER THAN RE-QUERYING, which is the whole point. The rule for
 * who belongs on a call list is four conditions wide (no website, a platform-only domain, a domain
 * with no MX, Tier C) and it already lives in one function. A second query here that said
 * `where website is null` would find the first case, miss the other three, and disagree with the
 * live path the moment either changed.
 *
 * ‼️ IT IS IDEMPOTENT AND SAFE TO RE-RUN. recordCallList dedupes against `contacts` on both
 * google_place_id and phone_last10 before inserting, and within its own batch as well, because
 * there is no unique index on contacts.phone_last10 to catch a double insert.
 */

import { supabaseAdmin } from "@/lib/db";
import { recordCallList } from "@/lib/scraper/listprep";

const write = process.argv.includes("--write");

const { data: runs, error } = await supabaseAdmin
  .from("list_pipeline_runs")
  .select("id, label, vertical_slug, started_at")
  .order("started_at", { ascending: true });
if (error) {
  console.error("could not read the runs: " + error.message);
  process.exit(1);
}

// What is waiting, per run, before anything is written.
let waiting = 0;
const perRun: Array<{ id: string; label: string; vertical: string; callable: number }> = [];
for (const r of runs ?? []) {
  const row = r as Record<string, unknown>;
  const id = String(row.id);
  const { count, error: e } = await supabaseAdmin
    .from("raw_leads")
    .select("id", { count: "exact", head: true })
    .eq("run_id", id)
    .eq("route", "call");
  if (e) {
    console.error("counting run " + id.slice(0, 8) + " failed: " + e.message);
    process.exit(1);
  }
  const n = count ?? 0;
  waiting += n;
  if (n > 0) {
    perRun.push({
      id,
      label: String(row.label ?? "(no label)"),
      vertical: String(row.vertical_slug ?? "medspa"),
      callable: n,
    });
  }
}

console.log("runs with a call list: " + perRun.length);
for (const r of perRun) {
  console.log("  " + r.id.slice(0, 8) + "  " + String(r.callable).padStart(4) + "  " + r.label);
}
console.log("callable rows in total: " + waiting);

// ‼️ THE ROWS WITH NO ROUTE ARE COUNTED AND NAMED, because they are the ones that look like nothing
// is wrong. A lead qualified before the route column existed has route NULL, which is neither
// 'call' nor 'email', so it is invisible to this script AND to the territory map. The fix is the
// backfill in docs/2026-10-08-lead-tiers.sql, not this file.
const { count: unrouted } = await supabaseAdmin
  .from("raw_leads")
  .select("id", { count: "exact", head: true })
  .is("route", null);
if ((unrouted ?? 0) > 0) {
  console.log(
    "\n:warning: " + unrouted + " raw leads have NO route at all and are invisible to this script. " +
      "Run docs/2026-10-08-lead-tiers.sql first, then run this again."
  );
}

if (!write) {
  console.log("\nNothing was written. Re-run with --write.");
  process.exit(0);
}

let added = 0;
let known = 0;
let noPhone = 0;
let failures = 0;
for (const r of perRun) {
  const res = await recordCallList(r.id, r.vertical);
  if (res.error) {
    console.error("  " + r.id.slice(0, 8) + "  FAILED: " + res.error);
    failures += 1;
    // Keep going: the runs already written are real, and stopping would make the next run of this
    // script re-do work it has no way to tell was done.
    continue;
  }
  added += res.added;
  known += res.alreadyKnown;
  noPhone += res.noPhone;
  console.log(
    "  " + r.id.slice(0, 8) + "  added " + res.added + ", already known " + res.alreadyKnown +
      ", no phone " + res.noPhone
  );
}

console.log("\nadded to the CRM   : " + added);
console.log("already in the CRM : " + known);
console.log("no phone, left off : " + noPhone);

// The closing line used to print unconditionally, so the run that failed on all six batches with
// "cannot insert a non-DEFAULT value into column phone_last10" still signed off with "they are on
// the worklist now". A summary that cannot report a bad outcome is not a summary, it is a wrong
// one, and a non-zero exit is what makes it visible to anything calling this script.
if (failures) {
  console.log("\n" + failures + " run(s) FAILED and are NOT on the board. Fix the error above and re-run.");
  process.exit(1);
}
console.log("\nThey are on /dashboard/worklist now, in the 'No follow-up' bucket.");
