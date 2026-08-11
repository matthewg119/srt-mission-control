// Opt-in field validation for /webflow-Aivisibility.
//
// PURE AND ISOMORPHIC ON PURPOSE, exactly like src/lib/scan/normalize.ts. The client
// form imports these for inline validation and the route imports the same functions
// to re-check, so a typo never costs a round trip and the two cannot drift apart.
// Nothing here may import a node: builtin: one top-level `import ... from "crypto"`
// fails the browser bundle with "Module not found", and tsc does not catch it
// because a bundler boundary is not a type error.
//
// The website field is NOT validated here. It reuses normalizeTarget() from
// src/lib/scan/normalize.ts, which is already pure, already isomorphic, and already
// carries the SSRF host rules. Do not write a second URL parser.

export type FieldError = "name" | "email" | "phone" | "consent";

export function clean(v: unknown, max = 200): string {
  if (v === undefined || v === null) return "";
  return String(v).replace(/\s+/g, " ").trim().slice(0, max);
}

/** Same shape as the check in /api/scan/[id]/claim, kept deliberately identical. */
export function validEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
}

/**
 * A name has to contain at least one letter and be plausibly a name.
 *
 * Accepts accents, apostrophes and hyphens, because "O'Brien" and "Jean-Luc" are
 * real and rejecting them is the kind of validation bug nobody reports, they just
 * leave. Rejects anything that is only digits or punctuation.
 */
export function validName(v: string): boolean {
  const s = v.trim();
  if (s.length < 2 || s.length > 80) return false;
  if (!/\p{L}/u.test(s)) return false;
  return /^[\p{L}\p{M}][\p{L}\p{M}'\-. ]*$/u.test(s);
}

/** Split a single "first last" field the way ingestLead expects it. */
export function splitName(v: string): { firstName: string; lastName: string } {
  const parts = v.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0] ?? "", lastName: "" };
  return { firstName: parts[0] ?? "", lastName: parts.slice(1).join(" ") };
}

/**
 * US mobile, normalized to E.164, or null.
 *
 * This is the STRICT validator from /aivisibility rather than the looser one on
 * /PDF, and the strictness is load-bearing: ingestLead fires Speed-to-Lead at
 * whatever phone it is handed, and this route is public and unauthenticated. A
 * garbage number here is an outbound dialer pointed at a stranger.
 *
 * Rejected: fewer or more than 10 digits (11 only with a leading 1), an area code
 * or exchange starting 0 or 1, and every-digit-the-same placeholders like
 * 9999999999, which is what people type when they do not want to be called.
 */
export function normalizePhone(v: string): string | null {
  const digits = v.replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;

  if (ten.length !== 10) return null;
  if (/^(\d)\1{9}$/.test(ten)) return null;

  const areaCode = ten[0];
  const exchange = ten[3];
  if (areaCode === "0" || areaCode === "1") return null;
  if (exchange === "0" || exchange === "1") return null;

  return `+1${ten}`;
}

export interface OptinInput {
  name: string;
  email: string;
  phone: string;
  consent: boolean;
}

export interface OptinValid {
  ok: true;
  firstName: string;
  lastName: string;
  name: string;
  email: string;
  phone: string;
}

export function validateOptin(input: OptinInput): OptinValid | { ok: false; errors: FieldError[] } {
  const errors: FieldError[] = [];

  const name = clean(input.name, 80);
  const email = clean(input.email, 120).toLowerCase();
  const phoneRaw = clean(input.phone, 30);

  if (!validName(name)) errors.push("name");
  if (!validEmail(email)) errors.push("email");

  const phone = normalizePhone(phoneRaw);
  if (!phone) errors.push("phone");

  // Consent is required because we collect a mobile number and Speed-to-Lead dials
  // it. /PDF ships smsConsent hard-coded false precisely because it collects no
  // checkbox; this funnel collects one, so the record is real either way.
  if (!input.consent) errors.push("consent");

  if (errors.length) return { ok: false, errors };

  const { firstName, lastName } = splitName(name);
  return { ok: true, firstName, lastName, name, email, phone: phone as string };
}

/** Human-readable reason, shown under the offending input. */
export function fieldErrorMessage(e: FieldError): string {
  switch (e) {
    case "name":
      return "Enter your first and last name.";
    case "email":
      return "That does not look like a working email address.";
    case "phone":
      return "Enter a 10 digit US mobile number.";
    case "consent":
      return "Tick the box so we know we can reach you.";
  }
}
