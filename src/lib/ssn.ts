// Helpers for collecting and validating full 9-digit SSN.
// Storage format is XXX-XX-XXXX (formatted). `ssn4` is derived from the last 4.

export function stripSSN(value: string | null | undefined): string {
  if (!value) return "";
  return String(value).replace(/\D/g, "").slice(0, 9);
}

export function formatSSN(value: string | null | undefined): string {
  const d = stripSSN(value);
  if (d.length <= 3) return d;
  if (d.length <= 5) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}`;
}

export function isValidSSN(value: string | null | undefined): boolean {
  return stripSSN(value).length === 9;
}

export function lastFourOfSSN(value: string | null | undefined): string {
  const d = stripSSN(value);
  return d.length >= 4 ? d.slice(-4) : "";
}
