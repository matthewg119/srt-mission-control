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

export interface PromptDropContext {
  /**
   * The city was worked out by research rather than typed by Matthew.
   *
   * ‼️ Print it when true. A resolved city is a decision the system made on his behalf about
   * WHICH BUSINESS this run is about, and every one of the 20 questions carries it. Making that
   * decision silently is the failure mode that made a city mandatory in the first place; saying
   * it out loud, next to the questions it shaped, is what replaced that requirement.
   */
  cityResolvedByResearch?: boolean;
  /** A site found during research for a business we were told had none, and then read. */
  discoveredWebsite?: string | null;
}

export function formatPromptDrop(
  report: AuditReportRow,
  ctx: PromptDropContext = {}
): { text: string } {
  // report.city is only ever null here for a confirmed non-local business (the
  // low-confidence-and-local case returns before a report row is even created)
  // — so omit the segment entirely rather than implying detection failed.
  const header = report.city
    ? `🎯 ${displayName(report)} · ${report.city}`
    : `🎯 ${displayName(report)}`;
  const notes: string[] = [];
  if (ctx.cityResolvedByResearch && report.city) {
    notes.push(`📍 City resolved from research, not given: *${report.city}*. Re-run with \`| City, ST\` if that is wrong.`);
  }
  if (ctx.discoveredWebsite) {
    notes.push(`🌐 Found a site after all and audited it: ${ctx.discoveredWebsite}`);
  }
  const promptLines = report.prompts.map((p) => p.prompt).join("\n");
  const text = [
    header,
    ...notes,
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

/**
 * Ask which city this is.
 *
 * Two shapes, because there are two different questions. A WEBSITE run that came back unsure is
 * "we could not tell where you are" — one best guess, retype the command. A NAME run with
 * `alternates` is a genuinely different situation: research found this trading name in more than
 * one metro, so the answer is a pick between real candidates rather than a guess to confirm.
 *
 * ‼️ Print the candidates. This message is the entire reason a bare `/audit Business Name` is
 * safe to allow: it is where the ambiguity that the parser no longer refuses becomes visible.
 * Collapsing it back to "best guess: X" would hide exactly the fact that makes it worth asking.
 */
export function formatAwaitingCityMessage(
  subject: string,
  bestGuess: string | null,
  alternates?: Array<{ city: string; state: string; note: string }>
): string {
  const rerun = (city: string) => `\`/audit ${subject} | ${city}\``;

  if (alternates && alternates.length > 0) {
    const seen = new Set<string>();
    const options = alternates
      .map((a) => [a.city, a.state].filter(Boolean).join(", "))
      .filter((c) => c && !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()));

    return [
      `🤔 More than one business trades as *${subject}*, so I stopped rather than score the wrong one.`,
      "",
      ...alternates.slice(0, options.length).map((a, i) => {
        const city = [a.city, a.state].filter(Boolean).join(", ");
        return `${i + 1}. ${city}${a.note ? ` — ${a.note}` : ""}`;
      }),
      "",
      "Re-run with the one you meant:",
      ...options.map((c) => rerun(c)),
    ].join("\n");
  }

  return [
    `🤔 Couldn't confidently detect the city for ${subject}${bestGuess ? ` (best guess: ${bestGuess})` : ""}.`,
    `A local audit without a geo-modifier isn't useful — reply with:`,
    rerun(bestGuess ?? "City, ST"),
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
