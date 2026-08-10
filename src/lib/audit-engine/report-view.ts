// Aggregates raw audit_reports + audit_runs rows into the view model the public
// report page (and the PDF) render. Kept separate from the page component so
// the "no fabrication" rule is easy to verify in one place: a prompt only ever
// reads as appeared=true when a real engine run recorded mentioned:true.

import { supabaseAdmin } from "@/lib/db";
import type { AuditReportRow, AuditRunRow } from "./types";
import { isClientName, isMentioned, findMatchExcerpt, buildAliases } from "./mention-match";

/**
 * Load the runs and build the view, in one call.
 *
 * These exact three lines (select audit_runs -> buildAliases -> buildReportView) were copied into
 * four places: `finish-report.ts`, `thread-assistant.ts` twice, and the public report page. Four
 * copies of "what does this report say" is four chances for one of them to compute the score from
 * a different alias set than the card sitting next to it.
 */
export async function loadReportView(report: AuditReportRow): Promise<ReportView> {
  const { data } = await supabaseAdmin.from("audit_runs").select("*").eq("report_id", report.id);
  const runs = (data ?? []) as AuditRunRow[];
  const aliases = buildAliases(report.client_name ?? report.business_type ?? report.website, report.website);
  return buildReportView(report, runs, aliases);
}

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
  isBranded: boolean; // true when the business's own name is already in the prompt text
  engines: { openai: EngineCellView };
  recommended: RecommendedNameView[]; // deduped, capped for display
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

export interface WeightedScore {
  score: number;
  organicAppeared: number;
  organicTotal: number;
  brandedAppeared: number;
  brandedTotal: number;
}

export interface ReportView {
  /** The audit_reports row this view was built from. Lets a consumer that pairs a view with a
   *  report (finish-report.ts, before creating an Outlook draft with a scorecard attached)
   *  prove they describe the same business rather than assume it. */
  reportId: string;
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
const FALLBACK_SNIPPET_CHARS = 250;

// Appearing in a prompt that already names the business proves almost nothing
// (of course a search for "Arpovo Health reviews" might mention Arpovo Health).
// Appearing in a prompt that never named the business is the genuinely earned
// signal — that's what buyers actually experience. Weighted 90/10 accordingly.
const ORGANIC_WEIGHT = 0.9;
const BRANDED_WEIGHT = 0.1;

function domainOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return null;
  }
}

function engineCell(run: AuditRunRow | undefined, aliases: string[]): EngineCellView {
  if (!run || run.status !== "ok") {
    return { status: "no_data", mentioned: null, snippet: null };
  }
  const raw = run.raw_response ?? "";
  const fallback = raw.length > FALLBACK_SNIPPET_CHARS ? `${raw.slice(0, FALLBACK_SNIPPET_CHARS).trim()}…` : raw.trim();
  const snippet = run.mentioned ? findMatchExcerpt(raw, aliases) ?? fallback : fallback;
  return { status: "ok", mentioned: run.mentioned, snippet: snippet || null };
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
    const openai = engineCell(openaiRun, clientAliases);

    const recommendedNames = dedupeNames(openaiRun?.recommended ?? []).slice(0, MAX_RECOMMENDED_PER_PROMPT);

    return {
      block: p.block,
      prompt: p.prompt,
      // `mentioned` is null on a no_data cell, which is falsy — so this reads as "did not
      // appear" for a prompt that was never actually measured. That is only safe because
      // finish-report.ts refuses to publish a report with any unmeasured prompt. If that gate
      // is ever loosened, this line has to start distinguishing absent from unknown.
      appeared: Boolean(openai.mentioned),
      isBranded: isMentioned(p.prompt, clientAliases),
      engines: { openai },
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
    reportId: report.id,
    prompts,
    blockStats,
    citedDomains,
    mostRecommended,
    totalMentioned: prompts.filter((p) => p.appeared).length,
    totalPrompts: prompts.length,
  };
}

/**
 * The single source of truth for the score formula — used by the web report,
 * the PDF, and process/route.ts's DB write, so all three always agree.
 * organic = prompt never named the business (the earned signal, 90% weight).
 * branded = prompt already named the business (proves little, 10% weight).
 */
export function computeWeightedScore(view: ReportView): WeightedScore {
  const organic = view.prompts.filter((p) => !p.isBranded);
  const branded = view.prompts.filter((p) => p.isBranded);

  const organicAppeared = organic.filter((p) => p.appeared).length;
  const brandedAppeared = branded.filter((p) => p.appeared).length;
  const organicRate = organic.length > 0 ? organicAppeared / organic.length : null;
  const brandedRate = branded.length > 0 ? brandedAppeared / branded.length : null;

  let score: number;
  if (organicRate !== null && brandedRate !== null) {
    score = ORGANIC_WEIGHT * organicRate * 100 + BRANDED_WEIGHT * brandedRate * 100;
  } else if (organicRate !== null) {
    score = organicRate * 100;
  } else if (brandedRate !== null) {
    score = brandedRate * 100;
  } else {
    score = 0;
  }

  return {
    score: Math.round(score),
    organicAppeared,
    organicTotal: organic.length,
    brandedAppeared,
    brandedTotal: branded.length,
  };
}
