// The keyword step's history, kept for good: every run, every rejected row, every decision.
//
// Matthew, 2026-09-15: "make sure the keywords that we generate here are saved for future strategies,
// page drafting, keyword positioning ... so we can create narratives in the future ... to train our
// own model in the future."
//
// ‼️ WHAT WAS MISSING, MEASURED. client_keywords is the CURRENT set and nothing else. It held no
// prompt, no raw model output, none of the rows acceptRows threw away, no record of who approved or
// dropped what, and resetForNewOffer HARD-DELETED every proposal the moment the offer changed. The CSV
// that looked like the record went to Slack only. So the one thing a training set needs (what was
// proposed, what a person kept, what a person threw out, and why) existed nowhere.
//
// ‼️ TWO APPEND-ONLY TABLES, AND client_keywords IS LEFT AS IT IS. The unique key on client_keywords
// is (client_id, normalized, use), so a "superseded" copy of a phrase would collide with the same phrase
// proposed for the next offer. A snapshot in keyword_runs keeps the old set whole without touching the
// table every reader of the current set depends on.
//
//   keyword_runs       one row per expansion, `more`, reset or measurement: prompts, raw rows,
//                      rejected rows with the reason, the whole set as it stood after, the CSV doc.
//   keyword_decisions  one row per approve / drop / add / pick, with the phrase as it was then.
//
// ‼️ NOTHING HERE EVER FAILS ITS CALLER, the rule client_events.ts follows. A run is the product; this
// is the record of it. An error is printed and swallowed, including a missing table.

import { supabaseAdmin } from "@/lib/db";
import type { StoredKeyword } from "./keyword-expansion";

export const KEYWORD_PROMPT_VERSION = "2026-09-13-research-first";

export type KeywordRunReason = "expansion" | "more" | "reset" | "measurement" | "rerun";

export interface ModelCall {
  system: string;
  user: string;
  rows: unknown[];
  error: string | null;
  ms: number;
}

export interface RejectedRow {
  phrase: string;
  category: string;
  reason: string;
}

/** Collects what one run said to the model and what it threw away, for the run row. */
export class KeywordRunRecorder {
  calls: ModelCall[] = [];
  rejected: RejectedRow[] = [];

  call(c: ModelCall): void {
    this.calls.push(c);
  }

  reject(r: RejectedRow): void {
    // A re-ask can reject the same phrase twice; once is the fact.
    if (this.rejected.length < 2000) this.rejected.push(r);
  }
}

function snapshot(rows: readonly StoredKeyword[]): Array<Record<string, unknown>> {
  return rows.map((r) => ({
    id: r.id,
    rank: r.rank,
    phrase: r.phrase,
    category: r.category,
    use: r.use,
    origin: r.origin,
    score: r.score,
    currently_named: r.currentlyNamed,
    source_url: r.sourceUrl,
    approved: r.approved,
    dropped: r.dropped,
    awareness_stage: r.awarenessStage ?? null,
    evidence_ids: r.evidenceIds ?? null,
    role: r.role ?? null,
  }));
}

export async function recordKeywordRun(args: {
  clientId: string;
  reason: KeywordRunReason;
  offerFingerprint: string | null;
  audienceId?: string | null;
  offerId?: string | null;
  model?: string | null;
  recorder?: KeywordRunRecorder | null;
  evidenceCount?: number;
  expansionCount?: number;
  rows: readonly StoredKeyword[];
  csvDocId?: string | null;
  notes?: readonly string[];
  context?: Record<string, unknown>;
}): Promise<string | null> {
  try {
    const rec = args.recorder;
    const { data, error } = await supabaseAdmin
      .from("keyword_runs")
      .insert({
        client_id: args.clientId,
        reason: args.reason,
        offer_fingerprint: args.offerFingerprint,
        audience_id: args.audienceId ?? null,
        offer_id: args.offerId ?? null,
        model: args.model ?? null,
        prompt_version: rec?.calls.length ? KEYWORD_PROMPT_VERSION : null,
        model_calls: rec?.calls ?? [],
        rejected: rec?.rejected ?? [],
        evidence_count: args.evidenceCount ?? null,
        expansion_count: args.expansionCount ?? null,
        rows_snapshot: snapshot(args.rows),
        row_count: args.rows.length,
        csv_doc_id: args.csvDocId ?? null,
        notes: args.notes ?? [],
        context: args.context ?? {},
      })
      .select("id")
      .maybeSingle();
    if (error) {
      console.error("[keyword-dataset] run not recorded:", error.message);
      return null;
    }
    return (data?.id as string | undefined) ?? null;
  } catch (e) {
    console.error("[keyword-dataset] run not recorded:", (e as Error).message);
    return null;
  }
}

export type KeywordDecisionAction =
  | "approve"
  | "drop"
  | "add"
  | "restore"
  | "pick_pillar"
  | "pick_support"
  | "unpick";

export async function recordKeywordDecisions(args: {
  clientId: string;
  action: KeywordDecisionAction;
  actor: string | null;
  rows: ReadonlyArray<Pick<StoredKeyword, "id" | "phrase" | "category" | "rank" | "score" | "origin" | "use">>;
  context?: Record<string, unknown>;
}): Promise<void> {
  if (args.rows.length === 0) return;
  try {
    const inserts = args.rows.map((r) => ({
      client_id: args.clientId,
      keyword_id: r.id || null,
      action: args.action,
      actor: args.actor,
      phrase: r.phrase,
      category: r.category,
      use: r.use,
      origin: r.origin,
      rank: r.rank,
      score: r.score,
      context: args.context ?? {},
    }));
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await supabaseAdmin.from("keyword_decisions").insert(inserts.slice(i, i + 500));
      if (error) {
        console.error("[keyword-dataset] decisions not recorded:", error.message);
        return;
      }
    }
  } catch (e) {
    console.error("[keyword-dataset] decisions not recorded:", (e as Error).message);
  }
}
