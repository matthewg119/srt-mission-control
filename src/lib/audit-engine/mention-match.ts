// Mechanical, auditable mention detection — case-insensitive substring match on
// the business name, its bare domain, and common legal-suffix variants. No fuzzy
// or LLM-based matching: the no-fabrication guarantee depends on this being
// simple enough to verify by eye against a raw response.

const GENERIC_SUFFIXES = [
  "llc", "inc", "incorporated", "co", "company", "corp", "corporation",
  "clinic", "clinics", "group", "studio", "studios", "spa", "center", "centre",
  "shop", "store", "boutique", "associates", "partners", "pllc", "pc", "ltd",
];

function stripSuffixes(name: string): string {
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

function bareDomain(domainOrUrl: string): string {
  try {
    const host = domainOrUrl.startsWith("http") ? new URL(domainOrUrl).hostname : domainOrUrl;
    return host.replace(/^www\./i, "").split(".")[0];
  } catch {
    return domainOrUrl.replace(/^www\./i, "").split(".")[0];
  }
}

/** Build every alias form worth matching against a raw engine response. */
export function buildAliases(businessName: string, website: string): string[] {
  const aliases = new Set<string>();
  const trimmedName = businessName.trim();
  if (trimmedName) {
    aliases.add(trimmedName);
    const stripped = stripSuffixes(trimmedName);
    if (stripped) aliases.add(stripped);
  }
  const domainToken = bareDomain(website);
  if (domainToken) aliases.add(domainToken);

  return [...aliases].filter((a) => a.length >= 2);
}

/** Case-insensitive substring match across every alias form. */
export function isMentioned(text: string, aliases: string[]): boolean {
  if (!text) return false;
  const lower = text.toLowerCase();
  return aliases.some((alias) => lower.includes(alias.toLowerCase()));
}

/** Is this short extracted name (e.g. "Acme Clinic") the client itself, not a competitor? */
export function isClientName(candidate: string, aliases: string[]): boolean {
  const c = candidate.toLowerCase().trim();
  if (!c) return false;
  return aliases.some((alias) => {
    const a = alias.toLowerCase();
    return c.includes(a) || a.includes(c);
  });
}

/**
 * Locate the first alias occurrence in `text` and return a window of text
 * around it, so a "mentioned" snippet always actually contains the match —
 * rather than blindly showing the first N characters of a long response,
 * which can miss the match entirely if it occurs later in the text.
 */
export function findMatchExcerpt(text: string, aliases: string[], contextChars = 160): string | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  let bestIndex = -1;
  let bestLength = 0;
  for (const alias of aliases) {
    const idx = lower.indexOf(alias.toLowerCase());
    if (idx !== -1 && (bestIndex === -1 || idx < bestIndex)) {
      bestIndex = idx;
      bestLength = alias.length;
    }
  }
  if (bestIndex === -1) return null;

  const start = Math.max(0, bestIndex - contextChars);
  const end = Math.min(text.length, bestIndex + bestLength + contextChars);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < text.length ? "…" : "";
  return `${prefix}${text.slice(start, end).trim()}${suffix}`;
}
