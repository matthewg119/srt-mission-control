// Supabase for the scraper lane. Two tables: `scraper_batches` (one per dropped file) and
// `scraper_rows` (one per line of it).
//
// ‼️ THE ROWS ARE WRITTEN BEFORE THE MX SWEEP RUNS, AND THAT IS THE WHOLE REASON THIS LANE IS
// RESUMABLE. A Vercel function caps at 300s. A 20k-row pull with 8k unique domains does not finish
// its DNS sweep inside that, and a one-pass design fails by SILENTLY TRUNCATING rather than by
// erroring: the run just posts a smaller clean.csv and nothing says which leads were never asked
// about. Rows land first with `mx_ok = null`, the sweep fills them in across ticks, and a batch is
// only allowed to produce a CSV once nothing is pending.

import { supabaseAdmin } from "@/lib/db";
import type { FilteredRow } from "./filter";
import type { JunkReason } from "./rules";

export type BatchStatus = "parsing" | "mx" | "filtered" | "verifying" | "done" | "error";

export interface BatchRow {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  slack_file_id: string | null;
  file_name: string | null;
  status: BatchStatus;
  email_column: string | null;
  /** The header row of the dropped file, verbatim and in order. See report.ts for why. */
  headers: string[] | null;
  total_rows: number;
  clean_count: number;
  junk_count: number;
  mv_file_id: string | null;
  mv_status: string | null;
  mv_counts: Record<string, unknown> | null;
  mv_awaiting_approval: boolean;
  mv_approval_ts: string | null;
  /** Stamped once clean.csv and junk.csv are in the thread, so a re-entry cannot post them twice. */
  csv_posted_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredRow {
  row_index: number;
  email: string | null;
  domain: string | null;
  raw: Record<string, string>;
  verdict: "clean" | "junk" | null;
  reason: JunkReason | null;
  mx_ok: boolean | null;
  mv_result: string | null;
}

const BATCH_COLUMNS =
  "id, slack_channel_id, slack_thread_ts, slack_file_id, file_name, status, email_column, " +
  "headers, total_rows, clean_count, junk_count, mv_file_id, mv_status, mv_counts, " +
  "mv_awaiting_approval, mv_approval_ts, csv_posted_at, error, created_at, updated_at";

// Supabase-js issues selects and filtered updates as GET/PATCH with the filter in the QUERY STRING,
// so an `.in()` list is bounded by URL length rather than by anything Postgres cares about. 100
// domains of ~20 chars keeps a chunk near 2KB, well under every proxy limit in the path.
const IN_CHUNK = 100;
const INSERT_CHUNK = 500;
const PAGE = 1000;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function createBatch(input: {
  channel: string;
  threadTs: string | null;
  fileId: string | null;
  fileName: string | null;
}): Promise<BatchRow> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .insert({
      slack_channel_id: input.channel,
      slack_thread_ts: input.threadTs,
      slack_file_id: input.fileId,
      file_name: input.fileName,
      status: "parsing",
    })
    .select(BATCH_COLUMNS)
    .single();
  if (error) throw new Error("createBatch: " + error.message);
  return data as unknown as BatchRow;
}

export async function updateBatch(id: string, patch: Partial<BatchRow>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("scraper_batches")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("updateBatch: " + error.message);
}

export async function getBatch(id: string): Promise<BatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(BATCH_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error("getBatch: " + error.message);
  return (data as unknown as BatchRow) ?? null;
}

/** Batches the tick has work to do on, oldest first so a backlog drains in order. */
export async function activeBatches(): Promise<BatchRow[]> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(BATCH_COLUMNS)
    .in("status", ["parsing", "mx", "filtered", "verifying"])
    .order("created_at", { ascending: true });
  if (error) throw new Error("activeBatches: " + error.message);
  return (data ?? []) as unknown as BatchRow[];
}

/** The most recent batch in a channel, for the `status` command. */
export async function latestBatch(channel: string): Promise<BatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(BATCH_COLUMNS)
    .eq("slack_channel_id", channel)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("latestBatch: " + error.message);
  return (data as unknown as BatchRow) ?? null;
}

/** The batch whose "shall I spend the credits" card carries this message ts. */
export async function batchByApprovalTs(channel: string, ts: string): Promise<BatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(BATCH_COLUMNS)
    .eq("slack_channel_id", channel)
    .eq("mv_approval_ts", ts)
    .maybeSingle();
  if (error) throw new Error("batchByApprovalTs: " + error.message);
  return (data as unknown as BatchRow) ?? null;
}

/**
 * Every address already in `outreach_prospects`, lowercased.
 *
 * Paged over the CRM rather than filtered by the CSV's addresses, deliberately: an `.in()` list
 * built from a 20k-row export would be hundreds of KB of query string, and this table is the
 * follow-up operator's, so it is thousands of rows rather than millions. If it ever stops being
 * that, this becomes a chunked `.in()` and the chunk size is the thing to tune.
 */
export async function knownProspectEmails(): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("outreach_prospects")
      .select("email")
      .range(from, from + PAGE - 1);
    if (error) throw new Error("knownProspectEmails: " + error.message);
    const rows = (data ?? []) as Array<{ email: string | null }>;
    for (const r of rows) if (r.email) out.add(r.email.trim().toLowerCase());
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Insert the filtered rows. String-junk rows land final; survivors land pending on MX. */
export async function insertRows(batchId: string, rows: FilteredRow[]): Promise<void> {
  const payload = rows.map((r) => ({
    batch_id: batchId,
    row_index: r.rowIndex,
    email: r.email,
    domain: r.domain,
    raw: r.raw,
    verdict: r.reason ? "junk" : null,
    reason: r.reason,
  }));

  for (const part of chunk(payload, INSERT_CHUNK)) {
    // ignoreDuplicates so a retried parse cannot double-insert against (batch_id, row_index).
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .upsert(part, { onConflict: "batch_id,row_index", ignoreDuplicates: true });
    if (error) throw new Error("insertRows: " + error.message);
  }
}

/** Distinct domains on this batch still waiting for an MX answer. */
export async function pendingDomains(batchId: string, limit = 8000): Promise<string[]> {
  const seen = new Set<string>();
  for (let from = 0; from < limit; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select("domain")
      .eq("batch_id", batchId)
      .is("verdict", null)
      .is("mx_ok", null)
      .not("domain", "is", null)
      .range(from, from + PAGE - 1);
    if (error) throw new Error("pendingDomains: " + error.message);
    const rows = (data ?? []) as Array<{ domain: string | null }>;
    for (const r of rows) if (r.domain) seen.add(r.domain);
    if (rows.length < PAGE) break;
  }
  return Array.from(seen);
}

/**
 * Write MX verdicts onto every row of the matching domains.
 *
 * ‼️ AN UNDETERMINED DOMAIN IS NOT PASSED IN AND MUST NOT BE. `mx.ts` returns null for "nobody
 * managed to ask", and writing that as false would junk good leads over a resolver blip with no
 * trace. Those rows keep `mx_ok = null` and the next tick asks again.
 */
export async function applyMx(
  batchId: string,
  verdicts: ReadonlyMap<string, boolean | null>
): Promise<{ clean: number; junk: number }> {
  const withMx: string[] = [];
  const withoutMx: string[] = [];
  for (const [domain, verdict] of verdicts) {
    if (verdict === true) withMx.push(domain);
    else if (verdict === false) withoutMx.push(domain);
  }

  for (const part of chunk(withMx, IN_CHUNK)) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ mx_ok: true, verdict: "clean" })
      .eq("batch_id", batchId)
      .is("verdict", null)
      .in("domain", part);
    if (error) throw new Error("applyMx(clean): " + error.message);
  }

  for (const part of chunk(withoutMx, IN_CHUNK)) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ mx_ok: false, verdict: "junk", reason: "no_mx" })
      .eq("batch_id", batchId)
      .is("verdict", null)
      .in("domain", part);
    if (error) throw new Error("applyMx(junk): " + error.message);
  }

  return { clean: withMx.length, junk: withoutMx.length };
}

export async function countPending(batchId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("scraper_rows")
    .select("row_index", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .is("verdict", null);
  if (error) throw new Error("countPending: " + error.message);
  return count ?? 0;
}

export async function countByVerdict(batchId: string, verdict: "clean" | "junk"): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("scraper_rows")
    .select("row_index", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .eq("verdict", verdict);
  if (error) throw new Error("countByVerdict: " + error.message);
  return count ?? 0;
}

/** Every row of a verdict, in file order, paged. */
export async function rowsByVerdict(batchId: string, verdict: "clean" | "junk"): Promise<StoredRow[]> {
  const out: StoredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select("row_index, email, domain, raw, verdict, reason, mx_ok, mv_result")
      .eq("batch_id", batchId)
      .eq("verdict", verdict)
      .order("row_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("rowsByVerdict: " + error.message);
    const rows = (data ?? []) as unknown as StoredRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The junk breakdown, by reason. */
export async function junkBreakdown(batchId: string): Promise<Map<JunkReason, number>> {
  const out = new Map<JunkReason, number>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select("reason")
      .eq("batch_id", batchId)
      .eq("verdict", "junk")
      .range(from, from + PAGE - 1);
    if (error) throw new Error("junkBreakdown: " + error.message);
    const rows = (data ?? []) as Array<{ reason: JunkReason | null }>;
    for (const r of rows) {
      if (!r.reason) continue;
      out.set(r.reason, (out.get(r.reason) ?? 0) + 1);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Write MillionVerifier verdicts back onto the clean rows, matched by address. */
export async function applyMvResults(
  batchId: string,
  results: ReadonlyMap<string, string>
): Promise<number> {
  const byResult = new Map<string, string[]>();
  for (const [email, result] of results) {
    const list = byResult.get(result) ?? [];
    list.push(email);
    byResult.set(result, list);
  }

  let written = 0;
  for (const [result, emails] of byResult) {
    for (const part of chunk(emails, IN_CHUNK)) {
      const { error, count } = await supabaseAdmin
        .from("scraper_rows")
        .update({ mv_result: result }, { count: "exact" })
        .eq("batch_id", batchId)
        .in("email", part);
      if (error) throw new Error("applyMvResults: " + error.message);
      written += count ?? 0;
    }
  }
  return written;
}
