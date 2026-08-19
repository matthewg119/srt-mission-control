// The Day 0 wall.
//
// Runner v3's one hard rail: Photograph II archives BEFORE any change lands on a
// CLIENT-CONTROLLED property. `docs/2026-08-18-day-zero-wall.sql` carries the reasoning
// for why this one blocks when the Measure gate and the market check only flag.
//
// ONE function, imported by every gated path, so the list of gated paths is greppable:
//
//   grep -rn "assertDay0Archived" src/
//
// If that grep ever returns fewer callers than the list in GATED below, a path has been
// added without a gate and the wall has a hole in it.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

/**
 * The delivery step whose completion opens the wall.
 *
 * It lives HERE and `delivery-checklist.ts` imports it, not the other way round.
 * delivery-checklist has to call stampDay0(), so if this module imported DELIVERY_STEPS
 * back the two would form a cycle and one of them would see a half-initialised module at
 * load time. One direction only: delivery-checklist depends on day-zero.
 */
// Defined in @/config/delivery-steps and re-exported here, so every existing import of
// DAY_ZERO_STEP_KEY from this module keeps working. See that file for why the direction is
// config -> day-zero and not the reverse.
import { DAY_ZERO_STEP_KEY } from "@/config/delivery-steps";
export { DAY_ZERO_STEP_KEY };

/**
 * Last-resort wording only. The real label lives on the DELIVERY_STEPS row and callers
 * pass it in — see the hub route, which reads it with stepByKey(). This string exists so
 * the error is still a sentence if a caller does not, and it is not kept in step with
 * anything: if the two ever disagree, the one the person reads is the caller's.
 */
const DAY_ZERO_STEP_LABEL = "Day-0 scan archived, before any change lands";

/**
 * Every write path that lands something on a property the CLIENT controls.
 *
 * Documentation, not enforcement — enforcement is the call to assertDay0Archived() in
 * each of these. Kept here so the set is visible in one place rather than inferred by
 * reading four routes.
 */
export const GATED = [
  "POST /api/clients/[id]/hub  action=page_publish",
  // Not built yet. When they are, they gate here too:
  // "POST /api/clients/[id]/citations  action=submit_correction",
  // "POST /api/clients/[id]/gbp        action=* (any field write)",
] as const;

/**
 * Deliberately NOT gated, and why. Runner v3 lists these itself: "Preview and staging are
 * ours. The wall is about their properties."
 *
 *   register / scripts/hub-register.ts — attaching a Vercel domain changes nothing the
 *     client can see. Nothing resolves until they add the CNAME, and the CNAME is theirs
 *     to add. Blocking the attach would only mean the record they add on the call
 *     resolves to nothing.
 *   /api/clients/[id]/dns any action  — seeding, reading back and verifying records. The
 *     client types the record; we never write their zone.
 *   page_save                         — a draft is not published. Drafting before the
 *     call is the entire point of the PREPARE phase.
 *   the preview route                 — our infrastructure, noindex, no client DNS.
 *   the review tool                   — theirs to hand out, and it publishes nothing.
 */
export const NOT_GATED = [
  "POST /api/clients/[id]/hub  action=register",
  "POST /api/clients/[id]/hub  action=page_save",
  "POST /api/clients/[id]/dns  (every action)",
  "scripts/hub-register.ts",
] as const;

export type Day0Source = "photograph_2" | "manual_step" | "waived";

export interface Day0State {
  archivedAt: string | null;
  archivedBy: string | null;
  source: Day0Source | null;
  waivedReason: string | null;
}

/** Thrown by assertDay0Archived. Carries what the route needs to answer with. */
export class Day0NotArchivedError extends Error {
  readonly stepKey = DAY_ZERO_STEP_KEY;
  readonly stepLabel: string;
  readonly clientName: string;

  constructor(clientName: string, stepLabel: string = DAY_ZERO_STEP_LABEL) {
    super(
      `Day 0 is not archived for ${clientName}. ` +
        `Tick "${stepLabel}" on the delivery checklist first, or waive it with a reason.`
    );
    this.name = "Day0NotArchivedError";
    this.clientName = clientName;
    this.stepLabel = stepLabel;
  }
}

export function isDay0Error(e: unknown): e is Day0NotArchivedError {
  return e instanceof Day0NotArchivedError;
}

export async function readDay0(clientId: string): Promise<Day0State | null> {
  const { data } = await supabaseAdmin
    .from("clients")
    .select("day_0_archived_at, day_0_archived_by, day_0_source, day_0_waived_reason")
    .eq("id", clientId)
    .maybeSingle();

  if (!data) return null;

  return {
    archivedAt: (data.day_0_archived_at as string | null) ?? null,
    archivedBy: (data.day_0_archived_by as string | null) ?? null,
    source: (data.day_0_source as Day0Source | null) ?? null,
    waivedReason: (data.day_0_waived_reason as string | null) ?? null,
  };
}

/**
 * THE GATE. Throws Day0NotArchivedError when the wall is closed.
 *
 * Reads the client fresh rather than taking a row the caller already loaded: a caller
 * that selected the client three lines earlier could be handed a stale object, and this
 * is the one check in the codebase where being convenient is worth less than being right.
 *
 * A missing client throws too. Failing open on a lookup miss would mean a bad id
 * publishes, which is the opposite of what a wall is for.
 */
export async function assertDay0Archived(
  clientId: string,
  clientName?: string,
  stepLabel?: string
): Promise<Day0State> {
  const state = await readDay0(clientId);

  if (!state?.archivedAt) {
    throw new Day0NotArchivedError(clientName ?? "that client", stepLabel);
  }

  return state;
}

/**
 * Stamp the wall open because the delivery step was ticked.
 *
 * Called from setDeliveryStep, not from a route, so the tick and the stamp cannot drift.
 * `manual_step` is the honest source: a tick asserts the archive happened, it is not
 * evidence that it did. When a real photograph_2 run exists, that writer calls this with
 * source 'photograph_2' and this comment gets shorter.
 *
 * Never overwrites an existing stamp, whatever the source. A client already opened by
 * photograph_2 is not downgraded to manual_step by someone re-ticking a checkbox, and a
 * waiver is not written over a real archive — waiveDay0 refuses that case before it gets
 * here, because waiving an open wall is not a thing that means anything.
 */
export async function stampDay0(args: {
  clientId: string;
  source: Day0Source;
  by: string | null;
  reason?: string | null;
}): Promise<void> {
  const existing = await readDay0(args.clientId);
  if (existing?.archivedAt) return;

  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      day_0_archived_at: new Date().toISOString(),
      day_0_archived_by: args.by,
      day_0_source: args.source,
      day_0_waived_reason: args.source === "waived" ? (args.reason ?? null) : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", args.clientId);

  if (error) throw new Error(`Day 0 stamp failed: ${error.message}`);
}

/**
 * Clear the stamp because the delivery step was UNticked.
 *
 * Only clears a 'manual_step' stamp. Un-ticking a checkbox must not silently undo a
 * waiver somebody signed their name to, and it must never erase a photograph_2 that a
 * real run wrote — that would make the archive itself deniable by a mis-click.
 */
export async function clearDay0IfManual(clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("clients")
    .update({
      day_0_archived_at: null,
      day_0_archived_by: null,
      day_0_source: null,
      day_0_waived_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", clientId)
    .eq("day_0_source", "manual_step");

  if (error) throw new Error(`Day 0 clear failed: ${error.message}`);
}

/**
 * Publish anyway, on purpose, with a reason.
 *
 * The door in the wall. It is loud by construction: the reason is required by a CHECK
 * constraint, the actor is recorded, and it is posted to #alerts-infra where somebody
 * who is not the person waiving will see it.
 */
export async function waiveDay0(args: {
  clientId: string;
  reason: string;
  by: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const reason = args.reason.trim();
  if (reason.length < 10) {
    return {
      ok: false,
      error:
        "A waiver needs a real reason, in a sentence. It is read months later by someone " +
        "working out whether a scorecard can be trusted.",
    };
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("legal_name")
    .eq("id", args.clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "That client does not exist." };

  // Waiving an already-open wall is not a thing. Say so rather than writing a waiver
  // record over an archive that actually happened.
  const existing = await readDay0(args.clientId);
  if (existing?.archivedAt) {
    return {
      ok: false,
      error:
        `Day 0 is already archived for this client (${existing.source}). ` +
        `There is nothing to waive — pages can publish.`,
    };
  }

  try {
    await stampDay0({ clientId: args.clientId, source: "waived", by: args.by, reason });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  await postInfraAlert(
    `:no_entry: *Day 0 waived* for *${client.legal_name as string}* by ${args.by ?? "unknown"}.\n` +
      `> ${reason}\n` +
      `Pages can now publish to their live hub host. Day 30, 60 and 90 for this client ` +
      `have no archived baseline behind them, and every artifact has to say so.`
  ).catch(() => {});

  return { ok: true };
}

/** Loud failures go here. Same channel and same doctrine as provision.ts. */
async function postInfraAlert(text: string): Promise<void> {
  const channel = process.env.SLACK_ALERTS_INFRA_CHANNEL;
  if (!channel) {
    console.error("[clients/day-zero] SLACK_ALERTS_INFRA_CHANNEL unset. Alert dropped:", text);
    return;
  }
  await slack.postMessage(channel, text);
}
