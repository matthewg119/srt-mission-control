// The eight pilot stages, DERIVED from the delivery steps underneath them.
//
// WHY THIS EXISTS. client_onboarding_steps was written in exactly two places -- seeded
// whole at provisioning, and 'intake' marked complete when the funnel finished. Nothing
// ever advanced the other six. So a client whose baseline had run, whose call had been
// held and whose pages were live still showed Photograph I, The call and Build sitting at
// Pending, forever, on the one card at the top of the board that is supposed to say where
// they are. The Slack checklist was right the whole time and the board was not, which is
// the worst possible split: two surfaces describing one journey, disagreeing, with the
// wrong one being the one somebody glances at.
//
// ‼️ DERIVED, NEVER ASSERTED. Same doctrine as buildStatusPayload() in the /scan funnel:
// a stage is complete because the work under it is recorded as complete, not because
// somebody remembered to tick a second box. That also means it goes BACKWARDS. Un-ticking
// baseline_scan un-completes Photograph I, because the alternative is a board that can
// only ever be optimistic.
//
// The two step lists stay at their own altitudes and this is the only thing that joins
// them: client_onboarding_steps is the EIGHT client-facing stages, client_delivery_steps
// is the THIRTY-THREE operational steps SRT works through, several of which live inside
// one stage. Nothing here merges them.

import { supabaseAdmin } from "@/lib/db";
import { ONBOARDING_STAGES } from "@/lib/clients/provision";
import { DAY_ZERO_STEP_KEY } from "@/lib/clients/day-zero";

type Stage = (typeof ONBOARDING_STAGES)[number];

/**
 * Which delivery steps have to be complete for a stage to be.
 *
 * 'start' is absent on purpose: it is seeded complete at provisioning and means "they
 * paid and we made a record", which no delivery step represents. Leaving it out means
 * this function never touches it.
 *
 * Where a stage needs more than one step, ALL of them are required. 'build' is the case
 * that matters: a subdomain that resolves with nothing published on it is not a build,
 * and a page published to a host that does not resolve is not one either.
 */
const STAGE_REQUIRES: Partial<Record<Stage, readonly string[]>> = {
  intake: ["intake_received"],
  photograph_1: ["baseline_scan"],
  call: ["call_held"],
  photograph_2: [DAY_ZERO_STEP_KEY],
  build: ["subdomain_live", "first_page"],
  rhythm: ["weekly_report"],
  renew: ["day_30_date"],
};

/** Pure, so the mapping can be reasoned about without a database. */
export function stagesFor(completedStepKeys: Iterable<string>): Record<string, boolean> {
  const done = new Set(completedStepKeys);
  const out: Record<string, boolean> = {};
  for (const [stage, required] of Object.entries(STAGE_REQUIRES)) {
    out[stage] = (required ?? []).every((k) => done.has(k));
  }
  return out;
}

/**
 * Recompute this client's eight stages from its delivery rows.
 *
 * Never throws into a caller: it hangs off setDeliveryStep, where the row write has
 * already happened and a rollup failure must not undo it. Same discipline as the Slack
 * refresh next to it.
 */
export async function refreshStages(clientId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("client_delivery_steps")
    .select("step_key, status")
    .eq("client_id", clientId);

  if (error) {
    console.error("[stage-rollup] read failed:", error.message);
    return;
  }

  const completed = (data ?? [])
    .filter((r) => r.status === "complete")
    .map((r) => r.step_key as string);

  const want = stagesFor(completed);
  const nowIso = new Date().toISOString();

  // One UPDATE per stage rather than an upsert of all eight: an upsert would need to
  // supply completed_at for every row and would therefore keep rewriting the timestamp on
  // stages that have not changed, which turns "when did this client reach Build" into
  // "when did anybody last tick anything".
  await Promise.all(
    Object.entries(want).map(async ([stage, complete]) => {
      const { error: upErr } = await supabaseAdmin
        .from("client_onboarding_steps")
        .update({
          status: complete ? "complete" : "pending",
          completed_at: complete ? nowIso : null,
          updated_at: nowIso,
        })
        .eq("client_id", clientId)
        .eq("stage", stage)
        // Only write when it actually differs, so completed_at keeps meaning the moment
        // the stage was first reached rather than the moment of the last unrelated tick.
        .neq("status", complete ? "complete" : "pending");

      if (upErr) console.error(`[stage-rollup] ${stage} failed:`, upErr.message);
    })
  );
}
