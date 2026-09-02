// Hostname to client, on the hot path of every hub request.
//
// A MISS AND A FAILURE ARE DIFFERENT FACTS AND MUST NOT COLLAPSE. `unknown` means no row:
// somebody pointed a CNAME at us who is not a client, and 404 is the honest answer. A
// thrown error means the lookup itself failed, and the honest answer there is 503. Serving
// a 404 during a Supabase blip, on pages Google has already crawled, is how a client's hub
// gets quietly deindexed — which is the one outcome this whole feature exists to prevent.
// That is the entire reason these two are not one nullable return.
//
// The lookup does NOT run in middleware. Middleware is Edge and runs on every request;
// a Supabase round trip there would be both latency and a connection amplifier. Middleware
// classifies the host (pure string work) and rewrites; this resolves, on Node, behind a
// cache.

import { unstable_cache, revalidateTag } from "next/cache";
import { supabaseAdmin } from "@/lib/db";
import { readTheme, activeTheme, type HubTheme } from "@/lib/hub/theme";
import { readSkin, activeSkin, type StoredSkin } from "@/lib/hub/skin";

export type HubKind = "hub" | "reviews";

/** The cache tag every host row shares. Re-attaching a domain busts all of them. */
export const HOSTS_TAG = "client-hosts";

/** Per client, so publishing a page invalidates that client and nobody else. */
export function pagesTag(clientId: string): string {
  return `client-pages:${clientId}`;
}

/**
 * What a hub page is allowed to know about a client.
 *
 * A deliberate subset, not `select *`. These rows render on a PUBLIC website, so the
 * default has to be that a column is invisible until somebody decides otherwise: billing
 * status, tier scope, market centre, the onboarding token hash and the whole access
 * inventory have no business travelling to a page a crawler reads.
 */
export interface HubClient {
  id: string;
  displayName: string;
  legalName: string;
  domain: string | null;
  website: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  email: string | null;
  hours: unknown;
  language: string;
  reviewDestinationPrimary: string | null;
  reviewWorkflow: Record<string, unknown> | null;
  /**
   * The theme the page may actually use, or null.
   *
   * Already through activeTheme(), so it is null until a human confirmed it (5f) and every
   * value in it has passed validation. A renderer never sees the raw column, which means a
   * renderer can never be the place a bad colour reaches a style attribute.
   */
  theme: HubTheme | null;
  /**
   * The template and ground colours the page is built on, or null.
   *
   * Gated on the SAME confirmation the theme is, because they are one decision — "the look is
   * signed off" — and two independent gates would let a hub go live half-confirmed with no
   * way to describe which half. Null renders the Document template, which is what every hub
   * built before this existed already renders.
   */
  skin: StoredSkin | null;
}

export type HostResolution =
  | { status: "ok"; host: string; kind: HubKind; client: HubClient }
  | { status: "unknown" };

const SELECT =
  "id, legal_name, dba_name, domain, website, address_line1, address_line2, city, state, " +
  "postal_code, phone, email, hours, language, review_destination_primary, review_workflow, theme, hub_skin";

async function lookup(host: string): Promise<HostResolution> {
  const { data, error } = await supabaseAdmin
    .from("client_hosts")
    .select(`host, kind, enabled, clients!inner(${SELECT})`)
    .eq("host", host)
    .eq("enabled", true)
    .maybeSingle();

  // THROW, do not return unknown. See the header: a failed lookup that 404s is how an
  // indexed client site disappears from search during an outage that lasted ten minutes.
  if (error) {
    throw new Error(`[hub/resolve] lookup failed for ${host}: ${error.message}`);
  }

  if (!data) return { status: "unknown" };

  const row = data as unknown as {
    host: string;
    kind: HubKind;
    clients: Record<string, unknown>;
  };
  const c = row.clients;
  if (!c) return { status: "unknown" };

  return { status: "ok", host: row.host, kind: row.kind, client: toHubClient(c) };
}

/**
 * One row shape to one HubClient, in one place.
 *
 * Exported because the PREVIEW resolves the same client by id instead of by hostname, and
 * a second copy of this mapping is how a preview starts quietly disagreeing with the live
 * page about which name or which address it shows.
 */
export function toHubClient(
  c: Record<string, unknown>,
  opts?: { pending?: boolean }
): HubClient {
  const legalName = (c.legal_name as string | null) ?? "";
  const dbaName = (c.dba_name as string | null) ?? null;

  // ‼️ `pending` IS FOR THE INTERNAL PREVIEW AND FOR NOTHING ELSE.
  //
  // The confirmation gate exists so a colour scraped out of a cookie banner is never a thing a
  // client discovers on a call. That is right for the live host and right for the tokenised
  // preview link, which IS shown to clients. It is wrong for the dashboard preview, whose whole
  // job is to show what has just been changed: without this, choosing a template and looking at
  // it required confirming it first, so the only way to see a design was to sign it off unseen.
  //
  // Same split the two previews already make about DRAFT PAGES, for the same reason.
  const storedTheme = readTheme(c.theme);
  const storedSkin = readSkin(c.hub_skin);
  const pending = opts?.pending === true;

  return {
    id: c.id as string,
    // The trading name is what a customer recognises, so it wins when it exists. Same
    // precedence clientDisplayName() already uses on the internal side.
    displayName: dbaName?.trim() || legalName,
    legalName,
    domain: (c.domain as string | null) ?? null,
    website: (c.website as string | null) ?? null,
    addressLine1: (c.address_line1 as string | null) ?? null,
    addressLine2: (c.address_line2 as string | null) ?? null,
    city: (c.city as string | null) ?? null,
    state: (c.state as string | null) ?? null,
    postalCode: (c.postal_code as string | null) ?? null,
    phone: (c.phone as string | null) ?? null,
    email: (c.email as string | null) ?? null,
    hours: c.hours ?? null,
    language: (c.language as string | null) ?? "en",
    reviewDestinationPrimary: (c.review_destination_primary as string | null) ?? null,
    reviewWorkflow: (c.review_workflow as Record<string, unknown> | null) ?? null,
    theme: pending
      ? // Still through the same validators — `pending` relaxes the CONFIRMATION, never the
        // validation. A colour that failed safeColor() has no business in a style attribute on
        // an internal page either.
        activeTheme({ ...storedTheme, confirmedAt: storedTheme.confirmedAt ?? "pending" })
      : activeTheme(storedTheme),
    skin: pending
      ? storedSkin
      : activeSkin(storedSkin, storedTheme.confirmedAt),
  };
}

/**
 * The preview's resolver: by client id, NOT by hostname, and DELIBERATELY UNCACHED.
 *
 * Uncached because the entire purpose of a preview is to show the newest draft. Five
 * minutes of ISR is right for a crawler and wrong for somebody who just hit save and is
 * about to walk a client through the result on a call.
 *
 * This never touches client_hosts, so a preview works before a single domain is attached
 * — which is the point: 5f wants the client to see the hub BEFORE the DNS conversation.
 */
export async function loadClientForPreview(
  clientId: string,
  opts?: { pending?: boolean }
): Promise<HubClient | null> {
  const { data, error } = await supabaseAdmin
    .from("clients")
    .select(SELECT)
    .eq("id", clientId)
    .maybeSingle();

  if (error) throw new Error(`[hub/resolve] preview load failed: ${error.message}`);
  if (!data) return null;

  return toHubClient(data as unknown as Record<string, unknown>, opts);
}

const cached = unstable_cache(lookup, ["hub-host"], {
  // Five minutes. A newly attached host starts serving without a deploy, and a disabled
  // one stops, both within one TTL — while a crawl burst still costs one query.
  revalidate: 300,
  tags: [HOSTS_TAG],
});

/**
 * Resolve a hostname to its client.
 *
 * Returns `{ status: "unknown" }` on a miss. THROWS when the lookup itself fails; callers
 * map that to 503, never to 404.
 *
 * No in-process Map in front of this: a warm-lambda Map has no cross-instance invalidation
 * path, so a disabled or renamed host would keep serving from some regions for the life of
 * the container. `unstable_cache` plus `revalidateTag` has one, and that trade is not close.
 */
export async function resolveHost(rawHost: string): Promise<HostResolution> {
  const host = rawHost.trim().toLowerCase();
  if (!host) return { status: "unknown" };
  return cached(host);
}

/**
 * Bust the host cache because the CLIENT RECORD changed, not because a host was attached.
 *
 * The cached resolution carries the client's name, address, phone and website — so a NAP
 * correction is a hub content change, and until this existed nothing told the cache that.
 * `registerClientHosts` was the only caller of revalidateTag(HOSTS_TAG), which meant a
 * client whose address was corrected on the call kept serving the old one, in the
 * LocalBusiness schema, for up to five minutes.
 *
 * Five minutes is survivable. Being wrong about the canonical NAP is the one thing this
 * product cannot be wrong about, so it is worth the one line at each write.
 *
 * Guarded for the same reason the attach path guards it: outside a request context
 * revalidateTag throws, and failing to bust a cache that expires anyway must never undo a
 * database write that already succeeded.
 */
export function revalidateClientHub(): void {
  try {
    revalidateTag(HOSTS_TAG);
  } catch {
    // Not in a request (a cron, a script). The TTL covers it.
  }
}
