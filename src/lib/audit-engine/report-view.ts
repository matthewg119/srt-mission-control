// Aggregates raw audit_reports + audit_runs rows into the view model the public
// report page renders. Kept separate from the page component so the "no
// fabrication" rule is easy to verify in one place: a prompt only ever reads as
// appeared=true when a real engine run recorded mentioned:true.

import type { AuditReportRow, AuditRunRow } from "./types";
import { isClientName } from "./mention-match";

export interface EngineCellView {
  status: "ok" | "no_data";
  mentioned: boolean | null;
  snippet: string | null;
}

export interface RecommendedNameView {
  name: string;
  isClient: boolean;
}

export interface PromptRowView {
  block: string;
  prompt: string;
  appeared: boolean;
  engines: { openai: EngineCellView; perplexity: EngineCellView };
  recommended: RecommendedNameView[]; // deduped across both engines, capped for display
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

export interface MostRecommended {
  name: string;
  count: number;
}

export interface ReportView {
  prompts: PromptRowView[];
  blockStats: BlockStat[];
  citedDomains: CitedDomain[];
  mostRecommended: MostRecommended[];
  totalMentioned: number;
  totalPrompts: number;
}

const BLOCK_ORDER = ["MARCA", "SERVICIO", "INFO", "COMPARATIVO"];
const MAX_RECOMMENDED_PER_PROMPT = 5;
const MAX_MOST_RECOMMENDED = 8;

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

/** Dedupe names case-insensitively, keeping the first-seen casing. */
function dedupeNames(names: string[]): string[] {
  const seen = new Map<string, string>();
  for (const n of names) {
    const key = n.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, n.trim());
  }
  return [...seen.values()];
}

export function buildReportView(report: AuditReportRow, runs: AuditRunRow[], clientAliases: string[]): ReportView {
  const runsByPrompt = new Map<string, AuditRunRow[]>();
  for (const r of runs) {
    const list = runsByPrompt.get(r.prompt) ?? [];
    list.push(r);
    runsByPrompt.set(r.prompt, list);
  }

  const prompts: PromptRowView[] = report.prompts.map((p) => {
    const promptRuns = runsByPrompt.get(p.prompt) ?? [];
    const openaiRun = promptRuns.find((r) => r.engine === "openai");
    const perplexityRun = promptRuns.find((r) => r.engine === "perplexity");
    const openai = engineCell(openaiRun);
    const perplexity = engineCell(perplexityRun);

    const recommendedNames = dedupeNames([...(openaiRun?.recommended ?? []), ...(perplexityRun?.recommended ?? [])]).slice(
      0,
      MAX_RECOMMENDED_PER_PROMPT
    );

    return {
      block: p.block,
      prompt: p.prompt,
      appeared: Boolean(openai.mentioned || perplexity.mentioned),
      engines: { openai, perplexity },
      recommended: recommendedNames.map((name) => ({ name, isClient: isClientName(name, clientAliases) })),
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
    .slice(0, MAX_MOST_RECOMMENDED);

  // "Who owns the answers": frequency of recommended names across every run,
  // excluding the client's own business (that's not a competitor).
  const nameCounts = new Map<string, { display: string; count: number }>();
  for (const r of runs) {
    for (const name of r.recommended ?? []) {
      const trimmed = name.trim();
      if (!trimmed || isClientName(trimmed, clientAliases)) continue;
      const key = trimmed.toLowerCase();
      const existing = nameCounts.get(key);
      if (existing) existing.count += 1;
      else nameCounts.set(key, { display: trimmed, count: 1 });
    }
  }
  const mostRecommended = [...nameCounts.values()]
    .map(({ display, count }) => ({ name: display, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_MOST_RECOMMENDED);

  return {
    prompts,
    blockStats,
    citedDomains,
    mostRecommended,
    totalMentioned: prompts.filter((p) => p.appeared).length,
    totalPrompts: prompts.length,
  };
}
