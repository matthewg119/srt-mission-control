// The signed agreement, rendered. SNAPSHOT IN, BYTES OUT.
//
// ‼️ THIS FILE MUST NEVER IMPORT src/config/onboarding2-agreement.ts, AND THAT IS THE ENTIRE
// POINT OF IT. Its only inputs are a stored snapshot and the typed fields off the same row.
// Editing the live template next month changes AGREEMENT_SECTIONS; it cannot change one byte of
// what comes out of here for a row written today. Two things enforce it, because a comment is
// not a guard:
//
//   grep -n "onboarding2-agreement" src/lib/onboarding2/agreement-pdf.ts      must print nothing
//   npx tsx scripts/_probe-onboarding2-pdf.ts                                 must pass
//
// The probe renders a snapshot whose section 3 body is a sentinel string, extracts the text back
// out with unpdf, and asserts the sentinel IS present and the live constant's section 3 text is
// NOT. That single test is the requirement, executable.
//
// ‼️ THE BYTES ARE NOT REPRODUCIBLE AND NOTHING MAY DEPEND ON THEM BEING SO. jsPDF writes a
// CreationDate into every file, so rendering the same snapshot twice gives two different hashes.
// pdf_sha256 on the row describes ONE rendering and exists only to prove the emailed attachment
// is the stored file. The reproducible hash is agreement_sha256, over the TEXT.

import {
  CONTENT_W,
  MARGIN,
  MUTED,
  PAGE_W,
  REEF,
  ensureSpace,
  finishDoc,
  keyValueTable,
  paragraph,
  plainFooter,
  sectionHeading,
  setColor,
  startDoc,
  type PageState,
} from "@/lib/pdf/kit";
import type { AgreementSnapshot } from "./snapshot";
import type { InitialRecord, Onboarding2SigningRow } from "./types";

export interface SignedRecord {
  signatureTyped: string;
  printName: string;
  signerTitle: string | null;
  businessLegalName: string;
  address: string;
  contactEmail: string;
  contactPhoneTyped: string | null;
  signedDate: string | null;
  signedAt: string | null;
  initials: InitialRecord[];
  documentSha256: string;
  templateVersion: string;
  canon: string;
  ipHash: string | null;
  userAgent: string | null;
  signingId: string;
}

/** The eight signature fields, joined the way a contract prints an address. */
export function addressLine(row: {
  address_line1: string | null;
  address_city: string | null;
  address_state: string | null;
  address_postal: string | null;
}): string {
  const tail = [row.address_city, row.address_state].filter(Boolean).join(", ");
  return [row.address_line1, tail, row.address_postal].filter(Boolean).join(", ");
}

/** Pull the render input straight off a signed row. No other caller shape is supported. */
export function signedRecordFrom(row: Onboarding2SigningRow): SignedRecord {
  return {
    signatureTyped: row.signature_typed ?? "",
    printName: row.print_name ?? "",
    signerTitle: row.signer_title,
    businessLegalName: row.business_legal_name ?? "",
    address: addressLine(row),
    contactEmail: row.contact_email ?? "",
    contactPhoneTyped: row.contact_phone_typed ?? row.contact_phone,
    signedDate: row.signed_date,
    signedAt: row.signed_at,
    initials: row.initials_snapshot ?? [],
    documentSha256: row.agreement_sha256,
    templateVersion: row.template_version,
    canon: row.agreement_snapshot?.canon ?? "unknown",
    ipHash: row.signed_ip_hash,
    userAgent: row.signed_user_agent,
    signingId: row.id,
  };
}

/** A right-aligned "Initialled: MG, 1 Sep 2026, 14:03" under a section. */
function initialLine(state: PageState, rec: InitialRecord | undefined): void {
  if (!rec) return;
  ensureSpace(state, 8);
  const { doc } = state;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  setColor(doc, "text", REEF);
  doc.text(`Initialled: ${rec.initials}   ${rec.at}`, PAGE_W - MARGIN, state.y + 3, {
    align: "right",
  });
  state.y += 7;
}

/** Bullets, drawn here rather than through kit's bulletList so each can wrap to CONTENT_W. */
function bullets(state: PageState, items: string[]): void {
  for (const item of items) {
    const { doc } = state;
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "normal");
    const lines = doc.splitTextToSize(item, CONTENT_W - 6) as string[];
    lines.forEach((line, i) => {
      ensureSpace(state, 5.5);
      doc.setFontSize(9.5);
      doc.setFont("helvetica", "normal");
      setColor(doc, "text", [255, 255, 255]);
      if (i === 0) {
        setColor(doc, "text", REEF);
        doc.text("-", MARGIN, state.y + 4.5);
        setColor(doc, "text", [255, 255, 255]);
      }
      doc.text(line, MARGIN + 5, state.y + 4.5);
      state.y += 4.6;
    });
    state.y += 1.6;
  }
  state.y += 2;
}

/** A ruled line to sign on, with its caption underneath. Blank mode only. */
function signatureRule(state: PageState, caption: string, width: number): void {
  ensureSpace(state, 14);
  const { doc } = state;
  state.y += 6;
  setColor(doc, "draw", MUTED);
  doc.setLineWidth(0.2);
  doc.line(MARGIN, state.y, MARGIN + width, state.y);
  doc.setFontSize(8);
  doc.setFont("helvetica", "normal");
  setColor(doc, "text", MUTED);
  doc.text(caption, MARGIN, state.y + 4);
  state.y += 8;
}

export interface RenderAgreementOptions {
  /**
   * An UNSIGNED counterpart, for wet signature on a call.
   *
   * ‼️ IT DROPS THE "SIGNATURE RECORD" TABLE, AND THAT IS THE POINT. Signing id, SHA-256, server
   * timestamp, hashed IP and user agent all describe an e-signature ceremony that has not
   * happened. Printing them empty on a blank counterpart would produce a document whose
   * provenance block asserts nothing while looking exactly like one that asserts something.
   * The eight signature fields become ruled lines instead of a filled table.
   *
   * The agreement TEXT is identical either way, and the footer still carries the document hash,
   * so a blank counterpart is still traceable to the template version it was struck from.
   */
  blank?: boolean;
}

/**
 * Render one agreement, signed or blank.
 *
 * The footer carries the document hash on EVERY page, which is what makes a single photocopied
 * page traceable back to a record rather than to a template.
 */
export function renderAgreementPdf(
  snapshot: AgreementSnapshot,
  signature: SignedRecord,
  opts?: RenderAgreementOptions
): Buffer {
  const blank = opts?.blank === true;
  const state = startDoc({
    title: snapshot.title,
    footer: plainFooter(
      `${snapshot.title}  |  ${signature.templateVersion}  |  ${signature.documentSha256.slice(0, 16)}`
    ),
  });

  // ── Cover ──
  state.doc.setFontSize(18);
  state.doc.setFont("helvetica", "bold");
  setColor(state.doc, "text", [255, 255, 255]);
  const titleLines = state.doc.splitTextToSize(snapshot.title, CONTENT_W) as string[];
  state.doc.text(titleLines, MARGIN, state.y + 8);
  state.y += titleLines.length * 8 + 6;

  for (const line of snapshot.preamble) {
    paragraph(state, line, { size: 9, color: MUTED, gap: 1 });
  }
  state.y += 4;

  paragraph(state, snapshot.promise, { size: 12, bold: true, color: REEF, gap: 8 });

  // ── The sections ──
  //
  // On a blank counterpart the map is empty, so initialLine() returns early and no section
  // carries an initial. Nothing else changes.
  const byNumber = new Map(signature.initials.map((r) => [r.n, r]));
  for (const s of snapshot.sections) {
    sectionHeading(state, s.heading, { number: s.n });
    for (const p of s.body) paragraph(state, p);
    if (s.bullets?.length) bullets(state, s.bullets);
    for (const p of s.after ?? []) paragraph(state, p);
    initialLine(state, byNumber.get(s.n));
    state.y += 3;
  }

  // ── Closing and the signature block ──
  state.y += 4;
  sectionHeading(state, "Signatures");
  for (const p of snapshot.closing) paragraph(state, p);
  state.y += 2;

  if (blank) {
    signatureRule(state, "Client signature", CONTENT_W * 0.6);
    signatureRule(state, "Print name", CONTENT_W * 0.6);
    signatureRule(state, "Title", CONTENT_W * 0.45);
    signatureRule(state, "Business legal name", CONTENT_W * 0.75);
    signatureRule(state, "Business address", CONTENT_W);
    signatureRule(state, "Best contact email", CONTENT_W * 0.6);
    signatureRule(state, "Best contact phone", CONTENT_W * 0.45);
    signatureRule(state, "Date", CONTENT_W * 0.35);
  } else {
    keyValueTable(state, [
      { label: "Client signature", value: signature.signatureTyped, tone: "good" },
      { label: "Print name", value: signature.printName },
      { label: "Title", value: signature.signerTitle ?? "" },
      { label: "Business legal name", value: signature.businessLegalName },
      { label: "Business address", value: signature.address },
      { label: "Best contact email", value: signature.contactEmail },
      { label: "Best contact phone", value: signature.contactPhoneTyped ?? "" },
      { label: "Date", value: signature.signedDate ?? "" },
    ]);
  }

  // ── The record about the record ──
  //
  // Printed inside the document rather than kept only in the database, so a PDF handed to a
  // lawyer carries its own provenance and does not need us to be reachable to be checkable.
  //
  // ‼️ SUPPRESSED ON A BLANK COUNTERPART. See RenderAgreementOptions.blank.
  if (!blank) {
    state.y += 4;
    sectionHeading(state, "Signature record");
    keyValueTable(state, [
      { label: "Signing id", value: signature.signingId },
      { label: "Template version", value: signature.templateVersion },
      { label: "Canonical form", value: signature.canon },
      { label: "Agreement SHA-256", value: signature.documentSha256 },
      { label: "Signed at (server)", value: signature.signedAt ?? "" },
      { label: "Signer IP (hashed)", value: signature.ipHash ?? "" },
      { label: "Signer user agent", value: signature.userAgent ?? "" },
    ]);
  }

  state.y += 4;
  paragraph(
    state,
    blank
      ? `Unsigned counterpart. Template ${signature.templateVersion}, text SHA-256 ${signature.documentSha256}. This copy carries no signature record because it has not been signed. Signing it on paper does not create one.`
      : "The agreement text above is reproduced from the record stored when this document was signed, not from any later version of the template. The SHA-256 is taken over that stored text.",
    { size: 8, color: MUTED }
  );

  for (const line of snapshot.footer) paragraph(state, line, { size: 8, color: MUTED, gap: 1 });

  return finishDoc(state);
}
