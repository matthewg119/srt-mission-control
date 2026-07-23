// Internal batch worker for the Audit Engine. Runs 4 prompts x 2 engines per
// invocation, writes each audit_runs row as soon as it resolves (so partial
// progress survives a kill), then self-chains to the next batch via waitUntil +
// fetch. On the final batch: computes score, marks the report done, and posts
// the final Slack message. Gated by AUDIT_INTERNAL_SECRET — never call directly
// from the browser or an unauthenticated caller.

import { NextRequest, NextResponse } from "next/server";
import { waitUntil } from "@vercel/functions";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { runOpenAI, runPerplexity, withMention } from "@/lib/audit-engine/run-prompts";
import { buildAliases } from "@/lib/audit-engine/mention-match";
import { extractRecommendedBatch } from "@/lib/audit-engine/extract-recommended";
import { formatFinalMessage, formatFailureMessage } from "@/lib/audit-engine/slack-format";
import { BATCH_SIZE, TOTAL_PROMPTS } from "@/lib/audit-engine/types";
import type { AuditReportRow, AuditRunRow, AuditEngine } from "@/lib/audit-engine/types";
import { buildReportView } from "@/lib/audit-engine/report-view";
import { generateScorecardPDF } from "@/lib/audit-engine/pdf-scorecard";
import { draftInitialEmail } from "@/lib/audit-engine/email-assistant";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function appUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
}

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.AUDIT_INTERNAL_SECRET;
  return !!secret && req.headers.get("x-audit-secret") === secret;
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

  const start = batch * BATCH_SIZE;
  const promptsInBatch = row.prompts.slice(start, start + BATCH_SIZE);
  if (promptsInBatch.length === 0) {
    return NextResponse.json({ ok: true, skipped: "empty_batch" });
  }

  const aliases = buildAliases(row.business_type ?? row.website, row.website);

  try {
    const perPrompt = await Promise.all(
      promptsInBatch.map(async (p, idx) => {
        const [openaiResult, perplexityResult] = await Promise.all([
          runOpenAI(p.prompt, row.city).then((r) => withMention(r, aliases)),
          runPerplexity(p.prompt, row.city).then((r) => withMention(r, aliases)),
        ]);
        return { prompt: p, idx, openaiResult, perplexityResult };
      })
    );

    // One cheap extraction call for the whole batch (not per response) — pulls
    // the 0-5 business names each "ok" response actually named, for display.
    const extractionItems = perPrompt.flatMap(({ idx, openaiResult, perplexityResult }) => [
      ...(openaiResult.status === "ok" ? [{ id: `${idx}:openai`, text: openaiResult.raw }] : []),
      ...(perplexityResult.status === "ok" ? [{ id: `${idx}:perplexity`, text: perplexityResult.raw }] : []),
    ]);
    const recommendedMap = await extractRecommendedBatch(extractionItems);

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
  } catch (e) {
    await failReport(row, (e as Error).message);
    return NextResponse.json({ ok: false, error: (e as Error).message });
  }

  const totalPrompts = row.prompts.length || TOTAL_PROMPTS;
  const isLastBatch = start + BATCH_SIZE >= totalPrompts;

  if (!isLastBatch) {
    const secret = process.env.AUDIT_INTERNAL_SECRET || "";
    waitUntil(
      fetch(`${appUrl()}/api/audit/process?id=${row.id}&batch=${batch + 1}`, {
        method: "POST",
        headers: { "x-audit-secret": secret },
      })
        .then(() => undefined)
        .catch((e) => console.error("[audit/process] chain to next batch failed:", (e as Error).message))
    );
    return NextResponse.json({ ok: true, batch, nextBatch: batch + 1 });
  }

  await finishReport(row);
  return NextResponse.json({ ok: true, batch, done: true });
}

async function failReport(row: AuditReportRow, message: string): Promise<void> {
  await supabaseAdmin
    .from("audit_reports")
    .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
    .eq("id", row.id);

  if (row.slack_channel_id && row.slack_thread_ts) {
    await slack
      .postThreadReply(
        row.slack_channel_id,
        row.slack_thread_ts,
        formatFailureMessage({ ...row, status: "failed", error: message })
      )
      .catch(() => {});
  }
}

async function finishReport(row: AuditReportRow): Promise<void> {
  const { data: runsData } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", row.id);
  const runs = (runsData ?? []) as AuditRunRow[];

  // A prompt "appeared" if at least one engine returned status:"ok" with mentioned:true.
  // no_data runs never count as a mention either way — see run-prompts.ts.
  const appearedByPrompt = new Map<string, boolean>();
  for (const r of runs) {
    const mentioned = r.status === "ok" && r.mentioned === true;
    if (mentioned || !appearedByPrompt.has(r.prompt)) {
      appearedByPrompt.set(r.prompt, mentioned || (appearedByPrompt.get(r.prompt) ?? false));
    }
  }

  const total = row.prompts.length || TOTAL_PROMPTS;
  const mentionedCount = [...appearedByPrompt.values()].filter(Boolean).length;
  const score = Math.round((mentionedCount / total) * 100);

  const { data: updated } = await supabaseAdmin
    .from("audit_reports")
    .update({ status: "done", score, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .select("*")
    .single();

  const finalRow = (updated as AuditReportRow | null) ?? { ...row, status: "done" as const, score };
  if (finalRow.slack_channel_id && finalRow.slack_thread_ts) {
    await slack.postThreadReply(finalRow.slack_channel_id, finalRow.slack_thread_ts, formatFinalMessage(finalRow)).catch(() => {});
    await postScorecardAndEmailDraft(finalRow, runs);
  }
}

// Best-effort: branded PDF scorecard + a first outreach-email draft, posted in
// the same thread right after the score. Never blocks the report from being
// marked done — a failure here just means Matthew generates these manually.
async function postScorecardAndEmailDraft(report: AuditReportRow, runs: AuditRunRow[]): Promise<void> {
  try {
    const aliases = buildAliases(report.business_type ?? report.website, report.website);
    const view = buildReportView(report, runs, aliases);

    const pdfBuffer = generateScorecardPDF(report, view);
    const fileName = `AI Visibility Scorecard - ${report.business_type ?? report.website}.pdf`;
    await slack.uploadFilePDF(report.slack_channel_id!, fileName, pdfBuffer, report.slack_thread_ts!);

    const emailDraft = await draftInitialEmail(report, view);
    await slack.postThreadReply(
      report.slack_channel_id!,
      report.slack_thread_ts!,
      `✉️ Draft outreach email — copy/paste and send:\n\n${emailDraft}\n\n_Reply in this thread with "email 2" through "email 5" for the next follow-up, or paste what the prospect said back and I'll draft the reply._`
    );
  } catch (e) {
    console.error("[audit/process] scorecard/email draft failed:", (e as Error).message);
  }
}
