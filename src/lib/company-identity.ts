// "Are these two records the same company?" — shared by the inbound-lead stack
// (src/lib/lead-intake.ts) and the audit engine (mention-match.ts, finish-report.ts).
//
// It lives outside audit-engine on purpose: lead-intake serves the funding funnels too and
// must not depend on the audit feature.
//
// The rule everywhere is CONFLICT, not match. Two records only disagree when BOTH carry the
// field and the values differ. A missing value is never evidence of anything, which matters
// because the funding funnels pass no website at all and must keep behaving exactly as before.

const GENERIC_SUFFIXES = [
  "llc", "inc", "incorporated", "co", "company", "corp", "corporation",
  "clinic", "clinics", "group", "studio", "studios", "spa", "center", "centre",
  "shop", "store", "boutique", "associates", "partners", "pllc", "pc", "ltd",
];

/** "Acme Controls, LLC" and "Acme Controls" are the same company. */
export function stripSuffixes(name: string): string {
  const suffixPattern = new RegExp(`\\b(${GENERIC_SUFFIXES.join("|")})\\.?\\s*$`, "i");
  let stripped = name.trim();
  // Strip repeatedly in case of "X Clinic LLC" style double suffixes.
  for (let i = 0; i < 3; i++) {
    const next = stripped.replace(suffixPattern, "").trim().replace(/[,\-]+$/, "").trim();
    if (next === stripped) break;
    stripped = next;
  }
  return stripped;
}

/** Registrable-ish host: no protocol, no www., no path, lowercased. Null when unparseable. */
export function normalizeHost(websiteOrUrl: string | null | undefined): string | null {
  const raw = (websiteOrUrl ?? "").trim();
  if (!raw) return null;
  try {
    const host = raw.startsWith("http") ? new URL(raw).hostname : new URL(`https://${raw}`).hostname;
    return host.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0].toLowerCase() || null;
  }
}

/** Comparable company name: legal suffixes gone, punctuation gone, lowercased. */
export function normalizeCompanyName(name: string | null | undefined): string | null {
  const raw = (name ?? "").trim();
  if (!raw) return null;
  const key = stripSuffixes(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return key || null;
}

export interface CompanyIdentity {
  website?: string | null;
  businessName?: string | null;
}

/**
 * True only when the two records positively describe DIFFERENT companies.
 *
 * Website disagreement is decisive. Name disagreement counts only when neither side has a
 * website to judge by, since a company can legitimately be recorded under a trading name on
 * one row and a legal name on another, and the host is the harder signal.
 */
export function companiesConflict(a: CompanyIdentity, b: CompanyIdentity): boolean {
  const hostA = normalizeHost(a.website);
  const hostB = normalizeHost(b.website);
  if (hostA && hostB) return hostA !== hostB;

  const nameA = normalizeCompanyName(a.businessName);
  const nameB = normalizeCompanyName(b.businessName);
  if (nameA && nameB) return nameA !== nameB;

  return false;
}
