// Aggregates raw audit_reports + audit_runs rows into the view model the public
// report page renders. Kept separate from the page component so the "no
// fabrication" rule is easy to verify in one place: a prompt only ever reads as
// appeared=true when a real engine run recorded mentioned:true.

import type { AuditReportRow, AuditRunRow } from "./types";

export interface EngineCellView {
  status: "ok" | "no_data";
  mentioned: boolean | null;
  snippet: string | null;
}

export interface PromptRowView {
  block: string;
  prompt: string;
  appeared: boolean;
  engines: { openai: EngineCellView; perplexity: EngineCellView };
}

export interface BlockStat {
  block: string;
  mentioned: number;
  total: number;
}

export interface CitedDomain {
  domain: string;
  count: number;
}

export interface ReportView {
  prompts: PromptRowView[];
  blockStats: BlockStat[];
  citedDomains: CitedDomain[];
  totalMentioned: number;
  totalPrompts: number;
}

const BLOCK_ORDER = ["MARCA", "SERVICIO", "INFO", "COMPARATIVO"];

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function engineCell(run: AuditRunRow | undefined): EngineCellView {
  if (!run || run.status !== "ok") {
    return { status: "no_data", mentioned: null, snippet: null };
  }
  return {
    status: "ok",
    mentioned: run.mentioned,
    snippet: run.raw_response ? run.raw_response.slice(0, 300) : null,
  };
}

export function buildReportView(report: AuditReportRow, runs: AuditRunRow[]): ReportView {
  const runsByPrompt = new Map<string, AuditRunRow[]>();
  for (const r of runs) {
    const list = runsByPrompt.get(r.prompt) ?? [];
    list.push(r);
    runsByPrompt.set(r.prompt, list);
  }

  const prompts: PromptRowView[] = report.prompts.map((p) => {
    const promptRuns = runsByPrompt.get(p.prompt) ?? [];
    const openai = engineCell(promptRuns.find((r) => r.engine === "openai"));
    const perplexity = engineCell(promptRuns.find((r) => r.engine === "perplexity"));
    return {
      block: p.block,
      prompt: p.prompt,
      appeared: Boolean(openai.mentioned || perplexity.mentioned),
      engines: { openai, perplexity },
    };
  });

  const blockStats: BlockStat[] = BLOCK_ORDER.map((block) => {
    const inBlock = prompts.filter((p) => p.block === block);
    return { block, mentioned: inBlock.filter((p) => p.appeared).length, total: inBlock.length };
  }).filter((b) => b.total > 0);

  const domainCounts = new Map<string, number>();
  for (const r of runs) {
    for (const url of r.citations ?? []) {
      const d = domainOf(url);
      if (d) domainCounts.set(d, (domainCounts.get(d) ?? 0) + 1);
    }
  }
  const citedDomains = [...domainCounts.entries()]
    .map(([domain, count]) => ({ domain, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return {
    prompts,
    blockStats,
    citedDomains,
    totalMentioned: prompts.filter((p) => p.appeared).length,
    totalPrompts: prompts.length,
  };
}
