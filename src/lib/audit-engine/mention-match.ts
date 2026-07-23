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
