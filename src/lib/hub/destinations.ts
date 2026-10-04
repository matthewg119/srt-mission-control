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
  /**
   * ‼️ `site` ARRIVED WITH THE LAUNCH LANE AND IS A THIRD THING, not a synonym for `hub`.
   * A Launch Lane client's whole website is on a domain SRT bought: the apex serves their pasted
   * marketing pages and the answer pages live one level down under /answers. So it is a hub-shaped
   * destination whose answers are NOT at the root, which is what basePath below now carries.
   */
  kind: "hub" | "reviews" | "site";
  delivery: Delivery;
  /** '/learn', no trailing slash. Null on a subdomain. */
  basePath: string | null;
  /** 'https://srtagency.com', no trailing slash. Null on a subdomain. */
  publicOrigin: string | null;
  /** Routing key for /s/{siteKey}. Null on a subdomain. */
  siteKey: string | null;
  enabled: boolean;
}

export const DESTINATION_COLUMNS =
  "id, client_id, host, kind, delivery, base_path, public_origin, site_key, enabled";

const COLUMNS = DESTINATION_COLUMNS;

/**
 * One client_hosts row to one Destination, in one place.
 *
 * Exported for the same reason toHubClient is: resolveHost() reads client_hosts by
 * hostname with the client joined on, so it holds these columns already and building the
 * Destination a second way there is how the live page and the board start disagreeing
 * about where a page lives.
 */
export function destinationFromRow(r: Record<string, unknown>): Destination {
  return toDestination(r);
}

function toDestination(r: Record<string, unknown>): Destination {
  return {
    id: String(r.id),
    clientId: String(r.client_id),
    host: String(r.host),
    kind: r.kind === "reviews" ? "reviews" : r.kind === "site" ? "site" : "hub",
    delivery: (r.delivery === "subfolder" || r.delivery === "cms" ? r.delivery : "subdomain") as Delivery,
    // ‼️ A `site` HOST SERVES ITS ANSWERS UNDER /answers, AND THAT DEFAULT LIVES HERE RATHER THAN
    // IN THE ROW. The launch lane computed `kind === "site" ? "/answers" : ""` separately at every
    // call site that built a URL, which is the inline composition this module's header exists to
    // abolish: the canonical tag, the sitemap, the llms.txt entry and the URL announced on publish
    // were four chances to forget it. Defaulting here rather than backfilling a column also means
    // every row written before the launch lane existed reads correctly with no migration.
    basePath:
      typeof r.base_path === "string" && r.base_path
        ? r.base_path
        : r.kind === "site"
          ? "/answers"
          : null,
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
    // ‼️ basePath IS HONOURED HERE TOO, AND IT USED TO BE IGNORED. On an ordinary hub subdomain it
    // is null and this is exactly what it always was: the site IS the root of the hostname, so the
    // index keeps the trailing slash it has always had and a page hangs straight off it. A `site`
    // host is the same hostname with its answers one level down, which is a base path and not a
    // third delivery mode. Ignoring it here is what sent a Launch Lane canonical to the apex.
    const base = dest.basePath ?? "";
    if (!base) return clean ? `https://${dest.host}/${clean}` : `https://${dest.host}/`;
    return clean ? `https://${dest.host}${base}/${clean}` : `https://${dest.host}${base}`;
  }

  // Subfolder and cms both live at a path on somebody else's origin. The index is the base
  // path itself with NO trailing slash, because that is the URL their proxy rule matches
  // and the one their server will answer without a redirect.
  const origin = dest.publicOrigin ?? `https://${dest.host}`;
  const base = dest.basePath ?? "";
  return clean ? `${origin}${base}/${clean}` : `${origin}${base}`;
}

/**
 * The ORIGIN a destination sits on, with no base path. `https://x.com`, no trailing slash.
 *
 * ‼️ NOT A SECOND URL BUILDER, AND THE DIFFERENCE IS WHAT IT IS FOR. siteUrl() answers "where
 * does this ANSWER PAGE live" and now prepends /answers on a `site` host. A Launch Lane site also
 * serves MARKETING pages at one-segment paths off the root, which are not answers and must not
 * get that prefix. Both still resolve the host the same way, in this module, so a subfolder
 * client's marketing root is their origin and not the hostname that served the request.
 */
export function siteRoot(dest: Destination): string {
  return dest.publicOrigin ?? `https://${dest.host}`;
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
  // ‼️ `site` IS PUBLISHABLE AND `reviews` IS NOT, AND LEAVING `site` OUT WAS A REAL BUG IN THE
  // MERGE. A Launch Lane client's only destination is its `site` host, so filtering to `hub`
  // alone made resolveDestination answer "this client has no destination wired yet" and refuse
  // every publish on the entire lane. `reviews` stays out for the reason above: a page published
  // onto it would replace the tool the client hands to their customers.
  return (await listDestinations(clientId)).filter(
    (d) => (d.kind === "hub" || d.kind === "site") && d.enabled
  );
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

/**
 * An in-memory subdomain destination for a surface that is not serving a real one.
 *
 * ‼️ THIS IS FOR PREVIEWS, AND IT EXISTS SO THERE IS STILL ONLY ONE COMPOSITION. The three
 * preview surfaces (the tokenised client link, the dashboard preview, and the HTML file
 * posted to Slack) render the production components against a hostname rather than a
 * client_hosts row -- a draft page has no destination yet, which is the whole point of a
 * preview. Without this they would each need a `https://${host}/${slug}` fallback, which is
 * three more places answering "where does this page live", and the previews are exactly
 * where a wrong answer is least likely to be noticed.
 *
 * It is not written anywhere and has no id, because it is not a destination anybody chose.
 */
export function subdomainDestination(
  clientId: string,
  host: string,
  // ‼️ A LAUNCH LANE PREVIEW IS PREVIEWING A `site` HOST, WHOSE ANSWERS ARE UNDER /answers.
  // Defaulting to "hub" here and letting the launch preview pass "site" keeps every existing
  // caller unchanged while making the previewed canonical and JSON-LD match the URL the page
  // will actually be published to. A preview that shows a canonical one level off is a preview
  // that cannot be used to check the thing canonicals exist to check.
  kind: "hub" | "site" = "hub"
): Destination {
  return {
    id: "",
    clientId,
    host,
    kind,
    delivery: "subdomain",
    basePath: kind === "site" ? "/answers" : null,
    publicOrigin: null,
    siteKey: null,
    enabled: true,
  };
}

/**
 * May a subfolder destination be wired for this client right now?
 *
 * ‼️ THE GATE IS ON WIRING, NOT ON PUBLISHING, AND THE DIFFERENCE IS WHOSE PROBLEM IT IS.
 * A subdomain we serve ourselves: if the crawlers cannot read it, that is our doing and our fix.
 * A subfolder is proxied through THEIR server, so a closed door means every page we put there is
 * invisible to the engines from the day it goes live, and nothing we do afterwards changes that.
 * Wiring one into a closed door is selling somebody a page nobody can read.
 *
 * ‼️ AND IT IS FRAMED FOR THE SALE RATHER THAN AS A BLOCKER. Fixing a robots.txt is week
 * one of the paid work, not a reason they cannot buy it. The refusal says that.
 *
 * A door that has never been READ does not refuse. Absent beats forbidden: an unmeasured door is
 * not evidence of a closed one, and the same rule keeps site_signals and MxVerdict honest.
 */
export async function subfolderAllowed(
  clientId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { lastDoor } = await import("@/lib/clients/crawler-door");
  const door = await lastDoor(clientId).catch(() => null);

  if (!door) return { ok: true };
  if (!door.closed) return { ok: true };

  return {
    ok: false,
    error:
      `The AI crawlers cannot read this client's site right now${
        door.agents.length ? ` (${door.agents.join(", ")} are disallowed)` : ""
      }. A subfolder is served through their own server, so every page put there would be ` +
      `invisible to the engines from the day it went live. Opening that door is week one of the ` +
      `work, not a reason they cannot buy it. Fix it, re-run the site intel step, and wire this ` +
      `afterwards.`,
  };
}

/** How a destination reads on a card or a picker. The URL its index would have. */
export function destinationLabel(dest: Destination): string {
  const where = siteUrl(dest).replace(/^https:\/\//, "").replace(/\/$/, "");
  return dest.delivery === "subdomain" ? where : `${where} (their site)`;
}
