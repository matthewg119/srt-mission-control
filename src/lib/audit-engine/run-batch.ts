// Runs a group of prompts against the engine and writes their audit_runs rows.
//
// Lives here rather than in api/audit/process/route.ts because finish-report.ts also needs it
// (the repair pass behind the coverage gate) and importing it from the route would make
// route -> finish-report -> route a cycle.
//
// Idempotent by construction: every call deletes the rows for the prompts it is about to write
// first, so a watchdog re-kick or a repair pass can never double-count audit_runs — which would
// silently corrupt the score.

import { supabaseAdmin } from "@/lib/db";
import { runOpenAI, withMention } from "./run-prompts";
import { extractRecommendedBatch } from "./extract-recommended";
import type { AuditReportRow } from "./types";
import type { AuditPrompt } from "./classify";

export async function runBatch(row: AuditReportRow, aliases: string[], promptsInBatch: AuditPrompt[]): Promise<void> {
  const perPrompt = await Promise.all(
    promptsInBatch.map(async (p, idx) => ({
      prompt: p,
      idx,
      result: await runOpenAI(p.prompt, row.city).then((r) => withMention(r, aliases)),
    }))
  );

  // One cheap extraction call for the whole batch — pulls the 0-5 business names
  // each "ok" response actually named, for display.
  const extractionItems = perPrompt
    .filter(({ result }) => result.status === "ok")
    .map(({ idx, result }) => ({ id: `${idx}:openai`, text: result.raw as string }));
  const recommendedMap = await extractRecommendedBatch(extractionItems);

  const batchPromptTexts = promptsInBatch.map((p) => p.prompt);
  await supabaseAdmin.from("audit_runs").delete().eq("report_id", row.id).in("prompt", batchPromptTexts);

  await Promise.all(
    perPrompt.map(({ prompt: p, idx, result }) =>
      supabaseAdmin.from("audit_runs").insert({
        report_id: row.id,
        block: p.block,
        prompt: p.prompt,
        engine: "openai",
        mentioned: result.status === "ok" ? result.mentioned : null,
        status: result.status,
        raw_response: result.raw,
        citations: result.citations,
        recommended: recommendedMap[`${idx}:openai`] ?? [],
        latency_ms: result.latencyMs,
        error: result.status === "no_data" ? result.error : null,
      })
    )
  );

  // Heartbeat: mark progress so the daily watchdog can tell a live run from a
  // stalled one, and a recovery knows how far the run got.
  await supabaseAdmin.from("audit_reports").update({ updated_at: new Date().toISOString() }).eq("id", row.id);
}
