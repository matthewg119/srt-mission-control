// Phone number normalization — shared across iMessage ingest, lead capture,
// vCard export, and CRM lookups. Single source of truth (formerly lived in
// loopmessage.ts, which has been removed along with the LoopMessage transport).

import { normalizePhone as strictE164 } from "@/lib/medspa/validate";

// Normalize a raw phone string to E.164 (+1XXXXXXXXXX for US). Returns null for
// anything that isn't a plausible phone number (e.g. an Apple ID email handle).
//
// DELIBERATELY LOOSE, and it stays that way. It accepts any 11+ digit string as
// `+<digits>` because iMessage and LoopMessage hand it international handles that
// really are reachable. For a lead-capture FORM that is the wrong trade: see
// normalizeLeadPhone below.
export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits[0] === "1") return `+${digits}`;
  if (digits.length > 10) return `+${digits}`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inbound funnels
// ─────────────────────────────────────────────────────────────────────────────
//
// THE FAILURE THIS EXISTS TO STOP. Every public funnel used to store whatever the
// visitor typed, cleaned only of punctuation (`.replace(/[^\d+]/g, "")`). That leaves
// "3368332303", "13368332303" and "+13368332303" as three different strings for one
// human, and findContact() dedupes on them, so one person became three contacts, three
// Zoho leads and three Slack threads. The fix is not a better dedupe, it is never
// storing the three shapes.
//
// It uses the STRICT normalizer from medspa/validate rather than the loose one above:
// a form is typed by a person who can mistype, and `+12345678901234` should not be
// accepted as a phone number just because it has enough digits.

/**
 * E.164 for anything that is a real US number, otherwise the digits as given.
 *
 * NEVER RETURNS EMPTY FOR NON-EMPTY INPUT. A number that will not normalize is still
 * the only way to reach that person, and a funnel that silently dropped it would lose
 * the lead outright rather than store it awkwardly. The raw value is cleaned the way it
 * always was, so this can only ever improve on the old behaviour, never lose data.
 */
export function normalizeLeadPhone(raw: string | null | undefined): string {
  const given = (raw ?? "").trim();
  if (!given) return "";
  return strictE164(given) ?? given.replace(/[^\d+]/g, "");
}
