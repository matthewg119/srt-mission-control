// What the plan was, before a rerun replaced it.
//
// Matthew, 2026-09-17: "help me make sure if I rerun the step and run the things again this should
// be creating a new record in our datasets."
//
// ‼️ THE BODY ALREADY HAD A HISTORY AND THE PLAN DID NOT. page_dataset captures every draft, edit
// and publish, so a page body could always be diffed across attempts. But proposePreCallPlan
// DELETES every status='proposed' row before inserting fresh ones, so the decisions that produced
// that body (which keyword, which angle, which awareness stages, which working title) were gone the
// moment somebody typed `rerun`. The half of the record that explains the other half was the half
// being thrown away.
//
// ‼️ A SNAPSHOT TABLE, NOT A superseded_at COLUMN ON page_plan. Adding superseded_at would mean
// every existing `.eq("status", "proposed")` read in the repo silently starts returning dead rows
// until each one learns to filter, and the ones that forget would draft pages from a plan somebody
// replaced. keyword_runs solved the identical problem for the keyword set with a jsonb snapshot and
// one insert, and this is that, deliberately.
//
// ‼️ IT NEVER FAILS THE RUN. Same posture as page-dataset.ts: this is a research artifact, the plan
// is the product. A snapshot that throws must not cost somebody their step 21.

import { supabaseAdmin } from "@/lib/db";

/** Why the plan was being replaced. Matches the check constraint on page_plan_runs.reason. */
export type PlanRunReason = "rerun" | "plan_new" | "offer_change" | "first_run";

export interface SnapshotResult {
  /** Rows that were in the plan when the snapshot was taken. */
  rowCount: number;
  /** Rows a rerun keeps: anything approved or claimed. */
  keptCount: number;
  /** Rows a rerun is about to delete. */
  replacedCount: number;
  /** The run row's id, or null when nothing was written. */
  runId: string | null;
}

/**
 * Snapshot the plan and its angles, then return the counts.
 *
 * ‼️ CALL IT BEFORE THE DELETE, NOT AFTER. Reading afterwards would record the plan that replaced
 * the one being asked about, which is the opposite of the point and would look correct in every
 * test that did not run twice.
 *
 * Every read is its own select and every one degrades: a missing column costs a field in the
 * snapshot and must never cost the run.
 */
export async function snapshotPlan(args: {
  clientId: string;
  reason: PlanRunReason;
  by?: string | null;
  offerId?: string | null;
  audienceId?: string | null;
  notes?: string[];
}): Promise<SnapshotResult> {
  const empty: SnapshotResult = { rowCount: 0, keptCount: 0, replacedCount: 0, runId: null };

  try {
    // ‼️ `*`, NOT A COLUMN LIST, AND THAT IS A FIX RATHER THAN LAZINESS. A snapshot exists to record
    // the plan AS IT STOOD, so a hand-written column list makes every new column silently absent
    // from the record: the read does not fail, it just quietly stops capturing the thing that was
    // added. Worse, an unknown name fails the WHOLE select and this function returns an empty
    // snapshot while reporting success, so a rerun would erase the plan and record nothing of it.
    // archive.ts takes `*` for the same job for the same reason.
    const { data: rows, error } = await supabaseAdmin
      .from("page_plan")
      .select("*")
      .eq("client_id", args.clientId)
      .order("rank", { ascending: true });

    if (error) {
      console.error(`[page-plan-runs] plan read failed: ${error.message}`);
      return empty;
    }

    const plan = rows ?? [];
    // What a rerun keeps, mirroring proposePreCallPlan's own filter exactly. Stated here rather
    // than recomputed differently, because two definitions of "kept" is how a count lies.
    const kept = plan.filter((r) => r.role && r.status !== "proposed").length;
    const replaced = plan.filter((r) => r.role && r.status === "proposed").length;

    const angles = await anglesFor(plan.map((r) => String(r.id)));

    const { data: run, error: insErr } = await supabaseAdmin
      .from("page_plan_runs")
      .insert({
        client_id: args.clientId,
        reason: args.reason,
        offer_id: args.offerId ?? null,
        audience_id: args.audienceId ?? null,
        rows_snapshot: plan,
        angles_snapshot: angles,
        row_count: plan.length,
        kept_count: kept,
        replaced_count: replaced,
        notes: args.notes ?? [],
        created_by: args.by ?? null,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      console.error(
        `[page-plan-runs] snapshot failed (${insErr.message}). If that names page_plan_runs, ` +
          "docs/2026-09-17-page-datasets-and-angles.sql has not been run on this database."
      );
      return { rowCount: plan.length, keptCount: kept, replacedCount: replaced, runId: null };
    }

    return {
      rowCount: plan.length,
      keptCount: kept,
      replacedCount: replaced,
      runId: run?.id ? String(run.id) : null,
    };
  } catch (e) {
    console.error("[page-plan-runs] snapshot threw:", (e as Error).message);
    return empty;
  }
}

/** The angles that had been generated for those plan rows, and which one was picked. */
async function anglesFor(planIds: string[]): Promise<unknown[]> {
  if (!planIds.length) return [];

  // `*` for the same reason the plan snapshot above takes it: this is the only record that survives
  // a rerun deleting the angles, so a column it forgets to name is a decision nobody can read back.
  const { data, error } = await supabaseAdmin
    .from("page_angles")
    .select("*")
    .in("plan_id", planIds)
    .order("created_at", { ascending: true });

  if (error) {
    console.error(`[page-plan-runs] angles read failed: ${error.message}`);
    return [];
  }
  return data ?? [];
}

/**
 * How many times this client's plan has been run, so a capture can number its variant.
 *
 * ‼️ COUNTED RATHER THAN STORED ON A COUNTER COLUMN. A counter is a second source of truth that
 * drifts the first time a row is inserted by hand; the rows themselves cannot.
 */
export async function planRunCount(clientId: string): Promise<number> {
  const { count, error } = await supabaseAdmin
    .from("page_plan_runs")
    .select("id", { count: "exact", head: true })
    .eq("client_id", clientId);

  if (error) {
    console.error(`[page-plan-runs] count failed: ${error.message}`);
    return 0;
  }
  return count ?? 0;
}
