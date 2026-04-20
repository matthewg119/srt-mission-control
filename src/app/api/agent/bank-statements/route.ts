import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { analyzeBankStatements } from "@/lib/ai-intel/bank-statement-analyzer";
import { routeToChannel } from "@/config/vektor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface Request {
  contact_id?: string;
  merchant_name?: string;
  pdf_urls?: string[];
  source?: "onedrive" | "manual" | "portal";
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Request;

  if (!body.pdf_urls || body.pdf_urls.length === 0) {
    return NextResponse.json({ error: "pdf_urls required" }, { status: 400 });
  }

  const fetched: Array<{ name: string; buffer: Buffer }> = [];
  for (let i = 0; i < body.pdf_urls.length; i++) {
    const url = body.pdf_urls[i];
    try {
      const res = await fetch(url);
      if (!res.ok) {
        console.error("[bank-statements] fetch failed:", url, res.status);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const name = url.split("/").pop()?.split("?")[0] ?? `statement-${i + 1}.pdf`;
      fetched.push({ name, buffer });
    } catch (e) {
      console.error("[bank-statements] fetch error:", url, (e as Error).message);
    }
  }

  if (fetched.length === 0) {
    return NextResponse.json({ error: "could not fetch any PDFs" }, { status: 500 });
  }

  let result;
  try {
    result = await analyzeBankStatements(fetched);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const { data: decision } = await supabaseAdmin
    .from("ai_decisions")
    .insert({
      merchant_id: body.contact_id ?? null,
      trigger_type: "webhook_zoho",
      state_classified: "bank_statement_analysis",
      action_taken: "slack_alert",
      reasoning: `Analyzed ${fetched.length} bank statement${fetched.length > 1 ? "s" : ""} via Opus 4.7 vision`,
      raw_response: { report_preview: result.report.slice(0, 500), tokens: result.tokens, source: body.source },
      model_used: result.model,
      latency_ms: result.latencyMs,
    })
    .select("id")
    .single();

  const channel = routeToChannel("bank_statement_analysis");
  if (channel) {
    const merchantName = body.merchant_name ?? "Merchant";
    const header = `🏦 *Bank Statement Analysis Ready* — ${merchantName}\n_${fetched.length} statement${fetched.length > 1 ? "s" : ""} analyzed · ${result.model} · ${(result.latencyMs / 1000).toFixed(1)}s_`;

    await slack.postMessage(channel, header);

    const chunks = chunkText(result.report, 3500);
    for (const chunk of chunks) {
      await slack.postMessage(channel, `\`\`\`\n${chunk}\n\`\`\``);
    }
  }

  return NextResponse.json({
    ok: true,
    decision_id: decision?.id,
    statements_analyzed: fetched.length,
    tokens: result.tokens,
    latency_ms: result.latencyMs,
  });
}

function chunkText(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const chunks: string[] = [];
  let pos = 0;
  while (pos < text.length) {
    let end = Math.min(pos + max, text.length);
    if (end < text.length) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > pos + max * 0.7) end = nl;
    }
    chunks.push(text.slice(pos, end));
    pos = end;
  }
  return chunks;
}
