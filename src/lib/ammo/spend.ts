// The spend ledger. What has already been said to this prospect, so it is never said again.
//
// ‼️ THIS IS THE FIRST WRITER outreach_prospects.ammo_used HAS EVER HAD. Before this lane the
// column existed in the migration, the AmmoSpent interface existed in types.ts, and the column name
// sat inside PROSPECT_COLUMNS so every read pulled it into memory. Nothing constructed an
// AmmoSpent, nothing wrote the column, and no caller ever dereferenced `.ammo_used`. All 104 rows
// in production have the default '[]'. operator-rules.ts states the doctrine out loud, "One unspent
// finding per touch, one ask, same thread. Never a new argument stacked on the old one", and
// nothing enforced a word of it.
//
// ‼️ DEDUPE IS ON THE NORMALIZED DETAIL, NOT ON AN ID, AND THAT IS DELIBERATE. Giving ammo a
// synthetic key would mean changing the stored shape of AmmoSpent, and the instruction for this
// lane is to feed the existing model rather than build a second one. The detail string IS the
// identity of a piece of ammo: two candidates that say the same sentence are the same argument, no
// matter which supply produced them. Normalizing before comparing means a rephrased number or a
// changed denominator does not read as fresh material.

import { supabaseAdmin } from "@/lib/db";
import type { AmmoSpent } from "@/lib/followup-operator/types";
import type { AmmoCandidate } from "./supply";

/**
 * The comparison form of one piece of ammo.
 *
 * Kind is part of the key because the same clause could legitimately arrive as a competitor line
 * and as a signal line, and spending one should not silently consume the other.
 */
export function ammoKey(ammo: AmmoCandidate | AmmoSpent): string {
  const detail = ammo.detail
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
  return `${ammo.kind}:${detail}`;
}

/**
 * Read the ledger off a prospect row defensively.
 *
 * ammo_used is jsonb with a '[]' default, but it has never been written by anything, so every row
 * in production is untested ground for a reader. A malformed value must degrade to "nothing has
 * been spent" rather than throw inside a send path: the cost of the pessimistic read is one
 * repeated line, and the cost of throwing is a cron that stops mailing.
 */
export function spentAmmo(row: { ammo_used?: unknown } | null | undefined): AmmoSpent[] {
  const raw = row?.ammo_used;
  if (!Array.isArray(raw)) return [];

  const out: AmmoSpent[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const a = item as Record<string, unknown>;
    if (typeof a.detail !== "string" || !a.detail.trim()) continue;
    if (a.kind !== "finding" && a.kind !== "competitor" && a.kind !== "signal") continue;
    out.push({
      kind: a.kind,
      detail: a.detail,
      step: typeof a.step === "number" ? a.step : 0,
    });
  }
  return out;
}

/**
 * The candidates that have not been used on this prospect yet, in the order they were offered.
 *
 * Pure, so the probe can prove the no-repeat rule with no database and no model. Also deduplicates
 * WITHIN the candidate list: two supplies can independently produce the same sentence, and handing
 * a drafter the same line twice in one call is the same bug one touch earlier.
 */
export function unspentAmmo(spent: AmmoSpent[], candidates: AmmoCandidate[]): AmmoCandidate[] {
  const seen = new Set(spent.map(ammoKey));
  const out: AmmoCandidate[] = [];
  for (const c of candidates) {
    const key = ammoKey(c);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Take the next piece of ammo for a touch, or null when the material has run out.
 *
 * ‼️ ONE PIECE, NOT A LIST. operator-rules.ts: "ONE idea per message. Two findings in one email
 * reads as a pitch and burns tomorrow's material." Returning an array here would make stacking the
 * default and the doctrine would erode in the first caller that wanted a fuller paragraph.
 */
export function nextAmmo(spent: AmmoSpent[], candidates: AmmoCandidate[]): AmmoCandidate | null {
  return unspentAmmo(spent, candidates)[0] ?? null;
}

/**
 * Append to the ledger. Returns the ledger as it now stands, or null if the write failed.
 *
 * ‼️ READ-MODIFY-WRITE, AND THE RACE IS REAL BUT BOUNDED. Two touches to the same prospect in the
 * same instant could each read the old array and the second would overwrite the first. That is
 * survivable here and a heavier design is not worth it: the send path already serializes a
 * prospect through cadence.ts's hasOutboundTouchToday and the queue's one-email-per-mailbox-per-
 * tick drain, and the worst case is one line offered twice rather than a lost send. If ammo ever
 * gets spent from two lanes at once this becomes an append via an ammo_touches table, the same
 * move docs/2026-09-01-onboarding2.sql made when fourteen screens shared one row.
 */
export async function recordAmmoSpent(
  prospectId: string,
  ammo: AmmoCandidate,
  step: number
): Promise<AmmoSpent[] | null> {
  const { data: current, error: readError } = await supabaseAdmin
    .from("outreach_prospects")
    .select("ammo_used")
    .eq("id", prospectId)
    .maybeSingle();

  if (readError || !current) {
    console.error(`[ammo] recordAmmoSpent read: ${readError?.message ?? "prospect not found"}`);
    return null;
  }

  const ledger = spentAmmo(current);

  // Spending the same line twice is a caller bug, not a reason to grow the ledger. Returning the
  // ledger unchanged keeps this idempotent, so a retried send cannot inflate the history and make
  // a fresh argument look spent.
  const key = ammoKey(ammo);
  if (ledger.some((a) => ammoKey(a) === key)) return ledger;

  const next: AmmoSpent[] = [...ledger, { kind: ammo.kind, detail: ammo.detail, step }];

  const { error: writeError } = await supabaseAdmin
    .from("outreach_prospects")
    .update({ ammo_used: next, updated_at: new Date().toISOString() })
    .eq("id", prospectId);

  if (writeError) {
    console.error(`[ammo] recordAmmoSpent write: ${writeError.message}`);
    return null;
  }

  return next;
}
