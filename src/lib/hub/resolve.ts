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

import { unstable_cache } from "next/cache";
import { supabaseAdmin } from "@/lib/db";

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
}

export type HostResolution =
  | { status: "ok"; host: string; kind: HubKind; client: HubClient }
  | { status: "unknown" };

const SELECT =
  "id, legal_name, dba_name, domain, website, address_line1, address_line2, city, state, " +
  "postal_code, phone, email, hours, language, review_destination_primary, review_workflow";

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

  const legalName = (c.legal_name as string | null) ?? "";
  const dbaName = (c.dba_name as string | null) ?? null;

  return {
    status: "ok",
    host: row.host,
    kind: row.kind,
    client: {
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
    },
  };
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
