// The scraper lane. Drop a CSV in #srt-scraper and it asks which of two jobs you want.
//
//   1️⃣ filter and verify   the seven checks, clean.csv + junk.csv, then MillionVerifier
//   2️⃣ score first          rank the companies on how visible they already are, cut the dominant
//                            ones, hand the rest to Apollo
//
// Workflow A replaces running `apollo_prefilter.py` on the Desktop. Same six checks in the same
// order, with two changes that only make sense once it lives in the app: dedup is a live query
// against `outreach_prospects` instead of a hand-exported `crm_hashes.txt` that goes stale the day
// it is written, and the survivors go to MillionVerifier without anybody uploading anything.
//
// ‼️ THE STAGE MACHINE IS THE POINT, NOT DECORATION. A batch walks
// awaiting_workflow -> (parsing -> mx -> filtered -> verifying -> done)
//                   or (scoring -> scored -> awaiting_apollo_export),
// and every stage is re-enterable, because the slow steps outlive a serverless invocation in three
// different ways: the MX sweep is thousands of our own DNS lookups, MillionVerifier runs on
// somebody else's queue for minutes to hours, and DataForSEO's standard queue takes about five
// minutes per wave. A design that tried any of them in one request would fail by truncating (see
// store.ts) or by blocking a function for an hour. `advanceBatch` is called both from the drop, so
// a small file finishes in one shot, and from the 5-minute cron, so a big one finishes at all.
//
// ‼️ EVERY GATE IS UNCONDITIONAL, THE PICKER INCLUDED. No thresholds and no auto-detection: a gate
// that only fires on the ambiguous case is a tripwire, not a review step. That is the same call
// Matthew made when the MillionVerifier size threshold came out on 2026-08-27.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { parseCsv } from "./csv";
import { filterRows } from "./filter";
import {
  resolveCityColumn,
  resolveCompanyColumn,
  resolveEmailColumn,
  resolveWebsiteColumn,
} from "./rules";
import { resolveMxBatch } from "./mx";
import {
  addScoreCost,
  allRows,
  applyMvResults,
  applyMx,
  applyScores,
  applyTaskIds,
  batchByGateTs,
  batchByThreadTs,
  countByVerdict,
  countPending,
  countScorable,
  createBatch,
  getBatch,
  insertCompanyRows,
  insertRows,
  junkBreakdown,
  knownProspectEmails,
  latestBatch,
  markQueuedForApollo,
  pendingDomains,
  rowsByVerdict,
  unscoredRows,
  updateBatch,
  type BatchRow,
  type StoredRow,
  type Workflow,
} from "./store";
import {
  buildApolloTargetsCsv,
  buildCleanCsv,
  buildJunkCsv,
  buildScoredCsv,
  buildVerifiedCsv,
  formatBreakdown,
  formatCutoffEcho,
  formatCutoffRefusal,
  formatMvSummary,
  formatCutoffCard,
  formatScoreSummary,
  formatWorkflowPicker,
} from "./report";
import {
  downloadResult,
  fileInfo,
  isConfigured as mvConfigured,
  parseResultLines,
  uploadEmails,
  type MvFileInfo,
} from "./millionverifier";
import {
  getTask,
  isConfigured as dfsConfigured,
  maxQueriesPerBatch,
  postTasks,
  TASKS_PER_POST,
} from "./dataforseo";
import {
  applyCutoff,
  buildScoreQuery,
  captionTemplate,
  CUTOFF_GRAMMAR,
  parseCutoff,
  scoreSerp,
  sortForCutoff,
  type CutoffIntent,
  type ScoredRow,
} from "./score";

const CSV_MIME = "text/csv";

/** Slack can hold a 1GB file. This lane cannot, and a huge drop is nearly always a wrong file. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 50000;

/** How long one invocation may spend on a sweep before parking the rest for the next tick. */
const MX_BUDGET_MS = 200_000;

/** The reaction names Slack sends for number keycaps. Same map drop-studio.ts uses. */
const KEYCAPS: Record<string, number> = { one: 1, two: 2, three: 3 };

/** 1️⃣ / 2️⃣ / 3️⃣ on the cutoff card, as a percentage of the file to KEEP off the bottom. */
const CUTOFF_PRESETS: Record<number, number> = { 1: 30, 2: 50, 3: 70 };

export function scraperChannel(): string {
  return process.env.SLACK_SCRAPER_CHANNEL || "";
}

interface SlackFile {
  id?: string;
  name?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private_download?: string;
  url_private?: string;
}

function isCsv(f: SlackFile): boolean {
  const name = f.name ?? "";
  const mime = f.mimetype ?? "";
  return /\.csv$/i.test(name) || f.filetype === "csv" || mime === "text/csv" || mime === "application/csv";
}

async function say(
  batch: Pick<BatchRow, "slack_channel_id" | "slack_thread_ts">,
  text: string
): Promise<string | null> {
  const res = batch.slack_thread_ts
    ? await slack.postThreadReply(batch.slack_channel_id, batch.slack_thread_ts, text)
    : await slack.postMessage(batch.slack_channel_id, text);
  const ts = (res as { ok?: boolean; ts?: string }).ts;
  return typeof ts === "string" ? ts : null;
}

/**
 * Upload a generated CSV into the batch's thread.
 *
 * ‼️ `slack.uploadFile` RETURNS `{ok:false}`, IT DOES NOT THROW, and the share silently no-ops if
 * the bot is not a member even when the call reports ok. Same trap the webinar deck records. So
 * the join is unconditional and idempotent, and a failure is NAMED in the thread rather than
 * leaving a confident summary with no file under it.
 */
async function uploadCsv(batch: BatchRow, fileName: string, body: string): Promise<boolean> {
  await slack.joinChannel(batch.slack_channel_id);
  const res = await slack.uploadFile(
    batch.slack_channel_id,
    fileName,
    Buffer.from(body, "utf8"),
    CSV_MIME,
    batch.slack_thread_ts ?? undefined
  );
  const ok = (res as { ok?: boolean }).ok === true;
  if (!ok) {
    console.error("[scraper] uploadFile failed:", fileName, JSON.stringify(res));
    await say(
      batch,
      ":warning: Could not upload `" + fileName + "`: " +
        JSON.stringify((res as { error?: string }).error ?? res)
    );
  }
  return ok;
}

async function fail(batch: BatchRow, message: string): Promise<void> {
  console.error("[scraper] batch", batch.id, "failed:", message);
  await updateBatch(batch.id, { status: "error", error: message });
  await say(batch, ":x: " + message);
}

/**
 * Re-read the dropped file.
 *
 * The drop stores headers and a file id and nothing else, because the column requirements belong to
 * a workflow that has not been chosen yet. Re-downloading on the pick costs one Slack call; the
 * alternative is inserting 50k rows for a workflow that may never be chosen, and it keeps
 * workflow A's body identical to what the 71-check probe already proves faithful to the Python.
 */
async function reloadCsv(batch: BatchRow): Promise<ReturnType<typeof parseCsv>> {
  if (!batch.slack_file_id) throw new Error("this batch has no Slack file id to re-read");
  const info = (await slack.filesInfo(batch.slack_file_id)) as {
    ok?: boolean;
    file?: SlackFile;
    error?: string;
  };
  const file = info.file;
  const url = file?.url_private_download ?? file?.url_private;
  if (!url) throw new Error("Slack would not give me that file again: " + (info.error ?? "no URL"));
  const buffer = await slack.downloadFile(url);
  return parseCsv(buffer.toString("utf8"));
}

// ── the drop ────────────────────────────────────────────────────────────────────────────────────

export interface ScraperEvent {
  channel: string;
  text: string;
  messageTs: string;
  threadTs: string | null;
  files: SlackFile[];
}

/**
 * Everything this channel does. Returns false when the message was not for it, so the caller can
 * fall through to the general assistant rather than this lane swallowing the channel.
 */
export async function handleScraperEvent(event: ScraperEvent): Promise<boolean> {
  const csvs = event.files.filter(isCsv);
  const inThread = Boolean(event.threadTs) && event.threadTs !== event.messageTs;

  // ‼️ A TOP-LEVEL DROP IS NEW; A THREADED DROP BELONGS TO ITS BATCH. Never guess. A CSV replied
  // into a thread that already has a batch is that batch's Apollo export, not a second job, and
  // starting a new batch for it would put a second picker under a workflow already in flight.
  if (csvs.length > 0 && inThread) {
    return handleThreadedCsv(event, csvs[0]);
  }

  if (csvs.length > 0) {
    for (const file of csvs) await startBatch(event, file);
    return true;
  }

  // Free text inside a thread is a cutoff instruction when that thread is waiting for one.
  if (inThread && event.text.trim()) {
    const handled = await handleThreadText(event);
    if (handled) return true;
  }

  if (/^\s*status\s*$/i.test(event.text)) {
    await reportStatus(event.channel);
    return true;
  }

  return false;
}

async function reportStatus(channel: string): Promise<void> {
  const batch = await latestBatch(channel);
  if (!batch) {
    await slack.postMessage(channel, "No batch has run in this channel yet. Drop a CSV here.");
    return;
  }
  const pending = await countPending(batch.id);
  const clean = await countByVerdict(batch.id, "clean");
  const junk = await countByVerdict(batch.id, "junk");
  const lines = [
    "*" + (batch.file_name ?? "last batch") + "*, status `" + batch.status + "`" +
      (batch.workflow ? ", workflow `" + batch.workflow + "`" : ""),
    "```",
    "rows      " + batch.total_rows,
    "clean     " + clean,
    "junk      " + junk,
    "pending   " + pending,
    "```",
  ];
  if (batch.mv_status) lines.push("MillionVerifier: `" + batch.mv_status + "`");
  if (Number(batch.score_cost_usd ?? 0) > 0) {
    lines.push("DataForSEO spend: $" + Number(batch.score_cost_usd).toFixed(4));
  }
  if (batch.error) lines.push(":x: " + batch.error);
  await slack.postMessage(channel, lines.join("\n"));
}

/**
 * A top-level CSV drop. Reads the file and asks which workflow. It does NOT start one.
 *
 * ‼️ NO COLUMN IS RESOLVED AS A GATE HERE AND NO ROW IS INSERTED. Column requirements are per
 * workflow and are checked AFTER the pick, or a company list dies at the drop on "no email column"
 * before anybody can choose 2️⃣. The resolvers still run, but only so the card can SAY what it sees.
 */
async function startBatch(event: ScraperEvent, file: SlackFile): Promise<void> {
  const threadTs = event.threadTs ?? event.messageTs;
  const caption = event.text.trim();
  const batch = await createBatch({
    channel: event.channel,
    threadTs,
    fileId: file.id ?? null,
    fileName: file.name ?? null,
    status: "awaiting_workflow",
    batchLabel: caption || null,
    scoreQueryTemplate: captionTemplate(caption),
  });

  await say(batch, "Reading `" + (file.name ?? "the file") + "`...");

  try {
    if ((file.size ?? 0) > MAX_FILE_BYTES) {
      return fail(
        batch,
        "That file is " + Math.round((file.size ?? 0) / 1048576) + "MB. The cap is 25MB. Split the export."
      );
    }

    const url = file.url_private_download ?? file.url_private;
    if (!url) return fail(batch, "Slack gave no download URL for that file.");

    const buffer = await slack.downloadFile(url);
    const parsed = parseCsv(buffer.toString("utf8"));

    if (parsed.headers.length === 0) return fail(batch, "That file has no header row.");
    if (parsed.rows.length === 0) return fail(batch, "That file has headers and no rows.");
    if (parsed.rows.length > MAX_ROWS) {
      return fail(batch, parsed.rows.length + " rows. The cap is " + MAX_ROWS + ". Split the export.");
    }

    await updateBatch(batch.id, { total_rows: parsed.rows.length, headers: parsed.headers });

    const fresh = (await getBatch(batch.id)) ?? batch;
    await postWorkflowPicker(fresh, parsed.headers);
  } catch (e) {
    await fail(batch, (e as Error).message);
  }
}

/** Guarded on `workflow_pick_ts`, so a cron re-entry re-reads one row and posts nothing. */
async function postWorkflowPicker(batch: BatchRow, headers: string[]): Promise<void> {
  if (batch.workflow_pick_ts) return;
  const ts = await say(
    batch,
    formatWorkflowPicker({
      fileName: batch.file_name,
      totalRows: batch.total_rows,
      emailColumn: resolveEmailColumn(headers),
      companyColumn: resolveCompanyColumn(headers),
      cityColumn: resolveCityColumn(headers),
      websiteColumn: resolveWebsiteColumn(headers),
    })
  );
  await updateBatch(batch.id, { workflow_pick_ts: ts });
}

/**
 * A CSV replied into a thread that already has a batch.
 *
 * The only thing that can legitimately be is the Apollo export for a batch parked at
 * `awaiting_apollo_export`. Anything else says so and does nothing, because guessing here starts a
 * job against the wrong file.
 */
async function handleThreadedCsv(event: ScraperEvent, file: SlackFile): Promise<boolean> {
  const threadTs = event.threadTs as string;
  const parent = await batchByThreadTs(event.channel, threadTs);
  if (!parent) return false;

  if (parent.status !== "awaiting_apollo_export") {
    await say(
      parent,
      "That CSV landed in a thread whose batch is at `" + parent.status + "`, so I left it alone. " +
        "An Apollo export belongs in a thread waiting for one; a new list belongs at the top level of the channel."
    );
    return true;
  }

  await updateBatch(parent.id, { apollo_export_file_id: file.id ?? null, status: "done" });

  // ‼️ A CHILD BATCH, NOT A REUSE OF THE PARENT'S ROWS. `scraper_rows` is keyed
  // (batch_id, row_index) and the Apollo export's indices collide with the scored companies', so
  // reusing the row would either overwrite the score audit trail or need an offset nobody could
  // read later. Two rows in the table, one thread on screen.
  const child = await createBatch({
    channel: event.channel,
    threadTs,
    fileId: file.id ?? null,
    fileName: file.name ?? null,
    status: "awaiting_workflow",
    workflow: "filter",
    batchLabel: parent.batch_label,
    parentBatchId: parent.id,
  });

  await say(child, "Apollo export received. Filtering it now, no picker: this thread already chose.");

  try {
    const url = file.url_private_download ?? file.url_private;
    if (!url) {
      await fail(child, "Slack gave no download URL for that file.");
      return true;
    }

    const buffer = await slack.downloadFile(url);
    const parsed = parseCsv(buffer.toString("utf8"));
    if (parsed.headers.length === 0) {
      await fail(child, "That file has no header row.");
      return true;
    }
    if (parsed.rows.length === 0) {
      await fail(child, "That file has headers and no rows.");
      return true;
    }
    if (parsed.rows.length > MAX_ROWS) {
      await fail(child, parsed.rows.length + " rows. The cap is " + MAX_ROWS + ". Split the export.");
      return true;
    }

    await updateBatch(child.id, { total_rows: parsed.rows.length, headers: parsed.headers });
    const fresh = (await getBatch(child.id)) ?? child;
    await beginFilterWorkflow(fresh, parsed);
  } catch (e) {
    await fail(child, (e as Error).message);
  }
  return true;
}

// ── the two workflow entries ────────────────────────────────────────────────────────────────────

/**
 * 1️⃣ Filter and verify. This is the old `startBatch` tail, unchanged in behaviour.
 *
 * The email column is resolved HERE rather than at the drop, which is the whole point of the
 * picker: a company list must be able to reach 2️⃣ without dying on this check first.
 */
async function beginFilterWorkflow(batch: BatchRow, parsed: ReturnType<typeof parseCsv>): Promise<void> {
  const emailColumn = resolveEmailColumn(parsed.headers);
  if (!emailColumn) {
    // Naming what WAS found is the difference between a message he can act on and the Python's
    // "Column 'email' not in CSV", which required opening the file to find out what to change.
    return fail(
      batch,
      "No email column in that file, so there is nothing to filter. Headers found: " +
        parsed.headers.map((h) => "`" + h + "`").join(", ")
    );
  }

  const knownEmails = await knownProspectEmails();
  const filtered = filterRows({ rows: parsed.rows, emailColumn, knownEmails });

  await insertRows(batch.id, filtered.rows);
  await updateBatch(batch.id, {
    status: "mx",
    workflow: "filter",
    email_column: emailColumn,
    total_rows: parsed.rows.length,
    headers: parsed.headers,
  });

  const fresh = await getBatch(batch.id);
  if (fresh) await advanceBatch(fresh);
}

/**
 * 2️⃣ Score first.
 *
 * Company is required the way email is for workflow A: there is nothing to search for without it.
 * City and website are optional, and their ABSENCE is a "not measured" signal in score.ts rather
 * than a zero, which is why neither is checked here.
 */
async function beginScoreWorkflow(batch: BatchRow, parsed: ReturnType<typeof parseCsv>): Promise<void> {
  const companyColumn = resolveCompanyColumn(parsed.headers);
  if (!companyColumn) {
    return fail(
      batch,
      "No company column in that file, so there is nothing to score. Headers found: " +
        parsed.headers.map((h) => "`" + h + "`").join(", ")
    );
  }

  const cityColumn = resolveCityColumn(parsed.headers);
  const websiteColumn = resolveWebsiteColumn(parsed.headers);

  await insertCompanyRows(
    batch.id,
    parsed.rows.map((raw, rowIndex) => ({
      rowIndex,
      raw,
      company: (raw[companyColumn] ?? "").trim() || null,
      city: cityColumn ? (raw[cityColumn] ?? "").trim() || null : null,
      website: websiteColumn ? (raw[websiteColumn] ?? "").trim() || null : null,
    }))
  );

  await updateBatch(batch.id, {
    status: "scoring",
    workflow: "score",
    total_rows: parsed.rows.length,
    headers: parsed.headers,
  });

  const missing: string[] = [];
  if (!cityColumn) missing.push("city");
  if (!websiteColumn) missing.push("website");
  if (missing.length) {
    // Stated at the start rather than discovered in the CSV, because it changes what the numbers
    // mean: those components leave the denominator for every row in the file.
    await say(
      batch,
      "No `" + missing.join("` and no `") + "` column in that file. Those components will read " +
        "*not measured* for every row rather than scoring zero, so the scores stay comparable."
    );
  }

  const fresh = await getBatch(batch.id);
  if (fresh) await advanceBatch(fresh);
}

// ── the stage machine ───────────────────────────────────────────────────────────────────────────

/**
 * Move one batch as far as it can go inside this invocation.
 *
 * Re-entrant and idempotent at every stage: whatever it did not finish is left in a state the next
 * call resumes from. It never throws at the caller; a failure lands on the row and in the thread.
 */
export async function advanceBatch(batch: BatchRow, deadline = Date.now() + MX_BUDGET_MS): Promise<void> {
  try {
    if (batch.status === "awaiting_workflow") {
      // The picker card is guarded, so this only does work when the drop-time post failed.
      if (batch.headers) await postWorkflowPicker(batch, batch.headers);
      return;
    }

    if (batch.status === "parsing") {
      // A pick that died between the status write and the workflow entry, which is a real shape
      // here because the pick re-downloads the file from Slack. Without this arm the batch sits at
      // `parsing` forever with a picker nobody can react to twice, and NOTHING would ever say so.
      // Re-driving is safe: both inserters upsert with ignoreDuplicates on (batch_id, row_index).
      if (!batch.workflow) return;
      const parsed = await reloadCsv(batch);
      if (batch.workflow === "filter") await beginFilterWorkflow(batch, parsed);
      else await beginScoreWorkflow(batch, parsed);
      // Both entries drive the rest of the machine themselves, so this call is done.
      return;
    }

    if (batch.status === "scoring") {
      const done = await sweepScoring(batch, deadline);
      if (!done) return;
      batch = (await getBatch(batch.id)) ?? batch;
    }

    if (batch.status === "scored") {
      await publishScores(batch);
      return;
    }

    if (batch.status === "mx") {
      const done = await sweepMx(batch, deadline);
      if (!done) return;
      batch = (await getBatch(batch.id)) ?? batch;
    }

    if (batch.status === "filtered") {
      const advanced = await publishResults(batch);
      if (!advanced) return;
      batch = (await getBatch(batch.id)) ?? batch;
    }

    if (batch.status === "verifying") {
      await pollVerification(batch);
    }
  } catch (e) {
    await fail(batch, (e as Error).message);
  }
}

/** Returns true when nothing is pending any more and the batch has moved to `filtered`. */
async function sweepMx(batch: BatchRow, deadline: number): Promise<boolean> {
  const domains = await pendingDomains(batch.id);

  if (domains.length > 0) {
    const { verdicts, undetermined } = await resolveMxBatch(domains, { deadline });
    await applyMx(batch.id, verdicts);
    if (undetermined > 0) {
      console.warn("[scraper]", batch.id, undetermined, "domains undetermined, will re-ask next tick");
    }
  }

  const pending = await countPending(batch.id);
  if (pending > 0) {
    // Parked, not stuck. The cron picks it up in five minutes and asks about the rest.
    console.log("[scraper]", batch.id, pending, "rows still pending MX");
    return false;
  }

  const clean = await countByVerdict(batch.id, "clean");
  const junk = await countByVerdict(batch.id, "junk");
  await updateBatch(batch.id, { status: "filtered", clean_count: clean, junk_count: junk });
  return true;
}

// ── workflow B: the scoring sweep ───────────────────────────────────────────────────────────────

/**
 * Post the SERPs that have not been posted and collect the ones that are ready.
 *
 * Returns true when every scorable row has a score and the batch has moved to `scored`.
 *
 * ‼️ THE SPEND CAP IS CHECKED BEFORE THE FIRST POST AND REFUSES WITH THE COUNT. DataForSEO charges
 * at task_post, so a cap enforced after the fact is not a cap. Refusing rather than truncating is
 * deliberate: a silently half-scored file produces a ranking whose bottom half is missing, and the
 * bottom is the pile that gets scraped.
 */
async function sweepScoring(batch: BatchRow, deadline: number): Promise<boolean> {
  if (!dfsConfigured()) {
    // Handled, not a bug. The list is still worth having in file order.
    await updateBatch(batch.id, { status: "scored" });
    await say(
      batch,
      "`DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` are not set, so nothing was scored and nothing " +
        "was spent. `scored.csv` will come out in file order with every row marked *not measured*."
    );
    return true;
  }

  const scorable = await countScorable(batch.id);
  const cap = maxQueriesPerBatch();
  if (scorable > cap) {
    return (
      await fail(
        batch,
        scorable + " companies is over the " + cap + " query cap, and DataForSEO bills per query " +
          "on the way in. Raise `DATAFORSEO_MAX_QUERIES_PER_BATCH` or split the file."
      ),
      false
    );
  }

  const pending = await unscoredRows(batch.id);
  if (pending.length === 0) {
    await updateBatch(batch.id, { status: "scored" });
    return true;
  }

  // 1. Queue everything that has never been queued. Guarded on a null task id, the same shape as
  //    MillionVerifier's `mv_file_id` guard, so a retried tick cannot buy the same list twice.
  const unposted = pending.filter((r) => !r.dataforseo_task_id);
  for (let i = 0; i < unposted.length; i += TASKS_PER_POST) {
    if (Date.now() > deadline) break;
    const slice = unposted.slice(i, i + TASKS_PER_POST);
    const posted = await postTasks(
      slice.map((row) => ({
        tag: row.id,
        keyword: buildScoreQuery(batch.score_query_template, {
          company: row.company ?? "",
          city: row.city,
        }),
        locationName: null,
      }))
    );

    // Written IMMEDIATELY. The account is already charged; an id that never lands is money spent on
    // a company that never scores and leaves no trace anywhere.
    const ids = new Map<string, string>();
    let cost = 0;
    for (const p of posted) {
      if (p.taskId) ids.set(p.tag, p.taskId);
      cost += p.costUsd;
    }
    await applyTaskIds(ids);
    await addScoreCost(batch.id, cost);

    const failures = posted.filter((p) => !p.taskId);
    if (failures.length) {
      console.error("[scraper]", batch.id, failures.length, "tasks refused:", failures[0].error);
    }
  }

  // 2. Collect whatever is ready. Free, and a task stays fetchable for 30 days, so there is no
  //    hurry and no penalty for a tick that only gets through half of them.
  const collectable = (await unscoredRows(batch.id)).filter((r) => r.dataforseo_task_id);
  const writes: Array<{ rowId: string; score: number; components: Record<string, unknown> }> = [];
  let stillPending = 0;

  for (const row of collectable) {
    if (Date.now() > deadline) {
      stillPending++;
      continue;
    }
    const result = await getTask(row.dataforseo_task_id as string);
    if (result.state === "pending") {
      stillPending++;
      continue;
    }
    if (result.state === "failed") {
      // A refused task is not a zero. The row keeps a null score and is reported as not measured.
      console.error("[scraper]", batch.id, "task failed for", row.company, result.error);
      continue;
    }
    const scored = scoreSerp(result.payload ?? {}, {
      company: row.company ?? "",
      website: row.website,
    });
    // ‼️ A NULL SCORE IS NOT WRITTEN. Nothing could be measured, so the next tick asks again.
    if (scored.score === null) continue;
    writes.push({
      rowId: row.id,
      score: scored.score,
      components: { ...scored.components, measured: scored.measured },
    });
  }

  if (writes.length) await applyScores(writes);

  const left = await unscoredRows(batch.id);
  if (left.length > 0 && stillPending > 0) {
    console.log("[scraper]", batch.id, left.length, "rows still waiting on DataForSEO");
    return false;
  }
  if (left.length > 0 && writes.length > 0) {
    // Progress was made and nothing is queued; go round again on the next tick rather than
    // declaring a partially scored file finished.
    return false;
  }

  await updateBatch(batch.id, { status: "scored" });
  return true;
}

/** The rows of a scored batch, in scored.csv order: most dominant first, unmeasured last. */
async function scoredRowsInOrder(batchId: string): Promise<StoredRow[]> {
  return sortForCutoff(await allRows(batchId), (r) => r.dominance_score);
}

/**
 * Post the summary, then scored.csv, then the cutoff card, then stop.
 *
 * The card goes LAST, under the file, the same order `publishResults` uses for the MillionVerifier
 * gate and for the same reason: "react on THIS message" has to sit below the thing it is asking you
 * to read first.
 *
 * Guarded twice, also like `publishResults`: `csv_posted_at` so the file cannot be posted twice and
 * `scoring_approval_ts` so the card cannot. A cron re-entry every five minutes does nothing but
 * re-read one row.
 */
async function publishScores(batch: BatchRow): Promise<void> {
  const headers = batch.headers ?? [];
  const rows = await scoredRowsInOrder(batch.id);
  const measured = rows.filter((r) => r.dominance_score !== null);

  if (!batch.csv_posted_at) {
    const scores = measured.map((r) => r.dominance_score as number);
    await say(
      batch,
      formatScoreSummary({
        fileName: batch.file_name,
        queryTemplate: buildScoreQuery(batch.score_query_template, {
          company: "{company}",
          city: "{city}",
        }),
        scored: measured.length,
        unmeasured: rows.length - measured.length,
        costUsd: Number(batch.score_cost_usd ?? 0),
        high: scores.length ? Math.max(...scores) : null,
        low: scores.length ? Math.min(...scores) : null,
      })
    );

    await uploadCsv(
      batch,
      "scored.csv",
      buildScoredCsv(
        headers,
        rows.map((r) => ({ raw: r.raw, score: r.dominance_score, measured: readMeasured(r) }))
      )
    );
    await updateBatch(batch.id, { csv_posted_at: new Date().toISOString() });
  }

  if (!batch.scoring_approval_ts) {
    const ts = await say(batch, formatCutoffCard());
    await updateBatch(batch.id, { scoring_approval_ts: ts });
  }
}

/** `score_components.measured` as written by sweepScoring, with an honest fallback. */
function readMeasured(row: StoredRow): string {
  const m = row.score_components && (row.score_components as { measured?: unknown }).measured;
  if (typeof m === "string") return m;
  return row.dominance_score === null ? "not measured" : "";
}

// ── workflow B: the cutoff ──────────────────────────────────────────────────────────────────────

/** Free text in a thread. Only a batch parked at `scored` has anything to do with it. */
async function handleThreadText(event: ScraperEvent): Promise<boolean> {
  const batch = await batchByThreadTs(event.channel, event.threadTs as string);
  if (!batch || batch.status !== "scored") return false;

  const intent = parseCutoff(event.text);
  if (!intent) {
    await say(batch, formatCutoffRefusal(event.text, CUTOFF_GRAMMAR));
    return true;
  }
  await proposeCutoff(batch, intent, event.text.trim());
  return true;
}

/**
 * Work out the split and echo it back. Nothing is deleted until the echo card is reacted on.
 *
 * ‼️ THIS IS THE SECOND GATE, NOT A CONFIRMATION OF THE FIRST. The descending sort already means
 * "the first 10" and the rows he is reading are the same thing, so this is no longer disambiguating
 * a direction. It survives because the count is the one number nobody can recover afterwards.
 */
async function proposeCutoff(batch: BatchRow, intent: CutoffIntent, spoken: string): Promise<void> {
  const rows = await scoredRowsInOrder(batch.id);
  const scored: ScoredRow[] = rows.map((r) => ({
    id: r.id,
    company: r.company,
    score: r.dominance_score,
  }));
  const plan = applyCutoff(scored, intent);

  const ts = await say(batch, formatCutoffEcho(plan, spoken));
  await updateBatch(batch.id, { score_cutoff: spoken, cutoff_confirm_ts: ts });
}

/**
 * The cutoff is confirmed. Post both piles.
 *
 * ‼️ BOTH FILES, NEVER JUST THE SURVIVORS. The split is the product: the dominant pile feeds the
 * cold-email project and the rest gets scraped. Posting only apollo_targets.csv would throw away
 * half of what the scoring was for.
 */
async function commitCutoff(batch: BatchRow): Promise<void> {
  if (!batch.score_cutoff) return;
  const intent = parseCutoff(batch.score_cutoff);
  if (!intent) return fail(batch, "I could no longer read the stored cutoff `" + batch.score_cutoff + "`.");

  const headers = batch.headers ?? [];
  const rows = await scoredRowsInOrder(batch.id);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const plan = applyCutoff(
    rows.map((r) => ({ id: r.id, company: r.company, score: r.dominance_score })),
    intent
  );

  const toCsvRows = (ids: ScoredRow[]) =>
    ids
      .map((s) => byId.get(s.id))
      .filter((r): r is StoredRow => Boolean(r))
      .map((r) => ({ raw: r.raw, score: r.dominance_score, measured: readMeasured(r) }));

  if (plan.dropped.length > 0) {
    await uploadCsv(batch, "dominant.csv", buildScoredCsv(headers, toCsvRows(plan.dropped)));
  }

  const keptRows = plan.kept.map((s) => byId.get(s.id)).filter((r): r is StoredRow => Boolean(r));
  await markQueuedForApollo(batch.id, keptRows.map((r) => r.id));
  await uploadCsv(
    batch,
    "apollo_targets.csv",
    buildApolloTargetsCsv(keptRows.map((r) => ({ company: r.company, website: r.website })))
  );

  await updateBatch(batch.id, { status: "awaiting_apollo_export" });
  await say(
    batch,
    "*" + plan.dropped.length + " dropped, " + plan.kept.length + " to scrape.*\n" +
      "`dominant.csv` is the pile for the email project, every original column kept.\n" +
      "`apollo_targets.csv` is the search list.\n\n" +
      "Reveal the contacts in Apollo and drop the export back *in this thread*. It picks up from " +
      "there and goes straight into the filter, no picker."
  );
}

// ── workflow A, unchanged below this line ───────────────────────────────────────────────────────

/**
 * Post the breakdown and both CSVs, then decide about MillionVerifier.
 *
 * Returns true when the batch moved on to `verifying`. It returns FALSE both when the run is
 * finished locally (no key, nothing clean) and when it is waiting on a ✅, because in neither case
 * is there anything more for this invocation to do.
 */
async function publishResults(batch: BatchRow): Promise<boolean> {
  const headers = batch.headers ?? [];

  // Guarded so a re-entry after an approval wait cannot post the same two files again.
  if (!batch.csv_posted_at) {
    const cleanRows = await rowsByVerdict(batch.id, "clean");
    const junkRows = await rowsByVerdict(batch.id, "junk");
    const breakdown = await junkBreakdown(batch.id);

    await say(
      batch,
      formatBreakdown({
        fileName: batch.file_name,
        emailColumn: batch.email_column,
        total: batch.total_rows,
        clean: cleanRows.length,
        junk: junkRows.length,
        breakdown,
      })
    );

    if (cleanRows.length > 0) await uploadCsv(batch, "clean.csv", buildCleanCsv(headers, cleanRows));
    if (junkRows.length > 0) await uploadCsv(batch, "junk.csv", buildJunkCsv(headers, junkRows));

    await updateBatch(batch.id, { csv_posted_at: new Date().toISOString() });
  }

  const cleanCount = await countByVerdict(batch.id, "clean");

  if (cleanCount === 0) {
    await updateBatch(batch.id, { status: "done" });
    await say(batch, "Nothing survived the filter, so there is nothing to verify.");
    return false;
  }

  if (!mvConfigured()) {
    await updateBatch(batch.id, { status: "done" });
    await say(batch, "`MILLIONVERIFIER_API_KEY` is not set, so upload `clean.csv` there by hand.");
    return false;
  }

  // ‼️ EVERY BATCH STOPS HERE. THE UPLOAD IS NEVER AUTOMATIC, AT ANY SIZE.
  //
  // This was a size cap once (`SCRAPER_MV_MAX_EMAILS`, gate above N, send below it) and Matthew
  // reversed it on 2026-08-27: the point of layer 1 is a list a person READS before layer 2 is
  // paid for, and a threshold means the small runs, which is most of them, get spent before
  // anyone has opened clean.csv. A gate that only fires on the unusual case is not a review step,
  // it is a tripwire.
  //
  // So the card goes up with the count on it and nothing moves until a human reacts. The batch
  // parks in `filtered` indefinitely, which is correct: approval can come days later, and the two
  // guards below mean a cron re-entry every five minutes does nothing but re-read a row.
  if (!batch.mv_approval_ts) {
    const ts = await say(
      batch,
      "*" +
        cleanCount +
        " addresses passed the filter.* Read `clean.csv` above before this goes anywhere.\n" +
        "MillionVerifier bills per address, so nothing is sent until you react " +
        ":white_check_mark: on THIS message."
    );
    await updateBatch(batch.id, { mv_awaiting_approval: true, mv_approval_ts: ts });
    return false;
  }

  // The card is up and nobody has reacted yet.
  if (batch.mv_awaiting_approval) return false;

  const cleanRows = await rowsByVerdict(batch.id, "clean");
  const emails = cleanRows.map((r) => r.email).filter((e): e is string => Boolean(e));

  const info = await uploadEmails(emails, (batch.file_name ?? "clean") + ".txt");
  if (!info.file_id) throw new Error("MillionVerifier returned no file_id");

  await updateBatch(batch.id, {
    status: "verifying",
    mv_file_id: info.file_id,
    mv_status: info.status,
    mv_awaiting_approval: false,
  });

  const eta = info.estimated_time_sec ? ", est. " + Math.ceil(info.estimated_time_sec / 60) + " min" : "";
  await say(batch, "Sent " + emails.length + " addresses to MillionVerifier" + eta + ".");
  return true;
}

async function pollVerification(batch: BatchRow): Promise<void> {
  if (!batch.mv_file_id) throw new Error("batch is verifying with no mv_file_id");

  const info: MvFileInfo = await fileInfo(batch.mv_file_id);
  await updateBatch(batch.id, { mv_status: info.status });

  if (info.status === "in_progress" || info.status === "in_queue_to_start" || info.status === "paused") {
    return;
  }
  if (info.status !== "finished") {
    return fail(batch, "MillionVerifier returned `" + info.status + "`" + (info.error ? ": " + info.error : ""));
  }

  // `all` first, so every clean row gets its verdict recorded and not only the ones that passed.
  // A row that came back `invalid` is the most useful thing this whole lane learns.
  const all = parseResultLines(await downloadResult(batch.mv_file_id, "all"));
  await applyMvResults(batch.id, all);

  const counts = {
    ok: info.ok,
    catch_all: info.catch_all,
    unknown: info.unknown,
    invalid: info.invalid,
    disposable: info.disposable,
  };
  await updateBatch(batch.id, { status: "done", mv_counts: counts });

  const headers = batch.headers ?? [];
  const cleanRows = await rowsByVerdict(batch.id, "clean");
  const okRows = cleanRows.filter((r) => r.mv_result === "ok");

  await say(batch, formatMvSummary(batch.file_name, counts));
  if (okRows.length > 0) await uploadCsv(batch, "verified-ok.csv", buildVerifiedCsv(headers, okRows));
}

// ── the gate router ─────────────────────────────────────────────────────────────────────────────

/**
 * Every reaction this lane acts on.
 *
 * ‼️ THE GATE IS RESOLVED FROM WHICH CARD WAS REACTED TO, NEVER GUESSED. Four gate cards now live
 * in one thread and they mean four different things, one of which SPENDS MONEY. `batchByGateTs`
 * answers both questions at once; a handler that resolved the batch and then inferred the card
 * would eventually release a MillionVerifier upload on a reaction meant for the picker.
 *
 * Returns false for anything not aimed at this lane, so the general reaction handlers still run.
 */
export async function handleScraperReaction(input: {
  reaction: string;
  channel: string;
  slackTs: string;
}): Promise<boolean> {
  if (!scraperChannel() || input.channel !== scraperChannel()) return false;

  const keycap = KEYCAPS[input.reaction];
  const isCheck = input.reaction === "white_check_mark";
  if (!keycap && !isCheck) return false;

  const found = await batchByGateTs(input.channel, input.slackTs);
  if (!found) return false;
  const { batch, gate } = found;

  switch (gate) {
    case "workflow_pick": {
      if (!keycap || keycap > 2) return false;
      // Guarded: a second reaction on the picker must not re-parse and re-insert the whole file.
      if (batch.workflow) return true;
      waitUntil(runWorkflowPick(batch, keycap === 1 ? "filter" : "score"));
      return true;
    }

    case "scoring_approval": {
      if (!keycap) return false;
      const pct = CUTOFF_PRESETS[keycap];
      if (!pct) return false;
      if (batch.status !== "scored") return true;
      waitUntil(
        proposeCutoff(batch, { kind: "keep_bottom_pct", pct }, "keep the bottom " + pct + "%").catch((e) =>
          fail(batch, (e as Error).message)
        )
      );
      return true;
    }

    case "cutoff_confirm": {
      if (!isCheck) return false;
      if (batch.status !== "scored") return true;
      waitUntil(commitCutoff(batch).catch((e) => fail(batch, (e as Error).message)));
      return true;
    }

    case "mv_approval": {
      if (!isCheck) return false;
      if (!batch.mv_awaiting_approval) return false;
      waitUntil(releaseMvUpload(batch));
      return true;
    }
  }
}

async function releaseMvUpload(batch: BatchRow): Promise<void> {
  await updateBatch(batch.id, { mv_awaiting_approval: false });
  const fresh = await getBatch(batch.id);
  if (fresh) await advanceBatch(fresh);
}

/** Re-read the file and hand it to the chosen workflow. */
async function runWorkflowPick(batch: BatchRow, workflow: Workflow): Promise<void> {
  try {
    await updateBatch(batch.id, { workflow, status: "parsing" });
    const parsed = await reloadCsv(batch);
    const fresh = (await getBatch(batch.id)) ?? batch;
    if (workflow === "filter") await beginFilterWorkflow(fresh, parsed);
    else await beginScoreWorkflow(fresh, parsed);
  } catch (e) {
    await fail(batch, (e as Error).message);
  }
}
