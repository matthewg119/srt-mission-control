// Internal batch worker for the Audit Engine. Processes ALL remaining batches
// (4 prompts x 2 engines each) within a SINGLE invocation — no cross-invocation
// self-chaining. The old waitUntil(fetch(next batch)) hop was silently dropped
// by Vercel after the response returned, stalling runs at status:"running"
// forever. ~5 batches fit comfortably under maxDuration=300. Writes are
// idempotent (each batch clears its prior rows first) so a re-kick from the
// daily watchdog never double-counts. Gated by AUDIT_INTERNAL_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { runOpenAI, runPerplexity, withMention } from "@/lib/audit-engine/run-prompts";
import { buildAliases } from "@/lib/audit-engine/mention-match";
import { extractRecommendedBatch } from "@/lib/audit-engine/extract-recommended";
import { BATCH_SIZE, TOTAL_PROMPTS } from "@/lib/audit-engine/types";
import type { AuditReportRow, AuditEngine } from "@/lib/audit-engine/types";
import type { AuditPrompt } from "@/lib/audit-engine/classify";
import { finishReport, failReport } from "@/lib/audit-engine/finish-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.AUDIT_INTERNAL_SECRET;
  return !!secret && req.headers.get("x-audit-secret") === secret;
}

// Runs one batch (4 prompts x 2 engines) idempotently and bumps the heartbeat.
async function runBatch(row: AuditReportRow, aliases: string[], promptsInBatch: AuditPrompt[]): Promise<void> {
  const perPrompt = await Promise.all(
    promptsInBatch.map(async (p, idx) => {
      const [openaiResult, perplexityResult] = await Promise.all([
        runOpenAI(p.prompt, row.city).then((r) => withMention(r, aliases)),
        runPerplexity(p.prompt, row.city).then((r) => withMention(r, aliases)),
      ]);
      return { prompt: p, idx, openaiResult, perplexityResult };
    })
  );

  // One cheap extraction call for the whole batch — pulls the 0-5 business names
  // each "ok" response actually named, for display.
  const extractionItems = perPrompt.flatMap(({ idx, openaiResult, perplexityResult }) => [
    ...(openaiResult.status === "ok" ? [{ id: `${idx}:openai`, text: openaiResult.raw }] : []),
    ...(perplexityResult.status === "ok" ? [{ id: `${idx}:perplexity`, text: perplexityResult.raw }] : []),
  ]);
  const recommendedMap = await extractRecommendedBatch(extractionItems);

  // Idempotent: clear any prior rows for these prompts before writing, so a
  // re-kick (daily watchdog) never double-counts audit_runs (score corruption).
  const batchPromptTexts = promptsInBatch.map((p) => p.prompt);
  await supabaseAdmin.from("audit_runs").delete().eq("report_id", row.id).in("prompt", batchPromptTexts);

  await Promise.all(
    perPrompt.flatMap(({ prompt: p, idx, openaiResult, perplexityResult }) => {
      const engineResults: Array<{ engine: AuditEngine; result: typeof openaiResult }> = [
        { engine: "openai", result: openaiResult },
        { engine: "perplexity", result: perplexityResult },
      ];

      return engineResults.map(({ engine, result }) =>
        supabaseAdmin.from("audit_runs").insert({
          report_id: row.id,
          block: p.block,
          prompt: p.prompt,
          engine,
          mentioned: result.status === "ok" ? result.mentioned : null,
          status: result.status,
          raw_response: result.raw,
          citations: result.citations,
          recommended: recommendedMap[`${idx}:${engine}`] ?? [],
          latency_ms: result.latencyMs,
          error: result.status === "no_data" ? result.error : null,
        })
      );
    })
  );

  // Heartbeat: mark progress so the daily watchdog can tell a live run from a
  // stalled one, and a recovery knows how far the run got.
  await supabaseAdmin.from("audit_reports").update({ updated_at: new Date().toISOString() }).eq("id", row.id);
}

export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  const batch = parseInt(searchParams.get("batch") ?? "0", 10);
  if (!id || Number.isNaN(batch)) {
    return NextResponse.json({ error: "missing id/batch" }, { status: 400 });
  }

  const { data: reportData, error: fetchError } = await supabaseAdmin
    .from("audit_reports")
    .select("*")
    .eq("id", id)
    .single();
  if (fetchError || !reportData) {
    return NextResponse.json({ error: "report not found" }, { status: 404 });
  }

  const row = reportData as AuditReportRow;
  if (row.status === "done" || row.status === "failed") {
    return NextResponse.json({ ok: true, skipped: row.status });
  }

  const aliases = buildAliases(row.client_name ?? row.business_type ?? row.website, row.website);
  const totalPrompts = row.prompts.length || TOTAL_PROMPTS;
  const totalBatches = Math.ceil(totalPrompts / BATCH_SIZE);

  try {
    // Process every remaining batch in THIS invocation — no fragile
    // cross-invocation self-chain. Fresh runs start at batch 0; a watchdog
    // re-kick starts at the first incomplete batch.
    for (let b = Math.max(0, batch); b < totalBatches; b++) {
      const startIdx = b * BATCH_SIZE;
      const promptsInBatch = row.prompts.slice(startIdx, startIdx + BATCH_SIZE);
      if (promptsInBatch.length === 0) break;
      await runBatch(row, aliases, promptsInBatch);
    }
  } catch (e) {
    await failReport(row, (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }

  await finishReport(row);
  return NextResponse.json({ ok: true, done: true, fromBatch: batch });
}
