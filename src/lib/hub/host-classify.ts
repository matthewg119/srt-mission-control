// Which application is this request allowed to be talking to?
//
// Pure, edge-safe, zero imports. It is testable in isolation on purpose: this function is
// the only thing standing between a client's DNS zone and the internal CRM, so it must be
// readable in one screen and provable without a database.
//
// DENY BY DEFAULT. Anything not recognised as an internal host is EXTERNAL, which means
// forgetting to add a new internal host breaks /dashboard loudly rather than quietly
// serving the CRM on a hostname somebody else's registrar controls. That asymmetry is the
// entire design and it must not be inverted into an allowlist of hub hosts.

export type HostClass = "internal" | "external" | "concierge";

/**
 * The one hostname that serves the AI Skin Concierge widget, and nothing else.
 *
 * ‼️ IT IS NOT INTERNAL AND IT MUST NEVER BE ADDED TO INTERNAL_HOSTS. Classifying it internal
 * would publish the whole application on it — /api/leads/funnel, /api/scan/*, /api/clients/start,
 * every future public-by-design route — on a brand new hostname that is pasted into third-party
 * web pages for a living. That is the exact failure the header of middleware.ts describes.
 *
 * It is not external either. External means "somebody else's registrar points this at us" and
 * gets the hub allowlist: the index, one level of slugs, and a single named API route. The
 * concierge needs /w/*, /embed.js and a real /api/concierge/* prefix, which would be reckless to
 * grant on a client-controlled name and is fine on one we own.
 *
 * So: its own class, its own allowlist, still deny-by-default.
 */
function conciergeHost(): string {
  return (process.env.CONCIERGE_HOST || "concierge.srtagency.com").trim().toLowerCase();
}

/**
 * The hosts that serve Mission Control itself.
 *
 * NEXT_PUBLIC_APP_URL is read as well as INTERNAL_HOSTS so that a correctly configured
 * deployment needs no new variable to keep working. INTERNAL_HOSTS is the escape hatch for
 * a second internal name (a staging alias, a vanity domain) and takes a comma-separated
 * list.
 */
function internalHosts(): Set<string> {
  const hosts = new Set<string>(["mission.srtagency.com"]);

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (appUrl) {
    try {
      hosts.add(new URL(appUrl).hostname.toLowerCase());
    } catch {
      // A malformed NEXT_PUBLIC_APP_URL must not take the whole classifier down. The
      // default above still covers production.
    }
  }

  for (const raw of (process.env.INTERNAL_HOSTS ?? "").split(",")) {
    const host = raw.trim().toLowerCase();
    if (host) hosts.add(host);
  }

  return hosts;
}

/** Strip the port and lowercase. `Host` carries a port in dev and behind some proxies. */
export function normalizeHost(raw: string | null | undefined): string {
  if (!raw) return "";
  // IPv6 literals arrive bracketed, e.g. [::1]:3000. Take the bracketed part whole.
  const trimmed = raw.trim().toLowerCase();
  if (trimmed.startsWith("[")) return trimmed.slice(0, trimmed.indexOf("]") + 1);
  return trimmed.split(":")[0];
}

export function classifyHost(rawHost: string | null | undefined): HostClass {
  const host = normalizeHost(rawHost);

  // No Host header at all. Fails closed: an external classification can only ever reach
  // the hub tree, which then finds no client and 404s.
  if (!host) return "external";

  // ‼️ CHECKED BEFORE INTERNAL, AND THE ORDER IS LOAD-BEARING. If somebody ever adds the
  // concierge hostname to INTERNAL_HOSTS — the obvious thing to try when the widget 404s — this
  // ordering means it stays on the narrow allowlist instead of quietly serving the CRM. The
  // classifier refusing to be overridden is the point.
  //
  // localhost is deliberately NOT special-cased into this class: in dev it classifies internal,
  // which allows everything, so /w/[slug] and /api/concierge/* work with no extra configuration.
  if (host === conciergeHost()) return "concierge";

  if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return "internal";

  // Preview deployments and the raw project URL. Treated as internal so that a caller who
  // spoofs `Host: learn.aclinic.com` at a *.vercel.app deployment URL gets a 404 instead of
  // picking which branch of this function runs.
  //
  // This does NOT make deployment URLs safe: they already serve the whole internal app to
  // anyone holding one. Vercel Deployment Protection is the control for that, and the hub
  // raises the stakes on turning it on.
  if (host.endsWith(".vercel.app")) return "internal";

  return internalHosts().has(host) ? "internal" : "external";
}
