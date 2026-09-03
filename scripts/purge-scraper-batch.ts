/**
 * Undo a scraper drop: the batch, the ledger keys it wrote, and the bot's messages in its thread.
 *
 *   bun run scripts/purge-scraper-batch.ts <batchId>            dry run, prints what it would do
 *   bun run scripts/purge-scraper-batch.ts <batchId> --commit
 *
 * ‼️ `bun run`, NOT `bunx tsx`. Bun auto-loads .env.local; Node does not, and the Supabase and
 * Slack calls fail with a bare "fetch failed" that says nothing about the missing credentials.
 *
 * WHY THIS IS A REAL SCRIPT AND NOT A ONE-OFF. It has been needed twice inside a day — once for a
 * file whose company names arrived pre-truncated from a screenshot, once for a run that needed
 * redoing after the matcher improved — and the dangerous half is the same every time:
 *
 * ‼️ THE LEDGER KEYS ARE THE POINT, NOT THE BATCH ROW. A drop records every new lead in
 * `scraper_seen` BEFORE any workflow runs. Delete the batch and leave the keys and the very next
 * upload of that list reports it as 100% duplicate — matching against the run you were trying to
 * take back. Deleting the Slack messages without deleting the keys is the same trap wearing a
 * clean thread.
 *
 * ‼️ KEYS FIRST, BATCH SECOND. `scraper_seen.first_batch_id` is ON DELETE SET NULL, so removing the
 * batch first turns its keys into orphans that no later run of this script can find by batch id.
 *
 * What it will NOT do: delete a human's message. A bot token cannot, and the file Matthew uploaded
 * is his, not this lane's.
 */

import { supabaseAdmin } from "../src/lib/db";
import { slack } from "../src/lib/slack-bot";

const batchId = process.argv[2];
const commit = process.argv.includes("--commit");

if (!batchId) {
  console.error("usage: bun run scripts/purge-scraper-batch.ts <batchId> [--commit]");
  process.exit(1);
}

interface BatchLite {
  id: string;
  file_name: string | null;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  total_rows: number;
  dedupe_dupe_count: number;
  dedupe_new_count: number;
  status: string;
  workflow: string | null;
}

async function main(): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(
      "id, file_name, slack_channel_id, slack_thread_ts, total_rows, dedupe_dupe_count, dedupe_new_count, status, workflow"
    )
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) {
    console.log("No batch with that id. Nothing to do.");
    return;
  }
  const batch = data as unknown as BatchLite;

  console.log("Batch   ", batch.file_name, "|", batch.total_rows, "rows |", batch.status,
    batch.workflow ? "| workflow " + batch.workflow : "| no workflow picked");
  console.log("Split   ", batch.dedupe_dupe_count, "duplicates,", batch.dedupe_new_count, "new");
  console.log("Thread  ", batch.slack_channel_id, batch.slack_thread_ts);

  const { count: seenCount } = await supabaseAdmin
    .from("scraper_seen")
    .select("id", { count: "exact", head: true })
    .eq("first_batch_id", batchId);
  const { count: rowCount } = await supabaseAdmin
    .from("scraper_rows")
    .select("id", { count: "exact", head: true })
    .eq("batch_id", batchId);

  console.log("\nWould delete:");
  console.log("  scraper_seen keys it wrote :", seenCount);
  console.log("  scraper_rows rows          :", rowCount, "(cascade)");

  // ‼️ A batch that already SPENT money is worth naming out loud before it is thrown away. The rows
  // carry the DataForSEO task ids and the scores they were bought for, and deleting them does not
  // get the money back.
  if (batch.workflow === "score" && (rowCount ?? 0) > 0) {
    console.log(
      "\n  !! This batch reached workflow 2. Its rows may hold SERPs that were paid for.\n" +
      "     Purging throws that away; it does not refund it."
    );
  }

  const replies = batch.slack_thread_ts
    ? await slack.conversationsReplies(batch.slack_channel_id, batch.slack_thread_ts, 100)
    : [];
  const mine = replies.filter((m) => Boolean(m.bot_id) || m.subtype === "bot_message");
  const theirs = replies.filter((m) => !m.bot_id && m.subtype !== "bot_message");

  console.log("\n  Slack: thread has " + replies.length + " messages, " + mine.length + " are the bot's:");
  for (const m of mine) {
    const files = Array.isArray(m.files) ? " [" + m.files.length + " file(s)]" : "";
    console.log("    " + m.ts + "  " + String(m.text ?? "").replace(/\s+/g, " ").slice(0, 70) + files);
  }
  for (const m of theirs) {
    console.log("    KEEPING (not the bot's): " + m.ts);
  }

  if (!commit) {
    console.log("\nDry run. Re-run with --commit to delete.");
    return;
  }

  for (const m of mine) {
    const res = (await slack.deleteMessage(batch.slack_channel_id, String(m.ts))) as {
      ok?: boolean;
      error?: string;
    };
    console.log("  delete " + m.ts + " " + (res.ok ? "ok" : "FAILED: " + res.error));
  }

  const keys = await supabaseAdmin.from("scraper_seen").delete().eq("first_batch_id", batchId);
  if (keys.error) throw new Error("scraper_seen: " + keys.error.message);
  const row = await supabaseAdmin.from("scraper_batches").delete().eq("id", batchId);
  if (row.error) throw new Error("scraper_batches: " + row.error.message);

  const { count: left } = await supabaseAdmin
    .from("scraper_seen")
    .select("id", { count: "exact", head: true });
  console.log("\nDone. scraper_seen now holds " + left + " keys.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
