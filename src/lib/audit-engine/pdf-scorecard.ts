// Branded one-page AI Visibility Scorecard PDF, following the same jsPDF/Node
// pattern as src/lib/pdf-generator.ts (same SRT header bar + brand palette),
// content structure follows the SOP's Part 7 scorecard template. Every number
// on this PDF comes straight from the real audit_runs data — nothing invented.

import { jsPDF } from "jspdf";
import type { AuditReportRow } from "./types";
import type { ReportView } from "./report-view";

const MIDNIGHT = [11, 20, 38] as const;
const OCEAN = [27, 101, 167] as const;
const SLATE = [61, 79, 111] as const;
const REEF = [0, 201, 167] as const;
const GRAY = [120, 120, 120] as const;

const BLOCK_LABEL: Record<string, string> = {
  MARCA: "Brand",
  SERVICIO: "Service",
  INFO: "Info",
  COMPARATIVO: "Comparison",
};

export function generateScorecardPDF(report: AuditReportRow, view: ReportView): Buffer {
  const doc = new jsPDF();
  const pw = 210;
  const m = 15;
  const cw = pw - m * 2;
  let y = 0;

  // ---- HEADER BAR ----
  doc.setFillColor(MIDNIGHT[0], MIDNIGHT[1], MIDNIGHT[2]);
  doc.rect(0, 0, pw, 26, "F");
  doc.setFillColor(REEF[0], REEF[1], REEF[2]);
  doc.rect(0, 26, pw, 1.5, "F");

  doc.setFontSize(17);
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.text("SRT AGENCY", m, 11);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(180, 195, 215);
  doc.text("Scaling Revenue Together", m, 17);
  doc.setFontSize(7.5);
  doc.text("submissions@srtagency.com  |  srtagency.com", m, 22);

  doc.setFontSize(12);
  doc.setTextColor(REEF[0], REEF[1], REEF[2]);
  doc.setFont("helvetica", "bold");
  doc.text("AI VISIBILITY", pw - m, 11, { align: "right" });
  doc.text("SCORECARD", pw - m, 17, { align: "right" });

  y = 36;

  // ---- CLIENT / DATE ----
  doc.setFontSize(13);
  doc.setTextColor(MIDNIGHT[0], MIDNIGHT[1], MIDNIGHT[2]);
  doc.setFont("helvetica", "bold");
  const title = `${report.business_type ?? report.website}${report.city ? " · " + report.city : ""}`;
  doc.text(title, m, y);
  y += 6;
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
  const date = new Date(report.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  doc.text(`Measured ${date} · neutral / logged-out view · ${report.website}`, m, y);
  y += 12;

  // ---- SCORE BLOCK ----
  doc.setFillColor(MIDNIGHT[0], MIDNIGHT[1], MIDNIGHT[2]);
  doc.roundedRect(m, y, cw, 32, 3, 3, "F");
  const scoreText = `${report.score ?? 0}`;
  doc.setFontSize(30);
  doc.setTextColor(REEF[0], REEF[1], REEF[2]);
  doc.setFont("helvetica", "bold");
  doc.text(scoreText, m + 12, y + 21);
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text("/ 100", m + 12 + doc.getTextWidth(scoreText) + 3, y + 21);
  doc.setFontSize(8.5);
  doc.setTextColor(200, 210, 225);
  doc.setFont("helvetica", "normal");
  doc.text(
    `AI Visibility Score — appeared in ${view.totalMentioned} of ${view.totalPrompts} real buyer questions`,
    pw - m - 5,
    y + 12,
    { align: "right" }
  );
  doc.text(`OpenAI + Perplexity, official APIs — no personalization`, pw - m - 5, y + 18, { align: "right" });
  y += 42;

  // ---- WHO OWNS YOUR ANSWERS ----
  doc.setFontSize(11);
  doc.setTextColor(MIDNIGHT[0], MIDNIGHT[1], MIDNIGHT[2]);
  doc.setFont("helvetica", "bold");
  doc.text("WHO OWNS YOUR ANSWERS", m, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  const topNames = view.mostRecommended.slice(0, 5);
  if (topNames.length === 0) {
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text("Not enough data captured yet to rank competitor mentions.", m, y);
    y += 6;
  } else {
    for (const [i, n] of topNames.entries()) {
      doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
      doc.text(`${i + 1}. ${n.name}`, m, y);
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      doc.text(`cited ${n.count}x`, pw - m, y, { align: "right" });
      y += 5.5;
    }
  }
  y += 5;

  // ---- BREAKDOWN ----
  doc.setFontSize(11);
  doc.setTextColor(MIDNIGHT[0], MIDNIGHT[1], MIDNIGHT[2]);
  doc.setFont("helvetica", "bold");
  doc.text("BREAKDOWN", m, y);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  for (const b of view.blockStats) {
    doc.setTextColor(SLATE[0], SLATE[1], SLATE[2]);
    doc.text(BLOCK_LABEL[b.block] ?? b.block, m, y);
    doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
    doc.text(`${b.mentioned} / ${b.total}`, pw - m, y, { align: "right" });
    y += 5.5;
  }
  y += 5;

  // ---- REAL EVIDENCE: quote up to 2 real missed-answer snippets ----
  const missed = view.prompts
    .filter((p) => !p.appeared && (p.engines.openai.snippet || p.engines.perplexity.snippet))
    .slice(0, 2);
  if (missed.length > 0) {
    doc.setFontSize(11);
    doc.setTextColor(MIDNIGHT[0], MIDNIGHT[1], MIDNIGHT[2]);
    doc.setFont("helvetica", "bold");
    doc.text("WHAT THE AI SAYS INSTEAD", m, y);
    y += 6;
    for (const p of missed) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8.5);
      doc.setTextColor(OCEAN[0], OCEAN[1], OCEAN[2]);
      const promptLines = doc.splitTextToSize(`"${p.prompt}"`, cw);
      doc.text(promptLines, m, y);
      y += promptLines.length * 4.2 + 1;

      doc.setFont("helvetica", "italic");
      doc.setTextColor(GRAY[0], GRAY[1], GRAY[2]);
      const snippet = (p.engines.openai.snippet || p.engines.perplexity.snippet || "").slice(0, 220);
      const snippetLines = doc.splitTextToSize(`${snippet}…`, cw);
      doc.text(snippetLines, m, y);
      y += snippetLines.length * 4.2 + 5;
    }
  }

  // ---- FOOTER ----
  const footerY = 280;
  doc.setDrawColor(REEF[0], REEF[1], REEF[2]);
  doc.setLineWidth(0.6);
  doc.line(m, footerY, pw - m, footerY);
  doc.setFontSize(6.5);
  doc.setTextColor(160, 160, 160);
  doc.setFont("helvetica", "normal");
  doc.text(
    "Run via official OpenAI & Perplexity APIs, neutral account, no personalization. We report visibility. Not customers, not revenue.",
    pw / 2,
    footerY + 4,
    { align: "center" }
  );
  doc.text("SRT Agency LLC • submissions@srtagency.com • srtagency.com", pw / 2, footerY + 7.5, { align: "center" });

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}
