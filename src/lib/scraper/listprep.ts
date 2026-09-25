// Supabase for Workflow C's three tables: `raw_leads`, `list_pipeline_runs`, `sendable_leads`.
//
// ‼️ EVERY SWEEP IN HERE IS A WORKLIST WITH AN EXIT CONDITION, AND THE EXIT CONDITION IS A COLUMN
// RATHER THAN A COUNTER. The lane runs on a 5-minute cron against a 240s budget, so a stage is
// entered many times and must be able to work out what is left from the database alone. A sweep
// whose "already done" state lives only in memory re-does the work on every tick, and on the paid
// stages that is a bill rather than a delay. Each reader below names the column that takes a row
// off its own worklist.
//
// The batch/row half of the lane lives in store.ts and is untouched by any of this: a listprep
// batch owns NO `scraper_rows`, which is why every shared arm in lane.ts branches on
// `batch.workflow` before it reads one.

import { supabaseAdmin } from "@/lib/db";
import type { EnrichAttempt, EnrichHit } from "./enrich";
import type { QualifyCandidate, Verdict } from "./qualify";
import type { Funnel } from "./pull";

export type RunStage =
  | "pulling"
  | "qualifying"
  | "qualified"
  | "enriching"
  | "verifying"
  | "catchall_recheck"
  | "suppressing"
  | "done"
  | "error";

export interface RunRow {
  id: string;
  batch_id: string | null;
  label: string | null;
  icp_text: string | null;
  vertical_slug: string | null;
  stage: RunStage;
  raw_count: number;
  qualified_count: number;
  enriched_count: number;
  verified_count: number;
  sendable_count: number;
  drop_review_ts: string | null;
  error: string | null;
}

// ‼️ A COLUMN MISSING FROM THIS STRING IS SILENTLY `undefined`, NOT AN ERROR. Same trap as
// BATCH_COLUMNS in store.ts: PostgREST returns only what it was asked for, so a field added to
// RunRow and forgotten here reads as absent on every row and every guard written against it is
// true forever. Add to both or neither.
const RUN_COLUMNS =
  "id, batch_id, label, icp_text, vertical_slug, stage, raw_count, qualified_count, " +
  "enriched_count, verified_count, sendable_count, drop_review_ts, error";

export async function getRun(runId: string): Promise<RunRow | null> {
  const { data, error } = await supabaseAdmin
    .from("list_pipeline_runs")
    .select(RUN_COLUMNS)
    .eq("id", runId)
    .maybeSingle();
  if (error) throw new Error("getRun: " + error.message);
  return (data as unknown as RunRow) ?? null;
}

export async function updateRun(runId: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin.from("list_pipeline_runs").update(patch).eq("id", runId);
  if (error) throw new Error("updateRun: " + error.message);
}

/** Bind the run to its batch, so `batchByGateTs` can walk back from a drop-review reaction. */
export async function bindRunToBatch(runId: string, batchId: string): Promise<void> {
  await updateRun(runId, { batch_id: batchId });
}

// --- Stage 2: qualification --------------------------------------------------------------------

/**
 * Rows still waiting on a verdict.
 *
 * ‼️ THE WORKLIST IS THE TRI-STATE, AND WITHOUT IT THIS STAGE NEVER ENDS. A row the model
 * deterministically fails on would come back on every tick forever, and the batch would sit in
 * `qualifying` with no error anywhere. `qualify_keep` and `qualify_reason` already encode it:
 *
 *   keep null, reason null  ->  not asked yet. Ask.
 *   keep null, reason set   ->  asked twice and not answered. Stop asking. Reported as unjudged.
 *   keep set                ->  judged.
 *
 * Same shape as `optimization_score` / `optimization_components` in store.ts, and the same reason:
 * `markAuditExhausted` exists because that stage learned this lesson first.
 */
export async function pendingQualify(runId: string, limit: number): Promise<QualifyCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from("raw_leads")
    .select("id, business_name, domain, city, state, categories, primary_type, rating, review_count, instagram_handle")
    .eq("run_id", runId)
    .is("qualify_keep", null)
    .is("qualify_reason", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error("pendingQualify: " + error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      businessName: String(row.business_name ?? ""),
      domain: (row.domain as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      categories: (row.categories as string | null) ?? null,
      primaryType: (row.primary_type as string | null) ?? null,
      rating: (row.rating as number | null) ?? null,
      reviewCount: (row.review_count as number | null) ?? null,
      instagramHandle: (row.instagram_handle as string | null) ?? null,
    };
  });
}

/**
 * Write one chunk's verdicts.
 *
 * ‼️ CALLED BEFORE THE NEXT CHUNK IS ASKED FOR, NEVER BATCHED UP AT THE END. A chunk that returned
 * and was not persisted is a chunk that gets paid for twice, and on a 240s budget the tick that
 * dies holding ten unwritten chunks is the normal case rather than the unlucky one.
 */
export async function writeVerdicts(verdicts: readonly Verdict[], model: string): Promise<void> {
  const now = new Date().toISOString();
  for (const v of verdicts) {
    // An unjudged verdict is written as reason-without-keep, which is the middle state above. It
    // must never be coerced to keep:false; a model timeout is not a drop.
    const patch: Record<string, unknown> =
      v.keep === null
        ? { qualify_reason: v.reason, qualify_model: model }
        : { qualify_keep: v.keep, qualify_reason: v.reason, qualify_model: model, qualified_at: now };
    const { error } = await supabaseAdmin.from("raw_leads").update(patch).eq("id", v.id);
    if (error) throw new Error("writeVerdicts(" + v.id + "): " + error.message);
  }
}

/**
 * Drop the rows we can judge for free, without asking a model.
 *
 * ‼️ FREE CHECKS BEFORE THE PAID ONE, THE SAME ORDER filter.ts ALREADY USES. A row with no website
 * cannot be enriched by the only rung there is, so asking Claude whether it is a good med spa is
 * paying for an answer that changes nothing. It is written as an ordinary drop with an ordinary
 * reason, so it groups and counts on the review card exactly like a model verdict.
 */
export async function dropWebsiteless(runId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("raw_leads")
    .update({
      qualify_keep: false,
      qualify_reason: "no website on the row",
      qualify_model: "rule",
      qualified_at: new Date().toISOString(),
    })
    .eq("run_id", runId)
    .is("qualify_keep", null)
    .is("qualify_reason", null)
    .or("website.is.null,website.eq.")
    .select("id");
  if (error) throw new Error("dropWebsiteless: " + error.message);
  return data?.length ?? 0;
}

export interface QualifyTally {
  raw: number;
  kept: number;
  dropped: number;
  unjudged: number;
}

export async function qualifyTally(runId: string): Promise<QualifyTally> {
  const count = async (apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>) => {
    const { count: n, error } = await apply(baseQuery());
    if (error) throw new Error("qualifyTally: " + error.message);
    return n ?? 0;
  };
  const baseQuery = () =>
    supabaseAdmin.from("raw_leads").select("id", { count: "exact", head: true }).eq("run_id", runId);

  const raw = await count((q) => q);
  const kept = await count((q) => q.eq("qualify_keep", true));
  const dropped = await count((q) => q.eq("qualify_keep", false));
  // Asked twice and never answered. Distinct from "not asked yet", which is `raw - kept - dropped
  // - unjudged` and is what keeps the stage running.
  const unjudged = await count((q) => q.is("qualify_keep", null).not("qualify_reason", "is", null));
  return { raw, kept, dropped, unjudged };
}

/** Every drop reason on the run, for grouping. Read in full because the card counts them all. */
export async function dropReasons(runId: string): Promise<Array<{ name: string; reason: string }>> {
  const out: Array<{ name: string; reason: string }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from("raw_leads")
      .select("business_name, qualify_reason")
      .eq("run_id", runId)
      .eq("qualify_keep", false)
      .range(from, from + PAGE - 1);
    if (error) throw new Error("dropReasons: " + error.message);
    const rows = data ?? [];
    for (const r of rows) {
      const row = r as Record<string, unknown>;
      out.push({ name: String(row.business_name ?? ""), reason: String(row.qualify_reason ?? "") });
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/** The dropped rows, in full, for `dropped.csv`. */
export async function droppedRows(runId: string): Promise<Array<Record<string, string>>> {
  const { data, error } = await supabaseAdmin
    .from("raw_leads")
    .select("business_name, website, city, state, qualify_reason")
    .eq("run_id", runId)
    .eq("qualify_keep", false)
    .order("qualify_reason", { ascending: true });
  if (error) throw new Error("droppedRows: " + error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      business_name: String(row.business_name ?? ""),
      website: String(row.website ?? ""),
      city: String(row.city ?? ""),
      state: String(row.state ?? ""),
      qualify_reason: String(row.qualify_reason ?? ""),
    };
  });
}

// --- Stage 4: enrichment -----------------------------------------------------------------------

export interface EnrichCandidate {
  id: string;
  businessName: string;
  domain: string | null;
  website: string | null;
  ownerName: string | null;
  city: string | null;
  state: string | null;
  raw: Record<string, unknown>;
}

/**
 * Kept rows that have not been through the waterfall.
 *
 * ‼️ THE EXIT CONDITION IS `enriched_at`, NOT "has an email". A site that was crawled and published
 * no address must leave this worklist, or the cron re-crawls it every five minutes forever. That is
 * not a slow pipeline, it is an unbounded outbound crawl against somebody else's server with no
 * error anywhere. `enriched_at` is stamped on a miss exactly as it is on a hit.
 */
export async function pendingEnrich(runId: string, limit: number): Promise<EnrichCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from("raw_leads")
    .select("id, business_name, domain, website, owner_name, city, state, raw")
    .eq("run_id", runId)
    .eq("qualify_keep", true)
    .is("enriched_at", null)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) {
    throw new Error(
      "pendingEnrich: " + error.message +
        ". If that names enriched_at, docs/2026-09-18-workflow-c-wiring.sql has not been run."
    );
  }
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      businessName: String(row.business_name ?? ""),
      domain: (row.domain as string | null) ?? null,
      website: (row.website as string | null) ?? null,
      ownerName: (row.owner_name as string | null) ?? null,
      city: (row.city as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      raw: (row.raw as Record<string, unknown>) ?? {},
    };
  });
}

export async function setOwnerName(rawLeadId: string, ownerName: string | null): Promise<void> {
  if (!ownerName) return;
  const { error } = await supabaseAdmin
    .from("raw_leads")
    .update({ owner_name: ownerName })
    .eq("id", rawLeadId);
  if (error) throw new Error("setOwnerName: " + error.message);
}

/**
 * Bank one lead's enrichment outcome, hit or miss, in one place.
 *
 * ‼️ THE MISS PATH IS THE IMPORTANT ONE. A hit writes a `sendable_leads` row AND stamps the raw
 * lead; a miss stamps the raw lead and writes nothing else. Both take the row off the worklist,
 * which is the only thing that makes this stage terminate.
 */
export async function recordEnrichment(args: {
  runId: string;
  rawLeadId: string;
  hit: EnrichHit | null;
  attempts: readonly EnrichAttempt[];
}): Promise<void> {
  const { error: rawErr } = await supabaseAdmin
    .from("raw_leads")
    .update({ enriched_at: new Date().toISOString(), enrich_attempts: args.attempts })
    .eq("id", args.rawLeadId);
  if (rawErr) throw new Error("recordEnrichment(raw): " + rawErr.message);

  if (!args.hit) return;

  const { error } = await supabaseAdmin.from("sendable_leads").insert({
    run_id: args.runId,
    raw_lead_id: args.rawLeadId,
    email: args.hit.email,
    first_name: args.hit.firstName,
    last_name: args.hit.lastName,
    title: args.hit.title,
    provider: args.hit.provider,
    provider_cost_usd: args.hit.costUsd,
    attempts: args.attempts,
  });
  // 23505 is a second hit for the same raw lead, which a re-driven tick can produce. The first one
  // stands; re-inserting would give one company two send rows.
  if (error && error.code !== "23505") throw new Error("recordEnrichment(sendable): " + error.message);
}

// --- Stage 5 and 6: verification, catch-all, suppression ---------------------------------------

export interface SendableRow {
  id: string;
  raw_lead_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  provider: string | null;
  email_status: string | null;
}

export async function unverifiedEmails(runId: string): Promise<SendableRow[]> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select("id, raw_lead_id, email, first_name, last_name, provider, email_status")
    .eq("run_id", runId)
    .is("verified_at", null);
  if (error) throw new Error("unverifiedEmails: " + error.message);
  return (data ?? []) as unknown as SendableRow[];
}

// Same bounds and the same reasoning as store.ts: supabase-js puts an `.in()` filter in the QUERY
// STRING, so a read chunk is bounded by URL length rather than by anything Postgres cares about.
// Deliberately re-declared rather than imported, because store.ts is the batch/row half of the lane
// and this file is the run half; the two do not otherwise depend on each other.
const IN_CHUNK = 100;
const INSERT_CHUNK = 500;

/**
 * Why an address was thrown away before a credit was spent on it.
 *
 * Every one of these is answerable for $0 from data already in hand, which is the whole point:
 * MillionVerifier bills per address UPLOADED, not per address that comes back OK.
 */
export type FreeRejectKind = "bad_syntax" | "disposable" | "no_mx" | "duplicate_in_run";

/**
 * Write the free rejects down, so they leave the worklist.
 *
 * ‼️ WITHOUT THE WRITE, THE FILTER SAVES NOTHING. `unverifiedEmails` selects on
 * `verified_at is null`, so an address that was merely filtered in memory is read again on the next
 * cron tick and uploaded then. The card would report a saving that did not happen. Stamping
 * `verified_at` is what makes the rejection real.
 *
 * ‼️ A DUPLICATE IS NOT INVALID, AND THE DIFFERENCE MATTERS DOWNSTREAM. Two locations of one chain
 * sharing info@chain.com is an ordinary shape and the address is perfectly good; it is the SECOND
 * row that is redundant. Writing `invalid` there would put a working address into held-back.csv
 * labelled undeliverable, and an operator reading that would conclude the verifier was wrong.
 * `sendableRows` already excludes it on `suppressed_reason is null`, so suppression is the honest
 * field and the status is left alone.
 */
export async function applyFreeRejects(
  runId: string,
  rejects: ReadonlyArray<{ id: string; kind: FreeRejectKind }>
): Promise<{ updated: number }> {
  if (!rejects.length) return { updated: 0 };
  const now = new Date().toISOString();

  const undeliverable: string[] = [];
  const duplicates: string[] = [];
  for (const r of rejects) {
    (r.kind === "duplicate_in_run" ? duplicates : undeliverable).push(r.id);
  }

  let updated = 0;

  for (let i = 0; i < undeliverable.length; i += IN_CHUNK) {
    const slice = undeliverable.slice(i, i + IN_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("sendable_leads")
      .update({ email_status: "invalid", verified_at: now })
      .eq("run_id", runId)
      .in("id", slice)
      .select("id");
    if (error) throw new Error("applyFreeRejects: " + error.message);
    updated += data?.length ?? 0;
  }

  for (let i = 0; i < duplicates.length; i += IN_CHUNK) {
    const slice = duplicates.slice(i, i + IN_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("sendable_leads")
      .update({ suppressed_reason: "duplicate_in_run", suppressed_at: now, verified_at: now })
      .eq("run_id", runId)
      .in("id", slice)
      .select("id");
    if (error) throw new Error("applyFreeRejects: " + error.message);
    updated += data?.length ?? 0;
  }

  return { updated };
}

/** MillionVerifier's verdict vocabulary, mapped onto the column's four values. */
export function mvStatusToEmailStatus(mv: string): "valid" | "catch_all" | "unknown" | "invalid" {
  const v = mv.trim().toLowerCase();
  if (v === "ok") return "valid";
  if (v === "catch_all" || v === "catchall") return "catch_all";
  if (v === "unknown") return "unknown";
  // ‼️ EVERYTHING ELSE IS INVALID, INCLUDING A VERDICT WE DO NOT RECOGNISE. The alternative is
  // letting an unfamiliar string fall through as "valid", which mails it.
  return "invalid";
}

export async function applyVerification(
  runId: string,
  verdicts: Map<string, string>
): Promise<{ updated: number }> {
  const now = new Date().toISOString();
  let updated = 0;
  for (const [email, mv] of verdicts) {
    const { data, error } = await supabaseAdmin
      .from("sendable_leads")
      .update({ email_status: mvStatusToEmailStatus(mv), verified_at: now })
      .eq("run_id", runId)
      .eq("email", email.toLowerCase())
      .select("id");
    if (error) throw new Error("applyVerification: " + error.message);
    updated += data?.length ?? 0;
  }
  return { updated };
}

/**
 * Catch-all rows that have not been rechecked.
 *
 * ‼️ `catchall_rechecked_at` IS STAMPED EVEN WHEN THE RECHECK RESOLVES NOTHING. A domain that still
 * looks catch-all after an MX lookup is STILL catch-all, and that is a finding rather than a
 * failure; leaving the stamp null so it gets asked again is how the stage stops terminating.
 */
export async function pendingCatchall(runId: string): Promise<Array<{ id: string; email: string }>> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select("id, email")
    .eq("run_id", runId)
    .eq("email_status", "catch_all")
    .is("catchall_rechecked_at", null);
  if (error) throw new Error("pendingCatchall: " + error.message);
  return (data ?? []) as unknown as Array<{ id: string; email: string }>;
}

export async function recordCatchallRecheck(
  id: string,
  status: "catch_all" | "invalid"
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sendable_leads")
    .update({ email_status: status, catchall_rechecked_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("recordCatchallRecheck: " + error.message);
}

export interface SuppressionCandidate {
  id: string;
  email: string;
  domain: string | null;
  companyName: string | null;
  phone: string | null;
}

/**
 * Rows the suppression sweep has not looked at.
 *
 * ‼️ `suppressed_at` MEANS "CHECKED AT", NOT "SUPPRESSED AT", AND THE DIFFERENCE IS WHAT MAKES THIS
 * TERMINATE. It is stamped on clean rows too. Without that, "checked and clean" and "not yet
 * checked" are the same row state and the sweep runs forever. `suppressed_reason is null` remains
 * the sendable set, exactly as the migration intends.
 */
export async function pendingSuppression(
  runId: string,
  limit: number
): Promise<SuppressionCandidate[]> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select("id, email, raw_leads!inner(domain, business_name, phone_normalized)")
    .eq("run_id", runId)
    .is("suppressed_at", null)
    .limit(limit);
  if (error) throw new Error("pendingSuppression: " + error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const joined = row.raw_leads as unknown as Record<string, unknown> | null;
    return {
      id: String(row.id),
      email: String(row.email ?? ""),
      domain: (joined?.domain as string | null) ?? null,
      companyName: (joined?.business_name as string | null) ?? null,
      phone: (joined?.phone_normalized as string | null) ?? null,
    };
  });
}

export async function recordSuppression(
  id: string,
  reason: string | null
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("sendable_leads")
    .update({ suppressed_reason: reason, suppressed_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error("recordSuppression: " + error.message);
}

// --- The send list and the funnel ---------------------------------------------------------------

export interface SendableExportRow {
  email: string;
  first_name: string;
  last_name: string;
  company: string;
  owner_name: string;
  website: string;
  domain: string;
  city: string;
  state: string;
  phone: string;
  email_status: string;
  provider: string;
  qualify_reason: string;
}

/** The send list. `suppressed_reason is null` is the sendable set. */
export async function sendableRows(runId: string): Promise<SendableExportRow[]> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select(
      "email, first_name, last_name, provider, email_status, " +
        "raw_leads!inner(business_name, owner_name, website, domain, city, state, phone, qualify_reason)"
    )
    .eq("run_id", runId)
    .is("suppressed_reason", null)
    .in("email_status", ["valid", "catch_all"]);
  if (error) throw new Error("sendableRows: " + error.message);
  return (data ?? []).map((r) => {
    const row = r as unknown as Record<string, unknown>;
    const j = (row.raw_leads as unknown as Record<string, unknown>) ?? {};
    const owner = String(j.owner_name ?? "");
    return {
      email: String(row.email ?? ""),
      // ‼️ THE MERGE VARIABLE THAT MATTERS, AND THE WHOLE REASON scrapeOwnerName IS IN THE PIPELINE.
      // Falls back to the first token of the scraped owner name when the rung could not split one.
      first_name: String(row.first_name ?? "") || owner.split(/\s+/)[0] || "",
      last_name: String(row.last_name ?? ""),
      company: String(j.business_name ?? ""),
      owner_name: owner,
      website: String(j.website ?? ""),
      domain: String(j.domain ?? ""),
      city: String(j.city ?? ""),
      state: String(j.state ?? ""),
      phone: String(j.phone ?? ""),
      // Carried out to the artifact on purpose: it lets the upload split valid from catch_all at
      // send time rather than discovering the difference in a bounce report.
      email_status: String(row.email_status ?? ""),
      provider: String(row.provider ?? ""),
      qualify_reason: String(j.qualify_reason ?? ""),
    };
  });
}

/** The held-back rows, with the reason, so the negative ships alongside the positive. */
export async function heldBackRows(runId: string): Promise<Array<Record<string, string>>> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select("email, email_status, suppressed_reason, raw_leads!inner(business_name, website, city, state)")
    .eq("run_id", runId)
    .not("suppressed_reason", "is", null);
  if (error) throw new Error("heldBackRows: " + error.message);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const j = (row.raw_leads as unknown as Record<string, unknown>) ?? {};
    return {
      business_name: String(j.business_name ?? ""),
      website: String(j.website ?? ""),
      city: String(j.city ?? ""),
      state: String(j.state ?? ""),
      email: String(row.email ?? ""),
      email_status: String(row.email_status ?? ""),
      suppressed_reason: String(row.suppressed_reason ?? ""),
    };
  });
}

/** The funnel, counted from the tables rather than from anything remembered mid-run. */
export async function funnelFor(runId: string): Promise<Funnel> {
  const rawCount = async (
    table: "raw_leads" | "sendable_leads",
    apply: (q: any) => any
  ): Promise<number> => {
    const { count, error } = await apply(
      supabaseAdmin.from(table).select("id", { count: "exact", head: true }).eq("run_id", runId)
    );
    if (error) throw new Error("funnelFor(" + table + "): " + error.message);
    return count ?? 0;
  };

  return {
    raw: await rawCount("raw_leads", (q) => q),
    qualified: await rawCount("raw_leads", (q) => q.eq("qualify_keep", true)),
    enriched: await rawCount("sendable_leads", (q) => q),
    verified: await rawCount("sendable_leads", (q) => q.in("email_status", ["valid", "catch_all"])),
    sendable: await rawCount("sendable_leads", (q) =>
      q.is("suppressed_reason", null).in("email_status", ["valid", "catch_all"])
    ),
  };
}

// --- Stage 8: the handoff record ----------------------------------------------------------------

/**
 * Write down that this run's addresses have been handed off for sending.
 *
 * ‼️ WITHOUT THIS, SUPPRESSION IS BLIND AND RE-MAILING IS THE DEFAULT. suppression.ts answers
 * "have we contacted this person" by reading `outreach_prospects`, and the only thing that has ever
 * minted a row there for a ReachInbox lead is `createCampaignProspect`, which runs when somebody
 * REPLIES. Everyone who ignored us stayed invisible. Measured on production 2026-09-19:
 * `outreach_prospects` held ZERO rows, so `already_contacted` and `domain_contacted` could never
 * fire, while a 136 address campaign had already gone out on 2026-09-16.
 *
 * ‼️ STAMPED AT PUBLISH, NOT AT A SEPARATE "I UPLOADED IT" REACTION, and the asymmetry is the
 * reason. A row wrongly marked handed off costs one lead we never mail. A row wrongly left unmarked
 * costs the same person a second cold sequence from a second domain, which is how sending domains
 * get burned at volume. The cheaper mistake is the one that is made here on purpose. The card says
 * so out loud, because the operator is the only one who knows whether the upload actually happened.
 *
 * ‼️ `confirmed` IS LEFT FALSE, DELIBERATELY. `outreach_prospects_due_idx` is
 * `where state <> 'CLOSED' and paused = false and confirmed = true`, which is the worklist the
 * Microsoft Graph nudge sender drains. These addresses are being mailed by ReachInbox. Confirming
 * them here would enrol every one of them in a SECOND sequence out of matthew@srtagency.com, from
 * the tenant that carries client mail, which is the single worst thing this lane could do.
 *
 * Insert-only by design: suppression runs before publish, so an address that is already in
 * `outreach_prospects` was already held back and cannot be in `rows`. The pre-read is a guard
 * against a re-driven publish, not a merge.
 */
export async function recordHandoff(
  runId: string,
  rows: SendableExportRow[],
  campaign: string | null
): Promise<{ recorded: number; alreadyKnown: number; error: string | null }> {
  if (!rows.length) return { recorded: 0, alreadyKnown: 0, error: null };

  const byEmail = new Map<string, SendableExportRow>();
  for (const r of rows) {
    const email = r.email.trim().toLowerCase();
    if (email) byEmail.set(email, r);
  }
  const emails = [...byEmail.keys()];

  // Which of these does the board already know? Chunked for the same reason every other `.in()` in
  // this lane is: supabase-js puts the filter in the query string, so the bound is URL length.
  const known = new Set<string>();
  for (let i = 0; i < emails.length; i += IN_CHUNK) {
    const slice = emails.slice(i, i + IN_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("outreach_prospects")
      .select("email")
      .in("email", slice);
    if (error) return { recorded: 0, alreadyKnown: 0, error: "reading the board failed: " + error.message };
    for (const r of data ?? []) known.add(String(r.email ?? "").toLowerCase());
  }

  const now = new Date().toISOString();
  const fresh = emails.filter((e) => !known.has(e));
  let recorded = 0;

  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    const slice = fresh.slice(i, i + INSERT_CHUNK).map((email) => {
      const r = byEmail.get(email) as SendableExportRow;
      const name = [r.first_name, r.last_name].filter(Boolean).join(" ") || r.owner_name || null;
      return {
        email,
        name,
        company: r.company || null,
        // ‼️ THE WEBSITE IS WHAT MAKES `domain_contacted` WORK. suppression.ts matches a domain with
        // `website ilike %domain%`, so a null here silently narrows the check to exact-address only
        // and the second person at the same clinic gets mailed anyway.
        website: r.website || (r.domain ? "https://" + r.domain : null),
        city: r.city || null,
        phone: r.phone || null,
        source: "listprep",
        // ‼️ THE COLUMN THAT MAKES THE WHOLE BUILD MEASURABLE, AND THE ONE THING HERE THAT CANNOT BE
        // BACKFILLED. list_pipeline_runs -> run_id -> contacts -> clients is what answers "what
        // fraction of the Instagram list converted versus the Maps list". Once a run has been mailed
        // without it, that run's attribution is gone: `campaign` is free text an operator typed, and
        // two runs can share it. Everything else in this lane is recoverable by re-running something.
        run_id: runId,
        campaign,
        first_sent_at: now,
        last_touch_at: now,
      };
    });

    const { error } = await supabaseAdmin.from("outreach_prospects").insert(slice);
    if (error) {
      return {
        recorded,
        alreadyKnown: known.size,
        error: "writing the board failed after " + recorded + " rows: " + error.message,
      };
    }
    recorded += slice.length;
  }

  // The per-address stamp, so a run can be audited without joining back through the board.
  const { error: stampErr } = await supabaseAdmin
    .from("sendable_leads")
    .update({ sent_at: now })
    .eq("run_id", runId)
    .is("suppressed_reason", null)
    .is("sent_at", null)
    .in("email_status", ["valid", "catch_all"]);

  return {
    recorded,
    alreadyKnown: known.size,
    error: stampErr ? "stamping sendable_leads failed: " + stampErr.message : null,
  };
}
