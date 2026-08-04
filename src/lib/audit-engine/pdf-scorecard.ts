// Branded AI Visibility Report PDF — deliberately mirrors the web report at
// /r/[slug] (same dark midnight/reef/ocean theme, same layout logic, same
// three-state ✅/❌/"no data" semantics) rather than the old light funding-app
// PDF style. Every number on this PDF comes straight from the real
// audit_runs data — nothing invented. Multi-page: lists all 20 prompts with
// their real matched excerpts, not just a couple of examples.

import { jsPDF } from "jspdf";
import type { AuditReportRow } from "./types";
import type { ReportView, PromptRowView, WeightedScore } from "./report-view";

const MIDNIGHT: [number, number, number] = [11, 20, 38];
const OCEAN: [number, number, number] = [27, 101, 167];
const REEF: [number, number, number] = [0, 201, 167];
const WHITE: [number, number, number] = [255, 255, 255];
const MUTED: [number, number, number] = [150, 162, 180]; // ~text-secondary
const CARD_BORDER: [number, number, number] = [45, 55, 78];
const RED: [number, number, number] = [231, 76, 60];

/** The four blocks as a buyer would name them. Exported: the delivery email says them out loud. */
export const BLOCK_LABEL: Record<string, string> = {
  MARCA: "Brand",
  SERVICIO: "Service",
  INFO: "Info",
  COMPARATIVO: "Comparison",
};

const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 12;

function setColor(doc: jsPDF, kind: "fill" | "text" | "draw", c: [number, number, number]) {
  if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
  else if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
  else doc.setDrawColor(c[0], c[1], c[2]);
}

/** The SRT 3-bar mark (2 ocean + 1 taller reef), matching the site's icon. */
function drawBrandIcon(doc: jsPDF, x: number, y: number, scale: number) {
  const bw = 1.6 * scale;
  const gap = 0.8 * scale;
  const draw = (barX: number, h: number, color: [number, number, number]) => {
    setColor(doc, "fill", color);
    doc.roundedRect(barX, y + (7 * scale - h), bw, h, 0.4, 0.4, "F");
  };
  draw(x, 3.6 * scale, OCEAN);
  draw(x + bw + gap, 5.2 * scale, OCEAN);
  draw(x + (bw + gap) * 2, 7 * scale, REEF);
}

/** Ring gauge approximated with short line segments (jsPDF has no native arc). */
function drawScoreRing(doc: jsPDF, cx: number, cy: number, radius: number, pct: number) {
  const lineWidth = 4.2;
  doc.setLineWidth(lineWidth);
  doc.setLineCap("round");

  const track = (from: number, to: number, color: [number, number, number]) => {
    setColor(doc, "draw", color);
    const steps = Math.max(1, Math.round(((to - from) / 360) * 144));
    for (let i = 0; i < steps; i++) {
      const a0 = from + ((to - from) * i) / steps;
      const a1 = from + ((to - from) * (i + 1)) / steps;
      const r0 = (a0 * Math.PI) / 180;
      const r1 = (a1 * Math.PI) / 180;
      doc.line(cx + radius * Math.cos(r0), cy + radius * Math.sin(r0), cx + radius * Math.cos(r1), cy + radius * Math.sin(r1));
    }
  };

  // Background track: full circle, faint.
  track(-90, 270, CARD_BORDER);
  // Foreground: score-percentage arc starting at 12 o'clock (-90deg), reef.
  const sweep = Math.max(0, Math.min(100, pct)) * 3.6;
  if (sweep > 0) track(-90, -90 + sweep, REEF);

  doc.setLineCap("butt");
}

interface PageState {
  doc: jsPDF;
  y: number;
  page: number;
  title: string;
}

function fillPageBackground(doc: jsPDF) {
  setColor(doc, "fill", MIDNIGHT);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

function drawFooter(doc: jsPDF, reportUrl: string) {
  setColor(doc, "draw", REEF);
  doc.setLineWidth(0.5);
  doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y);
  doc.setFontSize(7);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  doc.text("Run via official OpenAI & Perplexity APIs, neutral account, no personalization. We report visibility, not customers or revenue.", PAGE_W / 2, FOOTER_Y + 4, { align: "center" });
  setColor(doc, "text", REEF);
  doc.text(`View the live report: ${reportUrl}`, PAGE_W / 2, FOOTER_Y + 8, { align: "center" });
}

function newPage(state: PageState, reportUrl: string): void {
  if (state.page > 0) drawFooter(state.doc, reportUrl);
  if (state.page > 0) state.doc.addPage();
  fillPageBackground(state.doc);
  state.page += 1;
  state.y = MARGIN;

  if (state.page > 1) {
    // Slim running header on continuation pages.
    state.doc.setFontSize(9);
    state.doc.setFont("helvetica", "bold");
    setColor(state.doc, "text", MUTED);
    state.doc.text(state.title, MARGIN, state.y + 3);
    setColor(state.doc, "text", MUTED);
    state.doc.setFont("helvetica", "normal");
    state.doc.text(`Page ${state.page}`, PAGE_W - MARGIN, state.y + 3, { align: "right" });
    state.y += 9;
  }
}

function ensureSpace(state: PageState, needed: number, reportUrl: string): void {
  if (state.y + needed > FOOTER_Y - 4) newPage(state, reportUrl);
}

export function generateScorecardPDF(report: AuditReportRow, view: ReportView, weighted: WeightedScore): Buffer {
  const doc = new jsPDF();
  const reportUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com"}/r/${report.slug}`;
  const title = report.client_name || report.business_type || report.website;
  const state: PageState = { doc, y: 0, page: 0, title };

  newPage(state, reportUrl);

  // ---- HEADER (mirrors the web /r/[slug] ReportHeader: a small icon + eyebrow
  // on one row, the title below, subtitle, a divider, then a centered lead-in.
  // The icon is intentionally small so it never overlaps the title.) ----
  const iconScale = 1.5;
  const iconW = 6.4 * iconScale; // total width of the 3-bar mark (3 bars + 2 gaps)
  const iconH = 7 * iconScale;
  drawBrandIcon(doc, MARGIN, state.y, iconScale);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", REEF);
  doc.text("AI VISIBILITY REPORT", MARGIN + iconW + 4, state.y + iconH / 2 + 1.4);
  state.y += iconH + 5;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", WHITE);
  const titleLines = doc.splitTextToSize(title, CONTENT_W);
  doc.text(titleLines, MARGIN, state.y + 2);
  state.y += titleLines.length * 7 + 3;

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  const date = new Date(report.created_at).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const subtitle = [report.business_type, report.city, date].filter(Boolean).join(" · ");
  doc.text(subtitle, MARGIN, state.y);
  state.y += 8;

  // Divider under the header, like the web report.
  setColor(doc, "draw", CARD_BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, state.y, PAGE_W - MARGIN, state.y);
  state.y += 9;

  // Centered lead-in line (matches the web report's sub-header).
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  const leadIn = `${view.totalPrompts} questions real buyers ask before choosing ${report.business_type ? `a ${report.business_type}` : "this business"}`;
  const leadLines = doc.splitTextToSize(leadIn, CONTENT_W - 24);
  doc.text(leadLines, PAGE_W / 2, state.y, { align: "center" });
  state.y += leadLines.length * 5 + 8;

  // ---- SCORE RING (centered) ----
  const ringCx = PAGE_W / 2;
  const ringCy = state.y + 24;
  drawScoreRing(doc, ringCx, ringCy, 20, weighted.score);
  doc.setFontSize(24);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", WHITE);
  doc.text(`${weighted.score}`, ringCx, ringCy - 0.5, { align: "center", baseline: "middle" });
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  doc.text("/ 100", ringCx, ringCy + 6, { align: "center", baseline: "middle" });
  state.y = ringCy + 30;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", WHITE);
  doc.text(`Appeared in ${view.totalMentioned} of ${view.totalPrompts} buyer questions`, PAGE_W / 2, state.y, { align: "center" });
  state.y += 11;

  // ---- BREAKDOWN TILES ----
  const tileW = (CONTENT_W - 9) / 4;
  const tileH = 16;
  view.blockStats.forEach((b, i) => {
    const x = MARGIN + i * (tileW + 3);
    setColor(doc, "fill", MIDNIGHT);
    setColor(doc, "draw", CARD_BORDER);
    doc.setLineWidth(0.3);
    doc.roundedRect(x, state.y, tileW, tileH, 1.5, 1.5, "FD");
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    setColor(doc, "text", MUTED);
    doc.text((BLOCK_LABEL[b.block] ?? b.block).toUpperCase(), x + tileW / 2, state.y + 5.5, { align: "center" });
    doc.setFontSize(11);
    setColor(doc, "text", WHITE);
    doc.text(`${b.mentioned}/${b.total}`, x + tileW / 2, state.y + 12, { align: "center" });
  });
  state.y += tileH + 10;

  // ---- ALL 20 PROMPTS ----
  doc.setFontSize(10.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", WHITE);
  ensureSpace(state, 8, reportUrl);
  doc.text("EVERY QUESTION WE TESTED", MARGIN, state.y);
  state.y += 7;

  for (const p of view.prompts) {
    drawPromptBlock(state, p, reportUrl);
  }

  // ---- WHO OWNS THE ANSWERS ----
  if (view.mostRecommended.length > 0 || view.citedDomains.length > 0) {
    ensureSpace(state, 20, reportUrl);
    doc.setFontSize(10.5);
    doc.setFont("helvetica", "bold");
    setColor(doc, "text", WHITE);
    doc.text("WHO OWNS THE ANSWERS", MARGIN, state.y);
    state.y += 7;

    if (view.mostRecommended.length > 0) {
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      for (const r of view.mostRecommended.slice(0, 6)) {
        ensureSpace(state, 5.5, reportUrl);
        setColor(doc, "text", [200, 210, 225]);
        doc.text(r.name, MARGIN, state.y);
        setColor(doc, "text", MUTED);
        doc.text(`×${r.count}`, PAGE_W - MARGIN, state.y, { align: "right" });
        state.y += 5.5;
      }
      state.y += 3;
    }
  }

  drawFooter(doc, reportUrl);

  const arrayBuffer = doc.output("arraybuffer");
  return Buffer.from(arrayBuffer);
}

// jsPDF's standard fonts use WinAnsi encoding, which has no ✓/✗ glyphs — passing
// them corrupts the whole string. So we draw the check/cross as small vector
// marks (matching the web report's green ✅ / red ❌ / muted "no data" chips).
function engineLabel(doc: jsPDF, x: number, y: number, label: string, status: "ok" | "no_data", mentioned: boolean | null): number {
  const color: [number, number, number] = status === "no_data" ? MUTED : mentioned ? REEF : RED;
  const text = status === "no_data" ? `${label}: no data` : label;

  let tx = x;
  if (status === "ok") {
    setColor(doc, "draw", color);
    doc.setLineWidth(0.5);
    doc.setLineCap("round");
    if (mentioned) {
      // check mark
      doc.line(x, y - 1.2, x + 1, y - 0.1);
      doc.line(x + 1, y - 0.1, x + 2.6, y - 2.4);
    } else {
      // cross mark
      doc.line(x, y - 2.4, x + 2.4, y);
      doc.line(x + 2.4, y - 2.4, x, y);
    }
    doc.setLineCap("butt");
    tx = x + 4;
  }

  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", color);
  doc.text(text, tx, y);
  return tx - x + doc.getTextWidth(text) + 6;
}

function drawPromptBlock(state: PageState, p: PromptRowView, reportUrl: string): void {
  const { doc } = state;

  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  const promptLines = doc.splitTextToSize(p.prompt, CONTENT_W);
  const headerHeight = promptLines.length * 4.4 + (p.isBranded ? 4 : 0) + 6;

  const snippetLines: string[] = [];
  const openaiText = p.engines.openai.snippet ? `ChatGPT: ${p.engines.openai.snippet}` : "";
  const perplexityText = p.engines.perplexity.snippet ? `Perplexity: ${p.engines.perplexity.snippet}` : "";
  for (const t of [openaiText, perplexityText]) {
    if (t) snippetLines.push(...doc.splitTextToSize(t, CONTENT_W - 4));
  }
  const recommendedLine = p.recommended.length > 0 ? `Recommended: ${p.recommended.map((r) => r.name).join(", ")}` : "";

  const blockHeight = headerHeight + 5 + snippetLines.length * 3.6 + (recommendedLine ? 5 : 0) + 6;
  ensureSpace(state, blockHeight, reportUrl);

  setColor(doc, "fill", MIDNIGHT);
  setColor(doc, "draw", CARD_BORDER);
  doc.setLineWidth(0.3);
  doc.roundedRect(MARGIN, state.y, CONTENT_W, blockHeight, 1.5, 1.5, "FD");

  let y = state.y + 5;
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", WHITE);
  doc.text(promptLines, MARGIN + 3, y);
  y += promptLines.length * 4.4;

  if (p.isBranded) {
    doc.setFontSize(6.5);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", MUTED);
    doc.text("BRANDED SEARCH — name already in the query", MARGIN + 3, y);
    y += 4;
  }
  y += 2;

  let chipX = MARGIN + 3;
  chipX += engineLabel(doc, chipX, y, "ChatGPT", p.engines.openai.status, p.engines.openai.mentioned);
  engineLabel(doc, chipX, y, "Perplexity", p.engines.perplexity.status, p.engines.perplexity.mentioned);
  y += 5;

  if (recommendedLine) {
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", [180, 190, 205]);
    const recLines = doc.splitTextToSize(recommendedLine, CONTENT_W - 6);
    doc.text(recLines, MARGIN + 3, y);
    y += recLines.length * 3.6 + 2;
  }

  if (snippetLines.length > 0) {
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "italic");
    setColor(doc, "text", MUTED);
    doc.text(snippetLines, MARGIN + 3, y);
    y += snippetLines.length * 3.6;
  }

  state.y += blockHeight + 4;
}
