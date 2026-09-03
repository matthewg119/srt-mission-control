/**
 * Seed `scraper_seen` from a CSV that was already worked, without dropping it in Slack.
 *
 *   bun run scripts/seed-scraper-seen.ts "<path to csv>"             dry run, prints every key
 *   bun run scripts/seed-scraper-seen.ts "<path to csv>" --commit
 *   bun run scripts/seed-scraper-seen.ts "<path>" --commit --label="august apollo pull"
 *
 * ‼️ `bun run`, NOT `bunx tsx`. Bun auto-loads .env.local; Node does not, and the Supabase calls
 * fail with a bare "fetch failed" that says nothing about the missing credentials.
 *
 * WHY THIS EXISTS. The match rule became website-only on 2026-09-03 and the ledger was wiped to
 * zero in the same change, because every key in it was a company name off a screenshot. That left
 * the next drop reporting ~0 duplicates by design — correct, and useless as a first test, since a
 * count of zero is what a BROKEN ledger reports too. Seeding a list that was already pulled makes
 * the very next drop a real dedupe with a number worth reading.
 *
 * ‼️ IT RUNS THE DROP'S OWN CODE, NOT A COPY OF IT. parseCsv -> dedupeColumns -> allKeys ->
 * loadKnownKeys -> splitDuplicates -> recordSeen is exactly the path `runDedupe` takes, minus
 * Slack. The alternative — normalizing hosts in SQL — is the one mistake this lane cannot afford:
 * a `regexp_replace` chain that is 99% faithful to `domainKey` writes keys that never match
 * anything, and it fails SILENTLY, as a ledger that fills up while every count stays zero. There is
 * no drift to review here because there is no second implementation.
 *
 * ‼️ THE KEYS HANG OFF A SYNTHETIC BATCH ROW ON PURPOSE. `purge-scraper-batch.ts` finds keys only
 * by `.eq("first_batch_id", batchId)`. Seeding with a null batch id would create keys with no undo
 * path, invisible forever to the one script that exists to take a mistake back.
 */

import { basename } from "node:path";
import { readFileSync } from "node:fs";
import { parseCsv } from "../src/lib/scraper/csv";
import { ACTIVE_KEYS, allKeys, dedupeColumns, splitDuplicates } from "../src/lib/scraper/dedup";
import { createBatch, loadKnownKeys, recordSeen, updateBatch } from "../src/lib/scraper/store";

const path = process.argv[2];
const commit = process.argv.includes("--commit");
const labelArg = process.argv.find((a) => a.startsWith("--label="));

if (!path || path.startsWith("--")) {
  console.error('usage: bun run scripts/seed-scraper-seen.ts "<path to csv>" [--commit] [--label=...]');
  process.exit(1);
}

async function main(): Promise<void> {
  const text = readFileSync(path, "utf8");
  const parsed = parseCsv(text);
  const cols = dedupeColumns(parsed.headers);

  console.log("File    ", basename(path), "|", parsed.rows.length, "rows |", parsed.headers.length, "columns");
  console.log("Rule    ", "ACTIVE_KEYS = [" + ACTIVE_KEYS.join(", ") + "]");
  console.log("Website ", cols.website ?? "NOT FOUND");

  // ‼️ A SEED THAT RESOLVES NO WEBSITE COLUMN MUST NOT REPORT SUCCESS. Under the website-only rule
  // it would write nothing, print "0 keys", and leave Matthew believing the list is in the ledger.
  if (!cols.website) {
    console.error(
      "\nNo website column in this file, and the active rule reads nothing else.\n" +
      "Headers found: " + parsed.headers.join(" | ")
    );
    process.exit(1);
  }

  const known = await loadKnownKeys(allKeys(parsed.rows, cols));
  const { fresh, dupes, keyless } = splitDuplicates({ rows: parsed.rows, cols, known });

  const inFile = dupes.filter((d) => d.matchedOn === "in_file");
  const prior = dupes.filter((d) => d.matchedOn !== "in_file");

  console.log("\nSplit");
  console.log("  already in the ledger :", prior.length);
  console.log("  duplicate inside file :", inFile.length);
  console.log("  no key at all         :", keyless, keyless ? "(never recordable, always 'new')" : "");
  console.log("  to write              :", fresh.length);

  // The whole point of a website-only rule is that the list is short enough to read. Print it.
  const keys = fresh.map((r) => r.keys.domain).filter(Boolean).sort();
  console.log("\nKeys it would write (" + keys.length + "):");
  for (const k of keys) console.log("  " + k);

  if (inFile.length > 0) {
    console.log("\nCollapsed as duplicates inside this file:");
    for (const d of inFile) console.log("  row " + (d.rowIndex + 1) + "  " + d.matchedValue + "  " + (d.company ?? ""));
  }
  if (prior.length > 0) {
    console.log("\nAlready in the ledger, skipped:");
    for (const d of prior) console.log("  row " + (d.rowIndex + 1) + "  " + d.matchedValue + "  (" + d.matchedOn + ")");
  }

  if (!commit) {
    console.log("\nDry run. Re-run with --commit to write.");
    return;
  }
  if (fresh.length === 0) {
    console.log("\nNothing new to write. The ledger already holds this list.");
    return;
  }

  // ‼️ status "done" IS LOAD-BEARING. `awaiting_workflow` is in the cron's ACTIVE_STATUSES, and the
  // next tick would post a workflow picker into #srt-scraper for a file nobody dropped.
  // ‼️ threadTs null IS LOAD-BEARING TOO. It is what makes purge-scraper-batch.ts skip its Slack
  // step instead of calling conversationsReplies on a thread that never existed.
  // Read straight off the env rather than importing lane.ts for its one-line getter: that import
  // pulls in the Slack client and @vercel/functions to run a script that talks to neither.
  const batch = await createBatch({
    channel: process.env.SLACK_SCRAPER_CHANNEL || "seed",
    threadTs: null,
    fileId: null,
    fileName: basename(path),
    status: "done",
    batchLabel: labelArg ? labelArg.slice("--label=".length) : "seed",
  });

  await updateBatch(batch.id, {
    total_rows: parsed.rows.length,
    headers: parsed.headers,
    dedupe_dupe_indexes: dupes.map((d) => d.rowIndex),
    dedupe_dupe_count: dupes.length,
    dedupe_new_count: fresh.length,
    dedupe_ran_at: new Date().toISOString(),
  });

  await recordSeen(batch.id, fresh);

  console.log("\nWrote " + keys.length + " keys. Batch " + batch.id);
  console.log("Undo:  bun run scripts/purge-scraper-batch.ts " + batch.id + " --commit");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
