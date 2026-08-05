// URL normalization + SSRF guard for the public /scan funnel.
//
// This is the only place in the app where an ARBITRARY, unauthenticated,
// user-supplied URL gets fetched server-side (researchWebsite + checkRobots both
// take it). Every other crawler entry point is fed a domain that came out of
// Zoho, Outscraper or a form behind a shared secret. So the blocklist below is
// load-bearing, not decoration: without it, `http://169.254.169.254/` reaches the
// cloud metadata endpoint from inside the lambda.
//
// PURE AND ISOMORPHIC ON PURPOSE. `scan-form.tsx` is a client component and imports
// normalizeTarget() for inline validation, so nothing here may import a Node builtin: one
// top-level `import ... from "dns/promises"` fails the browser bundle with "Module not found",
// and tsc does not catch it because a bundler boundary is not a type error. The resolver half of
// the SSRF guard therefore lives in public-host.ts.

export interface NormalizedTarget {
  /** Absolute https URL, no path, no query. What researchWebsite() gets. */
  website: string;
  /** Registrable host, lowercased, www stripped. The cache + display key. */
  domain: string;
}

export type NormalizeError =
  | "empty"
  | "unparseable"
  | "not_public"
  | "no_tld";

/** Hostnames that must never be fetched from inside our infrastructure. */
function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase();

  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h.endsWith(".local") || h.endsWith(".internal") || h.endsWith(".home.arpa")) return true;

  // A bare IP literal, of either family, is never the website of a business worth auditing.
  // Reject them all rather than only the private ones.
  if (h.startsWith("[") || h.includes(":")) return true;
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h)) return true;

  return false;
}

/**
 * Turn whatever someone pasted into a target, or say why not.
 *
 * Deliberately forgiving on the front (bare `srtagency.com`, a copied deep link,
 * a trailing slash, mixed case) and strict on the back (https only, public host,
 * real TLD).
 */
export function normalizeTarget(raw: string): { ok: true; target: NormalizedTarget } | { ok: false; error: NormalizeError } {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { ok: false, error: "empty" };

  // Strip a pasted scheme we don't want rather than rejecting the paste.
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, error: "unparseable" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "not_public" };
  }

  const host = url.hostname.toLowerCase();
  if (!host) return { ok: false, error: "unparseable" };
  if (isPrivateHost(host)) return { ok: false, error: "not_public" };

  // A real registrable domain has a dot and a non-numeric TLD.
  const parts = host.split(".");
  if (parts.length < 2) return { ok: false, error: "no_tld" };
  const tld = parts[parts.length - 1];
  if (tld.length < 2 || /\d/.test(tld)) return { ok: false, error: "no_tld" };

  const domain = host.replace(/^www\./, "");

  // Always https and always the origin: the deep link someone pasted is not
  // where the homepage research should start, and site-research.ts walks to the
  // inner pages itself.
  return { ok: true, target: { website: `https://${domain}`, domain } };
}

/** Human-readable reason, shown under the input. */
export function normalizeErrorMessage(e: NormalizeError): string {
  switch (e) {
    case "empty":
      return "Enter your website to start.";
    case "no_tld":
      return "That does not look like a full domain. Try something like acmedental.com";
    case "not_public":
      return "That address is not a public website.";
    default:
      return "We could not read that address. Try something like acmedental.com";
  }
}
