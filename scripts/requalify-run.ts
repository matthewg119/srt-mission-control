/**
 * Re-judge a finished run against the CURRENT buyer profile.
 *
 *   bun run scripts/requalify-run.ts --run=<uuid>            dry, prints what it would do
 *   bun run scripts/requalify-run.ts --run=<uuid> --commit
 *
 * ‼️ EDITING src/lib/scraper/icp.ts DOES NOT REACH A RUN THAT ALREADY EXISTS, and that is by
 * design rather than an oversight. `startRun` copies the profile onto list_pipeline_runs.icp_text
 * and `sweepQualify` reads it from there, so every verdict can be argued with after the fact
 * against the exact words it was made under. The cost is that widening the profile changes FUTURE
 * runs only; this script is the deliberate, one-run-at-a-time way to apply it backwards.
 *
 * ‼️ ONLY ROWS WITH A WEBSITE ARE RE-OPENED. A business with no website cannot yield an email no
 * matter how the profile reads, so re-judging those would spend model calls to arrive at the same
 * place. They are already a call list: scripts/export-cold-call-leads.ts and the CRM source
 * "Med Spa Scrape - No Website".
 *
 * ‼️ AND ONLY THE DROPPED ONES. A row that was KEPT keeps its verdict and its address: it has
 * already been enriched, verified and in most cases mailed, and re-opening it would re-run the
 * whole pipeline over work that is finished.
 *
 * ‼️ bun run, NOT bunx tsx, for DATABASE_URL out of .env.local.
 */

import { SQL } from "bun";
import { MED_SPA_ICP } from "../src/lib/scraper/icp";

type Row = Record<string, unknown>;
interface TagSQL {
  (strings: TemplateStringsArray, ...values: unknown[]): Promise<Row[]>;
  unsafe(query: string): Promise<Row[]>;
  end(): Promise<void>;
}

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is not set. Run with `bun run`."); process.exit(1); }

const runArg = process.argv.find((a) => a.startsWith("--run="))?.slice("--run=".length) ?? null;
const commit = process.argv.includes("--commit");
if (!runArg || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(runArg)) {
  console.error("--run=<uuid> is required.");
  process.exit(1);
}

const sql = new SQL(url) as unknown as TagSQL;

const before = (await sql.unsafe(`
  select
    count(*) as total,
    count(*) filter (where qualify_keep is true) as kept,
    count(*) filter (where qualify_keep is false) as dropped,
    count(*) filter (where qualify_keep is false and website is not null and website <> '') as reopenable
  from raw_leads where run_id = '${runArg}'
`))[0];

console.log("run        ", runArg);
console.log("rows       ", before.total);
console.log("kept       ", before.kept, " (left alone)");
console.log("dropped    ", before.dropped);
console.log("re-openable", before.reopenable, " (dropped AND has a website)");
console.log("");
console.log("new profile starts:", MED_SPA_ICP.slice(0, 70).replace(/\n/g, " ") + "...");

if (!commit) {
  console.log("\nDry run. Nothing written. Re-run with --commit.");
  await sql.end();
  process.exit(0);
}

// 1. The run carries the profile its verdicts are made under, so it is replaced first.
await sql.unsafe(`
  update list_pipeline_runs
  set icp_text = $$${MED_SPA_ICP}$$,
      stage = 'qualifying',
      finished_at = null,
      drop_review_ts = null
  where id = '${runArg}'
`);
console.log("\n1/3  run: profile replaced, stage back to qualifying, drop-review card re-armed");

// 2. Re-open the dropped rows that can still become an email.
//    The tri-state is restored exactly: keep null AND reason null is "not asked yet", which is the
//    only shape pendingQualify treats as a worklist. Clearing only one of the two would park them.
const reopened = await sql.unsafe(`
  update raw_leads
  set qualify_keep = null, qualify_reason = null, qualify_model = null, qualified_at = null
  where run_id = '${runArg}'
    and qualify_keep is false
    and website is not null and website <> ''
  returning id
`);
console.log("2/3  raw_leads:", reopened.length, "rows re-opened for judgement");

// 3. The batch drives the cron, so it goes last: nothing is polled until the rows are ready.
//    MillionVerifier is reset too, because the addresses this finds are new ones it has not seen.
//    Already-verified rows are not re-uploaded: unverifiedEmails selects on verified_at is null.
await sql.unsafe(`
  update scraper_batches
  set status = 'qualifying',
      mv_file_id = null,
      mv_status = null,
      mv_approval_ts = null,
      mv_awaiting_approval = false,
      error = null
  where list_run_id = '${runArg}'
`);
console.log("3/3  batch: back to qualifying, MillionVerifier gate re-armed");

console.log("\nThe cron picks this up within 5 minutes and re-judges against the new profile.");
console.log("Watch the batch's thread in #srt-scraper for a fresh drop-review card.");

await sql.end();
