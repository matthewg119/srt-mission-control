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
import type { QualifyCandidate, TierTally, Verdict } from "./qualify";
import { domainKey, isCrossRunIdentity } from "./dedup";
import { freeVerdict, type LeadRoute } from "./tiering";
import { crmSourceFor } from "./verticals";
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
  /**
   * What this run has been charged, by every vendor, to date.
   *
   * ‼️ IT IS READ SO IT CAN BE ADDED TO. A retried pull that overwrote this would erase the
   * previous attempt's task fees, which DataForSEO charges whether or not the page answered, and the
   * run would report a metro as cheaper than it was. Every writer of this column adds.
   */
  cost_usd: number;
  /**
   * How many businesses the vendor reports inside this pull's circle, for its category list.
   *
   * ‼️ THE DENOMINATOR OF "IS THIS METRO FINISHED", AND NOTHING ELSE HOLDS IT. Dallas has about
   * 1,765 across the five med spa categories and a 500-record pull took the first 500; without this
   * number the territory table cannot tell that from a metro that only ever had 500.
   */
  metro_total_count: number | null;
  drop_review_ts: string | null;
  error: string | null;
  /** Where these leads came from. 'csv' for a drop, 'outscraper' for a Maps pull. */
  source: string | null;
  /** Outscraper's request id, so a dropped or replayed webhook can be named rather than guessed. */
  pull_request_id: string | null;
  /** When the pull webhook landed. THE MARKER the pulling poll ends on. Zero rows is a real answer. */
  pull_finished_at: string | null;
  /** Slack ts of the spend-estimate card. */
  pull_approval_ts: string | null;
  /** Set by the check mark on that card, and only then is Outscraper called. */
  spend_approved_at: string | null;
  /**
   * How many times the vendor fetch has been driven for this pull.
   *
   * ‼️ RAISED BEFORE THE ATTEMPT, NEVER AFTER IT. A counter bumped on the way out is not written
   * at all when the lambda is cut off mid-fetch, so a pull that dies three times reads as never
   * having been tried and is re-driven forever. Bumped first, the worst case is one attempt charged
   * that was not finished, which is the safe direction: the cap is reached rather than never
   * approached.
   */
  pull_attempts: number;
  started_at: string | null;
}

// ‼️ A COLUMN MISSING FROM THIS STRING IS SILENTLY `undefined`, NOT AN ERROR. Same trap as
// BATCH_COLUMNS in store.ts: PostgREST returns only what it was asked for, so a field added to
// RunRow and forgotten here reads as absent on every row and every guard written against it is
// true forever. Add to both or neither.
const RUN_COLUMNS =
  "id, batch_id, label, icp_text, vertical_slug, stage, raw_count, qualified_count, " +
  "enriched_count, verified_count, sendable_count, cost_usd, metro_total_count, " +
  "drop_review_ts, error, " +
  // The Maps door. Every one of these is read by a guard, so omitting any makes that guard true
  // forever, which is the trap the comment above states.
  "source, pull_request_id, pull_finished_at, pull_approval_ts, spend_approved_at, " +
  "pull_attempts, started_at";

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
    // ‼️ ONE STRING LITERAL, NOT A CONCATENATION, AND tsc IS THE REASON. supabase-js infers the
    // row type from the literal text of this argument; built with `+` it widens to string and `data`
    // comes back as GenericStringError[], which then needs a double cast at every field. Long line,
    // honest types.
    .select("id, business_name, domain, website, city, state, categories, primary_type, rating, review_count, instagram_handle, is_claimed")
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
      website: (row.website as string | null) ?? null,
      isClaimed: (row.is_claimed as boolean | null) ?? null,
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
    // ‼️ AN UNJUDGED ROW GETS NO TIER AND NO ROUTE EITHER, for the reason the comment above
    // gives about `keep`. Writing route 'drop' on a model timeout would move the lead off the call
    // list as well as off the email list, which is the same mistake twice.
    const patch: Record<string, unknown> =
      v.keep === null
        ? { qualify_reason: v.reason, qualify_model: model }
        : {
            qualify_keep: v.keep,
            qualify_reason: v.reason,
            qualify_model: model,
            qualified_at: now,
            tier: v.tier,
            judged_vertical: v.judgedVertical,
            route: v.route,
          };
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
      // ‼️ THE ROUTE IS 'call', AND THAT IS THE WHOLE CHANGE OF 2026-10-08 IN ONE WORD. These rows
      // were already being exported by scripts/export-cold-call-leads.ts, which selected on
      // `website is null` and therefore re-derived this rule in SQL. Now the row SAYS where it goes,
      // so the export reads a column and the call list cannot silently diverge from the pipeline.
      // `qualify_keep` stays false because it still means "not going into enrichment".
      route: "call",
    })
    .eq("run_id", runId)
    .is("qualify_keep", null)
    .is("qualify_reason", null)
    .or("website.is.null,website.eq.")
    .select("id");
  if (error) throw new Error("dropWebsiteless: " + error.message);
  return data?.length ?? 0;
}

/**
 * Drop rows this lane has already pulled under an earlier run, before the model is paid to judge them.
 *
 * ‼️ THE GAP THIS CLOSES IS OPENED BY THE GEOMETRY ITSELF. `raw_leads` is unique on
 * (run_id, place_id) only WITHIN a run, and circles cannot tile a plane, so overlapping cells deliver
 * the same clinic under several runs by design. The record cost of that is trivial ($0.00036); the
 * Claude sweep over every duplicate is not, and it is the expensive stage this whole pipeline was
 * reordered to protect.
 *
 * ‼️ IT IS A FREE RULE AND IT RUNS BEFORE THE PAID ONE, the same order filter.ts uses for its string
 * checks ahead of a DNS lookup, and the same shape `dropWebsiteless` above has: an ordinary drop with
 * an ordinary written reason, so it groups and counts on the existing drop-review card and explains
 * itself in dropped.csv instead of being invisible bookkeeping.
 *
 * ‼️ `created_at < started_at`, NEVER `run_id != runId`. A symmetric "some other run has this too"
 * test lets two runs each drop the other's copy and lose the lead entirely. A strict time comparison is
 * a total order with no ties, because every row of this run is created after the run's own
 * `started_at`, so exactly one copy survives: the earliest.
 *
 * ‼️ AND NOT ON `domain`. The existing scraper_seen ledger keys on domain (ACTIVE_KEYS), which is right
 * for "have we contacted this company" and wrong here: a twelve-location med spa chain shares one
 * domain, so a domain rule would drop eleven real clinics. `place_id` is per location.
 */
export async function dropCrossRunDuplicates(runId: string): Promise<number> {
  const run = await getRun(runId);
  if (!run?.started_at) return 0;

  // This run's candidates: rows not yet judged, that carry an identity worth comparing.
  const { data: mine, error: mineError } = await supabaseAdmin
    .from("raw_leads")
    .select("id, place_id")
    .eq("run_id", runId)
    .is("qualify_keep", null)
    .is("qualify_reason", null)
    .not("place_id", "is", null);
  if (mineError) throw new Error("dropCrossRunDuplicates(read): " + mineError.message);

  const byPlace = new Map<string, string[]>();
  for (const r of mine ?? []) {
    const row = r as Record<string, unknown>;
    const placeId = (row.place_id as string | null) ?? null;
    if (!isCrossRunIdentity(placeId)) continue;
    const key = String(placeId);
    const ids = byPlace.get(key) ?? [];
    ids.push(String(row.id));
    byPlace.set(key, ids);
  }
  if (!byPlace.size) return 0;

  // ‼️ CHUNKED AT 100, NOT 500. supabase-js puts `.in()` filters in the QUERY STRING, so the bound is
  // proxy URL length rather than anything Postgres cares about. store.ts states this above IN_CHUNK.
  const IN_CHUNK = 100;
  const keys = [...byPlace.keys()];
  const seenEarlier = new Set<string>();
  for (let i = 0; i < keys.length; i += IN_CHUNK) {
    const slice = keys.slice(i, i + IN_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("raw_leads")
      .select("place_id")
      .in("place_id", slice)
      .lt("created_at", run.started_at)
      .limit(slice.length * 4);
    if (error) throw new Error("dropCrossRunDuplicates(prior): " + error.message);
    for (const r of data ?? []) {
      const placeId = (r as Record<string, unknown>).place_id;
      if (typeof placeId === "string") seenEarlier.add(placeId);
    }
  }
  if (!seenEarlier.size) return 0;

  const doomed: string[] = [];
  for (const [placeId, ids] of byPlace) {
    if (seenEarlier.has(placeId)) doomed.push(...ids);
  }
  if (!doomed.length) return 0;

  const now = new Date().toISOString();
  let dropped = 0;
  for (let i = 0; i < doomed.length; i += IN_CHUNK) {
    const slice = doomed.slice(i, i + IN_CHUNK);
    const { data, error } = await supabaseAdmin
      .from("raw_leads")
      .update({
        qualify_keep: false,
        qualify_reason: "already pulled under an earlier run (overlapping cell)",
        qualify_model: "rule",
        qualified_at: now,
        // A genuine 'drop': the earlier copy is the one that carries the route. Routing this to
        // 'call' as well would put the same clinic on the call list twice.
        route: "drop",
      })
      .in("id", slice)
      // Re-checked at write time: a chunk that took a while must not overwrite a verdict the model
      // wrote in the meantime.
      .is("qualify_keep", null)
      .select("id");
    if (error) throw new Error("dropCrossRunDuplicates(write): " + error.message);
    dropped += data?.length ?? 0;
  }
  return dropped;
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

/**
 * The tier and route breakdown for the drop-review card.
 *
 * ‼️ SEVEN HEAD COUNTS RATHER THAN ONE GROUP BY, for the reason qualifyTally is written the same
 * way: PostgREST cannot express a group-by, and the alternative is reading every row of the run into
 * the lambda to count it in JavaScript. A head count is one index probe; seven of them is still
 * cheaper than one 5,000 row read, and the shape of the answer is fixed rather than depending on
 * which values happen to be present.
 *
 * ‼️ `untiered` COUNTS KEPT ROWS WITH NO TIER, NOT ALL ROWS WITH NO TIER. A dropped row has no
 * tier either and is already counted as a drop; adding it here would double count it and make the
 * card's own numbers fail to sum.
 */
export async function tierTally(runId: string): Promise<TierTally> {
  const baseQuery = () =>
    supabaseAdmin.from("raw_leads").select("id", { count: "exact", head: true }).eq("run_id", runId);
  const count = async (apply: (q: ReturnType<typeof baseQuery>) => ReturnType<typeof baseQuery>) => {
    const { count: n, error } = await apply(baseQuery());
    if (error) {
      throw new Error(
        "tierTally: " + error.message +
          ". If that names tier or route, docs/2026-10-08-lead-tiers.sql has not been run."
      );
    }
    return n ?? 0;
  };

  const [a, b, c, untiered, emailable, callable] = await Promise.all([
    count((q) => q.eq("tier", "A")),
    count((q) => q.eq("tier", "B")),
    count((q) => q.eq("tier", "C")),
    count((q) => q.eq("qualify_keep", true).is("tier", null)),
    count((q) => q.eq("route", "email")),
    count((q) => q.eq("route", "call")),
  ]);
  return { a, b, c, untiered, emailable, callable };
}

/**
 * The free rules, applied to every unjudged row of a run before the model is asked.
 *
 * ‼️ IT REPLACES NOTHING AND RUNS BEFORE EVERYTHING. `dropWebsiteless` still handles the
 * commonest case in one UPDATE, because 128 of the stored 550 rows have no website and doing that
 * row by row would be 128 round trips for a question SQL can answer in one. This handles the two
 * rules SQL cannot: the aggregator host list lives in TypeScript (dedup.ts), and "how many rows in
 * this pull share this domain" needs the pull in hand.
 *
 * ‼️ AGGREGATOR HOSTS ARE EXCLUDED FROM THE CHAIN COUNT, AND THAT IS MEASURED. On the Dallas 500,
 * 15 domains appear at 2+ locations covering 47 rows, and 15 of those 47 are instagram.com (9),
 * vagaro.com (4) and facebook.com (2). Counting them as a chain deletes nine unrelated businesses
 * as one franchise. They are routed to the call list by the rule ABOVE the chain rule, so by the
 * time the count is taken they are already gone.
 */
export async function applyFreeRules(runId: string): Promise<{ call: number; drop: number }> {
  const { data, error } = await supabaseAdmin
    .from("raw_leads")
    .select("id, website, domain")
    .eq("run_id", runId)
    .is("qualify_keep", null)
    .is("qualify_reason", null);
  if (error) throw new Error("applyFreeRules(read): " + error.message);

  const rows = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      id: String(row.id),
      website: (row.website as string | null) ?? null,
      domain: (row.domain as string | null) ?? null,
    };
  });
  if (!rows.length) return { call: 0, drop: 0 };

  // How many rows share each identifying domain. domainKey returns null for an aggregator, so those
  // rows never enter this map and can never be counted as a chain.
  const perDomain = new Map<string, number>();
  for (const r of rows) {
    const key = domainKey(r.website ?? r.domain);
    if (!key) continue;
    perDomain.set(key, (perDomain.get(key) ?? 0) + 1);
  }

  // ‼️ GROUPED BY VERDICT AND WRITTEN IN BULK, NOT ROW BY ROW, AND AT 5,000 RECORDS A DAY THAT IS
  // THE DIFFERENCE BETWEEN A TICK AND A TIMEOUT. The first version of this did one PostgREST UPDATE
  // per decided row. Measured on the Dallas 500 about 49 rows fire, which is 490 round trips per
  // 5,000 record day at perhaps 30ms each: a quarter of the whole 240s tick spent on writes, before
  // the model is asked anything. Grouping collapses it to one write per distinct reason, because a
  // free rule's reason is drawn from a tiny fixed set.
  //
  // ‼️ AND THE CHAIN REASON CARRIES THE LOCATION COUNT, so "domain shared by 6 locations" and
  // "domain shared by 4 locations" are different groups. That is wanted: the number is the evidence,
  // and it is what makes the drop-review card readable. It also keeps the group count bounded, since
  // there are only ever a handful of distinct counts in one pull.
  const byVerdict = new Map<string, { route: LeadRoute; reason: string; ids: string[] }>();
  for (const r of rows) {
    const key = domainKey(r.website ?? r.domain);
    const verdict = freeVerdict({
      website: r.website,
      domain: r.domain,
      reviewCount: null,
      sameDomainCount: key ? (perDomain.get(key) ?? 1) - 1 : 0,
    });
    if (!verdict) continue;
    const groupKey = verdict.route + "|" + verdict.reason;
    const group = byVerdict.get(groupKey) ?? { route: verdict.route, reason: verdict.reason, ids: [] };
    group.ids.push(r.id);
    byVerdict.set(groupKey, group);
  }

  const now = new Date().toISOString();
  let call = 0;
  let drop = 0;

  for (const group of byVerdict.values()) {
    for (let i = 0; i < group.ids.length; i += IN_CHUNK) {
      const slice = group.ids.slice(i, i + IN_CHUNK);
      const { data: written, error: writeError } = await supabaseAdmin
        .from("raw_leads")
        .update({
          // A free rule never puts a row into enrichment, so keep is false whichever way it routed.
          // The ROUTE is what says whether there is still somebody to ring.
          qualify_keep: false,
          qualify_reason: group.reason,
          qualify_model: "rule",
          qualified_at: now,
          route: group.route,
        })
        .in("id", slice)
        // Re-checked at write time, the same guard dropCrossRunDuplicates uses: a sweep that took a
        // while must not overwrite a verdict the model wrote in the meantime.
        .is("qualify_keep", null)
        .select("id");
      if (writeError) throw new Error("applyFreeRules(write): " + writeError.message);
      // ‼️ COUNTED FROM WHAT THE DATABASE ACCEPTED, NOT FROM WHAT WAS ASKED. The guard above can
      // refuse a row, and a card reporting the ask rather than the write would overstate the saving.
      const n = written?.length ?? 0;
      if (group.route === "call") call += n;
      else drop += n;
    }
  }

  return { call, drop };
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
    // ‼️ ROUTE, NOT qualify_keep, AND THE DIFFERENCE IS TIER C. A nail bar under the front-desk
    // profile is genuinely the buyer (it has a front desk and it asks for reviews), so it is KEPT;
    // what it is not is worth a crawl and a MillionVerifier credit. Selecting on `qualify_keep` here
    // would enrich it anyway and the "never emailed" rule would have to be enforced somewhere
    // further downstream, which is a rule in two places. One column decides the channel.
    //
    // ‼️ AND IT STILL PICKS UP EVERY PRE-TIERING ROW. docs/2026-10-08-lead-tiers.sql backfilled
    // route='email' for all 270 kept-with-a-website rows, so nothing already judged falls out of
    // this worklist. A row with a null route was never judged and must not be enriched.
    .eq("route", "email")
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

  // ‼️ THE RUNNERS-UP GO IN TOO, AND THEY CANNOT SHIP UNTIL A VERIFIER RULES ON THEM. A guessing rung
  // has six patterns and no way to tell which is right, so all of them are written, verified in the
  // same upload as everything else, and `resolvePermutations` keeps the winner and suppresses the
  // rest. This is safe only because `sendableRows` admits `valid` and `catch_all` alone, and a row
  // nobody has verified is neither: an unresolved candidate is invisible to the send list by default.
  for (const alt of args.hit.alternates ?? []) {
    const { error: altErr } = await supabaseAdmin.from("sendable_leads").insert({
      run_id: args.runId,
      raw_lead_id: args.rawLeadId,
      email: alt,
      first_name: args.hit.firstName,
      last_name: args.hit.lastName,
      title: args.hit.title,
      provider: args.hit.provider,
      // The cost sits on the primary row only, so a funnel that sums this column stays honest.
      provider_cost_usd: 0,
      attempts: args.attempts,
    });
    if (altErr && altErr.code !== "23505") throw new Error("recordEnrichment(alternate): " + altErr.message);
  }
}

/**
 * One address per company, once the verdicts are in.
 *
 * ‼️ WITHOUT THIS, A GUESSED LEAD SHIPS SIX TIMES. The permutation rung writes every pattern it wants
 * tested, so a company can hold six candidate rows. After verification exactly one should survive:
 * a `valid` beats a `catch_all`, and among equals the SHORTEST local part wins, which is `first@`,
 * the pattern a one-to-three person clinic actually uses.
 *
 * ‼️ AND IT ONLY TOUCHES ROWS THAT SHARE A raw_lead_id. A company with one address is left alone,
 * so this is a no-op for every lead the crawl or the file already solved.
 */
export async function resolvePermutations(runId: string): Promise<{ kept: number; suppressed: number }> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select("id, raw_lead_id, email, email_status, suppressed_reason")
    .eq("run_id", runId)
    .is("suppressed_reason", null);
  if (error) throw new Error("resolvePermutations: " + error.message);

  const byLead = new Map<string, Array<{ id: string; email: string; email_status: string | null }>>();
  for (const r of (data ?? []) as Array<{ id: string; raw_lead_id: string; email: string; email_status: string | null }>) {
    const list = byLead.get(r.raw_lead_id) ?? [];
    list.push({ id: r.id, email: r.email, email_status: r.email_status });
    byLead.set(r.raw_lead_id, list);
  }

  const rank = (s: string | null): number => (s === "valid" ? 0 : s === "catch_all" ? 1 : s === "unknown" ? 2 : 3);
  const losers: string[] = [];
  let kept = 0;
  for (const rows of byLead.values()) {
    if (rows.length < 2) continue;
    rows.sort((a, b) => rank(a.email_status) - rank(b.email_status) || a.email.length - b.email.length);
    kept++;
    for (const r of rows.slice(1)) losers.push(r.id);
  }

  const now = new Date().toISOString();
  for (let i = 0; i < losers.length; i += IN_CHUNK) {
    const slice = losers.slice(i, i + IN_CHUNK);
    const { error: upErr } = await supabaseAdmin
      .from("sendable_leads")
      .update({ suppressed_reason: "lost_permutation", suppressed_at: now })
      .in("id", slice);
    if (upErr) throw new Error("resolvePermutations(suppress): " + upErr.message);
  }
  return { kept, suppressed: losers.length };
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

  // ‼️ A no_mx DOMAIN IS A BUSINESS FOR THE CALL LIST, NOT A LEAD WE ARE DONE WITH. Measured over
  // the 75 nameless Dallas clinics: 26 had NO MX RECORD AT ALL, which means the domain cannot receive
  // mail from anybody, ever. The address is dead; the clinic is not. Marking the address invalid and
  // stopping there leaves a real business with a real phone number sitting in a table nobody exports.
  //
  // ‼️ AND IT IS no_mx ALONE, NEVER bad_syntax OR disposable. A malformed address is a fact about
  // our CRAWL, not about the business: the site published something unparseable and the right answer
  // is to crawl it again, not to give up on email for that clinic. A disposable domain is a fact
  // about a throwaway inbox. Only "this domain has no mail server" is evidence about the business.
  //
  // ‼️ mxRecords [] AND mxRecords null MEAN OPPOSITE THINGS, and the caller is what has to keep
  // them apart: `mailProviderOf` returns null for BOTH "no MX" and "an MX we do not recognise". This
  // function only ever sees the kind the caller already decided, which is why it can act on it.
  const noMx = rejects.filter((r) => r.kind === "no_mx").map((r) => r.id);
  if (noMx.length) {
    for (let i = 0; i < noMx.length; i += IN_CHUNK) {
      const slice = noMx.slice(i, i + IN_CHUNK);
      const { data, error } = await supabaseAdmin
        .from("sendable_leads")
        .select("raw_lead_id")
        .eq("run_id", runId)
        .in("id", slice);
      if (error) throw new Error("applyFreeRejects(no_mx lookup): " + error.message);
      const leadIds = [...new Set((data ?? []).map((r) => String((r as Record<string, unknown>).raw_lead_id)))];
      if (!leadIds.length) continue;
      const { error: routeError } = await supabaseAdmin
        .from("raw_leads")
        .update({ route: "call" })
        .in("id", leadIds)
        // Only a row still routed to email. A lead the free rules already sent to the call list is
        // there; one that was dropped as a chain is dropped for a reason MX cannot overturn.
        .eq("route", "email");
      if (routeError) throw new Error("applyFreeRejects(no_mx route): " + routeError.message);
    }
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
  /**
   * The merge variables the opening line is written from.
   *
   * ‼️ THEY ARE ON THE CSV BECAUSE THAT IS THE ONLY PLACE THEY CAN BE USED. ReachInbox merges
   * from the uploaded columns; a fact that stays in `raw_leads` cannot reach a sequence, however
   * well it was measured. Lifting is_claimed and the top competitor into columns bought nothing
   * until this line, which is exactly what the dead-wires probe said when it failed the build:
   * three columns backfilled over 1,582 rows and read by nothing.
   *
   * ‼️ AND THEY ARE STRINGS, EMPTY WHEN UNKNOWN, NEVER "0" OR "false". A sequence that writes
   * "the clinic down the road has 0 reviews" because a number was missing is worse than one that
   * skips the line. `competitor_reviews` empty is the signal to use a different opener.
   */
  competitor_name: string;
  competitor_rating: string;
  competitor_reviews: string;
  /** "unclaimed" or empty. Never "claimed": the line only exists when the answer is the former. */
  google_listing: string;
}

/** The send list. `suppressed_reason is null` is the sendable set. */
export async function sendableRows(runId: string): Promise<SendableExportRow[]> {
  const { data, error } = await supabaseAdmin
    .from("sendable_leads")
    .select(
      "email, first_name, last_name, provider, email_status, " +
        "raw_leads!inner(business_name, owner_name, website, domain, city, state, phone, " +
        "qualify_reason, competitor_name, competitor_rating, competitor_reviews, is_claimed)"
    )
    .eq("run_id", runId)
    .is("suppressed_reason", null)
    .in("email_status", ["valid", "catch_all"]);
  if (error) throw new Error("sendableRows: " + error.message);

  // ‼️ A GUESS MUST BE PROVEN. CATCH-ALL IS NOT PROOF. `catch_all` means the server accepts every
  // address, so it is evidence about the DOMAIN and none at all about the MAILBOX.
  //
  // For an address the crawl FOUND that distinction does not matter: somebody published it, so the
  // mailbox exists and catch-all only means the verifier could not add to what the page already
  // said. For an address the permutation rung INVENTED it is the whole question, and shipping one
  // is mailing a mailbox nobody has evidence exists. That is the bounce, and bounces are charged to
  // the sending domain's reputation rather than to the guess that caused them.
  //
  // So the rule is per SOURCE, not per status: a found address may be catch_all, a guessed one must
  // be `valid`. GUESSING_PROVIDERS is the list, and it is a list rather than a boolean because the
  // paid domain-people rung will join it the day it gets a key.
  const GUESSING_PROVIDERS = new Set(["permute-guess", "domain-people"]);
  const proven = (data ?? []).filter((r) => {
    const row = r as unknown as Record<string, unknown>;
    if (!GUESSING_PROVIDERS.has(String(row.provider ?? ""))) return true;
    return String(row.email_status ?? "") === "valid";
  });

  return proven.map((r) => {
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
      // ‼️ BOTH HALVES OR NEITHER. "Zuri Aesthetics" with no number and "310" with no name are
      // each half a sentence, and a merge field that is sometimes half a sentence produces an email
      // that is sometimes nonsense. Measured on the stored rows: 1,582 of 1,750 carry a competitor
      // and 1,390 of those are out-reviewed by it, so the line is available on most of the list.
      competitor_name: j.competitor_name && j.competitor_reviews ? String(j.competitor_name) : "",
      competitor_reviews: j.competitor_name && j.competitor_reviews ? String(j.competitor_reviews) : "",
      // ‼️ THE RATING RIDES ALONG RATHER THAN BEING DROPPED, AND THE PROBE IS WHY IT IS HERE AT
      // ALL. It was the third column lifted out of `raw` and the only one still read by nothing
      // after the other two were wired, which the dead-wires check failed the build over. The
      // choice was a declaration saying "owed an opener that uses it" or one more CSV column. A
      // column is cheaper than a promise, and "4.7 with 310 reviews" is a better sentence than
      // "310 reviews". Gated on the same both-halves rule: a rating with no name is not a line.
      competitor_rating:
        j.competitor_name && j.competitor_reviews && j.competitor_rating
          ? String(j.competitor_rating)
          : "",
      // ‼️ ONLY THE FALSE CASE IS CARRIED. 234 of 1,750 listings are unclaimed and that is the
      // strongest "nobody is managing this" signal in the payload. "claimed" is not an opener and
      // null means the source did not say, which must never be written as either.
      google_listing: j.is_claimed === false ? "unclaimed" : "",
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
 * Put the call list into the CRM, so somebody can actually dial it.
 *
 * ‼️ THE WIRE THAT WAS NEVER THERE. /dashboard/worklist reads `contacts`, and Workflow C has
 * never written a row to it. Measured 2026-10-09: 376 businesses in raw_leads have no website, 323
 * of them have a phone number, and only 106 appear in `contacts` at all, every one of those from
 * the OLD med spa pipeline rather than from this lane. So the lane has been finding callable
 * businesses for three weeks and dropping them somewhere nothing dials.
 *
 * ‼️ IT READS `route`, NOT `website is null`, WHICH IS WHY IT WAITED FOR THE ROUTE COLUMN. Four
 * different things land on the call list and only one of them is "no website": an Instagram or
 * Vagaro-only presence, a domain with no MX record that can never receive mail, and Tier C. A
 * `website is null` query would find the first and silently miss the other three.
 *
 * ‼️ THE SHAPE MATCHES THE 92 ROWS THE OLD PIPELINE ALREADY LEFT HERE: source
 * "<Label> Scrape - No Website", working_state 'new', application_stage 'New Lead'. Matching it is
 * not cosmetic. `fetchCandidates` in src/lib/worklist.ts selects on `working_state <> 'closed'` and
 * `do_not_contact` false, and the leads page filters on `source`, so a row in a different shape is
 * a row that is in the table and not on the board.
 *
 * ‼️ phone_last10 IS NEVER WRITTEN, AND THAT IS THE OPPOSITE OF WHAT IT LOOKS LIKE. Every dedupe
 * in this codebase keys on that column, which reads as "so be sure to set it". It is a GENERATED
 * ALWAYS column:
 *
 *   right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10)
 *
 * Postgres computes it from `phone` on every insert and REFUSES any value you send
 * ("cannot insert a non-DEFAULT value into column phone_last10"), which is how this was found: the
 * first run of the backfill failed on all six runs at once. Looking for a trigger finds nothing and
 * is misleading; a generated column needs no trigger. Set `phone` and the key appears.
 *
 * ‼️ A ROW WITH NO PHONE IS REPORTED AND NOT INSERTED. This is the one place that rule differs
 * from the CSV export, which keeps them and marks them "NO PHONE - look it up". A spreadsheet can
 * carry a row somebody has to research; a CALL LIST cannot, and 53 un-dialable contacts on the
 * board is how a board stops being read. They stay in raw_leads and in the CSV.
 */
export async function recordCallList(
  runId: string,
  verticalSlug: string | null | undefined
): Promise<{ added: number; alreadyKnown: number; noPhone: number; error: string | null }> {
  // ‼️ IT REFUSES RATHER THAN INVENTING A SOURCE. Writing these rows under a string the leads
  // page does not filter on puts them in the table and on no list, which looks exactly like
  // success. The first run of the backfill did that to 253 contacts.
  const source = crmSourceFor(verticalSlug);
  if (!source) {
    return {
      added: 0,
      alreadyKnown: 0,
      noPhone: 0,
      error:
        "there is no CRM source registered for the vertical `" + String(verticalSlug) + "`, so " +
        "these leads would land under a name nothing filters on. Add `crmSource` in " +
        "src/lib/scraper/verticals.ts.",
    };
  }
  const { data, error } = await supabaseAdmin
    .from("raw_leads")
    .select(CALL_LIST_COLUMNS)
    .eq("run_id", runId)
    .eq("route", "call");
  if (error) return { added: 0, alreadyKnown: 0, noPhone: 0, error: "reading the call list failed: " + error.message };

  // ‼️ `as unknown as` BECAUSE THE COLUMN LIST IS A CONSTANT RATHER THAN A LITERAL. supabase-js
  // infers a row type from the select STRING, so moving the list into CALL_LIST_COLUMNS (shared with
  // the sweep, which is the point) costs the inference. The alternative is two copies of a
  // fourteen-column list, and two copies of that is how a sweep starts writing a column the run
  // path stopped writing.
  const rows = (data ?? []).map((r) => r as unknown as Record<string, unknown>);
  return writeCallList(rows, source);
}

/**
 * Every call-route lead this lane has ever pulled, whatever run it came from, into the CRM.
 *
 * ‼️ THE PER-RUN WRITE IS NOT ENOUGH AND THE GAP IS STRUCTURAL. `recordCallList` runs at the end of
 * a run, which covers everything from here on and nothing from before, and it cannot cover a row
 * whose ROUTE WAS DECIDED LATER: a lead parked as unjudged when its run finished, re-qualified on a
 * later tick and routed to `call`, is never looked at again by anything. Measured on 2026-10-09:
 * 423 leads on the call route, 367 with a usable phone, and 6 of those in no CRM row at all.
 *
 * ‼️ IT IS A RECONCILIATION, NOT A BACKFILL, so it is safe and useful to run on a schedule. Every
 * insert is deduped against `contacts` on both `google_place_id` and `phone_last10` and within the
 * batch itself, exactly as the per-run path is, so running it twice adds nothing the first run did
 * not. That is what lets the cron call it rather than somebody remembering to.
 *
 * ‼️ PAGED, BECAUSE PostgREST CAPS A RESPONSE AT 1,000 ROWS. 423 rows fits today and will not at
 * 4,000 records a day, and the failure mode is the one that already truncated the territory map:
 * the query succeeds, returns 1,000, and the sweep reports a clean reconciliation over a third of
 * the data.
 */
export async function sweepCallListGap(
  verticalSlug: string | null | undefined,
  options: { includeUnphoned?: boolean } = {}
): Promise<{
  scanned: number;
  added: number;
  alreadyKnown: number;
  noPhone: number;
  error: string | null;
}> {
  const source = crmSourceFor(verticalSlug);
  if (!source) {
    return {
      scanned: 0,
      added: 0,
      alreadyKnown: 0,
      noPhone: 0,
      error:
        "there is no CRM source registered for the vertical `" + String(verticalSlug) + "`, so " +
        "these leads would land under a name nothing filters on. Add `crmSource` in " +
        "src/lib/scraper/verticals.ts.",
    };
  }

  const PAGE_SIZE = 1000;
  const rows: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabaseAdmin
      .from("raw_leads")
      .select(CALL_LIST_COLUMNS)
      .eq("vertical_slug", verticalSlug ?? "")
      .eq("route", "call")
      // A total order, so paging cannot return the same row twice or skip one. `created_at` alone
      // is not one: a 300-record chunk lands inside the same second.
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      return { scanned: rows.length, added: 0, alreadyKnown: 0, noPhone: 0, error: "reading the call list failed: " + error.message };
    }
    const page = (data ?? []) as unknown as Array<Record<string, unknown>>;
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const wrote = await writeCallList(rows, source, options.includeUnphoned ?? true);
  return { scanned: rows.length, ...wrote };
}

/** The raw_leads columns a contact is built from. One list, so the sweep and the run path agree. */
const CALL_LIST_COLUMNS =
  "id, business_name, phone, website, city, state, postal_code, full_address, place_id, " +
  "instagram_handle, qualify_reason, review_count, rating, owner_name";

/**
 * Put a batch of call-route leads into the CRM, deduped. The shared half of recordCallList.
 *
 * ‼️ EXTRACTED RATHER THAN COPIED, AND THE ROW SHAPE IS WHY. recordCallList's own header says the
 * shape is not cosmetic: `fetchCandidates` selects on `working_state <> 'closed'`, the leads page
 * filters on `source` with `eq`, and a row in a different shape is a row that is in the table and
 * on no list. A second writer would start out identical and drift, and the first symptom would be
 * leads that exist and cannot be found.
 *
 * ‼️ `includeUnphoned` IS A PARAMETER AND ITS DEFAULT IS THE OLD BEHAVIOUR. The run path still
 * refuses a row with no usable phone, because a call list is for dialling. The SWEEP passes true,
 * because the question it answers is "is any pulled business missing from the book", and for that
 * question an un-dialable row is still a missing lead. Both are defensible and they are different
 * jobs, so it is an argument rather than a changed rule.
 */
async function writeCallList(
  rows: Array<Record<string, unknown>>,
  source: string,
  includeUnphoned = false
): Promise<{ added: number; alreadyKnown: number; noPhone: number; error: string | null }> {
  if (!rows.length) return { added: 0, alreadyKnown: 0, noPhone: 0, error: null };

  const last10 = (phone: unknown): string | null => {
    const digits = String(phone ?? "").replace(/\D/g, "");
    if (digits.length < 10) return null;
    const ten = digits.slice(-10);
    // 0000000000 / 5555555555: placeholder cells, not numbers, and they collide everything.
    return /^(\d)\1{9}$/.test(ten) ? null : ten;
  };

  const phoned = rows.filter((r) => last10(r.phone) !== null);
  const noPhone = rows.length - phoned.length;
  const callable = includeUnphoned ? rows : phoned;
  if (!callable.length) return { added: 0, alreadyKnown: 0, noPhone, error: null };

  // ‼️ DEDUPED ON BOTH place_id AND phone_last10, AND NEITHER ALONE IS ENOUGH. A Google place id
  // is per LOCATION and is the only key that tells two sites of one group apart, but the 531
  // contacts the old pipeline left behind carry no place id at all. The last ten digits catch those;
  // the place id catches a business that has since changed its number.
  const placeIds = [...new Set(callable.map((r) => String(r.place_id ?? "")).filter(Boolean))];
  // ‼️ `filter(Boolean)` BEFORE THE Set AND NOT AFTER, now that an unphoned row can reach here. A
  // null in this list becomes `phone_last10=in.(null)` in the query string, which PostgREST reads
  // as the literal string "null" and matches nothing, so every lookup would silently miss.
  const phones = [...new Set(callable.map((r) => last10(r.phone)).filter((p): p is string => !!p))];

  const knownPlaces = new Set<string>();
  const knownPhones = new Set<string>();
  for (let i = 0; i < placeIds.length; i += IN_CHUNK) {
    const { data: hit, error: e } = await supabaseAdmin
      .from("contacts")
      .select("google_place_id")
      .in("google_place_id", placeIds.slice(i, i + IN_CHUNK));
    if (e) return { added: 0, alreadyKnown: 0, noPhone, error: "reading the CRM failed: " + e.message };
    for (const h of hit ?? []) knownPlaces.add(String((h as Record<string, unknown>).google_place_id ?? ""));
  }
  for (let i = 0; i < phones.length; i += IN_CHUNK) {
    const { data: hit, error: e } = await supabaseAdmin
      .from("contacts")
      .select("phone_last10")
      .in("phone_last10", phones.slice(i, i + IN_CHUNK));
    if (e) return { added: 0, alreadyKnown: 0, noPhone, error: "reading the CRM failed: " + e.message };
    for (const h of hit ?? []) knownPhones.add(String((h as Record<string, unknown>).phone_last10 ?? ""));
  }

  // ‼️ DEDUPED WITHIN THE BATCH TOO. Overlapping cells deliver the same clinic under several
  // runs, and dropCrossRunDuplicates only catches the ones it reaches before the model does. Two
  // rows for one phone number in the same insert would both land, because there is no unique index
  // on contacts.phone_last10 to stop them.
  const seen = new Set<string>();
  const fresh: Array<Record<string, unknown>> = [];
  let alreadyKnown = 0;

  for (const r of callable) {
    const phoneKey = last10(r.phone);
    const placeKey = String(r.place_id ?? "");
    if ((phoneKey && knownPhones.has(phoneKey)) || (placeKey && knownPlaces.has(placeKey))) {
      alreadyKnown += 1;
      continue;
    }
    // ‼️ AN UNPHONED ROW IS DEDUPED ON ITS PLACE ID, AND REFUSED WHEN IT HAS NEITHER. With no phone
    // and no place id there is no key at all, so a re-run would insert the same business again on
    // every sweep. A business with neither is also one nobody can act on.
    const key = phoneKey ?? (placeKey ? "place:" + placeKey : null);
    if (!key) {
      alreadyKnown += 1;
      continue;
    }
    if (seen.has(key)) continue;
    seen.add(key);

    fresh.push({
      business_name: String(r.business_name ?? ""),
      // ‼️ THE OWNER NAME IS CARRIED WHEN THE CRAWL FOUND ONE AND LEFT BLANK OTHERWISE. A call
      // list where every row says "there" is worse than one that admits it does not know.
      first_name: String(r.owner_name ?? "").split(/\s+/)[0] || null,
      // phone_last10 is GENERATED ALWAYS from this column. See the header: sending it is an error.
      // ‼️ NULL RATHER THAN "", because the generated column is right(regexp_replace(...), 10) and
      // an empty string produces an empty KEY, which every later row with no phone would then
      // collide with. Null produces null and collides with nothing.
      phone: phoneKey ? String(r.phone ?? "") : null,
      website: (r.website as string | null) ?? null,
      // ‼️ biz_*, NOT city/state/zip/address, AND THIS HAS BITTEN THIS CODEBASE BEFORE. There is
      // no `contacts.city`: the CRM workflow buttons shipped a query against one and found nothing.
      // The business location columns are biz_city, biz_state, biz_zip and biz_address, and
      // home_address is a different thing belonging to the funding side.
      biz_city: (r.city as string | null) ?? null,
      biz_state: (r.state as string | null) ?? null,
      biz_zip: (r.postal_code as string | null) ?? null,
      biz_address: (r.full_address as string | null) ?? null,
      google_place_id: placeKey || null,
      instagram_handle: (r.instagram_handle as string | null) ?? null,
      // The shape the board reads. See the comment above: this is not cosmetic.
      source,
      source_system: "mission_control",
      working_state: "new",
      application_stage: "New Lead",
      do_not_contact: false,
      // ‼️ WHY THEY ARE BEING CALLED, ON THE CARD. The worklist renders next_action_reason, and
      // "Instagram only, no own domain" tells the person dialling what the opener is before they
      // pick up the phone. next_action_at is left NULL on purpose: that puts them in the "No
      // follow-up" bucket, which is true, rather than inventing a due date nobody agreed to.
      next_action_reason:
        (phoneKey ? "" : "NO PHONE on the row, look it up. ") +
        String(r.qualify_reason ?? "scraped, no email route"),
    });
  }

  if (!fresh.length) return { added: 0, alreadyKnown, noPhone, error: null };

  let added = 0;
  for (let i = 0; i < fresh.length; i += INSERT_CHUNK) {
    const { data: wrote, error: e } = await supabaseAdmin
      .from("contacts")
      .insert(fresh.slice(i, i + INSERT_CHUNK))
      .select("id");
    if (e) {
      // Partial success is reported as such, the same way storeRawLeads reports it: the rows
      // already committed are real, and a caller told "0" would insert them all again.
      return { added, alreadyKnown, noPhone, error: "writing to the CRM failed: " + e.message };
    }
    added += wrote?.length ?? 0;
  }

  return { added, alreadyKnown, noPhone, error: null };
}

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
