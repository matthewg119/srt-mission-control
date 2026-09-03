// Build (or re-build) market_mentions from every measured audit run.
//
//   bunx tsx --env-file=.env.local scripts/build-market-dataset.ts            # dry, writes nothing
//   bunx tsx --env-file=.env.local scripts/build-market-dataset.ts --write
//
// ‼️ DRY BY DEFAULT, --write TO ACT. Same shape as _backfill-gbp-serp.ts and _rescore-optimization.ts.
// The dry run is not a courtesy, it is the measurement step: it prints the exact numbers the
// dataset will contain so they can be compared against the pre-build figures before anything is
// stored. A dataset that turns out to name three businesses in one city is a finding, and finding
// it after the write is worse than finding it before.
//
// ‼️ IDEMPOTENT. Upserts on (run_id, normalized_name), so re-running refreshes rather than
// duplicating. Re-running after new audits land is the intended way to keep the dataset current.
//
// This script never calls a model. Every name it stores was extracted at audit time by
// extract-recommended.ts and is being copied, not generated.

import { supabaseAdmin } from "@/lib/db";
import { loadRunsWithReports, aggregate, type MentionRow } from "@/lib/market/aggregate";

const WRITE = process.argv.includes("--write");
const CHUNK = 500;

function pct(n: number, total: number): string {
  if (!total) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

async function main(): Promise<void> {
  console.log(`\nmarket dataset build  (${WRITE ? "WRITE" : "dry run, nothing is written"})\n`);

  const runs = await loadRunsWithReports();
  const { rows, stats } = aggregate(runs);

  console.log("  scan");
  console.log(`    ok runs scanned            ${stats.runsScanned}`);
  console.log(`    runs that produced a row   ${stats.runsPlaced}`);
  console.log(
    `    runs with nothing usable   ${stats.runsUnplaceable}  (no city, no service, or nothing named)`
  );
  console.log(`    names dropped by filters   ${stats.namesDropped}  (chains, aggregators, self)`);

  console.log("\n  dataset");
  console.log(`    mention rows               ${stats.mentions}`);
  console.log(`    distinct businesses        ${stats.distinctBusinesses}`);
  console.log(`    cities                     ${stats.cities}`);
  console.log(`    city + service cells       ${stats.cells}`);
  console.log(`    market rows                ${stats.marketRows}`);

  // How much of this is actually usable for a first email. A cell with one business named once is
  // technically a row and practically nothing to say, so it is counted separately rather than
  // folded into the headline number.
  const byCell = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const cell = `${r.city}|${r.state ?? ""}|${r.service}`;
    let biz = byCell.get(cell);
    if (!biz) byCell.set(cell, (biz = new Map()));
    biz.set(r.normalized_name, (biz.get(r.normalized_name) ?? 0) + 1);
  }

  let emailReady = 0;
  for (const biz of byCell.values()) {
    const repeat = [...biz.values()].filter((n) => n >= 2).length;
    if (biz.size >= 3 && repeat >= 2) emailReady += 1;
  }

  console.log(
    `    cells ready for an email   ${emailReady} of ${byCell.size}  ` +
      `(${pct(emailReady, byCell.size)}, 3+ businesses and 2+ named more than once)`
  );

  const withDomain = rows.filter((r) => r.cited_domains.length > 0).length;
  console.log(
    `    rows with a cited domain   ${withDomain}  (${pct(withDomain, rows.length)}, conservative match)`
  );

  if (!WRITE) {
    console.log("\n  dry run. Pass --write to store these rows.\n");
    return;
  }

  console.log(`\n  writing ${rows.length} rows in chunks of ${CHUNK}`);
  let written = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk: MentionRow[] = rows.slice(i, i + CHUNK);
    const { error } = await supabaseAdmin
      .from("market_mentions")
      .upsert(chunk, { onConflict: "run_id,normalized_name" });

    if (error) {
      console.error(`\n  FAILED at row ${i}: ${error.message}`);
      console.error(`  ${written} rows written before this chunk.`);
      process.exit(1);
    }
    written += chunk.length;
    process.stdout.write(`\r  written ${written}/${rows.length}`);
  }

  console.log(`\n\n  done. ${written} rows upserted.\n`);
}

main().catch((err) => {
  console.error(`\nbuild-market-dataset failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
