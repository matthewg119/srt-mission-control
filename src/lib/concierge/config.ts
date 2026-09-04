// One tenant's widget settings, and the browser-enforced control that keeps it theirs.
//
// ‼️ enabled IS THE ONLY THING THAT PUTS THIS ON A REAL SITE, AND IT DEFAULTS FALSE. A config row
// existing is not consent. concierge_preview creates the row so the widget can be demoed on the
// call; concierge_live flips it afterwards. Nothing here may flip it.
//
// ‼️ AN EMPTY allowed_origins MEANS "THIS CLIENT'S OWN HOSTS", NEVER 'none'. Rendering
// frame-ancestors 'none' for an empty array would silently kill the widget everywhere it is
// embedded, and it would look like a caching problem rather than a config one. The SQL comment on
// the column says this in as many words; this file is where getting it wrong would actually happen.

import { supabaseAdmin } from "@/lib/db";
import { isAudience, type Audience } from "./magnets";

export type BookingMode = "link" | "calendly" | "none";

export interface ConciergeConfig {
  clientId: string;
  slug: string;
  enabled: boolean;
  audience: Audience;
  vertical: string;
  greeting: string | null;
  allowedOrigins: string[];
  bookingMode: BookingMode;
  bookingUrl: string | null;
  bookingPhone: string | null;
  analysisProvider: string;
  dailyScanCap: number;
  consentVersion: string;
  /** Tenant facts the prompt needs. The client is the business the widget belongs to. */
  clientName: string;
  clientCity: string | null;
  clientState: string | null;
  clientWebsite: string | null;
}

const CONFIG_COLUMNS =
  "client_id, enabled, audience, vertical, greeting, allowed_origins, booking_mode, booking_url, " +
  "booking_phone, analysis_provider, daily_scan_cap, consent_version, " +
  "clients!inner(slug, legal_name, dba_name, domain, website, city, state)";

function bookingMode(v: unknown): BookingMode {
  return v === "link" || v === "calendly" ? v : "none";
}

/**
 * The widget config for one client slug.
 *
 * Returns null for an unknown slug AND for a row whose audience is not one of the two known
 * strings. The second case cannot happen while the CHECK constraint holds, and failing closed on it
 * costs nothing: a widget that will not load is recoverable, one talking to the wrong person is not.
 */
export async function loadConciergeConfig(slug: string): Promise<ConciergeConfig | null> {
  const clean = slug.trim().toLowerCase();
  if (!clean || !/^[a-z0-9][a-z0-9-]{0,78}[a-z0-9]$/.test(clean)) return null;

  const { data, error } = await supabaseAdmin
    .from("concierge_configs")
    .select(CONFIG_COLUMNS)
    .eq("clients.slug", clean)
    .maybeSingle();

  if (error || !data) return null;

  const row = data as unknown as Record<string, unknown>;
  const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as
    | Record<string, unknown>
    | undefined;
  if (!client) return null;

  if (!isAudience(row.audience)) {
    console.error(`[concierge] ${clean} has an unreadable audience, refusing to serve`);
    return null;
  }

  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

  return {
    clientId: String(row.client_id),
    slug: clean,
    enabled: row.enabled === true,
    audience: row.audience,
    vertical: str(row.vertical) ?? "medspa",
    greeting: str(row.greeting),
    allowedOrigins: Array.isArray(row.allowed_origins)
      ? (row.allowed_origins as unknown[]).filter((o): o is string => typeof o === "string" && !!o.trim())
      : [],
    bookingMode: bookingMode(row.booking_mode),
    bookingUrl: str(row.booking_url),
    bookingPhone: str(row.booking_phone),
    analysisProvider: str(row.analysis_provider) ?? "mock",
    dailyScanCap: typeof row.daily_scan_cap === "number" ? row.daily_scan_cap : 200,
    consentVersion: str(row.consent_version) ?? "v1",
    clientName: str(client.dba_name) ?? str(client.legal_name) ?? clean,
    clientCity: str(client.city),
    clientState: str(client.state),
    clientWebsite: str(client.website) ?? str(client.domain),
  };
}

/**
 * The Content-Security-Policy frame-ancestors value for this tenant's frame.
 *
 * ‼️ THIS IS THE ONLY THING THAT STOPS ONE CLIENT EMBEDDING A COMPETITOR'S WIDGET AND HARVESTING
 * THEIR LEADS. It is a browser-enforced control, not a log line.
 *
 * An empty stored array falls back to the client's OWN hosts, read live from client_hosts and
 * clients.domain, rather than to 'none'. A tenant with no rows anywhere still gets 'self', which
 * shows the frame on our own preview and nowhere else: restrictive, and visibly so, rather than
 * silently dead on every page at once.
 */
export async function frameAncestorsFor(config: ConciergeConfig): Promise<string> {
  // ‼️ OUR OWN APP ORIGIN IS ALWAYS ALLOWED, AND WITHOUT IT THE PREVIEW IS A BLANK BOX.
  //
  // 'self' is the CONCIERGE hostname, not Mission Control's, so a frame embedded by
  // /preview/{token} is refused by the browser with nothing in any server log. seedOrigins()
  // seeds the client's own domain and their hub hosts, never ours, so no amount of re-running
  // concierge_preview fixes it. This is a hostname we control and every page on it that embeds
  // the widget is one we render, so it is not a widening of the tenant allowlist below: that
  // list is still what stops one clinic embedding a competitor's widget.
  const ours = appOrigin();
  if (config.allowedOrigins.length > 0) {
    const listed = new Set(config.allowedOrigins);
    if (ours) listed.add(ours);
    return `'self' ${[...listed].join(" ")}`;
  }

  const { data } = await supabaseAdmin
    .from("client_hosts")
    .select("host")
    .eq("client_id", config.clientId);

  const hosts = new Set<string>();
  for (const row of (data ?? []) as Array<{ host?: unknown }>) {
    if (typeof row.host === "string" && row.host.trim()) hosts.add(`https://${row.host.trim()}`);
  }

  const { data: client } = await supabaseAdmin
    .from("clients")
    .select("domain")
    .eq("id", config.clientId)
    .maybeSingle();

  const domain = typeof client?.domain === "string" ? client.domain.trim() : "";
  if (domain) {
    hosts.add(`https://${domain}`);
    hosts.add(`https://www.${domain}`);
  }

  if (ours) hosts.add(ours);

  return hosts.size > 0 ? `'self' ${[...hosts].sort().join(" ")}` : "'self'";
}

/**
 * Mission Control's own origin, or null on a deployment that has not been told what it is.
 *
 * Null rather than a guessed default: a wrong origin in a CSP is a widget that silently will not
 * render, which is the hardest class of bug to see. Same tri-state discipline as BOOKING_LINK.
 */
function appOrigin(): string | null {
  const raw = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
}
