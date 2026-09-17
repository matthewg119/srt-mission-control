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
import { isLauncherCorner, type LauncherCorner } from "@/lib/clients/mascot-grammar";
import { isAudience, type Audience } from "./magnets";
import { audienceById, type AudienceVocabulary } from "@/lib/clients/audiences";

export type BookingMode = "link" | "calendly" | "none";

/**
 * Whether the client bought the widget (Matthew, 2026-09-15: "we will charge for this additionally so it can
 * be optional in the onboarding but if I skip it I still may be able to come back and install it").
 *
 * ‼️ THE CONFIG ROW EXISTS EITHER WAY. Page drafting, magnets, publishing and the site replica all read the
 * catalogue through it, so declining the widget must not delete it. `declined` only keeps the widget off
 * every live page; `concierge install` flips it to `included` later.
 */
export type AddonStatus = "undecided" | "included" | "declined";

/** A button under "How can we help you today?". */
export interface QuickAction {
  kind: "audit" | "magnet" | "type" | "booking";
  label: string;
}

export interface ConciergeConfig {
  clientId: string;
  slug: string;
  enabled: boolean;
  audience: Audience;
  /**
   * The SHARED research namespace, from the audience row.
   *
   * ‼️ NO LONGER `?? "medspa"`. That fallback sat on a column whose own database default was
   * also 'medspa', so a client that never chose anything read as a med spa twice over. Both are
   * gone: the default was dropped in docs/2026-09-14-client-audiences.sql and the coalesce here
   * was the other half of the same silent answer.
   */
  vertical: string;
  /** The nouns every prompt interpolates. Loaded once, here, from client_audiences. */
  vocabulary: AudienceVocabulary;
  /** The guards that are this audience's and not universal. Empty is legitimate. */
  hardLines: string[];
  /** What this lane is called in front of a person, from the row rather than from a ternary. */
  laneName: string | null;
  launcherLabel: string | null;
  /** The market the ammo lookup is about. Null is honest and competitorAmmo says so. */
  buyerMarket: string | null;
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
  addonStatus: AddonStatus;
  /** Null means the audience's default buttons (quickActionsFor). */
  quickActions: QuickAction[] | null;
  /** Which mascot sits in the corner, or null for the plain pill. */
  mascot: string | null;
  /**
   * Up to three mascots shortlisted for this client, in the order they were picked.
   *
   * ‼️ A SHORTLIST IS NOT A CHOICE. These are what step 18 posts preview links for so the client can
   * be shown three and pick one on the call. `mascot` is the one that actually renders, and nothing
   * here reaches a live page.
   */
  mascotCandidates: string[];
  /** Which corner the launcher rests in. One of four; anything else reads as the default. */
  launcherCorner: LauncherCorner;
}

// ‼️ DECLARED IN mascot-grammar.ts AND RE-EXPORTED HERE. That file is pure, so the probe can check the
// four corners without pulling in a Supabase client; this is where every caller already looks.
export { isLauncherCorner };
export type { LauncherCorner };

const CONFIG_COLUMNS =
  "client_id, enabled, audience, audience_id, vertical, greeting, allowed_origins, booking_mode, booking_url, " +
  "booking_phone, analysis_provider, daily_scan_cap, consent_version, addon_status, quick_actions, mascot, " +
  "mascot_candidates, launcher_corner, " +
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

  // ‼️ THE WORDS COME FROM A ROW, AND A WIDGET WITH NO ROW DOES NOT SERVE.
  // This file already refuses on an unreadable audience and says why in the log, for the same
  // reason: the widget speaks in a client's own voice on a client's own domain, and the failure
  // it is guarding against is confidently saying the wrong word to a stranger. A missing
  // audience is the same class of fault as an unreadable stance, so it gets the same answer.
  const audienceId = str(row.audience_id);
  if (!audienceId) {
    console.error(
      `[concierge] ${clean} has no audience_id, refusing to serve. ` +
        `Seed one with seedClientAudience() so the widget knows what to call the buyer.`
    );
    return null;
  }

  const resolved = await audienceById(audienceId);
  if (!resolved.ok) {
    console.error(`[concierge] ${clean} refusing to serve: ${resolved.error}`);
    return null;
  }
  const aud = resolved.audience;

  const addonStatus: AddonStatus =
    row.addon_status === "included" || row.addon_status === "declined" ? row.addon_status : "undecided";

  return {
    clientId: String(row.client_id),
    slug: clean,
    // A declined add-on is off on every live page whatever `enabled` says. A preview token still opens it,
    // so the widget can be shown on a call to a client who has not bought it yet.
    enabled: row.enabled === true && addonStatus !== "declined",
    addonStatus,
    quickActions: readQuickActions(row.quick_actions),
    mascot: row.mascot === null ? null : str(row.mascot) ?? "wizard-cat",
    mascotCandidates: Array.isArray(row.mascot_candidates)
      ? (row.mascot_candidates as unknown[])
          .filter((k): k is string => typeof k === "string" && !!k.trim())
          .slice(0, 3)
      : [],
    launcherCorner: isLauncherCorner(row.launcher_corner) ? row.launcher_corner : "bottom-right",
    audience: row.audience,
    vertical: aud.researchVertical,
    vocabulary: aud.vocabulary,
    hardLines: aud.hardLines,
    laneName: aud.laneName,
    launcherLabel: aud.launcherLabel,
    buyerMarket: aud.buyerMarket,
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

function readQuickActions(raw: unknown): QuickAction[] | null {
  if (!Array.isArray(raw)) return null;
  const kinds = new Set(["audit", "magnet", "type", "booking"]);
  const out = raw
    .map((a) => a as { kind?: unknown; label?: unknown })
    .filter((a) => typeof a.kind === "string" && kinds.has(a.kind) && typeof a.label === "string" && a.label.trim())
    .map((a) => ({ kind: a.kind as QuickAction["kind"], label: String(a.label).trim().slice(0, 48) }));
  return out.length ? out.slice(0, 4) : null;
}

/**
 * The buttons under the greeting, by audience, when the row names none.
 *
 * ‼️ AN OWNER IS OFFERED THE AUDIT AND A PATIENT IS NOT. The free AI visibility audit is something SRT sells
 * to a business; on a med spa's own site the reader is a patient, and an audit button there would pitch our
 * product to our client's customers. The magnet button carries the page's own offer either way.
 */
export function quickActionsFor(config: Pick<ConciergeConfig, "audience" | "quickActions">): QuickAction[] {
  if (config.quickActions) return config.quickActions;
  return config.audience === "owner"
    ? [
        { kind: "audit", label: "Get Free AI Visibility audit (3 min)" },
        { kind: "magnet", label: "" },
        { kind: "type", label: "Type for help" },
      ]
    : [
        { kind: "magnet", label: "" },
        { kind: "type", label: "Type for help" },
      ];
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
