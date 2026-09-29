// Destinations: where a published page actually lives, and the one function that says so.
//
// ‼️ WHY THIS MODULE EXISTS. Before it, a page's URL was implied: every public URL in the
// hub was composed inline as `https://${host}/${slug}` from whatever host the caller
// happened to be holding. That is correct exactly while a client has one hub subdomain and
// nothing else, and it is wrong the moment a client publishes to a subfolder on their own
// domain -- silently, as a canonical tag pointing at a hostname the page is not served on,
// which is the single most expensive thing to get wrong on a page we are asking engines to
// trust.
//
// ‼️ siteUrl() IS THE ONLY WAY TO BUILD A PUBLIC PAGE URL. Canonical, OG, sitemap,
// llms.txt, the JSON-LD on the page itself, the URL announced on publish and the URL
// written into the delivery checklist all flow from it. A second composition is not a
// duplicate string, it is a second answer to "where does this page live", and the two go
// out of step on the first client who is not on a subdomain.
//
// ‼️ EXPORT IS NOT A DESTINATION AND HAS NO ROW. It is always available to every client,
// it writes nothing, and it is deliberately absent from this file: a destination is
// somewhere we can put a page, and an export is a file handed to somebody else.

import { supabaseAdmin } from "@/lib/db";

/** How a destination is delivered. Orthogonal to `kind`, which is what is served. */
export type Delivery = "subdomain" | "subfolder" | "cms";

/**
 * One wired destination. The shape every consumer reads; nothing downstream touches
 * client_hosts columns directly, so the subdomain/subfolder difference is resolved once.
 */
export interface Destination {
  id: string;
  clientId: string;
  /** The hostname we attached (subdomain), or the hostname whose owner proxies to us (subfolder). */
  host: string;
  kind: "hub" | "reviews";
  delivery: Delivery;
  /** '/learn', no trailing slash. Null on a subdomain. */
  basePath: string | null;
  /** 'https://srtagency.com', no trailing slash. Null on a subdomain. */
  publicOrigin: string | null;
  /** Routing key for /s/{siteKey}. Null on a subdomain. */
  siteKey: string | null;
  enabled: boolean;
}

const COLUMNS = "id, client_id, host, kind, delivery, base_path, public_origin, site_key, enabled";

function toDestination(r: Record<string, unknown>): Destination {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    host: String(r.host),
    kind: r.kind === "reviews" ? "reviews" : "hub",
    delivery: (r.delivery === "subfolder" || r.delivery === "cms" ? r.delivery : "subdomain") as Delivery,
    basePath: typeof r.base_path === "string" && r.base_path ? r.base_path : null,
    publicOrigin: typeof r.public_origin === "string" && r.public_origin ? r.public_origin : null,
    siteKey: typeof r.site_key === "string" && r.site_key ? r.site_key : null,
    enabled: r.enabled !== false,
  };
}

/**
 * THE ONE PLACE A PUBLIC PAGE URL IS BUILT.
 *
 * `slug` omitted or empty means the destination's index.
 *
 * ‼️ NO TRAILING SLASH ON A SLUG URL, AND A TRAILING SLASH ON THE SUBDOMAIN INDEX. That is
 * not taste, it is what the eight literals this replaced already emitted, and a canonical
 * tag that disagrees with the URL the page is actually served at by one slash is a
 * canonical tag pointing at a redirect.
 */
export function siteUrl(dest: Destination, slug?: string | null): string {
  const clean = (slug ?? "").replace(/^\/+/, "").trim();

  if (dest.delivery === "subdomain") {
    // The site IS the root of the hostname, so the index keeps the trailing slash it has
    // always had and a page hangs straight off it.
    return clean ? `https://${dest.host}/${clean}` : `https://${dest.host}/`;
  }

  // Subfolder and cms both live at a path on somebody else's origin. The index is the base
  // path itself with NO trailing slash, because that is the URL their proxy rule matches
  // and the one their server will answer without a redirect.
  const origin = dest.publicOrigin ?? `https://${dest.host}`;
  const base = dest.basePath ?? "";
  return clean ? `${origin}${base}/${clean}` : `${origin}${base}`;
}

/** Every destination wired for this client, enabled or not. The picker shows them all. */
export async function listDestinations(clientId: string): Promise<Destination[]> {
  const { data, error } = await supabaseAdmin
    .from("client_hosts")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .order("kind")
    .order("delivery");

  // ‼️ A READ FAILURE IS NOT AN EMPTY LIST, and the caller has to be able to tell. An empty
  // array here would render a picker saying this client has nowhere to publish, which is a
  // statement about the client rather than about Supabase being down.
  if (error) throw new Error(`Could not read destinations: ${error.message}`);
  return (data ?? []).map((r) => toDestination(r as Record<string, unknown>));
}

/**
 * The destinations a PAGE may be published to: the hub lanes only.
 *
 * `reviews` is a destination in the table because it is a hostname we attached, and it is
 * not one here: it serves the referral engine, and a page published onto it would replace
 * the tool a client is handing to their customers.
 */
export async function publishableDestinations(clientId: string): Promise<Destination[]> {
  return (await listDestinations(clientId)).filter((d) => d.kind === "hub" && d.enabled);
}

/**
 * The subdomain hub, which is what every page published before destinations existed went
 * to.
 *
 * ‼️ THIS IS NOT A DEFAULT AND MUST NOT BECOME ONE. It is how an existing page is RENDERED
 * when its destination_id is null -- the honest reading of a row written when there was
 * only one place to publish. It is deliberately not consulted when somebody is choosing
 * where a new page goes: see resolveDestination.
 */
export async function hubDestination(clientId: string): Promise<Destination | null> {
  const { data, error } = await supabaseAdmin
    .from("client_hosts")
    .select(COLUMNS)
    .eq("client_id", clientId)
    .eq("kind", "hub")
    .eq("delivery", "subdomain")
    .maybeSingle();

  if (error) throw new Error(`Could not read the hub destination: ${error.message}`);
  return data ? toDestination(data as Record<string, unknown>) : null;
}

/** The destination a published page went to, falling back to the subdomain hub for old rows. */
export async function destinationForPage(
  clientId: string,
  destinationId: string | null
): Promise<Destination | null> {
  if (!destinationId) return hubDestination(clientId);

  const { data, error } = await supabaseAdmin
    .from("client_hosts")
    .select(COLUMNS)
    .eq("id", destinationId)
    .maybeSingle();

  if (error) throw new Error(`Could not read that destination: ${error.message}`);
  if (!data) return hubDestination(clientId);

  const dest = toDestination(data as Record<string, unknown>);
  // A page pointing at another client's destination is a data fault, not a URL to build.
  return dest.clientId === clientId ? dest : null;
}

export type DestinationChoice =
  | { ok: true; destination: Destination }
  | { ok: false; error: string };

/**
 * Turn what the picker sent into a destination, or refuse.
 *
 * ‼️ WITH MORE THAN ONE DESTINATION WIRED, NOTHING IS CHOSEN FOR THE CALLER. A silent
 * default here is how a page lands on the wrong domain with nobody having decided it
 * should, and on a client's own indexed domain that is not an edit, it is a retraction.
 * clients.default_destination_id pre-ticks the control; it is not read here on purpose.
 *
 * One destination is not a choice, so it resolves without asking -- that is the state every
 * client is in today and a picker demanding an answer to a question with one possible
 * answer is a step nobody can learn anything from.
 */
export async function resolveDestination(
  clientId: string,
  destinationId: string | null | undefined
): Promise<DestinationChoice> {
  const wired = await publishableDestinations(clientId);

  if (wired.length === 0) {
    return {
      ok: false,
      error:
        "This client has no destination wired yet, so there is nowhere to publish. Attach the hub host first, or export the page instead.",
    };
  }

  if (destinationId) {
    const picked = wired.find((d) => d.id === destinationId);
    if (!picked) {
      return {
        ok: false,
        error: "That destination does not belong to this client, or it is no longer enabled.",
      };
    }
    return { ok: true, destination: picked };
  }

  if (wired.length === 1) return { ok: true, destination: wired[0] };

  return {
    ok: false,
    error: `This client has ${wired.length} destinations wired. Choose which one this page goes to: ${wired
      .map((d) => destinationLabel(d))
      .join(", ")}.`,
  };
}

/** How a destination reads on a card or a picker. The URL its index would have. */
export function destinationLabel(dest: Destination): string {
  const where = siteUrl(dest).replace(/^https:\/\//, "").replace(/\/$/, "");
  return dest.delivery === "subdomain" ? where : `${where} (their site)`;
}
