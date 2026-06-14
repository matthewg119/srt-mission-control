// Belief library parsing + slot-aware rotation for the Daily Creative Drop.
//
// Source of truth is src/data/reel/broll-captions.ts (embedded markdown). We parse
// the `## BELIEF N — "title"` sections and their numbered caption lines, then rotate
// through them per slot with no immediate repeat. Rotation state lives in the
// Supabase `reel_rotation` table (see docs/2026-06-14-reel-rotation.sql).

import { BROLL_CAPTIONS } from "@/data/reel/broll-captions";
import { SLOT_BELIEF_WEIGHTS, type ReelSlot } from "@/config/reel-style";
import { supabaseAdmin } from "@/lib/db";

export interface Belief {
  number: number;
  title: string;
  lines: string[];
}

/** Parse the embedded caption library into the 6 beliefs with their caption lines. */
export function loadBeliefs(): Belief[] {
  const parts = BROLL_CAPTIONS.split(/^##\s+BELIEF\s+/m).slice(1);
  const beliefs: Belief[] = [];

  for (const part of parts) {
    const nl = part.indexOf("\n");
    if (nl === -1) continue;
    const header = part.slice(0, nl);
    // header looks like: `1 — "I own a job, not a business ..."`
    const m = header.match(/^(\d+)\s*[—–-]\s*"?(.+?)"?\s*$/);
    if (!m) continue;
    const number = parseInt(m[1], 10);
    const title = m[2].trim();

    // Stop the section at the first horizontal rule or the next `##` heading so a
    // belief never absorbs the Spanish block or the pairing guide.
    let body = part.slice(nl + 1);
    const cut = body.search(/^\s*(---|##\s)/m);
    if (cut !== -1) body = body.slice(0, cut);

    const lines: string[] = [];
    const lineRe = /^\s*\d+\.\s+(.*\S)\s*$/gm;
    let lm: RegExpExecArray | null;
    while ((lm = lineRe.exec(body)) !== null) lines.push(lm[1].trim());

    if (number >= 1 && number <= 6 && lines.length > 0) {
      beliefs.push({ number, title, lines });
    }
  }

  return beliefs.sort((a, b) => a.number - b.number);
}

interface RotationRow {
  slot: string;
  last_belief: number;
  updated_at: string;
}

/**
 * Choose the belief for a slot: rotate through that slot's weighted pool starting
 * after the slot's last belief, and avoid repeating the globally most-recent belief
 * (so two consecutive drops never show the same belief).
 */
export async function selectBeliefForSlot(slot: ReelSlot): Promise<Belief> {
  const beliefs = loadBeliefs();
  const pool = SLOT_BELIEF_WEIGHTS[slot].filter((n) => beliefs.some((b) => b.number === n));
  if (pool.length === 0) {
    // Defensive: weighting references a belief that didn't parse. Fall back to all.
    return beliefs[0];
  }

  let rows: RotationRow[] = [];
  try {
    const { data } = await supabaseAdmin
      .from("reel_rotation")
      .select("slot,last_belief,updated_at");
    rows = (data as RotationRow[] | null) ?? [];
  } catch {
    rows = [];
  }

  const slotLast = rows.find((r) => r.slot === slot)?.last_belief ?? null;
  const globalLast =
    rows
      .slice()
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())[0]
      ?.last_belief ?? null;

  let ordered = pool;
  if (slotLast != null) {
    const idx = pool.indexOf(slotLast);
    ordered = idx === -1 ? pool : [...pool.slice(idx + 1), ...pool.slice(0, idx + 1)];
  }

  const pick = ordered.find((n) => n !== globalLast) ?? ordered[0];
  return beliefs.find((b) => b.number === pick) ?? beliefs[0];
}

/** Persist that `slot` just used belief `n` (advances the rotation). */
export async function recordBeliefUsed(slot: ReelSlot, n: number): Promise<void> {
  try {
    await supabaseAdmin
      .from("reel_rotation")
      .upsert(
        { slot, last_belief: n, updated_at: new Date().toISOString() },
        { onConflict: "slot" }
      );
  } catch (e) {
    console.error("[reel] recordBeliefUsed failed:", (e as Error).message);
  }
}
