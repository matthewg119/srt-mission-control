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
import type { DedupeRow, KnownKeys } from "./dedup";
import type { FilteredRow } from "./filter";
import type { JunkReason } from "./rules";

export type BatchStatus =
  | "awaiting_workflow"
  | "scoring"
  | "auditing"
  | "scored"
  | "awaiting_apollo_export"
  | "parsing"
  | "mx"
  | "filtered"
  | "verifying"
  | "done"
  | "error";

/** 1️⃣ filter and verify, 2️⃣ score first. Null until somebody reacts on the picker. */
export type Workflow = "filter" | "score";

/**
 * The gate cards, one per `*_ts` column.
 *
 * ‼️ EACH GATE NEEDS ITS OWN COLUMN. `handleScraperReaction` used to resolve a batch from
 * `mv_approval_ts` alone, and with four gate cards in one thread it has to know WHICH card was
 * reacted to. A shared column would make a ✅ on the picker release a MillionVerifier upload.
 */
export type GateKind = "workflow_pick" | "scoring_approval" | "cutoff_confirm" | "mv_approval";

export interface BatchRow {
  id: string;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  slack_file_id: string | null;
  file_name: string | null;
  status: BatchStatus;
  workflow: Workflow | null;
  /** The drop caption, verbatim. Printed on the cards so a thread says what the file was. */
  batch_label: string | null;
  /** Set on the child batch an Apollo export creates, pointing at the scored batch it came from. */
  parent_batch_id: string | null;
  apollo_export_file_id: string | null;
  score_query_template: string | null;
  score_cutoff: string | null;
  score_cost_usd: number;
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
  workflow_pick_ts: string | null;
  scoring_approval_ts: string | null;
  cutoff_confirm_ts: string | null;
  /**
   * The 0-based indexes into the ORIGINAL parsed file that the drop's dedupe already matched.
   *
   * ‼️ INDEXES, NOT A REWRITTEN FILE. `scraper_rows.row_index` is the index into the file as
   * dropped, so both workflows step over these in place rather than being handed a shortened array.
   */
  dedupe_dupe_indexes: number[] | null;
  dedupe_dupe_count: number;
  dedupe_new_count: number;
  /** Guard, exactly like `csv_posted_at`: set once the split has been posted, so a re-entry
   * re-reads one row and uploads nothing a second time. */
  dedupe_ran_at: string | null;
  /** Stamped once clean.csv and junk.csv are in the thread, so a re-entry cannot post them twice. */
  csv_posted_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface StoredRow {
  id: string;
  row_index: number;
  email: string | null;
  domain: string | null;
  raw: Record<string, string>;
  verdict: "clean" | "junk" | null;
  reason: JunkReason | null;
  mx_ok: boolean | null;
  mv_result: string | null;
  company: string | null;
  city: string | null;
  website: string | null;
  dominance_score: number | null;
  score_components: Record<string, unknown> | null;
  dataforseo_task_id: string | null;
  queued_for_apollo: boolean;
  /**
   * The GBP optimization audit. A SECOND score answering a different question, never blended into
   * `dominance_score` and never the sort key.
   *
   * ‼️ THE TWO NULLABLE COLUMNS ARE ONE TRI-STATE AND THE PAIR IS THE STAGE'S EXIT CONDITION:
   *   score null, components null  -> not asked yet, the next tick asks again
   *   score null, components set   -> asked, nothing was measurable. Stop asking.
   *   score set                    -> done
   * Without the middle state a row whose profile task failed and whose site refuses the crawl is
   * re-collected on every tick forever and the batch parks at `auditing` with nothing to show.
   */
  optimization_score: number | null;
  optimization_components: Record<string, unknown> | null;
  gbp_task_id: string | null;
  /** The exact-profile key, read off the SERP the scoring pass already bought. Never a name. */
  gbp_cid: string | null;
  gbp_place_id: string | null;
  /** Category, city, description and url off the knowledge_graph. Free, no extra call. */
  gbp_serp: Record<string, unknown> | null;
}

const BATCH_COLUMNS =
  "id, slack_channel_id, slack_thread_ts, slack_file_id, file_name, status, workflow, " +
  "batch_label, parent_batch_id, apollo_export_file_id, score_query_template, score_cutoff, " +
  "score_cost_usd, email_column, headers, total_rows, clean_count, junk_count, mv_file_id, " +
  "mv_status, mv_counts, mv_awaiting_approval, mv_approval_ts, workflow_pick_ts, " +
  "scoring_approval_ts, cutoff_confirm_ts, csv_posted_at, dedupe_dupe_indexes, " +
  "dedupe_dupe_count, dedupe_new_count, dedupe_ran_at, error, created_at, updated_at";

// ‼️ A COLUMN MISSING FROM THIS STRING IS SILENTLY `undefined`, NOT AN ERROR, and on this table that
// costs money rather than correctness. `!row.gbp_task_id` would be true on every row forever, so
// every tick would re-post and RE-BUY the whole batch. Adding a column to `StoredRow` without adding
// it here is the single most expensive mistake available in this file.
const ROW_COLUMNS =
  "id, row_index, email, domain, raw, verdict, reason, mx_ok, mv_result, company, city, " +
  "website, dominance_score, score_components, dataforseo_task_id, queued_for_apollo, " +
  "optimization_score, optimization_components, gbp_task_id, gbp_cid, gbp_place_id, gbp_serp";

/** Which gate a `*_ts` column belongs to. One list, so the router and the lookup cannot drift. */
const GATE_COLUMNS: Array<{ gate: GateKind; column: string }> = [
  { gate: "workflow_pick", column: "workflow_pick_ts" },
  { gate: "scoring_approval", column: "scoring_approval_ts" },
  { gate: "cutoff_confirm", column: "cutoff_confirm_ts" },
  { gate: "mv_approval", column: "mv_approval_ts" },
];

// Supabase-js issues selects and filtered updates as GET/PATCH with the filter in the QUERY STRING,
// so an `.in()` list is bounded by URL length rather than by anything Postgres cares about. 100
// domains of ~20 chars keeps a chunk near 2KB, well under every proxy limit in the path.
const IN_CHUNK = 100;
const INSERT_CHUNK = 500;
const PAGE = 1000;

// The dedupe's keys are shorter than a domain list is long — a phone key is 10 characters and an
// address about 25 — so 300 of them keeps a chunk near 8KB, still well inside every proxy in the
// path, and a 50k-row drop asks 500 questions instead of 1,500.
const SEEN_IN_CHUNK = 300;
/** How many of those are in flight at once. Plain reads, no ordering, nothing to serialize. */
const SEEN_CONCURRENCY = 6;

/**
 * The ledger's four key types.
 *
 * ‼️ ONE LIST, so the read and the write cannot drift on the camelCase/snake_case boundary. The
 * `DedupeKeys` field is `companyCity`; the value stored in `scraper_seen.key_type` and printed in
 * duplicates.csv is `company_city`, and the CHECK constraint only accepts the latter.
 */
const KEY_TYPES: Array<{ field: "domain" | "phone" | "email" | "companyCity"; stored: string }> = [
  { field: "domain", stored: "domain" },
  { field: "phone", stored: "phone" },
  { field: "email", stored: "email" },
  { field: "companyCity", stored: "company_city" },
];

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
  /** `awaiting_workflow` for a top-level drop; `parsing` for the child an Apollo export creates. */
  status?: BatchStatus;
  workflow?: Workflow | null;
  batchLabel?: string | null;
  parentBatchId?: string | null;
  scoreQueryTemplate?: string | null;
}): Promise<BatchRow> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .insert({
      slack_channel_id: input.channel,
      slack_thread_ts: input.threadTs,
      slack_file_id: input.fileId,
      file_name: input.fileName,
      status: input.status ?? "awaiting_workflow",
      workflow: input.workflow ?? null,
      batch_label: input.batchLabel ?? null,
      parent_batch_id: input.parentBatchId ?? null,
      score_query_template: input.scoreQueryTemplate ?? null,
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

/**
 * Batches the tick has work to do on, oldest first so a backlog drains in order.
 *
 * ‼️ `awaiting_apollo_export` IS DELIBERATELY ABSENT. It waits on a human uploading a file into the
 * thread, so there is genuinely nothing to post and nothing to poll, and listing it would make the
 * cron's worklist dishonest. `awaiting_workflow` and `scored` ARE listed even though they are gates
 * too: their cards are guarded by their own `*_ts` already being set, so a re-entry re-reads one
 * row and does nothing, and a card whose Slack post failed at drop time gets posted on the next
 * tick instead of the batch sitting silent forever.
 *
 * The cron may poll external work. It may never advance past a gate.
 */
const ACTIVE_STATUSES: BatchStatus[] = [
  "awaiting_workflow",
  "scoring",
  "auditing",
  "scored",
  "parsing",
  "mx",
  "filtered",
  "verifying",
];

export async function activeBatches(): Promise<BatchRow[]> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(BATCH_COLUMNS)
    .in("status", ACTIVE_STATUSES)
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

/**
 * Which batch, and which of its gate cards, carries this message ts.
 *
 * ‼️ THE GATE IS RETURNED, NOT INFERRED. Four gate cards now live in one thread and they mean four
 * different things: a reaction on the picker chooses a workflow, one on the cutoff card chooses how
 * much to delete, and one on the MillionVerifier card SPENDS MONEY. A handler that resolved the
 * batch and then guessed which card it was looking at would eventually release an upload on a
 * reaction meant for something else.
 */
export async function batchByGateTs(
  channel: string,
  ts: string
): Promise<{ batch: BatchRow; gate: GateKind } | null> {
  for (const { gate, column } of GATE_COLUMNS) {
    const { data, error } = await supabaseAdmin
      .from("scraper_batches")
      .select(BATCH_COLUMNS)
      .eq("slack_channel_id", channel)
      .eq(column, ts)
      .maybeSingle();
    if (error) throw new Error("batchByGateTs(" + column + "): " + error.message);
    if (data) return { batch: data as unknown as BatchRow, gate };
  }
  return null;
}

/**
 * The newest batch on a thread.
 *
 * Newest rather than only, because an Apollo export creates a CHILD batch sharing its parent's
 * thread. A reply belongs to whatever is happening in that thread NOW.
 */
export async function batchByThreadTs(channel: string, threadTs: string): Promise<BatchRow | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_batches")
    .select(BATCH_COLUMNS)
    .eq("slack_channel_id", channel)
    .eq("slack_thread_ts", threadTs)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error("batchByThreadTs: " + error.message);
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

/**
 * Which of this file's keys the lane has seen before.
 *
 * ‼️ ASKED ABOUT THE FILE, NEVER PAGED WHOLE — the opposite call to `knownProspectEmails` above,
 * and deliberately. That table is the follow-up operator's few thousand rows and stops growing;
 * `scraper_seen` gains three keys per new lead on every drop, forever, so paging it would get
 * slower every week while a chunked `.in()` stays proportional to the file that was dropped.
 */
export async function loadKnownKeys(keys: {
  domain: string[];
  phone: string[];
  email: string[];
  companyCity: string[];
}): Promise<KnownKeys> {
  const out = {
    domain: new Set<string>(),
    phone: new Set<string>(),
    email: new Set<string>(),
    companyCity: new Set<string>(),
  };

  for (const keyType of KEY_TYPES) {
    const parts = chunk(keys[keyType.field], SEEN_IN_CHUNK).filter((p) => p.length > 0);

    // ‼️ RUN IN WAVES, NOT ONE AT A TIME. At MAX_ROWS this asks about 150k keys, and a strictly
    // sequential sweep at IN_CHUNK would be 1,500 round trips — most of the 300s the drop shares
    // with the CSV download, the parse and a 200s MX budget. The drop would time out on exactly
    // the big file this lane exists for.
    for (const wave of chunk(parts, SEEN_CONCURRENCY)) {
      const results = await Promise.all(
        wave.map((part) =>
          supabaseAdmin
            .from("scraper_seen")
            .select("key_value")
            .eq("key_type", keyType.stored)
            .in("key_value", part)
        )
      );
      for (const { data, error } of results) {
        if (error) throw new Error("loadKnownKeys(" + keyType.stored + "): " + error.message);
        for (const r of (data ?? []) as Array<{ key_value: string }>) out[keyType.field].add(r.key_value);
      }
    }
  }

  return out;
}

/**
 * Record the rows nobody had seen, so the next drop of the same list reports them as duplicates.
 *
 * ‼️ CALLED AFTER THE CSVs ARE POSTED, NEVER BEFORE. A crash between the two leaves the ledger
 * short and the rows come back as new next time, which is the direction this is allowed to fail in.
 * Recording first and crashing would bury real leads that were never delivered anywhere.
 */
export async function recordSeen(batchId: string, rows: DedupeRow[]): Promise<void> {
  const payload: Array<Record<string, unknown>> = [];

  for (const row of rows) {
    const provenance = {
      first_batch_id: batchId,
      company: row.company,
      city: row.city,
      website: row.website,
      email: row.keys.email,
      phone: row.keys.phone,
    };
    for (const { field, stored } of KEY_TYPES) {
      const value = row.keys[field];
      if (value) payload.push({ key_type: stored, key_value: value, ...provenance });
    }
  }

  for (const part of chunk(payload, INSERT_CHUNK)) {
    // ignoreDuplicates: the ledger keeps the FIRST sighting. A re-entry must not restamp a key
    // onto a newer batch and lose which drop actually found it.
    const { error } = await supabaseAdmin
      .from("scraper_seen")
      .upsert(part, { onConflict: "key_type,key_value", ignoreDuplicates: true });
    if (error) throw new Error("recordSeen: " + error.message);
  }
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
      .select(ROW_COLUMNS)
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

// ── workflow B: the company rows and their scores ───────────────────────────────────────────────

export interface CompanyRowInput {
  rowIndex: number;
  raw: Record<string, string>;
  company: string | null;
  city: string | null;
  website: string | null;
}

/**
 * Insert the rows of a company list.
 *
 * ‼️ NO VERDICT AND NO REASON IS WRITTEN. These rows are not clean and not junk: workflow B never
 * asks the seven filter questions of them, so `countPending` and `countByVerdict` are meaningless
 * here and the scoring sweep uses `dominance_score is null` as its worklist instead. A verdict
 * written to keep those two helpers happy would put company rows into clean.csv.
 */
export async function insertCompanyRows(batchId: string, rows: CompanyRowInput[]): Promise<void> {
  const payload = rows.map((r) => ({
    batch_id: batchId,
    row_index: r.rowIndex,
    raw: r.raw,
    company: r.company,
    city: r.city,
    website: r.website,
  }));

  for (const part of chunk(payload, INSERT_CHUNK)) {
    // ignoreDuplicates so a retried parse cannot double-insert against (batch_id, row_index).
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .upsert(part, { onConflict: "batch_id,row_index", ignoreDuplicates: true });
    if (error) throw new Error("insertCompanyRows: " + error.message);
  }
}

/** Every row of a batch in file order, paged. Workflow B reads all of them, verdict or not. */
export async function allRows(batchId: string): Promise<StoredRow[]> {
  const out: StoredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select(ROW_COLUMNS)
      .eq("batch_id", batchId)
      .order("row_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("allRows: " + error.message);
    const rows = (data ?? []) as unknown as StoredRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Rows that have a company and no score yet. The scoring sweep's whole worklist. */
export async function unscoredRows(batchId: string): Promise<StoredRow[]> {
  const out: StoredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select(ROW_COLUMNS)
      .eq("batch_id", batchId)
      .is("dominance_score", null)
      .not("company", "is", null)
      .order("row_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("unscoredRows: " + error.message);
    const rows = (data ?? []) as unknown as StoredRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export async function countScorable(batchId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("scraper_rows")
    .select("row_index", { count: "exact", head: true })
    .eq("batch_id", batchId)
    .not("company", "is", null);
  if (error) throw new Error("countScorable: " + error.message);
  return count ?? 0;
}

/**
 * Write the DataForSEO task ids back onto their rows.
 *
 * ‼️ THIS RUNS IMMEDIATELY AFTER THE POST RETURNS AND BEFORE ANYTHING ELSE. The account is charged
 * at task_post, so a task whose id never lands is money spent on a company that never scores and
 * leaves no trace. One update per row rather than a batched upsert, because an upsert would need
 * every not-null column of the row and a partial one would blank `raw`.
 */
export async function applyTaskIds(taskIds: ReadonlyMap<string, string>): Promise<void> {
  for (const [rowId, taskId] of taskIds) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ dataforseo_task_id: taskId })
      .eq("id", rowId)
      .is("dataforseo_task_id", null);
    if (error) throw new Error("applyTaskIds: " + error.message);
  }
}

export interface ScoreWrite {
  rowId: string;
  score: number;
  components: Record<string, unknown>;
  /**
   * What the SERP said about their Google Business Profile, extracted from the payload the scoring
   * sweep is already holding.
   *
   * It rides on the score write rather than getting its own pass because it costs nothing and comes
   * from the same response: one UPDATE, no second call, and the `auditing` stage that follows has
   * its lookup key ready without re-collecting the SERP on every tick.
   */
  gbpCid?: string | null;
  gbpPlaceId?: string | null;
  gbpSerp?: Record<string, unknown> | null;
}

/**
 * Write scores back.
 *
 * ‼️ A NULL SCORE IS NEVER PASSED IN AND MUST NOT BE. `scoreSerp` returns null for "not one
 * component could be measured", and writing that as 0 would rank a business nobody could look at as
 * the most invisible one on the list, which is the top of the scrape pile. Those rows keep
 * `dominance_score = null` and the next tick asks again. Same doctrine as `applyMx`.
 */
export async function applyScores(scores: ScoreWrite[]): Promise<void> {
  for (const s of scores) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({
        dominance_score: s.score,
        score_components: s.components,
        gbp_cid: s.gbpCid ?? null,
        gbp_place_id: s.gbpPlaceId ?? null,
        gbp_serp: s.gbpSerp ?? null,
      })
      .eq("id", s.rowId);
    if (error) throw new Error("applyScores: " + error.message);
  }
}

/**
 * The audit sweep's whole worklist: rows that have a company and have neither been scored on
 * optimization nor written off as unmeasurable.
 *
 * The `optimization_components is null` half is what makes the stage terminate. See the tri-state
 * note on `StoredRow`.
 */
export async function auditableRows(batchId: string): Promise<StoredRow[]> {
  const out: StoredRow[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("scraper_rows")
      .select(ROW_COLUMNS)
      .eq("batch_id", batchId)
      .is("optimization_score", null)
      .is("optimization_components", null)
      .not("company", "is", null)
      .order("row_index", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error("auditableRows: " + error.message);
    const rows = (data ?? []) as unknown as StoredRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Write the my_business_info task ids back onto their rows.
 *
 * ‼️ THIS RUNS IMMEDIATELY AFTER THE POST RETURNS AND BEFORE ANYTHING ELSE, and the `.is(null)`
 * guard is what stops a retried tick buying the same profile twice. Exactly the shape
 * `applyTaskIds` has for the SERP half and `mv_file_id` has for MillionVerifier, for exactly the
 * same reason: the account is charged at task_post, so an id that never lands is money spent on a
 * profile that never audits and leaves no trace.
 */
export async function applyGbpTaskIds(taskIds: ReadonlyMap<string, string>): Promise<void> {
  for (const [rowId, taskId] of taskIds) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ gbp_task_id: taskId })
      .eq("id", rowId)
      .is("gbp_task_id", null);
    if (error) throw new Error("applyGbpTaskIds: " + error.message);
  }
}

export interface OptimizationWrite {
  rowId: string;
  score: number;
  components: Record<string, unknown>;
}

/**
 * Write optimization scores back.
 *
 * ‼️ A NULL SCORE IS NEVER PASSED IN. `scoreOptimization` returns null for "not one component could
 * be measured", and 0 is the worst possible optimization score, which is the most interesting
 * business on the list. Those rows go through `markAuditExhausted` instead, or stay untouched for
 * the next tick. Same doctrine as `applyScores` and `applyMx`.
 */
export async function applyOptimizationScores(writes: OptimizationWrite[]): Promise<void> {
  for (const w of writes) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ optimization_score: w.score, optimization_components: w.components })
      .eq("id", w.rowId);
    if (error) throw new Error("applyOptimizationScores: " + error.message);
  }
}

/**
 * This row was asked and nothing could be measured. Stop asking.
 *
 * Writes ONLY the components, leaving the score null, which is the middle state of the tri-state on
 * `StoredRow`. It is what takes a row whose profile task failed and whose site refuses the crawl
 * out of `auditableRows` permanently. Without it the batch parks at `auditing` forever, re-polling
 * the same dead task every five minutes with nothing to show for it.
 */
export async function markAuditExhausted(
  rowId: string,
  components: Record<string, unknown>
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("scraper_rows")
    .update({ optimization_components: components })
    .eq("id", rowId);
  if (error) throw new Error("markAuditExhausted: " + error.message);
}

/** Add to the batch's recorded spend. Read-modify-write; the cron runs one batch at a time. */
export async function addScoreCost(batchId: string, costUsd: number): Promise<void> {
  if (costUsd <= 0) return;
  const batch = await getBatch(batchId);
  if (!batch) return;
  const next = Number(batch.score_cost_usd ?? 0) + costUsd;
  await updateBatch(batchId, { score_cost_usd: Math.round(next * 10000) / 10000 });
}

/**
 * Delete rows outright.
 *
 * ‼️ THE ONLY DELETE IN THIS FILE, AND IT EXISTS FOR ONE CALLER: the United States filter, cleaning
 * up a batch that was inserted before that filter existed. New batches never reach it, because they
 * are filtered BEFORE the insert and a row that is never written never needs removing. A verdict
 * column would have been the softer design and is deliberately not used here: these rows are not a
 * pile with a reason, they are rows this lane should never have been holding.
 *
 * Chunked on the same URL-length limit as `applyMx`: supabase-js puts an `.in()` list in the query
 * string, so the bound is the URL rather than anything Postgres cares about.
 */
export async function deleteRows(batchId: string, rowIds: string[]): Promise<number> {
  let removed = 0;
  for (const part of chunk(rowIds, IN_CHUNK)) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .delete()
      .eq("batch_id", batchId)
      .in("id", part);
    if (error) throw new Error("deleteRows: " + error.message);
    removed += part.length;
  }
  return removed;
}

/** Flag the kept pile after the cutoff is confirmed. Chunked, same URL-length limit as applyMx. */
export async function markQueuedForApollo(batchId: string, rowIds: string[]): Promise<void> {
  for (const part of chunk(rowIds, IN_CHUNK)) {
    const { error } = await supabaseAdmin
      .from("scraper_rows")
      .update({ queued_for_apollo: true })
      .eq("batch_id", batchId)
      .in("id", part);
    if (error) throw new Error("markQueuedForApollo: " + error.message);
  }
}
