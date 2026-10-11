// The database side of `pull 2000 medspa`: the plan, its steps, and the metro circles it measures.
//
// ‼️ SPLIT FROM pull-plan.ts ON THE SAME LINE maps-command.ts AND lane.ts ARE SPLIT. The arithmetic
// is pure and provable offline; this file is the part that cannot be, so keeping it thin is what
// keeps the planner testable. Nothing here decides anything: it reads rows, writes rows, and claims
// one step at a time.

import { supabaseAdmin } from "@/lib/db";
import type { PlanStep } from "./pull-plan";

export type PlanStatus = "awaiting_approval" | "approved" | "running" | "done" | "cancelled" | "error";
export type StepStatus = "pending" | "running" | "done" | "skipped" | "error";

export interface PlanRowDb {
  id: string;
  vertical_slug: string;
  requested_records: number;
  status: PlanStatus;
  slack_channel_id: string;
  slack_thread_ts: string | null;
  approval_ts: string | null;
  approved_at: string | null;
  /**
   * What released this plan.
   *
   * ‼️ READ, NOT JUST WRITTEN, AND THIS GATE IS THE ONE WHERE IT MATTERS. Every other card in this
   * lane authorises ONE purchase, so "who ticked it" is the message right above the reaction. A plan
   * card authorises a list that then runs unattended for hours, and the chunks it spawns record
   * `spend_approved_by = pull_plan:<id>` rather than a human. This column is the other end of that
   * trail: without it, a run says a plan paid for it and nothing says who approved the plan.
   */
  approved_by: string | null;
  estimated_cost_usd: number;
  spent_usd: number;
  records_pulled: number;
  error: string | null;
  finished_at: string | null;
  /**
   * What is stopping the walk right now, or null when nothing is.
   *
   * ‼️ A PLAN THAT IS HELD UP AND SAYS NOTHING IS INDISTINGUISHABLE FROM ONE THAT WAS NEVER
   * APPROVED, which is the failure this column exists to prevent. Chunks are serialised, so any
   * earlier batch stuck anywhere in the pipeline stops the whole walk, and a 34 chunk plan can
   * therefore be perfectly healthy and perfectly motionless.
   */
  blocked_by: string | null;
  blocked_since: string | null;
  created_at: string;
}

export interface PlanStepRowDb {
  id: string;
  plan_id: string;
  seq: number;
  kind: "measure" | "pull_budget" | "pull";
  metro_key: string;
  metro_label: string;
  where_text: string;
  pull_limit: number | null;
  pull_offset: number | null;
  budget_records: number | null;
  command_text: string | null;
  estimated_cost_usd: number;
  status: StepStatus;
  batch_id: string | null;
  records_pulled: number | null;
  cost_usd: number | null;
  note: string | null;
  finished_at: string | null;
}

const PLAN_COLUMNS =
  "id, vertical_slug, requested_records, status, slack_channel_id, slack_thread_ts, approval_ts, " +
  "approved_at, approved_by, estimated_cost_usd, spent_usd, records_pulled, error, finished_at, " +
  "blocked_by, blocked_since, created_at";

const STEP_COLUMNS =
  "id, plan_id, seq, kind, metro_key, metro_label, where_text, pull_limit, pull_offset, " +
  "budget_records, command_text, estimated_cost_usd, status, batch_id, records_pulled, cost_usd, " +
  "note, finished_at";

/** The states a plan is still the live one in. Matches the partial unique index in the migration. */
export const LIVE_PLAN_STATUSES: PlanStatus[] = ["awaiting_approval", "approved", "running"];

/**
 * ‼️ A MISSING TABLE IS REPORTED, NOT SWALLOWED, AND THIS IS THE OPPOSITE OF cellsMeasured. That
 * function reports on a table and zero is an honest answer. These functions are the SPEND PATH: a
 * plan that silently fails to record itself would leave a card in Slack whose check mark resolves to
 * nothing, which looks exactly like a plan that was approved and is quietly running.
 */
function fail(what: string, message: string): never {
  throw new Error(
    what + ": " + message +
      (/scraper_pull_plan|scraper_metro_circles/.test(message)
        ? ". If that names a table, docs/2026-10-09-pull-plan.sql has not been run."
        : "")
  );
}

export async function createPlan(input: {
  vertical: string;
  requested: number;
  channel: string;
  threadTs: string | null;
  estimatedCostUsd: number;
  steps: readonly PlanStep[];
}): Promise<PlanRowDb> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .insert({
      vertical_slug: input.vertical,
      requested_records: input.requested,
      status: "awaiting_approval",
      slack_channel_id: input.channel,
      slack_thread_ts: input.threadTs,
      estimated_cost_usd: input.estimatedCostUsd,
    })
    .select(PLAN_COLUMNS)
    .single();
  // ‼️ 23505 IS THE PARTIAL UNIQUE INDEX DOING ITS JOB, AND IT GETS ITS OWN MESSAGE. "one live plan
  // per vertical" is enforced in Postgres rather than by a read-then-write, so a second
  // `pull 2000 medspa` typed while the first card is still up lands here. Reporting it as a generic
  // insert failure would read as a bug; it is the system refusing to double the spend.
  if (error) {
    if (error.code === "23505") {
      throw new Error(
        "there is already a live pull plan for `" + input.vertical + "`. Let it finish, or " +
          "`stop plan " + input.vertical + "` to cancel what has not run yet."
      );
    }
    fail("createPlan", error.message);
  }
  const plan = data as unknown as PlanRowDb;
  await insertSteps(plan.id, input.steps);
  return plan;
}

export async function insertSteps(planId: string, steps: readonly PlanStep[]): Promise<void> {
  if (!steps.length) return;
  const { error } = await supabaseAdmin.from("scraper_pull_plan_steps").insert(
    steps.map((s) => ({
      plan_id: planId,
      seq: s.seq,
      kind: s.kind,
      metro_key: s.metroKey,
      metro_label: s.metroLabel,
      where_text: s.where,
      pull_limit: s.limit,
      pull_offset: s.offset,
      budget_records: s.budget,
      command_text: s.command,
      estimated_cost_usd: s.costUsd,
    }))
  );
  if (error) fail("insertSteps", error.message);
}

export async function getPlan(id: string): Promise<PlanRowDb | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .select(PLAN_COLUMNS)
    .eq("id", id)
    .maybeSingle();
  if (error) fail("getPlan", error.message);
  return (data as unknown as PlanRowDb) ?? null;
}

/** The live plan for a vertical, if there is one. At most one exists; the index says so. */
export async function livePlan(vertical: string): Promise<PlanRowDb | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .select(PLAN_COLUMNS)
    .eq("vertical_slug", vertical)
    .in("status", LIVE_PLAN_STATUSES)
    .maybeSingle();
  if (error) fail("livePlan", error.message);
  return (data as unknown as PlanRowDb) ?? null;
}

/** Every plan the walker may advance, oldest first. Approved and running only. */
export async function walkablePlans(): Promise<PlanRowDb[]> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .select(PLAN_COLUMNS)
    .in("status", ["approved", "running"])
    .order("created_at", { ascending: true });
  if (error) fail("walkablePlans", error.message);
  return (data ?? []) as unknown as PlanRowDb[];
}

/**
 * Which plan carries this message ts.
 *
 * ‼️ SCOPED BY CHANNEL, EXACTLY LIKE batchByGateTs. Two plans in two channels can only share a ts if
 * Slack reuses one, and the scope is what makes that impossible to rely on by accident.
 */
export async function planByApprovalTs(channel: string, ts: string): Promise<PlanRowDb | null> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .select(PLAN_COLUMNS)
    .eq("slack_channel_id", channel)
    .eq("approval_ts", ts)
    .maybeSingle();
  if (error) fail("planByApprovalTs", error.message);
  return (data as unknown as PlanRowDb) ?? null;
}

export async function updatePlan(id: string, patch: Record<string, unknown>): Promise<void> {
  const { error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) fail("updatePlan", error.message);
}

/**
 * Approve a plan, once.
 *
 * ‼️ CONDITIONAL ON THE CURRENT STATUS, WHICH IS THE SECOND GUARD releaseMapsPull ALREADY HAS. Two
 * check marks arriving in the same tick both see `awaiting_approval`; only the one whose UPDATE
 * matches a row may start the walk. The reaction router's own status check is the first guard and
 * is not sufficient on its own.
 */
export async function approvePlan(id: string, by: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plans")
    .update({
      status: "approved",
      approved_at: new Date().toISOString(),
      approved_by: by,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("status", "awaiting_approval")
    .select("id");
  if (error) fail("approvePlan", error.message);
  return (data?.length ?? 0) > 0;
}

/** Cancel the live plan for a vertical. Steps already running are left alone; they finish. */
export async function cancelPlan(vertical: string): Promise<{ plan: PlanRowDb | null; stepsLeft: number }> {
  const plan = await livePlan(vertical);
  if (!plan) return { plan: null, stepsLeft: 0 };

  const { data: skipped, error: stepErr } = await supabaseAdmin
    .from("scraper_pull_plan_steps")
    .update({ status: "skipped", note: "the plan was cancelled", finished_at: new Date().toISOString() })
    .eq("plan_id", plan.id)
    .eq("status", "pending")
    .select("id");
  if (stepErr) fail("cancelPlan(steps)", stepErr.message);

  await updatePlan(plan.id, { status: "cancelled", finished_at: new Date().toISOString() });
  return { plan, stepsLeft: skipped?.length ?? 0 };
}

export async function planSteps(planId: string): Promise<PlanStepRowDb[]> {
  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plan_steps")
    .select(STEP_COLUMNS)
    .eq("plan_id", planId)
    .order("seq", { ascending: true });
  if (error) fail("planSteps", error.message);
  return (data ?? []) as unknown as PlanStepRowDb[];
}

/**
 * Take the next step, atomically.
 *
 * ‼️ A CONDITIONAL UPDATE, NOT A READ THEN A WRITE, AND THIS IS THE ONE PLACE IT MATTERS. Vercel can
 * run two cron invocations that overlap, and a read-then-write would let both see the same pending
 * step and both buy it. `.eq("status", "pending")` makes the claim the same operation as the read:
 * exactly one caller gets a row back, and the loser gets an empty array and does nothing.
 */
export async function claimNextStep(planId: string): Promise<PlanStepRowDb | null> {
  const { data: next, error: readErr } = await supabaseAdmin
    .from("scraper_pull_plan_steps")
    .select("id")
    .eq("plan_id", planId)
    .eq("status", "pending")
    .order("seq", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (readErr) fail("claimNextStep(read)", readErr.message);
  if (!next) return null;

  const { data, error } = await supabaseAdmin
    .from("scraper_pull_plan_steps")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", (next as { id: string }).id)
    .eq("status", "pending")
    .select(STEP_COLUMNS)
    .maybeSingle();
  if (error) fail("claimNextStep(claim)", error.message);
  return (data as unknown as PlanStepRowDb) ?? null;
}

export async function finishStep(
  stepId: string,
  patch: {
    status: StepStatus;
    batchId?: string | null;
    recordsPulled?: number | null;
    costUsd?: number | null;
    note?: string | null;
  }
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("scraper_pull_plan_steps")
    .update({
      status: patch.status,
      batch_id: patch.batchId ?? undefined,
      records_pulled: patch.recordsPulled ?? undefined,
      cost_usd: patch.costUsd ?? undefined,
      note: patch.note ?? undefined,
      finished_at: new Date().toISOString(),
    })
    .eq("id", stepId);
  if (error) fail("finishStep", error.message);
}

/** How a plan is doing, counted from its steps rather than from anything remembered. */
export async function planProgress(planId: string): Promise<{
  total: number;
  done: number;
  pending: number;
  running: number;
  errored: number;
  skipped: number;
}> {
  const steps = await planSteps(planId);
  return {
    total: steps.length,
    done: steps.filter((s) => s.status === "done").length,
    pending: steps.filter((s) => s.status === "pending").length,
    running: steps.filter((s) => s.status === "running").length,
    errored: steps.filter((s) => s.status === "error").length,
    skipped: steps.filter((s) => s.status === "skipped").length,
  };
}

/** Add what a step cost to the plan's running total. Read then write, because there is no rpc. */
export async function addPlanSpend(planId: string, costUsd: number, records: number): Promise<void> {
  const plan = await getPlan(planId);
  if (!plan) return;
  await updatePlan(planId, {
    spent_usd: Number(plan.spent_usd ?? 0) + costUsd,
    records_pulled: Number(plan.records_pulled ?? 0) + records,
  });
}

// ── metro circles ────────────────────────────────────────────────────────────────────────────────

export interface MetroCircle {
  verticalSlug: string;
  metroKey: string;
  metroLabel: string;
  locationName: string;
  lat: number;
  lon: number;
  radiusKm: number;
  categoriesKey: string;
  totalCount: number;
  costUsd: number;
}

/**
 * Write a circle's measured size, raising a smaller stored one and never lowering a larger.
 *
 * ‼️ RAISED, NEVER ASSIGNED, FOR THE THIRD TIME IN THIS LANE AND THE SAME REASON. DataForSEO's index
 * is live: the same Dallas circle and the same five categories read 1,765 on 2026-09-28 and 1,990 on
 * 2026-10-08. Following an upward drift loses nothing. Writing a downward one would lower the
 * denominator a finished metro was finished against, which re-opens a metro that is done or, worse,
 * closes one that is not.
 *
 * ‼️ READ-THEN-WRITE RATHER THAN AN UPSERT, BECAUSE PostgREST CANNOT EXPRESS `greatest()` ON
 * CONFLICT. The race it leaves is two measurements of one circle in the same second, which cannot
 * happen: measurements are steps, steps are claimed one at a time, and the unique index would refuse
 * the second insert anyway. The 23505 branch below is that refusal being handled rather than thrown.
 */
export async function recordMetroCircle(c: MetroCircle): Promise<{ stored: number; raised: boolean }> {
  const { data: existing, error: readErr } = await supabaseAdmin
    .from("scraper_metro_circles")
    .select("id, total_count")
    .eq("vertical_slug", c.verticalSlug)
    .eq("categories_key", c.categoriesKey)
    .eq("metro_key", c.metroKey)
    .eq("radius_km", c.radiusKm)
    .maybeSingle();
  if (readErr) fail("recordMetroCircle(read)", readErr.message);

  const row = {
    vertical_slug: c.verticalSlug,
    metro_key: c.metroKey,
    metro_label: c.metroLabel,
    location_name: c.locationName,
    latitude: c.lat,
    longitude: c.lon,
    radius_km: c.radiusKm,
    categories_key: c.categoriesKey,
    total_count: c.totalCount,
    cost_usd: c.costUsd,
    measured_at: new Date().toISOString(),
  };

  if (existing) {
    const stored = Number((existing as { total_count: number }).total_count ?? 0);
    if (c.totalCount <= stored) return { stored, raised: false };
    const { error } = await supabaseAdmin
      .from("scraper_metro_circles")
      .update(row)
      .eq("id", (existing as { id: string }).id);
    if (error) fail("recordMetroCircle(raise)", error.message);
    return { stored: c.totalCount, raised: true };
  }

  const { error } = await supabaseAdmin.from("scraper_metro_circles").insert(row);
  if (error) {
    if (error.code === "23505") {
      // Somebody inserted it between the read and the write. Re-enter once; the branch above then
      // takes the maximum. One retry, never a loop: a second conflict would mean something else.
      return recordMetroCircle(c);
    }
    fail("recordMetroCircle(insert)", error.message);
  }
  return { stored: c.totalCount, raised: true };
}
