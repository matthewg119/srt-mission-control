// Fill the Black Tie Funding application by overlaying text onto the blank template
// (jsPDF can't write onto an existing PDF; pdf-lib can). Faithful TS port of the project's
// reportlab+pypdf overlay: y = PAGE_H - (top + box_h/2 + font_size/3), baseline from bottom-left.
//
// Coordinates are calibrated against the bundled template (612x792, y from TOP). Partner_* are
// only drawn when partner data is present; signature box = typed owner name; date = today.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import coords from "./btf_field_coordinates.json";
import { BTF_TEMPLATE_BASE64 } from "./template";

export interface BtfValues {
  legal_business_name?: string;
  dba?: string;
  industry?: string;
  tax_id_ein?: string;
  date_of_incorporation?: string;
  entity_type?: string;
  length_of_ownership?: string;
  business_street?: string;
  business_city?: string;
  business_state?: string;
  business_zip?: string;
  requested_amount?: string;
  use_of_funds?: string;
  estimated_credit_score?: string;
  owner_name?: string;
  owner_ssn?: string;
  owner_birthday?: string;
  owner_ownership_pct?: string;
  owner_street?: string;
  owner_city?: string;
  owner_state?: string;
  owner_zip?: string;
  owner_cell_phone?: string;
  owner_email?: string;
  partner_name?: string;
  partner_ssn?: string;
  partner_birthday?: string;
  partner_ownership_pct?: string;
  partner_street?: string;
  partner_city?: string;
  partner_state?: string;
  partner_zip?: string;
  partner_cell_phone?: string;
  partner_email?: string;
  owner_signature?: string;
  owner_signature_date?: string;
  partner_signature?: string;
  partner_signature_date?: string;
}

type FieldSpec = { box: number[]; font_size: number };
const FIELDS = coords.fields as Record<string, FieldSpec>;

/**
 * Produce a flattened, filled BTF application PDF (Buffer) from the values map.
 * Text that would overflow its box width is auto-shrunk a couple of points before drawing.
 */
export async function fillBtfApplication(values: BtfValues): Promise<Buffer> {
  const templateBytes = Buffer.from(BTF_TEMPLATE_BASE64, "base64");
  const doc = await PDFDocument.load(templateBytes);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.getPages()[0];
  const pageHeight = page.getHeight(); // 792

  for (const [key, raw] of Object.entries(values)) {
    const text = (raw ?? "").toString().trim();
    if (!text) continue;
    const spec = FIELDS[key];
    if (!spec) continue;
    const [x0, top, x1, bottom] = spec.box;
    let size = spec.font_size;
    const maxWidth = x1 - x0 - 6;
    // Shrink to fit the box width (down to 6pt) before drawing.
    while (size > 6 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 0.5;
    const boxH = bottom - top;
    const yFromTop = top + boxH / 2 + size / 3;
    const y = pageHeight - yFromTop;
    page.drawText(text, { x: x0 + 3, y, size, font, color: rgb(0, 0, 0) });
  }

  const out = await doc.save();
  return Buffer.from(out);
}

/** True when the values include any partner info (so the partner section should be filled). */
export function hasPartner(values: BtfValues): boolean {
  return Boolean(values.partner_name || values.partner_ssn || values.partner_email || values.partner_ownership_pct);
}
