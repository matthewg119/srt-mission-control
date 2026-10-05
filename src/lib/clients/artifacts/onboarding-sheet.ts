// The onboarding sheet: the one page Matthew works through on the setup call.
//
// Matthew, 2026-10-05: "i need one onboarding pdf for the clients I get with the things i need to
// collect them live, as simple as possible i know we do a few things in the onboardings but i need
// one that i can trust". So the test for anything on this page is: would he read it out loud on a
// ten minute call, and does the answer change what we build or print.
//
// ‼️ IT DOES NOT USE src/lib/pdf/kit.ts, AND THAT IS THE ONE STRUCTURAL DECISION HERE.
// Every page the kit draws is filled MIDNIGHT (fillPageBackground), its text defaults to WHITE
// and its rules are CARD_BORDER, which is a dark grey. That is right for a findings doc somebody
// reads on a screen and wrong for the only document we produce that is MEANT TO BE WRITTEN ON: a
// black page cannot take a pen, and printing one costs a cartridge per clinic. Threading a light
// palette through the kit would mean touching every call site of paragraph(), correctionBox() and
// sectionHeading() for one document, so this builds its own jsPDF instead. The kit's own header
// already blesses that route: "The audit scorecard is deliberately NOT routed through here."
//
// ‼️ SERVICES AND OFFERS ARE ONE GRID, NOT TWO SECTIONS. Matthew's field list has "full list of
// services with prices" under Services and "welcome offer for a new patient, per service" plus
// "services to exclude from referral offers" under Offers. On a call those are the same pass down
// the same list, and asking for the list twice is how a ten minute call becomes twenty. One row
// per service with four columns answers all three.
//
// ‼️ THE GOOGLE REVIEW LINK IS DELIBERATELY ABSENT. We pull it off their Maps listing ourselves.
// Asking a clinic to find and paste their own review URL is how a patient ends up pointed at
// somebody else's profile, which is the rule destinationsFor() in referral-engine.tsx is built
// around and the reason the onboarding2 funnel asks for a PLATFORM and never a link.
//
// ‼️ AND THE COMPLIANCE SECTION IS NOT LABELLED "HIPAA" ANYWHERE. Matthew's own read, which is
// right: the real artifact is a Business Associate Agreement, and it is a legitimate reason for
// the call. Calling an offer-setup form a HIPAA step is a pressure tactic an owner works out
// later. The card itself needs no BAA, because she uses her own phone and her answers are not
// tied to a name. The AUTOMATED texts do, the moment a clinic hands us patient numbers. The
// section says exactly that and claims nothing else.

import { jsPDF } from "jspdf";

import { supabaseAdmin } from "@/lib/db";

// ── A light page, and its own small palette ─────────────────────────────────
const PAGE_W = 210;
const PAGE_H = 297;
const MARGIN = 14;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 10;

type RGB = [number, number, number];
/** Ink, not a theme. A sheet that gets written on is black on white and nothing else. */
const INK: RGB = [17, 17, 17];
const SOFT: RGB = [110, 110, 112];
const RULE: RGB = [196, 196, 200];
/** The one colour, used for section numbers and the brand line only. */
const BRAND: RGB = [0, 112, 95];

/** How many blank service rows a sheet carries when we do not know the list yet. */
const BLANK_SERVICE_ROWS = 9;
/**
 * How many blank provider lines. Two per line.
 *
 * ‼️ CUT FROM THREE ROWS TO ONE ON 2026-10-05. Matthew looked at the printed sheet and said
 * section 3 "looks like a lot", and he was right: six empty ruled lines for a question most
 * clinics answer with two names read as a form that expected more than they had. One row holds
 * the common case and the section stops taking a third of the page.
 */
const BLANK_PROVIDER_ROWS = 1;

interface Cursor {
  doc: jsPDF;
  y: number;
  page: number;
  clinic: string;
}

function setColor(doc: jsPDF, kind: "fill" | "text" | "draw", c: RGB): void {
  if (kind === "fill") doc.setFillColor(c[0], c[1], c[2]);
  else if (kind === "text") doc.setTextColor(c[0], c[1], c[2]);
  else doc.setDrawColor(c[0], c[1], c[2]);
}

function footer(cur: Cursor): void {
  const { doc } = cur;
  doc.setFontSize(7.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", SOFT);
  doc.text("SRT - AI Referral Engine setup", MARGIN, FOOTER_Y);
  doc.text(`Page ${cur.page}`, PAGE_W - MARGIN, FOOTER_Y, { align: "right" });
}

function newPage(cur: Cursor): void {
  if (cur.page > 0) {
    footer(cur);
    cur.doc.addPage();
  }
  cur.page += 1;
  cur.y = MARGIN;
  if (cur.page > 1) {
    cur.doc.setFontSize(8);
    cur.doc.setFont("helvetica", "bold");
    setColor(cur.doc, "text", SOFT);
    cur.doc.text(`${cur.clinic} - setup`, MARGIN, cur.y + 3);
    cur.y += 8;
  }
}

function room(cur: Cursor, needed: number): void {
  if (cur.y + needed > FOOTER_Y - 6) newPage(cur);
}

function section(cur: Cursor, n: number, title: string, why?: string): void {
  room(cur, 20);
  const { doc } = cur;
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", BRAND);
  doc.text(`${n}. ${title}`, MARGIN, cur.y + 4);
  cur.y += 7;
  if (why) {
    doc.setFontSize(8);
    doc.setFont("helvetica", "italic");
    setColor(doc, "text", SOFT);
    const lines = doc.splitTextToSize(why, CONTENT_W) as string[];
    doc.text(lines, MARGIN, cur.y + 2);
    cur.y += lines.length * 3.6 + 1.5;
  }
  setColor(doc, "draw", RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, cur.y, PAGE_W - MARGIN, cur.y);
  cur.y += 5;
}

/** A labelled writing line. The label sits above, so the whole width is writable. */
function field(cur: Cursor, label: string, opts?: { prefill?: string | null; width?: number }): void {
  const w = opts?.width ?? CONTENT_W;
  room(cur, 12);
  const { doc } = cur;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", SOFT);
  doc.text(label, MARGIN, cur.y + 3);
  if (opts?.prefill) {
    doc.setFontSize(9.5);
    setColor(doc, "text", INK);
    doc.text(doc.splitTextToSize(opts.prefill, w) as string[], MARGIN, cur.y + 9);
  }
  setColor(doc, "draw", RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, cur.y + 10.5, MARGIN + w, cur.y + 10.5);
  cur.y += 14;
}

/** Two fields side by side, for the short answers that would waste a line each. */
function fieldPair(cur: Cursor, a: string, b: string): void {
  const w = (CONTENT_W - 6) / 2;
  const startY = cur.y;
  field(cur, a, { width: w });
  const afterY = cur.y;
  cur.y = startY;
  const { doc } = cur;
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", SOFT);
  doc.text(b, MARGIN + w + 6, cur.y + 3);
  setColor(doc, "draw", RULE);
  doc.line(MARGIN + w + 6, cur.y + 10.5, PAGE_W - MARGIN, cur.y + 10.5);
  cur.y = afterY;
}

/** A tick box and a line of text beside it. For the things that are done or not done. */
function checkbox(cur: Cursor, text: string): void {
  room(cur, 8);
  const { doc } = cur;
  setColor(doc, "draw", INK);
  doc.setLineWidth(0.35);
  doc.rect(MARGIN, cur.y, 3.6, 3.6);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", INK);
  const lines = doc.splitTextToSize(text, CONTENT_W - 7) as string[];
  doc.text(lines, MARGIN + 6, cur.y + 3);
  cur.y += Math.max(6.5, lines.length * 4.2 + 2.5);
}

/**
 * The services grid. One row answers three of Matthew's questions at once.
 *
 * ‼️ "NO OFFER" IS A COLUMN AND NOT AN OMISSION. A clinic has services it will not discount, and
 * a blank offer cell is ambiguous between "they will not" and "we did not get to it". A tick box
 * makes the refusal a recorded answer, which is what client_service_offers.excluded stores.
 */
function servicesGrid(cur: Cursor, services: string[]): void {
  const cols = [
    { label: "Service", w: 52 },
    { label: "Their price", w: 30 },
    { label: "What a referred friend gets", w: 82 },
    { label: "No offer", w: 18 },
  ];
  room(cur, 24);
  const { doc } = cur;

  doc.setFontSize(7.5);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", SOFT);
  let x = MARGIN;
  for (const c of cols) {
    doc.text(c.label.toUpperCase(), x, cur.y + 3);
    x += c.w;
  }
  cur.y += 5;
  setColor(doc, "draw", RULE);
  doc.setLineWidth(0.3);
  doc.line(MARGIN, cur.y, PAGE_W - MARGIN, cur.y);
  cur.y += 1;

  const rows = Math.max(services.length, BLANK_SERVICE_ROWS);
  for (let i = 0; i < rows; i += 1) {
    room(cur, 10);
    const rowY = cur.y;
    const name = services[i];
    if (name) {
      doc.setFontSize(9);
      doc.setFont("helvetica", "normal");
      setColor(doc, "text", INK);
      doc.text(doc.splitTextToSize(name, cols[0].w - 3) as string[], MARGIN, rowY + 5.5);
    }
    // The tick box lives in the last column, so a refusal is a mark and not a blank.
    setColor(doc, "draw", INK);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN + cols[0].w + cols[1].w + cols[2].w + 4, rowY + 2.6, 3.4, 3.4);

    setColor(doc, "draw", RULE);
    doc.line(MARGIN, rowY + 7.5, PAGE_W - MARGIN, rowY + 7.5);
    cur.y = rowY + 8.5;
  }
}

export interface OnboardingSheetInput {
  clinicName: string;
  /** Pre-filled from intake when we have it. Blank rows otherwise. */
  services: string[];
  /** Whatever is already on file, so the call does not ask for it twice. */
  bookingSoftware: string | null;
  reviewPlatform: string | null;
}

export function renderOnboardingSheet(input: OnboardingSheetInput): Buffer {
  const doc = new jsPDF({ orientation: "portrait", compress: true });
  const cur: Cursor = { doc, y: 0, page: 0, clinic: input.clinicName };
  newPage(cur);

  // ── Masthead ──
  doc.setFontSize(8);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", BRAND);
  doc.text("SRT - AI REFERRAL ENGINE", MARGIN, cur.y + 3);
  cur.y += 7;

  doc.setFontSize(17);
  doc.setFont("helvetica", "bold");
  setColor(doc, "text", INK);
  doc.text("Setup sheet", MARGIN, cur.y + 4);
  cur.y += 9;

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", SOFT);
  doc.text(
    doc.splitTextToSize(
      "Everything we need before your cards are printed. About ten minutes. " +
        "Anything already on file is filled in below.",
      CONTENT_W
    ) as string[],
    MARGIN,
    cur.y + 3
  );
  cur.y += 11;

  fieldPair(cur, "Clinic", "Date");
  // Written in rather than left blank: it is the one fact we always have, and a sheet that asks
  // the clinic its own name reads as a form nobody prepared.
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", INK);
  doc.text(input.clinicName, MARGIN, cur.y - 5.5);
  fieldPair(cur, "Who is on the call", "Their role");

  // ── 1. Checkout ──
  section(
    cur,
    1,
    "Checkout",
    "Decides when the front desk hands the card over, and how many people we train."
  );
  fieldPair(cur, "Do you charge before or after the appointment?", "How many people work the front desk?");

  // ── 2. Services and the referral offer ──
  section(
    cur,
    2,
    "Services, and what a referred friend gets",
    "One row each. The price is what you charge; the offer is what their friend gets for coming in. " +
      "Tick the last column for anything you do not want discounted."
  );
  servicesGrid(cur, input.services);
  cur.y += 1;
  field(cur, "If a service is not listed above, what should their friend get by default?");

  // ── 3. Providers ──
  section(
    cur,
    3,
    "Who works on patients",
    'The tool asks "who took care of you today?", so these are the names patients will type. ' +
      "Add more on the back if you need to."
  );
  for (let i = 0; i < BLANK_PROVIDER_ROWS; i += 1) {
    fieldPair(cur, i === 0 ? "Provider" : "", i === 0 ? "Provider" : "");
  }

  // ‼️ NO EXPLICIT PAGE BREAK HERE, AND THERE WAS ONE. room() had usually already broken
  // the page inside the provider rows above, so the unconditional newPage() that used to sit here
  // produced a COMPLETELY BLANK page 2 with nothing on it but a running header and a footer.
  // Flow is the only thing that decides where a page ends; sections ask room() for what they need.

  // ── 4. Links and feedback ──
  section(cur, 4, "Links and feedback");
  field(cur, "Booking link, where a referred friend claims their offer", {
    prefill: input.bookingSoftware ? `Booking system on file: ${input.bookingSoftware}` : null,
  });
  field(cur, "Who should receive private feedback a patient does not want posted?");
  field(cur, "Which number should a patient's referral text come from?");
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  setColor(doc, "text", SOFT);
  doc.text(
    doc.splitTextToSize(
      "We pull your Google review link from your Maps listing ourselves, so it is not on this sheet. " +
        (input.reviewPlatform
          ? `Reviews are set to go to ${input.reviewPlatform}.`
          : "We will confirm on the call where you want reviews to go."),
      CONTENT_W
    ) as string[],
    MARGIN,
    cur.y + 2
  );
  cur.y += 10;

  // ── 5. Before the automated texts ──
  //
  // ‼️ THE HEADING IS WHAT IT IS FOR, NOT WHAT IT IS CALLED. "Compliance" or "HIPAA" on this
  // section would be a label doing persuasion. This names the thing it gates.
  section(
    cur,
    5,
    "Before we switch on automated texts",
    "The QR card needs none of this: a patient uses her own phone and her answers are not tied to " +
      "her name. This is for the point where you hand us patient phone numbers."
  );
  checkbox(cur, "Business Associate Agreement signed");
  checkbox(cur, "Your patient intake forms already cover texting patients");
  field(cur, "Who is your privacy contact?");
  field(cur, "Which system will patient phone numbers come from?");

  // ── 6. Sign-off ──
  section(cur, 6, "Sign-off", "Cards get printed from this. A reprint costs a week.");
  checkbox(cur, "Owner has approved the card design");
  checkbox(cur, "Owner has approved the offers in section 2");
  checkbox(cur, "We recommend leaving the questions the tool asks exactly as they are");
  cur.y += 2;
  fieldPair(cur, "Signed", "Date");

  footer(cur);
  return Buffer.from(doc.output("arraybuffer"));
}

/**
 * Build the sheet for one client, pre-filled with whatever is already on file.
 *
 * ‼️ A FAILED READ STILL PRODUCES A SHEET. The point of the document is the blank lines; a
 * missing intake row means fewer prefills, not no sheet. Returning nothing because a select
 * failed would be the one outcome that makes the call impossible to run.
 */
export async function generateOnboardingSheet(clientId: string): Promise<Buffer> {
  let clinicName = "Clinic";
  let services: string[] = [];
  let bookingSoftware: string | null = null;
  let reviewPlatform: string | null = null;

  try {
    const { data } = await supabaseAdmin
      .from("clients")
      .select("dba_name, legal_name, services, booking_software, review_destination_primary")
      .eq("id", clientId)
      .maybeSingle();

    const row = (data ?? {}) as Record<string, unknown>;
    clinicName =
      (typeof row.dba_name === "string" && row.dba_name.trim()) ||
      (typeof row.legal_name === "string" && row.legal_name.trim()) ||
      clinicName;
    bookingSoftware =
      typeof row.booking_software === "string" && row.booking_software.trim()
        ? row.booking_software.trim()
        : null;
    reviewPlatform =
      typeof row.review_destination_primary === "string" && row.review_destination_primary.trim()
        ? row.review_destination_primary.trim()
        : null;
    services = readServices(row.services);
  } catch (e) {
    console.error("[artifacts/onboarding-sheet] prefill read failed:", (e as Error).message);
  }

  return renderOnboardingSheet({ clinicName, services, bookingSoftware, reviewPlatform });
}

/**
 * Pull service names out of intake step 2's bag.
 *
 * ‼️ THE BAG IS FREE TEXT AND THIS IS DEFENSIVE ON PURPOSE. `clients.services` is a jsonb intake
 * payload filled in by a human, so it has been seen as an array of strings, an array of objects
 * and one newline-separated blob. A prefill that throws would cost the sheet; a prefill that
 * guesses wrong costs one crossed-out line on a page that is already meant to be written on.
 */
function readServices(raw: unknown): string[] {
  const out: string[] = [];
  const push = (value: unknown): void => {
    if (typeof value !== "string") return;
    for (const part of value.split(/[\n,]/)) {
      const name = part.trim();
      if (name && out.length < 14) out.push(name);
    }
  };

  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (typeof entry === "string") push(entry);
      else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        push(o.name ?? o.service ?? o.label ?? o.title);
      }
    }
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (Array.isArray(o.list)) return readServices(o.list);
    if (Array.isArray(o.services)) return readServices(o.services);
    push(o.services);
  } else {
    push(raw);
  }
  return out;
}
