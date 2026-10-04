// What a business detail has to LOOK like before it is stored. Pure, isomorphic, imports only
// other pure modules, so the form and the route run the identical check.
//
// ‼️ WHY THIS EXISTS, MEASURED RATHER THAN IMAGINED.
// The Launch Lane form shipped with trimming and nothing else. A real attempt to use it typed
// `777777777` into City, `777777777` into State, `7777777777777` into ZIP and
// `77777777777777777` into Phone. Every one of them was stored. The ONLY field that objected was
// the website, and only because normalizeTarget() happened to parse it. The client row then read
// "Test Clinic in 777777777, 777777777", the step 1 verifier saw a non-empty string in each
// column and ticked itself GREEN, and the board reported the intake was captured correctly.
//
// That is worse than a crash. A refusal costs a retype; a green tick over garbage propagates into
// the NAP that every directory is later made to match, into the JSON-LD on every published page,
// and into the audit baseline the day 30/60/90 numbers are measured against.
//
// ‼️ THE SAME MODULE VALIDATES ON THE WAY IN AND ON THE WAY BACK OUT.
// The route uses it to refuse the write, and the step verifier uses it to refuse the TICK, so a
// row that predates this file (or that something else wrote) cannot be confirmed either. A check
// that only runs on submit is a check that a form is the only way to get data in, which is never
// true for long.
//
// ‼️ IT NORMALISES AS WELL AS REFUSING, AND THE NORMALISED VALUE IS WHAT GETS STORED.
// "arizona" becomes "AZ" and "(480) 555-0147" becomes "+14805550147". Normalising at the edge is
// the only way one client's state is comparable to another's, which place.ts already had to learn
// the expensive way: a raw join across two differently-written columns returned zero rows out of
// 2,671.

import { normalizePhone, validEmail, validName } from "@/lib/medspa/validate";
import { toStateCode } from "@/lib/market/place";

export type IntakeField =
  | "email"
  | "phone"
  | "legalName"
  | "dbaName"
  | "addressLine1"
  | "city"
  | "state"
  | "postalCode"
  | "verticalSlug"
  | "website";

export interface FieldVerdict {
  ok: boolean;
  /** The value to STORE. Normalised. Null when the field is empty and optional. */
  value: string | null;
  /** What to show under the input. Written to be read by a person mid-typing. */
  error?: string;
}

const ok = (value: string | null): FieldVerdict => ({ ok: true, value });
const bad = (error: string): FieldVerdict => ({ ok: false, value: null, error });

/**
 * A string that is only digits, punctuation or one character repeated.
 *
 * ‼️ THE REPEAT CHECK IS THE ONE THAT ACTUALLY FIRES. Nobody types "asdf" into City as often as
 * they mash one key, and `7777777` passes every length and character-class rule ever written for
 * a city name. normalizePhone already refuses repdigit phone numbers for exactly this reason.
 */
function looksLikeMashing(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (!/\p{L}/u.test(t)) return true; // no letters at all
  if (/^(.)\1+$/.test(t.replace(/\s/g, ""))) return true; // one character, repeated
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// The fields
// ─────────────────────────────────────────────────────────────────────────────

export function checkEmail(raw: string): FieldVerdict {
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return bad("An email is required.");
  if (!validEmail(v)) return bad("That is not an email address.");
  return ok(v);
}

/**
 * ‼️ STORED E.164, ALWAYS. Standing rule, and the reason there is no separate WhatsApp field
 * anywhere in this codebase: one number, asked once, stored one way, so one person cannot become
 * three records.
 */
export function checkPhone(raw: string, required = true): FieldVerdict {
  const v = (raw ?? "").trim();
  if (!v) return required ? bad("A phone number is required.") : ok(null);

  const e164 = normalizePhone(v);
  if (!e164) {
    const digits = v.replace(/\D/g, "").length;
    return bad(
      digits === 0
        ? "That has no digits in it."
        : digits < 10
          ? `That is only ${digits} digits. A US number has 10.`
          : digits > 11
            ? `That is ${digits} digits. A US number has 10.`
            : "That is not a real US number. Check the area code."
    );
  }
  return ok(e164);
}

export function checkBusinessName(raw: string, label: string, required: boolean): FieldVerdict {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return required ? bad(`${label} is required.`) : ok(null);
  if (v.length > 120) return bad(`${label} is too long.`);
  // NOT validName(): a business is "Lumen Aesthetics LLC" or "24/7 HVAC", and a person-name rule
  // rejects both. The bar here is only that it is not mashing.
  if (looksLikeMashing(v)) return bad(`${label} needs to be a real name.`);
  return ok(v);
}

export function checkCity(raw: string, required = true): FieldVerdict {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return required ? bad("A city is required.") : ok(null);
  if (looksLikeMashing(v)) return bad("That is not a city.");
  if (!/^[\p{L}\p{M}][\p{L}\p{M}'\-. ]*$/u.test(v)) return bad("A city is letters, spaces and hyphens.");
  if (v.length > 60) return bad("That is too long for a city.");
  return ok(v);
}

/**
 * ‼️ A REAL US STATE, NOT TWO CHARACTERS. toStateCode() accepts "AZ" or "Arizona" and answers
 * null for anything that is neither, which is what makes "77" and "XX" refusals rather than
 * stored values that only look right until somebody tries to join on them.
 */
export function checkState(raw: string, required = true): FieldVerdict {
  const v = (raw ?? "").trim();
  if (!v) return required ? bad("A state is required.") : ok(null);
  const code = toStateCode(v);
  if (!code) return bad("That is not a US state. Two letters, or the full name.");
  return ok(code);
}

export function checkPostalCode(raw: string, required = true): FieldVerdict {
  const v = (raw ?? "").trim();
  if (!v) return required ? bad("A ZIP is required.") : ok(null);
  if (!/^\d{5}(-\d{4})?$/.test(v)) return bad("A ZIP is 5 digits, or 5 plus 4.");
  // 00000 is syntactically fine and is not a place.
  if (/^0{5}/.test(v)) return bad("That is not a real ZIP.");
  return ok(v);
}

export function checkAddressLine1(raw: string, required = true): FieldVerdict {
  const v = (raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return required ? bad("A street address is required.") : ok(null);
  // A street address has a number AND a name. Either alone is a typo, and this is the field that
  // every directory listing is later made to match.
  if (!/\d/.test(v)) return bad("A street address needs a number.");
  if (!/\p{L}{2,}/u.test(v)) return bad("A street address needs a street name.");
  if (v.length > 120) return bad("That is too long.");
  return ok(v);
}

/**
 * The niche, as a kebab-case slug.
 *
 * ‼️ IT MUST CONTAIN LETTERS AND AT LEAST ONE, BECAUSE THIS VALUE IS SHARED ACROSS CLIENTS.
 * clients.vertical_slug keys question_bank and avatar_briefs, and question_bank has no client_id,
 * so a junk vertical cannot be unpicked from the shared corpus afterwards. verticalFor() refuses
 * an empty value for that reason; this refuses a meaningless one for the same reason.
 */
export function checkVerticalSlug(raw: string): FieldVerdict {
  const v = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "-");
  if (!v) return bad("Say what this business is.");
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) {
    return bad("Lowercase letters, numbers and hyphens only. For example roofing-contractor.");
  }
  if (!/[a-z]{3,}/.test(v)) return bad("That needs to be a real word, for example family-dentist.");
  if (v.length > 64) return bad("That is too long.");
  return ok(v);
}

/**
 * A website, when there is one.
 *
 * ‼️ OPTIONAL BY DESIGN IN THIS LANE, AND THE EMPTY CASE IS THE COMMON ONE. A typed but
 * unreadable value is still an error, because that is a mistake worth surfacing rather than
 * silently dropping. Same split startPilot() already draws.
 */
export function checkWebsite(raw: string, required = false): FieldVerdict {
  const v = (raw ?? "").trim();
  if (!v) return required ? bad("A website is required.") : ok(null);

  const stripped = v.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/.*$/, "");
  if (/\s/.test(stripped)) return bad("A web address has no spaces in it.");
  if (!/^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/i.test(stripped)) {
    return bad("That is not a web address. For example lumenaesthetics.com");
  }
  if (!/\.[a-z]{2,}$/i.test(stripped)) return bad("That is missing a .com or similar.");
  return ok(`https://${stripped.toLowerCase()}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// The whole form
// ─────────────────────────────────────────────────────────────────────────────

export interface IntakeInput {
  email?: string;
  phone?: string;
  legalName?: string;
  dbaName?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  verticalSlug?: string;
  website?: string;
}

export interface IntakeResult {
  ok: boolean;
  /** Per-field message, for rendering under the input that is wrong. */
  errors: Partial<Record<IntakeField, string>>;
  /** Normalised values, safe to store. Only meaningful when ok. */
  values: Partial<Record<IntakeField, string | null>>;
}

/**
 * Validate a Launch Lane intake.
 *
 * ‼️ EVERY FIELD IS CHECKED, NOT JUST UP TO THE FIRST FAILURE. Returning one error at a time
 * turns a form with four bad fields into four round trips, and people stop reading the message by
 * the third.
 */
export function validateLaunchIntake(input: IntakeInput): IntakeResult {
  const checks: Record<IntakeField, FieldVerdict> = {
    email: checkEmail(input.email ?? ""),
    verticalSlug: checkVerticalSlug(input.verticalSlug ?? ""),
    // ‼️ THE NAME IS REQUIRED HERE AND NOT IN startPilot(). /start provisions from an email alone
    // and backfills minutes later; this lane has no such second pass, and the name is what every
    // page, the JSON-LD and the GBP listing are built on.
    legalName: checkBusinessName(input.legalName ?? input.dbaName ?? "", "A business name", true),
    dbaName: checkBusinessName(input.dbaName ?? "", "The public facing name", false),
    phone: checkPhone(input.phone ?? "", true),
    addressLine1: checkAddressLine1(input.addressLine1 ?? "", true),
    city: checkCity(input.city ?? "", true),
    state: checkState(input.state ?? "", true),
    postalCode: checkPostalCode(input.postalCode ?? "", true),
    website: checkWebsite(input.website ?? "", false),
  };

  const errors: Partial<Record<IntakeField, string>> = {};
  const values: Partial<Record<IntakeField, string | null>> = {};

  for (const [field, verdict] of Object.entries(checks) as [IntakeField, FieldVerdict][]) {
    if (verdict.ok) values[field] = verdict.value;
    else errors[field] = verdict.error;
  }

  return { ok: Object.keys(errors).length === 0, errors, values };
}

/**
 * Does a STORED client row still look like real business details?
 *
 * Used by the step 1 verifier so a row written before this module existed, or by any other path,
 * cannot be ticked green. It re-runs the same checks rather than a looser copy of them: a second,
 * gentler definition of "valid" is how the tick and the form start disagreeing.
 */
export function faultsInStoredIntake(row: {
  legal_name?: unknown;
  dba_name?: unknown;
  phone?: unknown;
  address_line1?: unknown;
  city?: unknown;
  state?: unknown;
  postal_code?: unknown;
  vertical_slug?: unknown;
  business_type?: unknown;
}): string[] {
  const s = (v: unknown): string => (typeof v === "string" ? v : "");
  const faults: string[] = [];

  const name = checkBusinessName(s(row.dba_name) || s(row.legal_name), "The business name", true);
  if (!name.ok) faults.push(`business name: ${name.error}`);

  const phone = checkPhone(s(row.phone), true);
  if (!phone.ok) faults.push(`phone: ${phone.error}`);

  const city = checkCity(s(row.city), true);
  if (!city.ok) faults.push(`city: ${city.error}`);

  const state = checkState(s(row.state), true);
  if (!state.ok) faults.push(`state: ${state.error}`);

  // The address and ZIP are checked only when present: a client can legitimately be opened before
  // the full address is known, and the GBP steps are where that becomes blocking.
  if (s(row.address_line1)) {
    const addr = checkAddressLine1(s(row.address_line1), true);
    if (!addr.ok) faults.push(`street address: ${addr.error}`);
  }
  if (s(row.postal_code)) {
    const zip = checkPostalCode(s(row.postal_code), true);
    if (!zip.ok) faults.push(`ZIP: ${zip.error}`);
  }

  const vertical = checkVerticalSlug(s(row.vertical_slug) || s(row.business_type));
  if (!vertical.ok) faults.push(`what this business is: ${vertical.error}`);

  return faults;
}
