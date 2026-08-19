// One visual language, several documents.
//
// WHY THIS EXISTS. pdf-scorecard.ts was the only PDF generator in the repo: a 352-line
// monolith with two exports and every primitive — palette, geometry, page cursor, page break,
// background, brand mark — module-private. Runner v3 section 6 says the presence PDF uses
// "the same generator and visual treatment as the AI visibility audit report", and sections 10
// and 13 add two more documents on top of that. Four artifacts built by copy-pasting that
// file's layout maths would be roughly 150 duplicated lines that drift apart the first time
// anybody adjusts a margin.
//
// So the primitives were LIFTED here, unchanged, and pdf-scorecard.ts now imports them. There
// is deliberately no second PDF library and no second palette: jsPDF, these colours, this
// grid, every time.
//
// ‼️ THE FOOTER IS A CALLBACK, AND THAT IS THE ONE REAL DIFFERENCE FROM THE ORIGINAL.
// The scorecard's footer hardcodes the OpenAI methodology sentence and a /r/{slug} link, which
// are true of an audit and false of a call sheet. Every document supplies its own. The client-
// facing ones supply `fidelityFooter`, because Artifact Templates section 1 requires the
// question count, the ENGINE COUNT THAT ACTUALLY RAN, the date and the question set versions
// on every artifact carrying engine results.

import { jsPDF } from "jspdf";

// ─────────────────────────────────────────────────────────────────────────────
// Palette and grid — moved verbatim from pdf-scorecard.ts. Do not fork these.
// ─────────────────────────────────────────────────────────────────────────────

export type RGB = [number, number, number];

export const MIDNIGHT: RGB = [11, 20, 38];
export const OCEAN: RGB = [27, 101, 167];
export const REEF: RGB = [0, 201, 167];
export const WHITE: RGB = [255, 255, 255];
export const MUTED: RGB = [150, 162, 180]; // ~text-secondary
export const CARD_BORDER: RGB = [45, 55, 78];
export const RED: RGB = [231, 76, 60];
export const AMBER: RGB = [230, 168, 58];

/** A4 in mm, which is jsPDF's default unit. */
export const PAGE_W = 210;
export const PAGE_H = 297;
export const MARGIN = 15;
export const CONTENT_W = PAGE_W - MARGIN * 2;
export const FOOTER_Y = PAGE_H - 12;

export function setColor(doc: jsPDF, kind: "fill" | "text" | "draw", c: RGB) {
  if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
  else if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
  else doc.setDrawColor(c[0], c[1], c[2]);
}

/** The SRT 3-bar mark (2 ocean + 1 taller reef), matching the site's icon. */
export function drawBrandIcon(doc: jsPDF, x: number, y: number, scale: number) {
  const bw = 1.6 * scale;
  const gap = 0.8 * scale;
  const draw = (barX: number, h: number, color: RGB) => {
    setColor(doc, "fill", color);
    doc.roundedRect(barX, y + (7 * scale - h), bw, h, 0.4, 0.4, "F");
  };
  draw(x, 3.6 * scale, OCEAN);
  draw(x + bw + gap, 5.2 * scale, OCEAN);
  draw(x + (bw + gap) * 2, 7 * scale, REEF);
}

export function fillPageBackground(doc: jsPDF) {
  setColor(doc, "fill", MIDNIGHT);
  doc.rect(0, 0, PAGE_W, PAGE_H, "F");
}

// ─────────────────────────────────────────────────────────────────────────────
// The cursor
// ─────────────────────────────────────────────────────────────────────────────

/** Draws whatever belongs at the bottom of every page. See `fidelityFooter`. */
export type FooterFn = (doc: jsPDF, page: number) => void;

export interface PageState {
  doc: jsPDF;
  y: number;
  page: number;
  /** Repeated as a slim running header from page 2 onward. */
  title: string;
  footer: FooterFn;
  /** Suppresses the running header, for one-page documents like the review card. */
  noRunningHeader?: boolean;
}

export function startDoc(args: {
  title: string;
  footer: FooterFn;
  orientation?: "portrait" | "landscape";
  noRunningHeader?: boolean;
}): PageState {
  // ‼️ compress: true, and it is not cosmetic. jsPDF stores images UNCOMPRESSED by default: a
  // single 600px QR came out at 1.4 MB, and a findings doc carries five screenshots. Slack
  // rejects large uploads and a client's inbox is worse. The audit scorecard is deliberately
  // NOT routed through here — it builds its own jsPDF instance so its bytes stay unchanged.
  const doc = new jsPDF({ orientation: args.orientation ?? "portrait", compress: true });
  const state: PageState = {
    doc,
    y: 0,
    page: 0,
    title: args.title,
    footer: args.footer,
    noRunningHeader: args.noRunningHeader,
  };
  newPage(state);
  return state;
}

export function newPage(state: PageState): void {
  if (state.page > 0) state.footer(state.doc, state.page);
  if (state.page > 0) state.doc.addPage();
  fillPageBackground(state.doc);
  state.page += 1;
  state.y = MARGIN;

  if (state.page > 1 && !state.noRunningHeader) {
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

export function ensureSpace(state: PageState, needed: number): void {
  if (state.y + needed > FOOTER_Y - 4) newPage(state);
}

/** Footers the last page and hands back the bytes. Every document ends here. */
export function finishDoc(state: PageState): Buffer {
  state.footer(state.doc, state.page);
  return Buffer.from(state.doc.output("arraybuffer"));
}

// ─────────────────────────────────────────────────────────────────────────────
// The fidelity footer — Artifact Templates section 1, required, not decorative
// ─────────────────────────────────────────────────────────────────────────────

export interface Fidelity {
  questions: number;
  /**
   * ‼️ WHAT ACTUALLY RAN, never what the offer names. Read from audit_reports.engines, whose
   * own column comment says the same thing. The offer names four engines; one is keyed, so
   * this prints 1 and the artifact is honest about it. A2 D-P16.
   */
  engines: string[];
  date: Date;
  /** e.g. ["universal_v1@med_spa"]. Empty renders as "question set not frozen". */
  questionSetVersions: string[];
  /** Optional extra clause, e.g. "AI Overviews sampled". */
  note?: string;
}

const ENGINE_LABEL: Record<string, string> = {
  chatgpt_web: "ChatGPT",
  openai: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  ai_overviews: "Google AI Overviews",
};

export function fidelityLine(f: Fidelity): string {
  const m = f.engines.length;
  const named = f.engines.map((e) => ENGINE_LABEL[e] ?? e).join(", ");
  const date = f.date.toISOString().slice(0, 10);
  const versions = f.questionSetVersions.length
    ? f.questionSetVersions.join(", ")
    : "question set not frozen";
  const enginesPart = `${m} ${m === 1 ? "engine" : "engines"}${named ? ` (${named})` : ""}`;
  return `${f.questions} questions x ${enginesPart} · ${date} · ${versions}${f.note ? ` · ${f.note}` : ""}`;
}

/**
 * The standard client-facing footer. One reef rule, the fidelity line, the page number.
 *
 * The fidelity line is not a caption. It is the whole defence of every number above it:
 * defending a case study two years from now means showing how many questions ran against how
 * many engines, on what date, against which frozen set.
 */
export function fidelityFooter(f: Fidelity): FooterFn {
  const line = fidelityLine(f);
  return (doc, page) => {
    setColor(doc, "draw", REEF);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", MUTED);
    doc.text(line, PAGE_W / 2, FOOTER_Y + 4, { align: "center" });
    doc.text(`Page ${page}`, PAGE_W - MARGIN, FOOTER_Y + 4, { align: "right" });
  };
}

/** For internal documents that carry no engine results at all. */
export function plainFooter(label: string): FooterFn {
  return (doc, page) => {
    setColor(doc, "draw", REEF);
    doc.setLineWidth(0.5);
    doc.line(MARGIN, FOOTER_Y, PAGE_W - MARGIN, FOOTER_Y);
    doc.setFontSize(7);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", MUTED);
    doc.text(label, MARGIN, FOOTER_Y + 4);
    doc.text(`Page ${page}`, PAGE_W - MARGIN, FOOTER_Y + 4, { align: "right" });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Text
// ─────────────────────────────────────────────────────────────────────────────

/** The document title block: brand mark, eyebrow, title, subtitle, rule. */
export function coverHeading(
  state: PageState,
  args: { eyebrow: string; title: string; subtitle?: string }
): void {
  const { doc } = state;
  const scale = 1.5;
  const iconW = 6.4 * scale;
  const iconH = 7 * scale;
  drawBrandIcon(doc, MARGIN, state.y, scale);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", REEF);
  doc.text(args.eyebrow.toUpperCase(), MARGIN + iconW + 4, state.y + iconH / 2 + 1.4);
  state.y += iconH + 5;

  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", WHITE);
  const lines = doc.splitTextToSize(args.title, CONTENT_W) as string[];
  doc.text(lines, MARGIN, state.y + 2);
  state.y += lines.length * 7 + 3;

  if (args.subtitle) {
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", MUTED);
    const subLines = doc.splitTextToSize(args.subtitle, CONTENT_W) as string[];
    doc.text(subLines, MARGIN, state.y);
    state.y += subLines.length * 5 + 2;
  }

  setColor(doc, "draw", CARD_BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN, state.y, PAGE_W - MARGIN, state.y);
  state.y += 7;
}

/** A numbered or plain section heading. */
export function sectionHeading(state: PageState, text: string, opts?: { number?: number }): void {
  ensureSpace(state, 18);
  const { doc } = state;
  const label = opts?.number != null ? `${opts.number}. ${text}` : text;
  doc.setFontSize(12.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", REEF);
  const lines = doc.splitTextToSize(label, CONTENT_W) as string[];
  doc.text(lines, MARGIN, state.y + 4);
  state.y += lines.length * 5.6 + 3;
  setColor(doc, "draw", CARD_BORDER);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, state.y, PAGE_W - MARGIN, state.y);
  state.y += 5;
}

export function paragraph(
  state: PageState,
  text: string,
  opts?: { size?: number; color?: RGB; bold?: boolean; italic?: boolean; gap?: number; width?: number; x?: number }
): void {
  const { doc } = state;
  const size = opts?.size ?? 9.5;
  const lh = size * 0.48;
  const width = opts?.width ?? CONTENT_W;
  const style = opts?.italic ? "italic" : opts?.bold ? "bold" : "normal";
  doc.setFontSize(size);
  doc.setFont("helvetica", style);
  setColor(doc, "text", opts?.color ?? WHITE);
  const lines = doc.splitTextToSize(text, width) as string[];
  for (const line of lines) {
    ensureSpace(state, lh + 1);
    doc.setFontSize(size);
    doc.setFont("helvetica", style);
    setColor(doc, "text", opts?.color ?? WHITE);
    doc.text(line, opts?.x ?? MARGIN, state.y + lh);
    state.y += lh;
  }
  state.y += opts?.gap ?? 3;
}

export function bulletList(
  state: PageState,
  items: string[],
  opts?: { color?: RGB; size?: number }
): void {
  const size = opts?.size ?? 9.5;
  const lh = size * 0.48;
  const { doc } = state;
  for (const item of items) {
    const lines = (() => {
      doc.setFontSize(size);
      doc.setFont("helvetica", "normal");
      return doc.splitTextToSize(item, CONTENT_W - 5) as string[];
    })();
    ensureSpace(state, lh + 1);
    doc.setFontSize(size);
    setColor(doc, "text", REEF);
    doc.text("·", MARGIN + 1, state.y + lh);
    lines.forEach((line, i) => {
      if (i > 0) ensureSpace(state, lh);
      doc.setFontSize(size);
      doc.setFont("helvetica", "normal");
      setColor(doc, "text", opts?.color ?? WHITE);
      doc.text(line, MARGIN + 5, state.y + lh);
      state.y += lh;
    });
    state.y += 1;
  }
  state.y += 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure
// ─────────────────────────────────────────────────────────────────────────────

export interface TableRow {
  label: string;
  value: string;
  /** Renders the value in amber (a difference), red (a problem) or reef (confirmed good). */
  tone?: "normal" | "warn" | "bad" | "good";
}

const TONE: Record<string, RGB> = { normal: WHITE, warn: AMBER, bad: RED, good: REEF };

/**
 * Two-column label/value rows. The NAP block, the per-engine grid, the DNS records and the
 * access list are all this shape, which is why it is a primitive rather than four loops.
 */
export function keyValueTable(
  state: PageState,
  rows: TableRow[],
  opts?: { labelWidth?: number; size?: number }
): void {
  const labelW = opts?.labelWidth ?? 52;
  const size = opts?.size ?? 9;
  const lh = size * 0.5;
  const valueW = CONTENT_W - labelW - 4;
  const { doc } = state;

  for (const row of rows) {
    doc.setFontSize(size);
    doc.setFont("helvetica", "normal");
    const valueLines = doc.splitTextToSize(row.value || "not recorded", valueW) as string[];
    const h = Math.max(lh, valueLines.length * lh) + 2.5;
    ensureSpace(state, h);

    doc.setFontSize(size);
    setColor(doc, "text", MUTED);
    doc.setFont("helvetica", "normal");
    doc.text(doc.splitTextToSize(row.label, labelW) as string[], MARGIN, state.y + lh);

    setColor(doc, "text", row.value ? TONE[row.tone ?? "normal"] : MUTED);
    doc.setFont("helvetica", row.tone && row.tone !== "normal" ? "bold" : "normal");
    doc.text(valueLines, MARGIN + labelW + 4, state.y + lh);

    state.y += h;
    setColor(doc, "draw", CARD_BORDER);
    doc.setLineWidth(0.2);
    doc.line(MARGIN, state.y - 1, PAGE_W - MARGIN, state.y - 1);
  }
  state.y += 3;
}

/** A bordered panel. Returns the y it started at so a caller can draw inside it. */
export function card(state: PageState, height: number, opts?: { border?: RGB }): number {
  ensureSpace(state, height + 3);
  const top = state.y;
  setColor(state.doc, "draw", opts?.border ?? CARD_BORDER);
  state.doc.setLineWidth(0.3);
  state.doc.roundedRect(MARGIN, top, CONTENT_W, height, 1.5, 1.5, "S");
  return top;
}

/**
 * An empty ruled box for something written by hand on the call.
 *
 * Runner v3 section 13 is emphatic that the call sheet has "no placeholders, no blanks I fill
 * in live" for values we already hold — these boxes are for the values only the client can
 * give, which is a different thing: a NAP correction, a substituted term that is wrong, the
 * named person for the review tool.
 */
export function correctionBox(
  state: PageState,
  label: string,
  opts?: { lines?: number; prefill?: string | null }
): void {
  const lines = opts?.lines ?? 1;
  const h = lines * 6 + 6;
  ensureSpace(state, h + 2);
  const { doc } = state;

  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  doc.text(label, MARGIN, state.y + 3);

  if (opts?.prefill) {
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", WHITE);
    doc.text(doc.splitTextToSize(opts.prefill, CONTENT_W - 60) as string[], MARGIN + 55, state.y + 3);
  }

  setColor(doc, "draw", CARD_BORDER);
  doc.setLineWidth(0.3);
  for (let i = 0; i < lines; i++) {
    const y = state.y + 6 + i * 6;
    doc.line(MARGIN, y + 2, PAGE_W - MARGIN, y + 2);
  }
  state.y += h;
}

// ─────────────────────────────────────────────────────────────────────────────
// Images — the thing the scorecard never had
// ─────────────────────────────────────────────────────────────────────────────

export type ImageFormat = "PNG" | "JPEG";

/**
 * PNG and JPEG only, decided by MAGIC BYTES rather than by a filename or a stored content
 * type. Both of those are Slack-supplied strings; the first bytes are the file itself. jsPDF
 * throws on anything it cannot decode, and a throw here would sink a whole report over one
 * screenshot.
 */
export function sniffImageFormat(buf: Buffer): ImageFormat | null {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return "PNG";
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "JPEG";
  return null;
}

/**
 * Draws an image scaled to fit `maxW` x `maxH`, or a labelled placeholder if it cannot be
 * decoded. NEVER a broken box and never nothing: a findings doc whose screenshot silently
 * vanished reads as "there was no evidence", which is the opposite of true.
 */
export function image(
  state: PageState,
  buf: Buffer | null,
  opts: { caption?: string; maxW?: number; maxH?: number; fallbackLabel?: string }
): void {
  const maxW = opts.maxW ?? CONTENT_W;
  const maxH = opts.maxH ?? 90;
  const fmt = buf ? sniffImageFormat(buf) : null;

  if (!buf || !fmt) {
    ensureSpace(state, 22);
    setColor(state.doc, "draw", CARD_BORDER);
    state.doc.setLineWidth(0.3);
    state.doc.roundedRect(MARGIN, state.y, maxW, 16, 1.5, 1.5, "S");
    state.doc.setFontSize(8.5);
    state.doc.setFont("helvetica", "italic");
    setColor(state.doc, "text", MUTED);
    state.doc.text(
      opts.fallbackLabel ?? "Screenshot on file, not renderable in this format",
      MARGIN + 4,
      state.y + 9.5
    );
    state.y += 20;
    return;
  }

  let w = maxW;
  let h = Math.min(maxH, 70);
  try {
    const props = state.doc.getImageProperties(buf) as { width: number; height: number };
    const ratio = props.height / props.width;
    w = maxW;
    h = w * ratio;
    if (h > maxH) {
      h = maxH;
      w = h / ratio;
    }
  } catch {
    h = Math.min(maxH, 70);
  }

  ensureSpace(state, h + (opts.caption ? 7 : 3));
  try {
    state.doc.addImage(buf, fmt, MARGIN, state.y, w, h);
  } catch {
    state.doc.setFontSize(8.5);
    state.doc.setFont("helvetica", "italic");
    setColor(state.doc, "text", MUTED);
    state.doc.text("Screenshot on file, could not be embedded", MARGIN, state.y + 6);
    state.y += 10;
    return;
  }
  state.y += h + 2;

  if (opts.caption) {
    state.doc.setFontSize(8);
    state.doc.setFont("helvetica", "italic");
    setColor(state.doc, "text", MUTED);
    state.doc.text(state.doc.splitTextToSize(opts.caption, CONTENT_W) as string[], MARGIN, state.y + 3);
    state.y += 6;
  }
  state.y += 2;
}

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ‼️ FIXED VOCABULARY, EVERY ARTIFACT, NO EXCEPTIONS: named, not named, named alongside,
 * named instead. Never ranked, position, #N or top result. Runner v3 section 4 and Artifact
 * Templates section 3 both state it, because the whole product claim is about being NAMED in
 * an answer, and rank language quietly reframes it as SEO — inviting a comparison we did not
 * measure and cannot defend.
 */
export const NAMED = "named";
export const NOT_NAMED = "not named";
export const NAMED_ALONGSIDE = "named alongside";
export const NAMED_INSTEAD = "named instead";

export function namedLabel(mentioned: boolean | null): string {
  if (mentioned === null) return "not measured";
  return mentioned ? NAMED : NOT_NAMED;
}
