// Recover the GBP facts from SERPs that were already bought, and clear the foreign rows out.
//
//   bunx tsx --env-file=<envfile> scripts/_backfill-gbp-serp.ts <batch-id>            # dry run
//   bunx tsx --env-file=<envfile> scripts/_backfill-gbp-serp.ts <batch-id> --write
//   bunx tsx --env-file=<envfile> scripts/_backfill-gbp-serp.ts <batch-id> --write --no-repost
//
// A one-off, for the batches scored BEFORE `extractGbpSerpFacts` existed. Those rows have a
// `dominance_score`, a `dataforseo_task_id` and a NULL `gbp_serp`, so the optimization audit has no
// key to look a profile up by and reports every one of them as *not measured*. The SERP that
// carries the key was paid for at the time and is still sitting on DataForSEO's side.
//
// ‼️ `task_get` IS FREE AND A RESULT STAYS FETCHABLE FOR 30 DAYS. Re-collecting a task costs
// NOTHING, which is the entire reason this script can exist: the alternative is re-posting the same
// queries and paying for the same SERPs a second time. Anything past the 30 days is simply gone and
// is reported as such rather than re-bought.
//
// It also CLEARS a stale `optimization_components` on any row it recovers a cid for. That column
// being set is what takes a row out of `auditableRows` permanently, and those rows were written off
// for exactly one reason: no key. The key now exists, so the verdict does not.
//
// ‼️ THIS SCRIPT ITSELF SPENDS NOTHING. What it does is put the batch back to `auditing`, and the
// five-minute cron then buys ONE my_business_info lookup per recovered cid at $0.0015. That number
// is printed before anything is written and again at the end, because it is the one consequence of
// running this that is not visible from inside it.
//
// The dry run is the default and `--write` is required, the same shape every destructive script in
// this repo has: this DELETES ROWS.

import { getTask } from "../src/lib/scraper/dataforseo";
import { extractGbpSerpFacts } from "../src/lib/scraper/gbp-audit";
import { describeLocation, locationVerdict } from "../src/lib/scraper/geo";
import { supabaseAdmin } from "../src/lib/db";

const BATCH_ID = process.argv[2];
const WRITE = process.argv.includes("--write");
/**
 * Audit the recovered rows but leave the thread alone.
 *
 * `publishScores` is guarded by `csv_posted_at` and `scoring_approval_ts`, and clearing them is what
 * makes the cron post the NEW file over the stale one. That is the default and it is usually what
 * you want. It is wrong in one case: when somebody has already acted on the thread, or when the
 * running deployment is older than the code that would produce the new file, in which case clearing
 * the guards posts a summary in the shape you were replacing. This keeps them set, so the cron does
 * the profile lookups and writes the scores and posts nothing.
 */
const NO_REPOST = process.argv.includes("--no-repost");

/** What the cron pays per recovered cid, on the profile lookup this script makes possible. */
const GBP_LOOKUP_USD = 0.0015;

if (!BATCH_ID) {
  console.error("usage: _backfill-gbp-serp.ts <batch-id> [--write]");
  process.exit(1);
}

interface Row {
  id: string;
  row_index: number;
  company: string | null;
  city: string | null;
  raw: Record<string, string>;
  dominance_score: number | null;
  optimization_score: number | null;
  optimization_components: Record<string, unknown> | null;
  dataforseo_task_id: string | null;
  gbp_cid: string | null;
  gbp_serp: Record<string, unknown> | null;
}

async function allRows(batchId: string): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += 500) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select(
        "id, row_index, company, city, raw, dominance_score, optimization_score, " +
          "optimization_components, dataforseo_task_id, gbp_cid, gbp_serp"
      )
      .eq("batch_id", batchId)
      .order("row_index", { ascending: true })
      .range(from, from + 499);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as Row[];
    out.push(...rows);
    if (rows.length < 500) break;
  }
  return out;
}

async function main(): Promise<void> {
  const { data: batch, error } = await supabaseAdmin
    .from("scraper_batches")
    .select("id, file_name, status, total_rows, score_cost_usd, headers")
    .eq("id", BATCH_ID)
    .single();
  if (error || !batch) throw new Error("no such batch: " + BATCH_ID);

  console.log((WRITE ? "WRITE" : "DRY RUN") + "  batch " + BATCH_ID);
  console.log("file " + batch.file_name + ", status " + batch.status + ", spent $" + batch.score_cost_usd);
  console.log("");

  const rows = await allRows(BATCH_ID);
  console.log("rows in the batch: " + rows.length);

  // ── 1. the United States filter, FIRST ────────────────────────────────────────────────────────
  //
  // ‼️ BEFORE THE RECOVERY, NOT AFTER, AND THE ORDER IS THE WHOLE POINT. Every cid recovered on a
  // row that is about to be deleted turns into a $0.0015 profile lookup the cron buys for a business
  // in Prague. It is the same reasoning that puts the filter at the INSERT for new batches rather
  // than at publish time: DataForSEO charges on the way in, so the cheapest row is the one that was
  // never queued.
  //
  // ‼️ DECIDED ON THE `state` / `city` CELLS OF THE ORIGINAL FILE, NEVER ON WHAT THE SEARCH FOUND.
  // A row with no Google profile can still be in Florida and a row with a perfect one can be in
  // Prague, so the SERP is not evidence about this question and is not consulted.
  const foreign = rows.filter(
    (r) => locationVerdict({ state: r.raw?.state, city: r.raw?.city }) === "not_us"
  );
  const unlocated = rows.filter(
    (r) => locationVerdict({ state: r.raw?.state, city: r.raw?.city }) === "unknown"
  );
  const survivors = rows.filter((r) => !foreign.includes(r));

  console.log("");
  console.log("── not in the United States: " + foreign.length + " rows to delete ──");
  for (const r of foreign) {
    console.log(
      "  " + (r.company ?? "(no company)").padEnd(40).slice(0, 40) +
        "  " + describeLocation({ state: r.raw?.state, city: r.raw?.city })
    );
  }
  // ‼️ KEPT, AND SAID OUT LOUD. No city and no state is a fact about the export, not about the
  // business, and deleting on an empty cell is exactly the failure the tri-state exists to prevent.
  console.log("");
  console.log(
    "  " + unlocated.length + " rows carried no city and no state at all. KEPT, not judged: " +
      unlocated.map((r) => r.company ?? "?").join(", ")
  );
  console.log("");
  console.log("  " + survivors.length + " rows survive the filter.");

  if (WRITE && foreign.length > 0) {
    for (let i = 0; i < foreign.length; i += 100) {
      const part = foreign.slice(i, i + 100).map((r) => r.id);
      const { error: delError } = await supabaseAdmin
        .from("scraper_rows")
        .delete()
        .eq("batch_id", BATCH_ID)
        .in("id", part);
      if (delError) throw new Error("delete: " + delError.message);
    }
    await supabaseAdmin
      .from("scraper_batches")
      .update({ total_rows: survivors.length })
      .eq("id", BATCH_ID);
    console.log("  deleted.");
  }

  // ── 2. re-collect the SERPs that were already paid for ────────────────────────────────────────
  const pending = survivors.filter((r) => !r.gbp_serp && r.dataforseo_task_id);
  console.log("");
  console.log("── recoverable: " + pending.length + " rows with a paid SERP and no gbp_serp ──");
  if (pending.length === 0) {
    console.log("  nothing to re-collect.");
    // The reopen pass still has work: a row can hold a recovered cid from an earlier run and still
    // be carrying the write-off that keeps it off the worklist.
    await reopenWriteOffs(survivors, new Set());
    if (WRITE) {
      await supabaseAdmin
        .from("scraper_batches")
        .update(
          NO_REPOST
            ? { status: "auditing" }
            : { status: "auditing", csv_posted_at: null, scoring_approval_ts: null }
        )
        .eq("id", BATCH_ID);
      console.log("");
      console.log("  batch is back at `auditing`; the 5-minute cron takes it from here.");
    }
    return finish(0, 0);
  }

  let recovered = 0;
  let fromKnowledgeGraph = 0;
  let fromLocalPack = 0;
  let noCid = 0;
  let expired = 0;
  let reopened = 0;
  const writes: Array<{ id: string; cid: string | null; placeId: string | null; serp: unknown }> = [];
  const recoveredIds = new Set<string>();

  for (const row of pending) {
    const result = await getTask(row.dataforseo_task_id as string);
    if (result.state !== "ready") {
      // Past 30 days, or a task that failed at the time. Either way the SERP is gone and the honest
      // move is to say so rather than re-post the query and buy it again.
      expired++;
      continue;
    }
    const facts = extractGbpSerpFacts(result.payload ?? {}, {
      company: row.company,
      city: row.city,
    });
    if (facts.cid) {
      recovered++;
      if (facts.cidSource === "knowledge_graph") fromKnowledgeGraph++;
      else fromLocalPack++;
    } else {
      // ‼️ STILL WRITTEN. A SERP that was read and carries no cid is a MEASURED absence: Google has
      // no profile to point at. Leaving `gbp_serp` null would leave the row looking un-asked, and
      // the next run of this script would re-collect the same task to learn the same nothing.
      noCid++;
    }
    // ‼️ RECOVERING THE cid IS NOT ENOUGH ON ITS OWN, AND THIS IS THE BUG THE FIRST RUN OF THIS
    // SCRIPT SHIPPED WITH. `auditableRows` excludes a row whose `optimization_components` is set,
    // which is the middle state of the tri-state on `StoredRow`: "asked, nothing was measurable,
    // stop asking". Those 44 rows were written off during the original audit for one reason - they
    // had no key to look a profile up by - and that verdict is now STALE, because the key exists.
    // Left alone they sit outside the worklist forever, and the batch cheerfully reports every one
    // of them as *not measured* while holding the cid that would answer it. Measured: the cron ran,
    // posted nothing for them, and flipped the batch to `scored` with 44 recovered cids unused.
    //
    // ‼️ ONLY WHERE A cid WAS ACTUALLY RECOVERED, AND ONLY WHERE THE SCORE IS STILL NULL. A row
    // carrying a real `optimization_score` was measured, not written off, and clearing its
    // components would re-buy a profile lookup that already answered.
    writes.push({ id: row.id, cid: facts.cid, placeId: facts.placeId, serp: facts });
    if (facts.cid) recoveredIds.add(row.id);
  }

  console.log("  recovered a cid:      " + recovered);
  console.log("    from knowledge_graph " + fromKnowledgeGraph);
  console.log("    from local_pack      " + fromLocalPack);
  console.log("  SERP had no profile:  " + noCid);
  console.log("  task expired or failed: " + expired);

  await reopenWriteOffs(survivors, recoveredIds);

  if (WRITE) {
    for (const w of writes) {
      const { error: upError } = await supabaseAdmin
        .from("scraper_rows")
        .update({ gbp_cid: w.cid, gbp_place_id: w.placeId, gbp_serp: w.serp })
        .eq("id", w.id);
      if (upError) throw new Error("update: " + upError.message);
    }
    // ‼️ BACK TO `auditing`, WHICH IS WHAT MAKES THE CRON PICK IT UP. `publishScores` runs after
    // that stage, so the summary and scored.csv go out ONCE with the recovered rows on them rather
    // than being posted twice. `csv_posted_at` and `scoring_approval_ts` are cleared for the same
    // reason: they are the guards that stop the file and the cutoff card being posted again, and
    // the file about to be produced is a different file.
    await supabaseAdmin
      .from("scraper_batches")
      .update(
        NO_REPOST
          ? { status: "auditing" }
          : { status: "auditing", csv_posted_at: null, scoring_approval_ts: null }
      )
      .eq("id", BATCH_ID);
    console.log("");
    console.log("  written. Batch is back at `auditing`; the 5-minute cron takes it from here.");
    if (NO_REPOST) console.log("  --no-repost: the thread keeps its existing summary and cutoff card.");
  }

  finish(recovered, expired);
}

/**
 * Put back on the worklist every row that was written off for want of a key it now has.
 *
 * ‼️ RECOVERING THE cid IS NOT ENOUGH ON ITS OWN, AND THE FIRST RUN OF THIS SCRIPT SHIPPED WITHOUT
 * THIS AND PROVED IT. `auditableRows` excludes any row whose `optimization_components` is set, which
 * is the MIDDLE state of the tri-state on `StoredRow`: "asked, nothing was measurable, stop asking".
 * Those rows were written off during the original audit for exactly one reason — there was no cid to
 * look a profile up by — and that verdict is STALE the moment one exists. Left alone they sit
 * outside the worklist forever while the row holds the key that would answer them.
 *
 * Measured on the live batch: 44 cids were recovered, the cron ran, posted NOTHING for any of them,
 * and the file still reported all 44 as *not measured*. Nothing errored. Same failure family as the
 * 20100 and the `/advanced/` bugs — the money was already spent and no error appeared anywhere.
 *
 * ‼️ ONLY WHERE A KEY EXISTS AND THE SCORE IS STILL NULL. A row carrying a real
 * `optimization_score` was measured rather than written off, and clearing its components would put
 * a finished row back on the worklist and buy its profile a second time.
 */
async function reopenWriteOffs(rows: Row[], recoveredIds: Set<string>): Promise<void> {
  const stale = rows.filter(
    (r) =>
      (r.gbp_cid !== null || recoveredIds.has(r.id)) &&
      r.optimization_score === null &&
      r.optimization_components !== null
  );

  console.log("");
  console.log("── written off with a key: " + stale.length + " rows to put back on the worklist ──");
  if (stale.length === 0) {
    console.log("  none.");
    return;
  }
  for (const r of stale.slice(0, 10)) console.log("  " + (r.company ?? "(no company)"));
  if (stale.length > 10) console.log("  ... and " + (stale.length - 10) + " more");

  if (!WRITE) return;
  for (const r of stale) {
    // Back to "not asked yet", the first state of the tri-state.
    //
    // ‼️ THE `.is("optimization_score", null)` GUARD IS WHAT MAKES THIS SAFE TO RE-RUN. Between the
    // read above and this write the cron may have audited the row for real; clearing the components
    // then would re-buy a profile lookup that has already answered.
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ optimization_components: null })
      .eq("id", r.id)
      .is("optimization_score", null);
    if (error) throw new Error("reopen: " + error.message);
  }
  console.log("  reopened.");
}

function finish(recovered: number, expired: number): void {
  console.log("");
  if (recovered > 0) {
    // ‼️ SAID BEFORE AND AFTER, because it is the one cost of running this that is invisible from
    // inside the script. `task_get` was free; the profile lookups the cron now makes are not.
    console.log(
      "THIS WILL SPEND: " + recovered + " profile lookups at $" + GBP_LOOKUP_USD.toFixed(4) +
        " = $" + (recovered * GBP_LOOKUP_USD).toFixed(4) + ", bought by the cron, not by this script."
    );
  }
  if (expired > 0) {
    console.log(expired + " tasks could not be collected. Those SERPs are gone; they are NOT re-bought.");
  }
  if (!WRITE) console.log("Dry run. Nothing was written. Re-run with --write.");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
