// slides -> deck.pptx + slide-plan.md
//
// Deterministic renderer. It makes no creative decisions: chunking, emphasis and visual
// choices all live in the slide JSON that author.ts produces. Port of
// vsl-deck-builder/build_deck.py from python-pptx onto pptxgenjs (python does not run on
// Vercel), holding the same visual contract: white slide, Arial Black, purple emphasis runs,
// a gray image zone, and speaker notes carrying VISUAL/PROMPT/SEARCH.

import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";
import { type DeckSlide, type DeckRun, type DeckVisual, slideText } from "./types";

// --- style ---------------------------------------------------------------
const FONT = "Arial Black"; // swapped to Baloo 2 / Fredoka ExtraBold in Canva
const INK = "111111";
const PURPLE = "6D28F9";
const WHITE = "FFFFFF";
const PLACEHOLDER_FILL = "F2F2F2";
const PLACEHOLDER_INK = "999999";

// Neither python-pptx nor pptxgenjs can measure text, and PowerPoint's shrink-to-fit only
// runs when PowerPoint itself opens the file — Canva's importer will not do that. So size
// deterministically off character count instead of trusting autofit. Edit this one constant
// to answer "tighter slides" / "bigger slides".
const SIZE_LADDER: Array<[number, number]> = [
  [25, 80], [60, 64], [110, 52], [170, 42], [240, 34], [1e9, 28],
];
const MIN_PT = 20;

// Canonical PowerPoint 16:9 is 12192000 x 6858000 EMU. pptxgenjs multiplies inches by 914400,
// so the usual 13.333 lands 235 EMU short and produces a non-standard size importers can
// letterbox. These two numbers round to the canonical EMU exactly.
const SLIDE_W = 13.3333333;
const SLIDE_H = 7.5;
const MARGIN = 0.9;
const TEXT_W = SLIDE_W - 2 * MARGIN;

export const WORD_LIMIT = 45; // chunking rule: hard max ~45 words per slide

function sizeFor(chars: number): number {
  for (const [limit, points] of SIZE_LADDER) if (chars <= limit) return points;
  return SIZE_LADDER[SIZE_LADDER.length - 1][1];
}

function stepDown(points: number): number {
  const sizes = SIZE_LADDER.map(([, pt]) => pt);
  const i = sizes.indexOf(points);
  if (i >= 0 && i + 1 < sizes.length) return sizes[i + 1];
  return Math.max(MIN_PT, points - 8);
}

function runProps(run: DeckRun): { color: string; italic?: boolean; underline?: { style: "sng" } } {
  switch (run.e) {
    case "purple":
      return { color: PURPLE };
    case "purple-italic":
      return { color: PURPLE, italic: true };
    case "underline":
      return { color: INK, underline: { style: "sng" } };
    default:
      return { color: INK };
  }
}

type TextItem = { text: string; options: Record<string, unknown> };

/**
 * One paragraph, as pptxgenjs text items. Emphasis is always per-run — never a whole-
 * paragraph purple.
 *
 * Two pptxgenjs behaviours dictate the shape of this (see genXmlTextBody in the dist bundle):
 *   1. It re-runs genXmlParagraphProperties for EVERY run in a paragraph and appends whatever
 *      comes back, dropping only the exactly-empty result. More than one <a:pPr> inside one
 *      <a:p> is invalid OOXML and makes PowerPoint show a repair prompt. So paragraph props
 *      (align, lineSpacing, bullet, spaceBefore) ride the FIRST run and nothing else.
 *   2. Each run inherits align/lineSpacing/indent/paraSpace from the SHAPE options before that
 *      check, so any of those set shape-wide would give every run a non-empty pPr and defeat
 *      rule 1. That is why renderSlide passes none of them to addText.
 * Paragraphs are then separated explicitly with breakLine on the last run.
 */
function writeRuns(
  runs: DeckRun[],
  points: number,
  para: { align: "left" | "center"; bullet?: boolean; spaceBefore?: number }
): TextItem[] {
  const kept = runs.filter((r) => r.t);
  return kept.map((run, i) => ({
    text: run.t,
    options: {
      fontFace: FONT,
      fontSize: points,
      bold: true,
      ...runProps(run),
      ...(i === 0
        ? {
          align: para.align,
          lineSpacingMultiple: 1.05,
          ...(para.spaceBefore ? { paraSpaceBefore: para.spaceBefore } : {}),
          ...(para.bullet
            ? { bullet: { characterCode: "2022" }, indentLevel: 0 }
            : { bullet: false }),
        }
        : {}),
      breakLine: i === kept.length - 1,
    },
  }));
}

function notesFor(slide: DeckSlide): string {
  const v = slide.visual;
  const lines = v
    ? [
      `VISUAL: ${v.type} - ${v.idea ?? ""}`,
      `PROMPT: ${v.prompt ?? ""}`,
      `SEARCH: ${(v.search ?? []).join(", ")}`,
    ]
    : ["VISUAL: none"];
  if (slide.section) lines.push(`SECTION: ${slide.section}`);
  for (const note of slide.notes ?? []) lines.push(note);
  return lines.join("\n");
}

function addPlaceholder(slide: PptxGenJS.Slide, pptx: PptxGenJS, visual: DeckVisual): void {
  slide.addText(`[${visual.type.toUpperCase()}: ${visual.idea ?? ""}]`, {
    shape: pptx.ShapeType.rect,
    x: 3.0, y: 3.9, w: 7.3333, h: 3.1,
    fill: { color: PLACEHOLDER_FILL },
    line: { color: PLACEHOLDER_FILL, width: 0 },
    fontFace: "Arial",
    fontSize: 12,
    bold: false,
    color: PLACEHOLDER_INK,
    align: "center",
    valign: "middle",
    wrap: true,
  });
}

function renderSlide(pptx: PptxGenJS, spec: DeckSlide): void {
  const slide = pptx.addSlide();
  slide.background = { color: WHITE };

  const hasVisual = Boolean(spec.visual);
  const bullets = spec.bullets ?? [];
  const basePt = sizeFor(slideText(spec).length);
  const bulletPt = stepDown(basePt);
  const align: "left" | "center" = bullets.length ? "left" : "center";

  // With a visual, the text holds the top half and the lower half is the image zone.
  const top = hasVisual ? 0.6 : 0.75;
  const height = hasVisual ? 3.0 : SLIDE_H - 1.5;

  const items: TextItem[] = [...writeRuns(spec.runs ?? [], basePt, { align })];
  for (const bullet of bullets) {
    items.push(...writeRuns(bullet, bulletPt, { align: "left", bullet: true, spaceBefore: 14 }));
  }

  if (items.length) {
    // No align/lineSpacing/paraSpace here on purpose — see writeRuns.
    slide.addText(items, {
      x: MARGIN, y: top, w: TEXT_W, h: height,
      valign: "middle",
      wrap: true,
    });
  }

  if (hasVisual) addPlaceholder(slide, pptx, spec.visual!);
  slide.addNotes(notesFor(spec));
}

/**
 * Drop every <a:pPr> that is not the first child of its <a:p>.
 *
 * pptxgenjs calls genXmlParagraphProperties once per RUN and appends the result, and its
 * bullet branch ends in `else if (!textObj.options.bullet)` — which fires for a plain run with
 * no options at all, emitting `indent="0" marL="0"><a:buNone/>`. So a paragraph with three
 * runs always gets three <a:pPr>. CT_TextParagraph allows at most one, first, and PowerPoint
 * answers an out-of-sequence one with the "found a problem with content" repair prompt.
 *
 * Multi-run paragraphs are not optional here — they are how a purple word sits inside a black
 * sentence — so the strays get removed after generation. They carry nothing the surviving
 * first <a:pPr> does not already say: they are the inherited defaults, and for a bullet
 * paragraph the first one is the one holding the real marL/indent.
 */
function stripStrayParaProps(xml: string): string {
  return xml.replace(/<a:p>[\s\S]*?<\/a:p>/g, (para) => {
    let seen = false;
    return para.replace(/<a:pPr(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/a:pPr>)/g, (pPr) => {
      if (seen) return "";
      seen = true;
      return pPr;
    });
  });
}

export async function renderDeck(slides: DeckSlide[], title: string): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.defineLayout({ name: "SRT_WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "SRT_WIDE";
  pptx.title = title;
  for (const spec of slides) renderSlide(pptx, spec);

  const raw = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;

  const zip = await JSZip.loadAsync(raw);
  const targets = Object.keys(zip.files).filter((p) => /^ppt\/(slides|notesSlides)\/\w+\.xml$/.test(p));
  for (const path of targets) {
    const xml = await zip.file(path)!.async("string");
    zip.file(path, stripStrayParaProps(xml));
  }
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

// --- slide-plan.md -------------------------------------------------------

function cell(text: string): string {
  const out = text.replace(/\|/g, "\\|").replace(/\n/g, "<br>").trim();
  return out || "-";
}

export function writePlan(slides: DeckSlide[]): string {
  const rows = [
    "# Slide plan",
    "",
    `${slides.length} slides. Text below is exactly what is on screen.`,
    "",
    "| # | Section | On-screen text | Visual type | Visual idea | AI prompt | Search terms |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const slide of slides) {
    const v = slide.visual;
    const kind = v ? v.type : "none";
    const idea = v ? v.idea ?? "" : "";
    const prompt = v ? v.prompt ?? "" : "";
    const search = v ? (v.search ?? []).join(", ") : "";
    rows.push(
      `| ${String(slide.n).padStart(3, "0")} | ${cell(slide.section ?? "")} | ${cell(slideText(slide))} ` +
      `| ${cell(kind)} | ${cell(idea)} | ${cell(prompt)} | ${cell(search)} |`
    );
  }
  return rows.join("\n") + "\n";
}

// --- warnings ------------------------------------------------------------

/**
 * Slides whose text stops in the middle of a sentence.
 *
 * The chunking rule is that a slide ends where a sentence ends, and this is the one violation
 * that shows up on camera: the presenter reads a half-thought, the slide changes, and the
 * rhythm breaks. It is checked in code rather than trusted to the prompt for the reason the
 * rest of this repo checks things in code — a prose rule is not a rule. A trailing dash or
 * ellipsis is the sanctioned break for a sentence too long to fit, so those pass.
 */
function midSentenceSplits(slides: DeckSlide[]): number[] {
  const out: number[] = [];
  slides.forEach((slide, i) => {
    if (i === slides.length - 1) return;
    if (slide.bullets?.length) return;
    const text = slideText(slide).trim();
    if (!text) return;
    if (/[.!?:;…]["'”’)\]]?$/.test(text)) return;
    if (/[-–—]$/.test(text)) return;
    out.push(slide.n);
  });
  return out;
}

export function deckWarnings(slides: DeckSlide[]): string[] {
  const warnings: string[] = [];
  const long = slides
    .map((s) => [s.n, slideText(s).split(/\s+/).filter(Boolean).length] as const)
    .filter(([, w]) => w > WORD_LIMIT);
  const incomplete = slides
    .filter((s) => s.visual && !(s.visual.idea && s.visual.prompt && s.visual.search?.length))
    .map((s) => s.n);
  const empty = slides.filter((s) => !slideText(s).trim()).map((s) => s.n);

  if (long.length) {
    const detail = long.slice(0, 12).map(([n, w]) => `${n} (${w}w)`).join(", ");
    const more = long.length <= 12 ? "" : ` ... +${long.length - 12} more`;
    warnings.push(`${long.length} slide(s) over ${WORD_LIMIT} words: ${detail}${more}`);
  }
  if (incomplete.length) warnings.push(`visual missing idea/prompt/search on slide(s): ${incomplete.join(", ")}`);
  if (empty.length) warnings.push(`slide(s) with no on-screen text: ${empty.join(", ")}`);

  const split = midSentenceSplits(slides);
  if (split.length) {
    const detail = split.slice(0, 12).join(", ");
    const more = split.length <= 12 ? "" : ` ... +${split.length - 12} more`;
    warnings.push(`${split.length} slide(s) end mid-sentence: ${detail}${more}`);
  }

  const visuals = slides.filter((s) => s.visual).length;
  if (slides.length >= 12 && visuals * 8 < slides.length) {
    warnings.push(`only ${visuals} of ${slides.length} slides have a visual (aim for about 1 in 4)`);
  }
  return warnings;
}
