// The Launch Lane board: seeding it, reading it, and ticking it.
//
// This is the Launch Lane's twin of delivery-checklist.ts, deliberately NOT an import of it.
// The behaviour it copies is copied on purpose and the reasons are restated where they bite,
// because a rule whose justification lives in another file is a rule somebody deletes.
//
// ‼️ WHAT IT SHARES WITH THE SLACK LANE, AND WHAT IT MUST NOT.
// Shared: the `clients` row, the Day-0 wall (day-zero.ts writes CLIENT columns, not step rows,
// so one wall guards both lanes and publishPage() already enforces it), and every data table
// underneath. Not shared: the registry, the verifier map, the engine, and Slack. There is no
// channel here and no anchor timestamp — a step is worked on a dashboard page.
//
// ‼️ NO SLACK IMPORT MAY EVER APPEAR IN THIS FOLDER.
// scripts/_probe-launch-isolation.ts fails the build on one. The moment this lane can post to a
// channel, it is not a second lane, it is the first lane with a different front end.

import { supabaseAdmin } from "@/lib/db";
import { LAUNCH_STEPS, LAUNCH_DAY_ZERO_STEP_KEY, launchStepByKey, type LaunchStep } from "@/config/launch-steps";
import { stampDay0, clearDay0IfManual } from "@/lib/clients/day-zero";
import { verifyLaunchStep, verdictDetail, type LaunchVerdict } from "./verify";

export interface LaunchStepRow {
  step_key: string;
  status: string;
  completed_at: string | null;
  completed_by: string | null;
  note: string | null;
  started_at: string | null;
  error_detail: string | null;
  skipped_reason: string | null;
  output_ref: string | null;
  verified_source: string | null;
  verified_detail: string | null;
  verified_at: string | null;
}

const COLUMNS =
  "step_key, status, completed_at, completed_by, note, started_at, error_detail, " +
  "skipped_reason, output_ref, verified_source, verified_detail, verified_at";

export type LaunchTransition = "complete" | "skipped" | "reopened";

// ─────────────────────────────────────────────────────────────────────────────
// Seeding
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One row per step, once.
 *
 * `ignoreDuplicates` so re-running is free and so a step added to the registry later appears on
 * an in-flight client without disturbing the rows already there.
 *
 * ‼️ IT NEVER DELETES. A step removed from the registry leaves its row behind rather than
 * destroying the record that somebody once completed it. Orphan rows are invisible to the board
 * (which renders from the registry, not from the rows) and are cleaned up by hand, the same way
 * docs/2026-09-12-call-pack-orphans.sql did it for the Slack lane.
 */
export async function seedLaunchSteps(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin.from("client_launch_steps").upsert(
    LAUNCH_STEPS.map((s) => ({ client_id: clientId, step_key: s.key, status: "pending" })),
    { onConflict: "client_id,step_key", ignoreDuplicates: true }
  );
  if (error) console.error("[launch] seed failed:", error.message);
}

// ─────────────────────────────────────────────────────────────────────────────
// Reading
// ─────────────────────────────────────────────────────────────────────────────

export async function launchRows(clientId: string): Promise<LaunchStepRow[]> {
  const { data, error } = await supabaseAdmin
    .from("client_launch_steps")
    .select(COLUMNS)
    .eq("client_id", clientId);

  if (error) {
    // ‼️ SAY IT OUT LOUD. supabase-js RETURNS this error rather than throwing, and one unknown
    // column fails the whole select. A silent empty array here renders as "nothing done yet" on
    // a client who has finished the lane, which is the failure this repo has already paid for
    // once (see the client_docs.created_at note in CLAUDE.md).
    console.error("[launch] rows failed:", error.message);
    return [];
  }
  return (data ?? []) as unknown as LaunchStepRow[];
}

/**
 * ‼️ RESOLVED IS NOT THE SAME AS DONE, AND BOTH READINGS ARE NEEDED.
 *
 * `resolved` = not outstanding: ticked OR marked not applicable. That is what "what is next"
 * must use, or a deliberately skipped step becomes the answer forever.
 *
 * `done` = actually ticked. That is what any WARNING must use: "we decided not to" and "we did
 * it" are opposite claims, and the Day-0 wall below is exactly where confusing them is expensive.
 */
export const isResolved = (s: string | undefined): boolean => s === "complete" || s === "skipped";
export const isDone = (s: string | undefined): boolean => s === "complete";

/** The first step still outstanding, or null when the lane is finished. */
export function nextLaunchStep(rows: LaunchStepRow[]): LaunchStep | null {
  const status = new Map(rows.map((r) => [r.step_key, r.status]));
  return LAUNCH_STEPS.find((s) => !isResolved(status.get(s.key))) ?? null;
}

export interface LaunchBoardEntry {
  step: LaunchStep;
  number: number;
  row: LaunchStepRow | null;
  /** Registry keys this step waits on that are not resolved yet. Advisory, never enforcement. */
  waitingOn: string[];
}

/**
 * The whole board, registry-ordered, with each step's row attached.
 *
 * Renders from LAUNCH_STEPS and not from the rows, so a row for a retired key simply does not
 * appear and a step with no row yet renders as pending rather than vanishing.
 */
export async function launchBoard(clientId: string): Promise<LaunchBoardEntry[]> {
  const rows = await launchRows(clientId);
  const byKey = new Map(rows.map((r) => [r.step_key, r]));
  const status = new Map(rows.map((r) => [r.step_key, r.status]));

  return LAUNCH_STEPS.map((step, i) => ({
    step,
    number: i + 1,
    row: byKey.get(step.key) ?? null,
    waitingOn: (step.blockedBy ?? []).filter((k) => !isResolved(status.get(k))),
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Writing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tick, skip or reopen a step.
 *
 * ‼️ CONFIRMATION RUNS BEFORE THE ROW WRITE, AND A REFUSAL WRITES NOTHING.
 * This is the difference between a checkmark that records the work and one that records
 * somebody pressing a button. Writing first would leave a row saying complete above a verdict
 * saying it is not, and the row is what every later reader trusts.
 *
 * Only a TICK is gated. A SKIP is a decision rather than a claim about work, so there is nothing
 * to verify — gating it would be demanding evidence that something did not need doing. A REOPEN
 * is the remedy and must never be blocked.
 */
export async function setLaunchStep(args: {
  clientId: string;
  stepKey: string;
  transition: LaunchTransition;
  /** Only read on 'skipped'. Stored so the board can say WHY. */
  skippedReason?: string | null;
  actor?: string | null;
}): Promise<{ ok: boolean; error?: string; verdict?: LaunchVerdict }> {
  const step = launchStepByKey(args.stepKey);
  if (!step) return { ok: false, error: "Unknown step." };

  const complete = args.transition === "complete";
  const skipped = args.transition === "skipped";

  let verdict: LaunchVerdict | undefined;
  if (complete) {
    verdict = await verifyLaunchStep(args.clientId, args.stepKey);
    if (!verdict.ok) {
      return {
        ok: false,
        verdict,
        error:
          verdict.kind === "broken"
            ? `Could not confirm ${step.label}. ${verdict.found}`
            : `Not yet: ${verdict.found}`,
      };
    }
  }

  // Both a tick and a skip RESOLVE the step, so both stamp who and when. Only a reopen clears
  // them, because only a reopen says the work is outstanding again.
  const resolved = complete || skipped;
  const now = new Date().toISOString();

  const { data: written, error } = await supabaseAdmin
    .from("client_launch_steps")
    .update({
      status: complete ? "complete" : skipped ? "skipped" : "pending",
      completed_at: resolved ? now : null,
      completed_by: resolved ? (args.actor ?? null) : null,
      skipped_reason: skipped
        ? (args.skippedReason ?? `Marked not applicable by ${args.actor ?? "Mission Control"}`)
        : null,
      // The CHECK constraint requires source and timestamp together, so these three move as one.
      // Cleared on anything that is not a confirmed tick: a reopened step must not keep an old
      // proof.
      verified_source: verdict?.ok ? verdict.kind : null,
      verified_detail: verdict?.ok ? verdictDetail(verdict) : null,
      verified_at: verdict?.ok ? now : null,
      // Cleared on EVERY transition including a reopen: a tick, a skip and a reopen are all
      // somebody dealing with the step, so a stale runner error must not survive to poison the
      // next pass.
      error_detail: null,
      updated_at: now,
    })
    .eq("client_id", args.clientId)
    .eq("step_key", args.stepKey)
    .select("step_key");

  if (error) return { ok: false, error: error.message };

  // ‼️ AN UPDATE THAT MATCHED NOTHING IS NOT AN ERROR AND WOULD READ AS SUCCESS.
  // A client whose rows were never seeded affects zero rows and returns no error. Without the
  // .select() PostgREST has nothing to count and the caller would rewrite the UI as done over a
  // row that does not exist. The Slack lane shipped that bug; this one starts with the fix.
  if (!written?.length) {
    return {
      ok: false,
      error: `No ${args.stepKey} row exists for this client, so nothing was written. Seed the lane first.`,
    };
  }

  // ‼️ THE DAY-0 STAMP RIDES ON THE TICK SO THE TWO CANNOT DRIFT, and it is allowed to fail
  // loudly. A stamp that silently did not happen leaves the wall shut with the board saying it
  // is open, and whoever ticked it finds out when they try to publish an hour later.
  //
  // ‼️ A SKIP DOES NOT OPEN THE WALL. Everywhere else a skip counts as resolved; here it cannot.
  // The wall protects the baseline every later number is measured against, and "not applicable"
  // is not a statement that the archive happened.
  if (args.stepKey === LAUNCH_DAY_ZERO_STEP_KEY) {
    try {
      if (complete) {
        // The source is OBSERVED, never passed in: a tick asserts the archive happened, it is
        // not evidence that it did. Same reasoning, same function, as the Slack lane.
        const { day0PhotographFor } = await import("@/lib/clients/photograph");
        const photograph = await day0PhotographFor(args.clientId).catch(() => null);

        await stampDay0({
          clientId: args.clientId,
          source: photograph && photograph.answered > 0 ? "photograph_2" : "manual_step",
          by: args.actor ?? null,
        });
      } else {
        await clearDay0IfManual(args.clientId);
      }
    } catch (e) {
      return {
        ok: false,
        error:
          `The step was ${complete ? "ticked" : args.transition}, but the Day-0 stamp on the ` +
          `client record failed: ${(e as Error).message}. Publishing is still blocked. ` +
          `Un-tick and tick again once that is fixed.`,
      };
    }
  }

  return { ok: true, verdict };
}

/**
 * The system ticking a step it did the work for.
 *
 * Still goes through the verifier: a runner that believes it succeeded and a verifier that can
 * see the result disagreeing is exactly the case worth catching, and it is how the Slack lane
 * found two green ticks over work nobody had done.
 */
export async function autoCompleteLaunchStep(
  clientId: string,
  stepKey: string,
  actor = "Mission Control"
): Promise<{ ok: boolean; error?: string }> {
  const result = await setLaunchStep({ clientId, stepKey, transition: "complete", actor });
  if (!result.ok) console.warn(`[launch] auto-tick refused for ${stepKey}: ${result.error}`);
  return { ok: result.ok, error: result.error };
}

/** Park a step in `error` with a message a person can act on. */
export async function failLaunchStep(clientId: string, stepKey: string, detail: string): Promise<void> {
  await supabaseAdmin
    .from("client_launch_steps")
    .update({ status: "error", error_detail: detail, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("step_key", stepKey);
}

/** Record an artifact reference (a URL, an order id) against a step without resolving it. */
export async function setLaunchStepOutput(
  clientId: string,
  stepKey: string,
  outputRef: string
): Promise<void> {
  await supabaseAdmin
    .from("client_launch_steps")
    .update({ output_ref: outputRef, updated_at: new Date().toISOString() })
    .eq("client_id", clientId)
    .eq("step_key", stepKey);
}
