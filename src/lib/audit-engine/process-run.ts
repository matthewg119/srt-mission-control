// Run a report's batches, across as many requests as it takes.
//
// ‼️ THE HISTORY MATTERS, BECAUSE THE OBVIOUS FIX HERE HAS ALREADY FAILED ONCE.
// api/audit/process originally chained with `waitUntil(fetch(next batch))`. Vercel dropped the
// fetch after the response returned, so runs stalled at `running` forever with no error anywhere.
// The fix was to stop chaining and process every batch in ONE invocation, which worked because a
// prospect audit is twenty questions: five batches, comfortably inside 300 seconds.
//
// Supplied runs broke that assumption on 2026-09-12. Photograph II is the universal twenty plus
// custom_v1, which is forty questions on a Core client and eighty on a Complete one. At four
// prompts a batch and a 45 second web search per prompt, that is well past the ceiling, and the
// failure mode is the bad one: the lambda is killed mid-loop, failReport never runs, and the row
// sits `running` until the daily watchdog notices.
//
// So chaining is back, in the shape that is PROVEN in this repo rather than the shape that failed:
// pre-call-pages.ts hands its next wave to an internal route with an AWAITED fetch and a timeout,
// and that route answers 202 the moment it has scheduled the work in waitUntil. The difference
// that matters is the await: the handing-off request stays alive until the next one has
// acknowledged, so nothing is lost to a freeze.
//
// ‼️ AT LEAST ONE BATCH RUNS PER HOP, whatever the budget says. A hop that hands straight on
// without doing anything is an infinite loop that looks like progress.

import { supabaseAdmin } from "@/lib/db";
import { buildAliases } from "./mention-match";
import { runBatch } from "./run-batch";
import { BATCH_SIZE, TOTAL_PROMPTS } from "./types";
import type { AuditReportRow } from "./types";
import { failReport, finishReport } from "./finish-report";

/**
 * When to stop starting new batches.
 *
 * The route's ceiling is 300s. A batch is four prompts in parallel, each with a 45 second timeout
 * and one retry, plus an extraction call, so a batch can take about 100 seconds in the worst case.
 * Stopping at 180 leaves room for the batch in flight to finish and for the hand-off fetch.
 */
export const HOP_BUDGET_MS = 180_000;

/**
 * A run cannot hop forever. Eighty questions is twenty batches, which is four or five hops; thirty
 * is far more than any real run needs and still terminates a loop caused by a bug.
 */
export const MAX_HOPS = 30;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

export interface ProcessResult {
  ok: boolean;
  /** Set when this hop handed the rest on rather than finishing the run. */
  handedOffAt?: number;
  finished?: boolean;
  skipped?: string;
  error?: string;
}

export async function processRun(args: {
  reportId: string;
  fromBatch: number;
  hop: number;
}): Promise<ProcessResult> {
  const started = Date.now();

  const { data, error: fetchError } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("id", args.reportId)
    .single();

  if (fetchError || !data) return { ok: false, error: "report not found" };

  const row = data as AuditReportRow;
  if (row.status === "done" || row.status === "failed") return { ok: true, skipped: row.status };

  if (args.hop >= MAX_HOPS) {
    await failReport(
      row,
      `The scan stopped after ${MAX_HOPS} passes without finishing. That is a bug rather than a ` +
        `slow engine: check process-run.ts, because a run of ${row.prompts?.length ?? 0} questions ` +
        `should need a handful.`
    );
    return { ok: false, error: "hop limit reached" };
  }

  const aliases = buildAliases(row.client_name ?? row.business_type ?? row.website, row.website);
  const totalPrompts = row.prompts.length || TOTAL_PROMPTS;
  const totalBatches = Math.ceil(totalPrompts / BATCH_SIZE);

  try {
    for (let b = Math.max(0, args.fromBatch); b < totalBatches; b++) {
      const startIdx = b * BATCH_SIZE;
      const promptsInBatch = row.prompts.slice(startIdx, startIdx + BATCH_SIZE);
      if (promptsInBatch.length === 0) break;

      // The budget is checked BEFORE a batch and never mid-flight, and only after at least one
      // batch has run in this hop.
      if (b > args.fromBatch && Date.now() - started > HOP_BUDGET_MS) {
        const handed = await chainNextHop(row.id, b, args.hop + 1);
        if (handed.ok) return { ok: true, handedOffAt: b };
        // Could not hand off. Carrying on here is better than stopping: the work is idempotent,
        // and the worst case is this lambda being killed, which is where the watchdog comes in.
        console.error(`[process-run] ${row.id}: hand-off failed (${handed.error}), continuing in this request`);
      }

      await runBatch(row, aliases, promptsInBatch);
    }
  } catch (e) {
    await failReport(row, (e as Error).message);
    return { ok: false, error: (e as Error).message };
  }

  await finishReport(row);
  return { ok: true, finished: true };
}

/**
 * Hand the remaining batches to a fresh request.
 *
 * Awaited with a timeout. The route answers 202 as soon as it has scheduled the work, so this
 * waits a second or two rather than for the batches.
 */
async function chainNextHop(reportId: string, batch: number, hop: number): Promise<{ ok: boolean; error?: string }> {
  const secret = process.env.AUDIT_INTERNAL_SECRET;
  if (!secret) return { ok: false, error: "AUDIT_INTERNAL_SECRET is not set" };
  try {
    const res = await fetch(`${appUrl()}/api/internal/audit-continue`, {
      method: "POST",
      headers: { "x-audit-secret": secret, "content-type": "application/json" },
      body: JSON.stringify({ id: reportId, batch, hop }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.status === 202 ? { ok: true } : { ok: false, error: `the route answered ${res.status}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
