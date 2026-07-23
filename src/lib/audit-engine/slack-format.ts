// Slack message formatting for the Audit Engine. The prompt-drop text is
// deliberately plain (no numbering, no bullets) — Matthew's Chrome extension reads
// it line by line for the live manual demo, so any decoration breaks the parse.

import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

function reportUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  return `${base}/r/${slug}`;
}

function displayName(report: AuditReportRow): string {
  return report.client_name || report.business_type || report.website;
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
    "Prompts (copy/paste for the live demo):",
    promptLines,
    "",
    "⏳ Running the automated report... (~5-10 min)",
  ].join("\n");
  return { text };
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
