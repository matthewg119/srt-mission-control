// THE SCREENSHOT GATE. No keyword is used until the picture of its Google result is on file.
//
// ‼️ THIS IS THE THIRD HARD RAIL IN THIS CODEBASE AND IT WAS ADDED ON PURPOSE. The first is the
// Day 0 wall, the second is the page quality gate in src/lib/hub/page-gate.ts, and this is modelled
// on the second down to the hole check at the bottom of this comment.
//
// WHY IT EXISTS. Step 12 decides which searches a client's whole content plan is built on, and
// every input to that decision is a model reading a picture. A score a model produced can send a
// keyword to a page nobody checked, and NOTHING LOOKS WRONG WHILE IT HAPPENS: the plan is complete,
// the clusters are tidy, the numbers are plausible, and the first sign of trouble is a page that
// should never have been written. Matthew's rule, 2026-09-23: "nothing gets used until I have seen
// the picture of the Google result".
//
// WHAT SATISFIES IT, and it is one thing: a stored reading with source='vision' AND a doc_id. See
// pictured() in keyword-strategy-rules.ts for why both halves are load bearing.
//
// ‼️ WHAT DOES NOT SATISFY IT: A TYPED VERDICT. `keywords serp 9: merge` is a person asserting a
// conclusion, and bestVerdict() ranks it ABOVE a vision read for ROUTING, which is correct and
// unchanged. It is not a person's screenshot. Those are two questions and they get two answers.
// This is the half of the reconciliation Matthew asked for and leaned toward: typed stays a valid
// verdict and stops satisfying the gate.
//
// ‼️ IT REFUSES THE WRITE, IT DOES NOT FILTER IT SILENTLY. A gate that quietly drops the unpictured
// rows produces a smaller plan that looks finished, which is the same invisible failure with better
// manners. The refusal NAMES the keywords, with the shortlist numbers they are typed by, so the way
// out of a refusal is to copy a number out of it.
//
// ‼️ THE HOLE CHECK, and it is the same shape page-gate.ts and day-zero.ts both use:
//
//   grep -rn "assertPictured" src/   ->  must match GATED below, exactly
//
// scripts/_probe-serp-gate.ts runs that grep. A gate that is written and never wired is the same
// failure as an unwired column, wearing a safety label.

import { supabaseAdmin } from "@/lib/db";
import { blockLine, pictured, type BlockReason, type SerpReadRow } from "./keyword-strategy-rules";

/**
 * Every path that consults this gate. Documentation, not enforcement: enforcement is the call to
 * assertPictured() inside each one, and the probe checks the two lists agree.
 */
export const GATED = [
  "persistClusters          src/lib/clients/keyword-strategy.ts",
  "approveStrategyCommand   src/lib/clients/keyword-strategy.ts",
  "strategyView             src/lib/clients/keyword-strategy.ts",
] as const;

/**
 * Deliberately NOT gated, and why.
 *
 *   keywords serp N / keywords serp N: merge
 *     Recording a reading is how evidence ARRIVES. Gating it would mean a keyword could never
 *     acquire the thing the gate wants.
 *   keywords approve / keywords approve mine
 *     Approving a PHRASE is saying "this is a way people say our offer", which is a judgement about
 *     language and needs no SERP. The strategy is where a phrase becomes a page, and that is gated.
 *   strategy / strategy new
 *     Printing the proposal is not writing it. A person has to be able to SEE what is blocked, and
 *     a card that refused to render would hide the list of what to go and shoot.
 *   strategy merge / pillar / service / post
 *     Editing the shape of a proposal. The lock is what the gate guards, not the sketching.
 */
export const NOT_GATED = [
  "recordSerpScreenshot", "serpTypedCommand", "approveCommand", "strategyCommand",
  "mergeCommand", "pillarCommand", "kindCommand",
] as const;

export interface MissingPicture {
  keywordId: string;
  phrase: string;
  reason: BlockReason;
}

/** Thrown by assertPictured. Carries what the card and the refusal both print. */
export class SerpGateError extends Error {
  readonly missing: MissingPicture[];

  constructor(message: string, missing: MissingPicture[]) {
    super(message);
    this.name = "SerpGateError";
    this.missing = missing;
  }
}

export function isSerpGateError(e: unknown): e is SerpGateError {
  return e instanceof SerpGateError;
}

/**
 * Which of these keywords have a screenshot on file.
 *
 * ‼️ IT READS keyword_serp_reads FRESH RATHER THAN TRUSTING ANYTHING THE CALLER LOADED, for the same
 * reason assertGatePassed re-hashes the page body: this is the one place where being convenient is
 * worth less than being right. keyword_clusters once carried a missing_pictures column for exactly
 * this number, and it was DROPPED on 2026-09-25 rather than read: nothing ever selected it, it was
 * written on insert and never updated, so it was stale the moment a screenshot landed. A cache must
 * never be what a refusal is decided on, and a cache nobody reads is not a cache at all.
 *
 * ‼️ A FAILED READ BLOCKS EVERYTHING, AND THAT IS THE OPPOSITE OF THE HOUSE DEFAULT. Everywhere else
 * in this lane a missing table reads as "no strategy yet" and degrades to the old behaviour. Here it
 * cannot: the old behaviour is "write the cluster anyway", which is the thing being prevented. A
 * gate that opens when its evidence store is unreachable is not a gate. The refusal says the
 * database could not be read, so the cause is visible rather than looking like missing screenshots.
 */
export async function picturedIds(
  clientId: string,
  keywordIds: readonly string[]
): Promise<{ ok: true; pictured: Set<string> } | { ok: false; error: string }> {
  if (!keywordIds.length) return { ok: true, pictured: new Set() };

  const { data, error } = await supabaseAdmin
    .from("keyword_serp_reads")
    .select("keyword_id, source, doc_id")
    .eq("client_id", clientId)
    .in("keyword_id", [...keywordIds])
    .range(0, 2999);

  if (error) return { ok: false, error: error.message };

  const byKeyword = new Map<string, Array<{ source: "vision" | "typed"; docId: string | null }>>();
  for (const r of data ?? []) {
    const id = r.keyword_id as string | null;
    if (!id) continue;
    const list = byKeyword.get(id) ?? [];
    list.push({ source: (r.source as "vision" | "typed") ?? "vision", docId: (r.doc_id as string | null) ?? null });
    byKeyword.set(id, list);
  }

  const out = new Set<string>();
  for (const [id, reads] of byKeyword) if (pictured(reads)) out.add(id);
  return { ok: true, pictured: out };
}

/**
 * THE GATE. Throws SerpGateError when any of these keywords has no picture on file.
 *
 * `label` names each keyword the way the person will type it, so a refusal can be acted on by
 * copying a number out of it. Pass the shortlist position where there is one.
 */
export async function assertPictured(
  clientId: string,
  keywords: ReadonlyArray<{ id: string; phrase: string; verdict: unknown; docId: string | null }>
): Promise<void> {
  if (!keywords.length) return;

  const res = await picturedIds(
    clientId,
    keywords.map((k) => k.id)
  );

  if (!res.ok) {
    throw new SerpGateError(
      `The screenshots could not be read back, so nothing was written: ${res.error}. ` +
        "This is a database fault, not a missing picture.",
      []
    );
  }

  const missing: MissingPicture[] = [];
  for (const k of keywords) {
    if (res.pictured.has(k.id)) continue;
    missing.push({
      keywordId: k.id,
      phrase: k.phrase,
      // Same three states gateClusters draws, derived the same way, so the refusal and the card
      // never disagree about why one row is stuck.
      reason: k.docId ? "unreadable" : k.verdict ? "typed_only" : "no_reading",
    });
  }

  if (!missing.length) return;

  throw new SerpGateError(
    `${missing.length} keyword${missing.length === 1 ? " has" : "s have"} no screenshot on file.`,
    missing
  );
}

/**
 * The refusal, as Slack lines. One place, so every refusal reads the same.
 *
 * ‼️ IT PRINTS THE NUMBER, NOT JUST THE PHRASE. A refusal a person cannot act on without going and
 * looking something up is a refusal that gets worked around. `numberOf` maps a keyword id to its
 * shortlist position, which is what `keywords serp N` takes.
 */
export function refusalLines(
  err: SerpGateError,
  numberOf: (keywordId: string) => number | null
): string[] {
  if (!err.missing.length) return [`:warning: ${err.message}`];

  const lines = [
    `:no_entry: *Nothing was written.* ${err.message}`,
    "",
    "_No keyword is used, and no sub category is created under a pillar, until the picture of its Google result is on file. A typed verdict routes a keyword; it does not clear this._",
    "",
  ];

  for (const m of err.missing) {
    const n = numberOf(m.keywordId);
    const num = n ? `\`${String(n).padStart(2, " ")}\` ` : "";
    lines.push(`  :black_small_square: ${num}${m.phrase}  _(${blockLine(m.reason)})_`);
  }

  lines.push(
    "",
    "Google one of them, then paste the screenshot here with `keywords serp N` in the same message.",
    "`keywords shortlist` reprints the numbers."
  );
  return lines;
}

/** The three states, counted, for a card that wants a one-line summary rather than a list. */
export function tallyMissing(missing: readonly MissingPicture[]): Record<BlockReason, number> {
  const out: Record<BlockReason, number> = { no_reading: 0, typed_only: 0, unreadable: 0 };
  for (const m of missing) out[m.reason] += 1;
  return out;
}

export type { SerpReadRow };
