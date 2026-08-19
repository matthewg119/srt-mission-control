// Slack message formatting for the Audit Engine. The prompt-drop text is
// deliberately plain (no numbering, no bullets) — Matthew's Chrome extension reads
// it line by line for the live manual demo, so any decoration breaks the parse.

import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";
import { displayName } from "./display-name";

function reportUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  return `${base}/r/${slug}`;
}

export function formatPromptDrop(report: AuditReportRow): { text: string } {
  // report.city is only ever null here for a confirmed non-local business (the
  // low-confidence-and-local case returns before a report row is even created)
  // — so omit the segment entirely rather than implying detection failed.
  const header = report.city
    ? `🎯 ${displayName(report)} · ${report.city}`
    : `🎯 ${displayName(report)}`;
  const promptLines = report.prompts.map((p) => p.prompt).join("\n");
  const text = [
    header,
    ...crawlBanner(report),
    "Prompts (copy/paste for the live demo):",
    promptLines,
    "",
    "⏳ Running the automated report... (~5-10 min)",
  ].join("\n");
  return { text };
}

/**
 * Says out loud when the questions were NOT written from the prospect's own pages, and why.
 *
 * This exists so a scorecard built off directory listings is never quietly mistaken for one
 * built off the site, and so the reason is visible before anyone drafts an email about it.
 * It deliberately distinguishes "they refused us" from "we gave up", because only the first
 * is a fact about the prospect.
 */
export function crawlBanner(report: AuditReportRow): string[] {
  const block = report.crawl_block;
  const source = report.research_source;
  if (!block && (!source || source === "site")) return [];

  const lines: string[] = [];
  if (source === "declared") {
    // Deliberately worded as a fact about the business, not as a gap in our scan. A run that
    // reads like a degraded audit gets treated as one; this one is the strongest lead in the
    // channel, and the banner is the first thing anyone sees before drafting.
    lines.push(
      "ℹ️ NO WEBSITE — this business has no site of its own, so the 20 questions came from third-party sources.",
      "Nothing on their own site was scored because there is none. That is the pitch, not a caveat."
    );
  } else if (source === "search") {
    lines.push("⚠️ SITE NOT READ — the 20 questions came from third-party sources, not their pages.");
  } else if (source === "site+search") {
    lines.push("ℹ️ Their page text was too thin to classify from, so third-party research was added.");
  }

  if (block) {
    lines.push(
      block.reason === "blocked"
        ? `Their site refused our request: ${block.detail}. That is a fact about THEM.`
        : `We could not read it (${block.reason}: ${block.detail}). That is a fact about US — do not pitch this as a block.`
    );
    if (block.engines_cited_site === true) {
      lines.push("The engines DID cite their domain in this run, so AI crawlers reach them fine. Drop the angle.");
    } else if (block.engines_cited_site === false && block.reason === "blocked") {
      lines.push("The engines never cited their domain in this run. Consistent with crawler trouble, not proof of it.");
    }
  }
  lines.push("");
  return lines;
}

export function formatAwaitingCityMessage(website: string, bestGuess: string | null): string {
  return [
    `🤔 Couldn't confidently detect the city for ${website}${bestGuess ? ` (best guess: ${bestGuess})` : ""}.`,
    `A local audit without a geo-modifier isn't useful — reply with:`,
    `\`/audit ${website} | City, ST\``,
  ].join("\n");
}

export function formatFinalMessage(report: AuditReportRow, view: ReportView): string {
  const score = report.score ?? 0;
  const location = report.city ? ` · ${report.city}` : "";
  return [
    `✅ Report done for *${displayName(report)}*${location}`,
    ...crawlBanner(report),
    `Score: *${score}/100* — appeared in ${view.totalMentioned} of ${view.totalPrompts} buyer questions`,
    reportUrl(report.slug),
  ].join("\n");
}

export function formatFailureMessage(report: AuditReportRow): string {
  return [
    `⚠️ Audit for *${report.website}* failed to complete.`,
    report.error ? `Error: ${report.error}` : "",
    "Raw data collected so far is preserved — no fabricated results were shown.",
  ]
    .filter(Boolean)
    .join("\n");
}
