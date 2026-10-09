// The lead's printable card. Its own jsPDF, because the house kit cannot make a light page.
//
// ‼️ WHY THIS IS NOT renderReviewCard(). That one is the DELIVERY BOARD's card, step 17, and
// every page src/lib/pdf/kit.ts produces is MIDNIGHT: its header says so and the onboarding sheet
// already had to build its own instance for the same reason. The card a lead approves on
// /cards/p is the blush one, pale pink on card stock, and shipping them a black card after they
// looked at a pink one is the exact failure review-card-copy.ts was extracted to prevent, just
// moved from the words to the ink.
//
// ‼️ SO TWO RENDERERS, AND ONLY THE LOOK DIFFERS. Both read REVIEW_CARD_COPY / CARD_COPY_SETS for
// the front and CARD_QUESTIONS for the back, so the words and the question count cannot drift
// between them; that was always the risk worth fencing. What differs is the ground, which is the
// thing each audience actually approved.
//
// ‼️ NO MODEL, NO DATABASE, NO NETWORK. A name, a URL and a copy set in; bytes out.

import { jsPDF } from "jspdf";
import QRCode from "qrcode";

import { CARD_QUESTIONS, fillBusiness } from "@/lib/hub/review-script";
import { CARD_QUESTION_COUNT } from "@/lib/hub/review-card-copy";
import type { CardCopySet } from "@/config/card-preview";
import type { CardDesign } from "@/config/card-designs";

const PAGE_W = 210;
const PAGE_H = 297;

/** "#rrggbb" to the triple jsPDF wants. The design's own values, never a request's. */
function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface LeadCardInput {
  clinicName: string;
  /** What the code resolves to. Printed under it too, so a phone with no camera can type it. */
  scanUrl: string;
  copy: CardCopySet;
  design: CardDesign;
}

export async function renderLeadCard(input: LeadCardInput): Promise<Buffer> {
  const { design } = input;
  // Error correction M with a quiet margin: printed small and scanned in bad light on a kitchen
  // table, not read by a scanner gun. Identical settings to the preview and to review-card.ts, so
  // the code on screen and the code in their hand are the same object.
  const qrDataUrl = await QRCode.toDataURL(input.scanUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 600,
    color: { dark: "#0a0a0a", light: "#FFFFFF" },
  });
  const qrPng = Buffer.from(qrDataUrl.split(",")[1], "base64");

  const doc = new jsPDF({ orientation: "portrait", compress: true });
  doc.setProperties({ title: `${input.clinicName} referral card` });

  const ground = rgb(design.ground);
  const ink = rgb(design.ink);
  const accent = rgb(design.accent);
  const muted = rgb(design.muted);

  /** The clinic's ground, edge to edge. Done first on every page or the page is white. */
  const paintGround = () => {
    doc.setFillColor(ground[0], ground[1], ground[2]);
    doc.rect(0, 0, PAGE_W, PAGE_H, "F");
  };

  // ── FRONT ──
  paintGround();
  let y = 70;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(26);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  const nameLines = doc.splitTextToSize(input.clinicName, PAGE_W - 40) as string[];
  doc.text(nameLines, PAGE_W / 2, y, { align: "center" });
  y += nameLines.length * 10 + 8;

  doc.setFontSize(16);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  const promiseLines = doc.splitTextToSize(input.copy.promise, PAGE_W - 44) as string[];
  doc.text(promiseLines, PAGE_W / 2, y, { align: "center" });
  y += promiseLines.length * 7 + 14;

  // ‼️ A WHITE PLATE EVEN ON A PALE GROUND. A QR needs a light quiet zone to scan, and "pale
  // pink is nearly white" is the kind of nearly that fails on a cheap phone in a dim room.
  const qrSize = 72;
  const qrX = (PAGE_W - qrSize) / 2;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(qrX - 5, y - 5, qrSize + 10, qrSize + 10, 3, 3, "F");
  doc.addImage(qrPng, "PNG", qrX, y, qrSize, qrSize);
  y += qrSize + 16;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(13);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text(input.copy.scanLine, PAGE_W / 2, y, { align: "center" });
  y += 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(muted[0], muted[1], muted[2]);
  doc.text(input.scanUrl.replace(/^https?:\/\//, ""), PAGE_W / 2, y, { align: "center" });

  // ── BACK ──
  //
  // ‼️ THE QUESTIONS ARE THE WALK'S AND ARE DERIVED, NEVER RETYPED. A card whose questions have
  // drifted from the ones the page asks is worse than no card: she reads one thing on paper and
  // is asked another on screen, and card stock cannot be redeployed.
  doc.addPage();
  paintGround();
  y = 46;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.setTextColor(accent[0], accent[1], accent[2]);
  doc.text(`${CARD_QUESTION_COUNT} questions`, PAGE_W / 2, y, { align: "center" });
  y += 16;

  for (const [i, prompt] of CARD_QUESTIONS.entries()) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11.5);
    doc.setTextColor(ink[0], ink[1], ink[2]);
    // fillBusiness is the same substitution the screen does, so the card cannot say it differently.
    const line = `${i + 1}. ${fillBusiness(prompt, input.clinicName)}`;
    const lines = doc.splitTextToSize(line, PAGE_W - 50) as string[];
    doc.text(lines, 28, y);
    y += lines.length * 6 + 8;
  }

  y += 6;
  doc.setDrawColor(accent[0], accent[1], accent[2]);
  doc.setLineWidth(0.4);
  doc.line(50, y, PAGE_W - 50, y);
  y += 12;

  doc.setFont("helvetica", "italic");
  doc.setFontSize(11);
  doc.setTextColor(ink[0], ink[1], ink[2]);
  doc.text("Answer in your own words.", PAGE_W / 2, y, { align: "center" });
  y += 7;
  doc.text("Nothing is posted unless you post it.", PAGE_W / 2, y, { align: "center" });

  // The print instruction, on both pages, small and in the muted tone.
  for (const page of [1, 2]) {
    doc.setPage(page);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(muted[0], muted[1], muted[2]);
    doc.text("Print double sided, short edge, on card stock.", PAGE_W / 2, PAGE_H - 14, {
      align: "center",
    });
  }

  return Buffer.from(doc.output("arraybuffer"));
}
