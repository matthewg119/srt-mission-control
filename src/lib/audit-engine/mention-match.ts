// Mechanical, auditable mention detection — case-insensitive substring match on
// the business name, its bare domain, and common legal-suffix variants. No fuzzy
// or LLM-based matching: the no-fabrication guarantee depends on this being
// simple enough to verify by eye against a raw response.

// The suffix list lives in company-identity.ts, shared with the inbound-lead stack's
// same-company check so the two can never drift apart.
import { stripSuffixes } from "@/lib/company-identity";
import { isBorrowedHost } from "./web-hosts";

function bareDomain(domainOrUrl: string): string {
  try {
    const host = domainOrUrl.startsWith("http") ? new URL(domainOrUrl).hostname : domainOrUrl;
    return host.replace(/^www\./i, "").split(".")[0];
  } catch {
    return domainOrUrl.replace(/^www\./i, "").split(".")[0];
  }
}

/**
 * Build every alias form worth matching against a raw engine response.
 *
 * ‼️ Both arguments are nullable, and the website genuinely is null on a name-mode run. The
 * bare-domain token simply drops out then, which means the BUSINESS NAME CARRIES THE WHOLE
 * MATCH and therefore the whole score. That is why classifyBusiness pins the name Matthew
 * typed instead of letting the model paraphrase it.
 */
export function buildAliases(businessName?: string | null, website?: string | null): string[] {
  const aliases = new Set<string>();
  const trimmedName = (businessName ?? "").trim();
  if (trimmedName) {
    aliases.add(trimmedName);
    const stripped = stripSuffixes(trimmedName);
    if (stripped) aliases.add(stripped);
  }
  // ‼️ ONLY OFF A DOMAIN THE BUSINESS ACTUALLY OWNS.
  //
  // The bare-domain token is a strong alias when the URL is their site, because an engine that
  // recommends them often writes the domain. It is a LIE when the URL is somebody else's platform.
  // A med spa whose Instagram bio pointed at threads.com produced the alias "threads", and
  // isMentioned is a substring test, so every answer mentioning PDO threads or a thread lift
  // counted as an appearance and the clinic scored 4 of 4 in searches it was absent from. An
  // inflated score is worse than a missing one: it is the number the DM and the report both state
  // as measured fact, and the prospect is the one person who can check it.
  //
  // isBorrowedHost covers the aggregators too: linktr.ee would otherwise contribute "linktr".
  const domainToken = website && !isBorrowedHost(website) ? bareDomain(website) : "";
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
