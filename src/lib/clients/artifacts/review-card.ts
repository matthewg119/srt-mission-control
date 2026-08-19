// The printed review card — delivery step 17, v4 section 8, SRT-Review-Tool-BUILD-SPEC-v2.
//
// A patient finishes her visit and is handed this. That evening, at home, on her own phone,
// she scans it and answers four open questions in her own words.
//
// ‼️ VISUAL THEME PER CLIENT. COPY IDENTICAL FOR EVERY CLIENT. FOREVER.
// The build spec is explicit: the review tool "takes the same theme object as the hub — logo,
// palette, fonts — so it reads as the clinic's page and not an agency page. The COPY, the four
// questions, the flow, the bullet labels, the destination links and every rule in the build
// spec are IDENTICAL for every clinic and are not themable."
//
// So the accent colour comes from clients.theme and NOTHING ELSE DOES. There is no per-client
// wording hook here and there must not be one.
//
// ‼️ THE FOUR QUESTIONS ARE IMPORTED, NEVER RETYPED. REVIEW_QUESTIONS in hub/review-assemble.ts
// is the one definition. A card whose questions have drifted from the ones the tool actually
// asks is worse than no card: she reads one thing on paper and is asked another on screen.
//
// ‼️ NO MODEL IN THIS PATH, like everything else in the review tool. Nothing here generates,
// rewrites or suggests review content. FTC 16 CFR Part 465 regulates a tool that GENERATES
// review content its user did not write. This one prints four questions on card stock.
//
// WHAT IS DELIBERATELY ABSENT, each one a rule rather than an omission: no star rating, no
// "if you loved your visit", no sentiment pre-screen, no staff names, no incentive, no gift,
// no clinic tablet. Every patient gets the same card.
//
// The QR resolves through reviews.{domain}, which is live from the moment the domain is
// attached to the Vercel project — so cards can be printed and handed out before the hub has a
// single page on it.

import QRCode from "qrcode";
import { supabaseAdmin } from "@/lib/db";
import { REVIEW_QUESTIONS } from "@/lib/hub/review-assemble";
import { readTheme, activeTheme } from "@/lib/hub/theme";
import {
  startDoc,
  finishDoc,
  newPage,
  plainFooter,
  setColor,
  drawBrandIcon,
  PAGE_W,
  MARGIN,
  CONTENT_W,
  WHITE,
  MUTED,
  REEF,
  CARD_BORDER,
  type RGB,
} from "@/lib/pdf/kit";
import { deliverArtifact } from "./deliver";

/** A theme accent arrives as "#rrggbb" or "#rgb" — safeColor already guaranteed that shape. */
function hexToRgb(hex: string | null): RGB | null {
  if (!hex) return null;
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  if (full.length !== 6) return null;
  const n = parseInt(full, 16);
  if (Number.isNaN(n)) return null;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export interface ReviewCardInput {
  clinicName: string;
  reviewsUrl: string;
  accent: RGB;
}

/**
 * ‼️ SPANISH IS NOT MACHINE-TRANSLATED HERE, AND THE GAP IS STATED RATHER THAN FILLED.
 * The build spec requires a native speaker precisely because a translated sentiment-neutral
 * question can land as a leading one, and a leading question is the single thing this tool
 * cannot afford. Until reviewed Spanish copy exists, a Spanish-language clinic gets the English
 * card and a line on the delivery note saying so. Auto-translating it would be the exact
 * failure the spec is written to prevent.
 */
export const SPANISH_PENDING_NOTE =
  "This clinic reads Spanish. The card is English because the Spanish copy has not been " +
  "reviewed by a native speaker yet, and a machine translation of a deliberately neutral " +
  "question can land as a leading one. Do not print Spanish cards until that review happens.";

export async function renderReviewCard(input: ReviewCardInput): Promise<Buffer> {
  // Error correction M with a quiet margin: this is printed small and scanned in bad light on
  // a kitchen table, not read by a scanner gun.
  const qrDataUrl = await QRCode.toDataURL(input.reviewsUrl, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 600,
    color: { dark: "#0B1426", light: "#FFFFFF" },
  });
  const qrPng = Buffer.from(qrDataUrl.split(",")[1], "base64");

  const state = startDoc({
    title: `${input.clinicName} review card`,
    footer: plainFooter("SRT · print double-sided, short edge · card stock"),
    noRunningHeader: true,
  });
  const { doc } = state;

  // ── FRONT ──
  state.y = 40;

  doc.setFontSize(20);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", WHITE);
  const nameLines = doc.splitTextToSize(input.clinicName, CONTENT_W) as string[];
  doc.text(nameLines, PAGE_W / 2, state.y, { align: "center" });
  state.y += nameLines.length * 8 + 6;

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", input.accent);
  doc.text("Four questions. Ninety seconds. Your words.", PAGE_W / 2, state.y, { align: "center" });
  state.y += 16;

  const qrSize = 62;
  const qrX = (PAGE_W - qrSize) / 2;
  // A white plate behind the code: the page is midnight, and a QR needs light quiet zones to
  // scan at all.
  setColor(doc, "fill", WHITE);
  doc.roundedRect(qrX - 4, state.y - 4, qrSize + 8, qrSize + 8, 2, 2, "F");
  doc.addImage(qrPng, "PNG", qrX, state.y, qrSize, qrSize);
  state.y += qrSize + 14;

  doc.setFontSize(12);
  doc.setFont("helvetica", "italic");
  setColor(doc, "text", WHITE);
  doc.text("Scan when you are home.", PAGE_W / 2, state.y, { align: "center" });
  state.y += 10;

  doc.setFontSize(8.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  doc.text(input.reviewsUrl, PAGE_W / 2, state.y, { align: "center" });

  // ── BACK ──
  newPage(state);
  state.y = 34;

  doc.setFontSize(14);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", input.accent);
  doc.text("Four questions", PAGE_W / 2, state.y, { align: "center" });
  state.y += 14;

  REVIEW_QUESTIONS.forEach((q, i) => {
    doc.setFontSize(11);
    doc.setFont("helvetica", "normal");
    setColor(doc, "text", WHITE);
    const lines = doc.splitTextToSize(`${i + 1}. ${q.prompt}`, CONTENT_W - 16) as string[];
    doc.text(lines, MARGIN + 8, state.y);
    state.y += lines.length * 6 + 8;
  });

  state.y += 6;
  setColor(doc, "draw", CARD_BORDER);
  doc.setLineWidth(0.4);
  doc.line(MARGIN + 20, state.y, PAGE_W - MARGIN - 20, state.y);
  state.y += 10;

  doc.setFontSize(10.5);
  doc.setFont("helvetica", "italic");
  setColor(doc, "text", WHITE);
  doc.text("Answer in your own words.", PAGE_W / 2, state.y, { align: "center" });
  state.y += 7;
  doc.text("Nothing is posted unless you post it.", PAGE_W / 2, state.y, { align: "center" });
  state.y += 16;

  drawBrandIcon(doc, PAGE_W / 2 - 3.2, state.y, 1.2);

  return finishDoc(state);
}

/**
 * Step 17. Reads the client, renders, files, posts.
 *
 * Blocked on `hub_preview` in DELIVERY_STEPS because the theme is confirmed there — a card
 * printed in the wrong accent is a re-print, and these go to a physical printer.
 */
export async function generateReviewCard(
  clientId: string
): Promise<{ ok: boolean; error?: string; docId?: string }> {
  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("id, legal_name, dba_name, domain, subdomain, language, theme")
    .eq("id", clientId)
    .maybeSingle();

  if (!client) return { ok: false, error: "client not found" };
  if (!client.domain) return { ok: false, error: "no domain on the client, so there is no QR target" };

  // The reviews host as ATTACHED, not as derived. client_hosts exists precisely so a live,
  // printed QR does not depend on a string on the board staying correct — somebody fixing a
  // typo must not silently invalidate a thousand printed cards.
  const { data: host } = await supabaseAdmin
    .from("client_hosts")
    .select("host")
    .eq("client_id", clientId)
    .eq("kind", "reviews")
    .maybeSingle();

  const derived = `reviews.${client.domain as string}`;
  const reviewsHost = (host?.host as string | null) ?? derived;

  if (!host) {
    console.warn(
      `[artifacts/review-card] no attached reviews host for ${clientId}; the QR points at ${derived}, ` +
        `which will not resolve until the domain is attached and the CNAME is added`
    );
  }

  const theme = activeTheme(readTheme(client.theme));
  const accent = hexToRgb(theme?.accent ?? null) ?? REEF;
  const clinicName = ((client.dba_name || client.legal_name) as string) ?? "Your clinic";
  const language = ((client.language as string) ?? "en") as "en" | "es" | "both";

  let buffer: Buffer;
  try {
    buffer = await renderReviewCard({
      clinicName,
      reviewsUrl: `https://${reviewsHost}`,
      accent,
    });
  } catch (e) {
    return { ok: false, error: `render failed: ${(e as Error).message}` };
  }

  const lines = [
    `:card_index: Review card for *${clinicName}*. Front and back, print double-sided on card stock.`,
    `The QR points at https://${reviewsHost}${host ? "" : " — NOT YET ATTACHED, so it will not resolve until the domain is added and the CNAME is in"}.`,
    "Same card for every patient. No stars, no staff names, nothing offered.",
  ];
  if (language !== "en") lines.push(SPANISH_PENDING_NOTE);

  const result = await deliverArtifact({
    clientId,
    stepKey: "review_card_pdf",
    filename: `Review card - ${clinicName}.pdf`,
    buffer,
    message: lines.join("\n"),
  });

  return { ok: result.ok, error: result.error, docId: result.docId };
}

// ‼️ THERE IS NO PRE-FILLED SAMPLE ANSWER ANYWHERE IN THIS FILE, and there must never be one.
// v4 5g: "NEVER ship pre-filled sample patient answers — a fabricated patient review is
// precisely what this tool exists not to produce." Demo text typed live on a call is fine;
// demo text that ships is not.
