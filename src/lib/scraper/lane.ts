// The scraper lane. Drop an Apollo export in #srt-scraper, get clean.csv and junk.csv back.
//
// This replaces running `apollo_prefilter.py` on the Desktop. Same six checks in the same order,
// with two changes that only make sense once it lives in the app: dedup is a live query against
// `outreach_prospects` instead of a hand-exported `crm_hashes.txt` that goes stale the day it is
// written, and the survivors go to MillionVerifier without anybody uploading anything.
//
// ‼️ THE STAGE MACHINE IS THE POINT, NOT DECORATION. A batch walks
// parsing -> mx -> filtered -> verifying -> done, and every stage is re-enterable, because the two
// slow steps here outlive a serverless invocation in opposite ways: the MX sweep is thousands of
// our own DNS lookups, and MillionVerifier takes minutes to hours on somebody else's queue. A
// design that tried to do either in one request would fail by truncating (see store.ts) or by
// blocking a function for an hour. `advanceBatch` is called both from the drop, so a small file
// finishes in one shot, and from the 5-minute cron, so a big one finishes at all.

import { waitUntil } from "@vercel/functions";
import { slack } from "@/lib/slack-bot";
import { parseCsv } from "./csv";
import { filterRows } from "./filter";
import { resolveEmailColumn } from "./rules";
import { resolveMxBatch } from "./mx";
import {
  applyMvResults,
  applyMx,
  batchByApprovalTs,
  countByVerdict,
  countPending,
  createBatch,
  getBatch,
  insertRows,
  junkBreakdown,
  knownProspectEmails,
  latestBatch,
  pendingDomains,
  rowsByVerdict,
  updateBatch,
  type BatchRow,
} from "./store";
import {
  buildCleanCsv,
  buildJunkCsv,
  buildVerifiedCsv,
  formatBreakdown,
  formatMvSummary,
} from "./report";
import {
  downloadResult,
  fileInfo,
  isConfigured as mvConfigured,
  maxEmails,
  parseResultLines,
  uploadEmails,
  type MvFileInfo,
} from "./millionverifier";

const CSV_MIME = "text/csv";

/** Slack can hold a 1GB file. This lane cannot, and a huge drop is nearly always a wrong file. */
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_ROWS = 50000;

/** How long one invocation may spend resolving MX before parking the rest for the next tick. */
const MX_BUDGET_MS = 200_000;

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

async function say(batch: Pick<BatchRow, "slack_channel_id" | "slack_thread_ts">, text: string): Promise<string | null> {
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
    await say(batch, ":warning: Could not upload `" + fileName + "`: " + JSON.stringify((res as { error?: string }).error ?? res));
  }
  return ok;
}

async function fail(batch: BatchRow, message: string): Promise<void> {
  console.error("[scraper] batch", batch.id, "failed:", message);
  await updateBatch(batch.id, { status: "error", error: message });
  await say(batch, ":x: " + message);
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

  if (csvs.length > 0) {
    for (const file of csvs) await startBatch(event, file);
    return true;
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
    await slack.postMessage(channel, "No batch has run in this channel yet. Drop an Apollo CSV here.");
    return;
  }
  const pending = await countPending(batch.id);
  const clean = await countByVerdict(batch.id, "clean");
  const junk = await countByVerdict(batch.id, "junk");
  const lines = [
    "*" + (batch.file_name ?? "last batch") + "*, status `" + batch.status + "`",
    "```",
    "rows      " + batch.total_rows,
    "clean     " + clean,
    "junk      " + junk,
    "pending   " + pending,
    "```",
  ];
  if (batch.mv_status) lines.push("MillionVerifier: `" + batch.mv_status + "`");
  if (batch.error) lines.push(":x: " + batch.error);
  await slack.postMessage(channel, lines.join("\n"));
}

async function startBatch(event: ScraperEvent, file: SlackFile): Promise<void> {
  const threadTs = event.threadTs ?? event.messageTs;
  const batch = await createBatch({
    channel: event.channel,
    threadTs,
    fileId: file.id ?? null,
    fileName: file.name ?? null,
  });

  await say(batch, "Reading `" + (file.name ?? "the file") + "`...");

  try {
    if ((file.size ?? 0) > MAX_FILE_BYTES) {
      return fail(batch, "That file is " + Math.round((file.size ?? 0) / 1048576) + "MB. The cap is 25MB. Split the export.");
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

    const emailColumn = resolveEmailColumn(parsed.headers);
    if (!emailColumn) {
      // Naming what WAS found is the difference between a message he can act on and the Python's
      // "Column 'email' not in CSV", which required opening the file to find out what to change.
      return fail(
        batch,
        "No email column in that file. Headers found: " + parsed.headers.map((h) => "`" + h + "`").join(", ")
      );
    }

    const knownEmails = await knownProspectEmails();
    const filtered = filterRows({ rows: parsed.rows, emailColumn, knownEmails });

    await insertRows(batch.id, filtered.rows);
    await updateBatch(batch.id, {
      status: "mx",
      email_column: emailColumn,
      total_rows: parsed.rows.length,
      headers: parsed.headers,
    });

    const fresh = await getBatch(batch.id);
    if (fresh) await advanceBatch(fresh);
  } catch (e) {
    await fail(batch, (e as Error).message);
  }
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

  const cap = maxEmails();
  if (cleanCount > cap && !batch.mv_approval_ts) {
    // The expensive failure is a file whose email column was mis-resolved: it produces a
    // plausible-looking upload of every row in the export, billed per address. Above the cap a
    // person looks at the number first.
    const ts = await say(
      batch,
      cleanCount +
        " clean addresses is over the " +
        cap +
        " cap, and MillionVerifier bills per address.\nReact :white_check_mark: on this message to send them."
    );
    await updateBatch(batch.id, { mv_awaiting_approval: true, mv_approval_ts: ts });
    return false;
  }
  if (cleanCount > cap && batch.mv_awaiting_approval) return false;

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

// ── the approval reaction ───────────────────────────────────────────────────────────────────────

/**
 * ✅ on an over-cap card releases the upload. Returns false for any other message, so the general
 * reaction handlers still run.
 */
export async function handleScraperReaction(input: {
  reaction: string;
  channel: string;
  slackTs: string;
}): Promise<boolean> {
  if (!scraperChannel() || input.channel !== scraperChannel()) return false;
  if (input.reaction !== "white_check_mark") return false;

  const batch = await batchByApprovalTs(input.channel, input.slackTs);
  if (!batch || !batch.mv_awaiting_approval) return false;

  await updateBatch(batch.id, { mv_awaiting_approval: false });
  const fresh = await getBatch(batch.id);
  if (fresh) waitUntil(advanceBatch(fresh));
  return true;
}
