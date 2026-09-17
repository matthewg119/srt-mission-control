// In-flight claims for the two reply-card buttons that cost real money.
//
// WHY A ROW AND NOT A FLAG ON THE PROSPECT
// The unit being claimed is one PRESS of one button on one message, not the prospect. Matthew
// re-drafting after a weak first attempt is normal and must stay free; two presses of Draft in the
// same second are a double click and must not post two approval cards, because approving both
// sends the prospect two emails. A partial unique index on (slack_ts, action) WHERE finished_at is
// null expresses exactly that and nothing more.
//
// ‼️ NEVER point a PostgREST .upsert({onConflict}) at that index. PostgREST cannot emit the WHERE
// clause, so every call would fail 42P10. Plain insert, read 23505.

import { supabaseAdmin } from "@/lib/db";

export type ThreadAction = "draft" | "loom";

/**
 * Take the right to run this action for this card. Returns false when one is already running.
 *
 * Fails OPEN on an unexpected database error: a claim table that is unreachable should not be able
 * to stop Matthew from answering a prospect. The cost of the rare double is one duplicate card,
 * which is visible and fixable; the cost of failing closed is a button that silently does nothing.
 */
export async function claimThreadAction(input: {
  prospectId: string;
  action: ThreadAction;
  channel: string;
  slackTs: string;
  userId?: string | null;
}): Promise<boolean> {
  const { error } = await supabaseAdmin.from("reachinbox_thread_actions").insert({
    prospect_id: input.prospectId,
    action: input.action,
    slack_channel: input.channel,
    slack_ts: input.slackTs,
    pressed_by: input.userId ?? null,
  });

  if (!error) return true;
  if (error.code === "23505") return false;

  // 42P01 means the migration has not been run yet. Say so by name rather than letting the button
  // look broken for an unrelated reason.
  if (error.code === "42P01") {
    console.error(
      "[reachinbox] reachinbox_thread_actions is missing; run docs/2026-09-17-reachinbox-reply-actions.sql"
    );
    return true;
  }
  console.error("[reachinbox] claimThreadAction:", error.message);
  return true;
}

/** Hand the claim back, so the same button can be pressed again. */
export async function finishThreadAction(input: {
  slackTs: string;
  action: ThreadAction;
  outcome: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from("reachinbox_thread_actions")
    .update({ finished_at: new Date().toISOString(), outcome: input.outcome.slice(0, 200) })
    .eq("slack_ts", input.slackTs)
    .eq("action", input.action)
    .is("finished_at", null);
  if (error && error.code !== "42P01") {
    console.error("[reachinbox] finishThreadAction:", error.message);
  }
}
