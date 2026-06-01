// Phone number normalization — shared across iMessage ingest, lead capture,
// vCard export, and CRM lookups. Single source of truth (formerly lived in
// loopmessage.ts, which has been removed along with the LoopMessage transport).

// Normalize a raw phone string to E.164 (+1XXXXXXXXXX for US). Returns null for
// anything that isn't a plausible phone number (e.g. an Apple ID email handle).
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}
