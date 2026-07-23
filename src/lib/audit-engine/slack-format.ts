// Slack message formatting for the Audit Engine. The prompt-drop text is
// deliberately plain (no numbering, no bullets) — Matthew's Chrome extension reads
// it line by line for the live manual demo, so any decoration breaks the parse.

import type { AuditReportRow } from "./types";

function reportUrl(slug: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  return `${base}/r/${slug}`;
}

export function formatPromptDrop(report: AuditReportRow): { text: string } {
  // report.city is only ever null here for a confirmed non-local business (the
  // low-confidence-and-local case returns before a report row is even created)
  // — so omit the segment entirely rather than implying detection failed.
  const header = report.city
    ? `🎯 ${report.business_type ?? "Unknown business"} · ${report.city}`
    : `🎯 ${report.business_type ?? "Unknown business"}`;
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

export function formatFinalMessage(report: AuditReportRow): string {
  const total = report.prompts.length || 20;
  const score = report.score ?? 0;
  const location = report.city ? ` · ${report.city}` : "";
  return [
    `✅ Report done for *${report.business_type ?? report.website}*${location}`,
    `Score: *${score}/100* — appeared in ${Math.round((score / 100) * total)} of ${total} buyer questions`,
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
