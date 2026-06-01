// vCard 3.0 builder — RFC 2426 compliant with CRLF line endings required by iOS.
import { normalizePhone } from "@/lib/phone";

export interface VCardFields {
  firstName?: string | null;
  lastName?: string | null;
  businessName?: string | null;
  title?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  note?: string | null;
  categories?: string | null;
  url?: string | null;
}

/** Backslash-escape characters that are special in vCard property values. */
export function escapeVCard(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** Strip everything that isn't safe for a filename across iOS/macOS/Windows. */
export function sanitizeFilename(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, "_").replace(/_+/g, "_");
}

export function buildVCard(fields: VCardFields): string {
  const CRLF = "\r\n";
  const lines: string[] = ["BEGIN:VCARD", "VERSION:3.0"];

  const firstName = fields.firstName?.trim() ?? "";
  const lastName = fields.lastName?.trim() ?? "";
  const fullName = [firstName, lastName].filter(Boolean).join(" ");

  if (fullName) lines.push(`FN:${escapeVCard(fullName)}`);
  lines.push(`N:${escapeVCard(lastName)};${escapeVCard(firstName)};;;`);

  if (fields.businessName?.trim()) lines.push(`ORG:${escapeVCard(fields.businessName.trim())}`);
  if (fields.title?.trim())        lines.push(`TITLE:${escapeVCard(fields.title.trim())}`);

  if (fields.phone) {
    const e164 = normalizePhone(fields.phone);
    if (e164) lines.push(`TEL;TYPE=CELL:${e164}`);
  }

  if (fields.email?.trim()) lines.push(`EMAIL;TYPE=WORK:${escapeVCard(fields.email.trim())}`);

  const city  = fields.city?.trim()  ?? "";
  const state = fields.state?.trim() ?? "";
  if (city || state) {
    lines.push(`ADR;TYPE=WORK:;;;${escapeVCard(city)};${escapeVCard(state)};;`);
  }

  if (fields.note?.trim())       lines.push(`NOTE:${escapeVCard(fields.note.trim())}`);
  if (fields.categories?.trim()) lines.push(`CATEGORIES:${escapeVCard(fields.categories.trim())}`);
  if (fields.url?.trim())        lines.push(`URL:${fields.url.trim()}`);

  lines.push("END:VCARD");
  return lines.join(CRLF) + CRLF;
}
