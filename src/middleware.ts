// HOSTNAME DECIDES FIRST. Then path. Then session. Never the reverse.
//
// Mission Control now answers on hostnames whose DNS a CLIENT controls: learn.{their
// domain} and reviews.{theirdomain} resolve to this same deployment. The hostname decides
// WHICH APPLICATION a request is allowed to be talking to; only after that does a route's
// own auth() decide whether the caller may do the thing. This file is a deny filter layered
// on top of the existing per-route checks and it is NEVER a replacement for one — every
// /api/clients/* route keeps calling auth() itself. CVE-2025-29927 (middleware skippable
// via x-middleware-subrequest, fixed in 14.2.25; this repo is on 14.2.28) is the standing
// argument for why: middleware must never be the only thing protecting a route.
//
// DENY BY DEFAULT, and it is an ALLOWLIST of hub paths rather than a denylist of internal
// ones. A denylist that missed one would be catastrophic in a specific way: /api/scan/*,
// /api/leads/funnel, /api/onboarding/save and /api/clients/start are PUBLIC BY DESIGN and
// take no session, so on a client-controlled hostname they would become a lead-injection
// endpoint and a model-spend faucet. A new /api route added next month is refused here
// without anybody remembering to think about it. That asymmetry is the whole design.
//
// NO DATABASE HERE. This runs on the Edge on every document request. Host CLASSIFICATION
// is pure string work; host RESOLUTION (which client) happens in the hub layout, on Node,
// behind a cache. See src/lib/hub/resolve.ts.

import { NextResponse, type NextRequest, type NextFetchEvent } from "next/server";
import { auth } from "@/lib/auth";
import { classifyHost, normalizeHost } from "@/lib/hub/host-classify";

/**
 * A bare 404. Never 401 or 403, which confirm the route exists, and never a redirect to
 * /login — a redirect issued from a host the client's DNS controls is an open-redirect
 * primitive, and pointing their staff at an SRT login form on their own domain is the
 * phishing surface this whole file exists to remove.
 */
function notFound(json: boolean): NextResponse {
  const headers: Record<string, string> = {
    "x-robots-tag": "noindex, nofollow",
    "cache-control": "no-store",
  };
  return json
    ? NextResponse.json({ error: "Not found" }, { status: 404, headers })
    : new NextResponse("Not found", {
        status: 404,
        headers: { ...headers, "content-type": "text/plain; charset=utf-8" },
      });
}

/** The per-host generated files. Rewritten, because public/robots.txt is the app's own. */
const HUB_FILES = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt"]);

/**
 * One page segment. No slash, no dot, no encoded traversal — so nothing under /api or
 * /dashboard can match, and neither can /foo.php. The hub's whole public surface is the
 * index plus one level of slugs.
 */
const HUB_SLUG = /^\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * The only API route reachable on a client-controlled hostname.
 *
 * ‼️ A NAME, NOT A PREFIX, AND IT STAYS THAT WAY. Turning this into a startsWith on
 * "/api/hub/" would publish every present and future route under that folder on every
 * hostname a client's registrar points at us. The hit log deliberately lives outside that
 * folder for the same reason -- see HIT_ENDPOINT below.
 */
const HUB_API = "/api/hub/reviews/submit";

/**
 * Where the hit log is posted.
 *
 * Under /api/internal/ rather than /api/hub/, so that the "name, not a prefix" rule above
 * cannot be relaxed into publishing a database write endpoint on a client's domain. It is
 * already refused on external hosts by the allowlist with no rule of its own: HUB_SLUG
 * forbids slashes, so a two-segment path can never match.
 */
const HIT_ENDPOINT = "/api/internal/hub-hit";

/**
 * The concierge frame document: /w/{client-slug}, one segment, same shape rule as HUB_SLUG.
 *
 * No dot, no slash, no encoded traversal, so /w/../api/anything cannot match and neither can
 * /w/foo.php. The slug is `clients.slug`, which is already unique-constrained, so the embed
 * snippet a clinic pastes into their site carries a name they recognise rather than a uuid.
 */
const CONCIERGE_FRAME = /^\/w\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * Record one hub request, out of band.
 *
 * WHY HERE. The hub pages are ISR (revalidate = 300), so a server component runs on
 * regeneration rather than on request and cannot count anything. And a browser beacon --
 * the existing /api/marketing/page-visit pattern -- cannot see GPTBot, OAI-SearchBot or
 * PerplexityBot at all, because they do not run JavaScript. Middleware is the only place
 * that sees every request, and AI crawlers are the audience this whole product is sold on.
 *
 * NO DATABASE WORK HAPPENS HERE. This builds a small JSON body and posts it to a Node route
 * that does the resolving and the hashing. The file's own rule stands.
 *
 * ‼️ IT MUST NOT BE ABLE TO AFFECT THE RESPONSE. It is called inside waitUntil on a
 * response that has already been returned, and it swallows everything. A hub page rendering
 * correctly may never depend on the analytics row landing.
 */
function logHubHit(req: NextRequest, host: string, path: string): Promise<void> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  const secret = process.env.CRON_SECRET;
  if (!appUrl || !secret) return Promise.resolve();

  // Vercel APPENDS the real client IP to any x-forwarded-for the caller sent, so index 0 is
  // whatever a caller chose to write. Same reasoning, and the same ordering, as
  // clientIpFrom() in src/lib/scan/session.ts.
  const ip =
    req.ip ??
    req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() ??
    req.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ??
    null;

  return fetch(`${appUrl}${HIT_ENDPOINT}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-hub-hit-secret": secret },
    body: JSON.stringify({
      host,
      path,
      ua: req.headers.get("user-agent"),
      ip,
      referrer: req.headers.get("referer"),
    }),
    // A hung ingest must not hold an edge invocation open behind a response that has
    // already been sent.
    signal: AbortSignal.timeout(2000),
  })
    .then(() => undefined)
    .catch(() => undefined);
}

/**
 * Is this a request worth counting?
 *
 * Only the things the allowlist cannot already see. By the time this runs, HUB_SLUG has
 * refused anything containing a dot, and the matcher has excluded _next/static and
 * _next/image, so there is no asset path left to filter and a file-extension regex here
 * would be dead code.
 *
 * Header reads and string compares only. No allocation, no database, no exceptions.
 */
function isCountable(req: NextRequest): boolean {
  // No secret means no ingest route to talk to. Checked first so an unconfigured
  // deployment does not fire a fetch per request that can only ever 404.
  if (!process.env.CRON_SECRET || !process.env.NEXT_PUBLIC_APP_URL) return false;

  // HEAD is what link checkers and uptime monitors send. A crawler that HEADs and then GETs
  // is counted once, on the GET, which is the fetch that actually read the page.
  if (req.method !== "GET") return false;

  // Next prefetches a link before anybody clicks it, and fetches an RSC payload on a soft
  // navigation. Counting either reports a visit to a page nobody opened.
  if (req.headers.has("next-router-prefetch")) return false;
  if (req.headers.has("rsc")) return false;
  const purpose = req.headers.get("purpose") ?? req.headers.get("x-purpose");
  if (purpose === "prefetch" || purpose === "preview") return false;
  if (req.headers.get("sec-purpose")?.includes("prefetch")) return false;

  // A PRESENT non-document destination is a subresource. A MISSING one is deliberately
  // allowed through: crawlers and curl do not send Sec-Fetch-*, and they are precisely the
  // requests this whole feature exists to count.
  const dest = req.headers.get("sec-fetch-dest");
  if (dest && dest !== "document") return false;

  // ‼️ The generated files ARE counted. A GPTBot fetch of llms.txt is some of the
  // strongest crawler evidence available and it is low volume. They carry no client_pages
  // row, so the ingest route allows them by name and they appear as their own rows.
  return true;
}

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  const host = normalizeHost(req.headers.get("host"));
  const path = req.nextUrl.pathname;
  const hostClass = classifyHost(host);

  // ── CONCIERGE: the widget hostname, ours, pasted into third-party pages ─────
  //
  // An allowlist of three shapes and a 404 for everything else, the same deny-by-default
  // posture as the hub branch and for a sharper reason: this hostname's whole job is to be
  // embedded in web pages we do not control, so its URL is public by design and will be
  // crawled, shared and probed. It must expose the widget and nothing adjacent to it.
  //
  // ‼️ /api/concierge/ IS A PREFIX HERE, AND THAT IS ONLY SAFE BECAUSE THIS HOST IS OURS.
  // The identical relaxation on the external branch is forbidden (see HUB_API above) because
  // there the hostname belongs to a client's registrar. Do not read this as permission to
  // loosen that one.
  if (hostClass === "concierge") {
    const ok =
      path === "/embed.js" ||
      CONCIERGE_FRAME.test(path) ||
      path === "/api/concierge" ||
      path.startsWith("/api/concierge/");
    if (!ok) return notFound(path.startsWith("/api/"));
    return NextResponse.next();
  }

  // ── EXTERNAL: a hostname somebody else's registrar points at us ─────────────
  if (hostClass === "external") {
    // The hub's internal path is not a public route. It is reachable only by the rewrite
    // below, so asking for it directly is a miss like any other.
    if (path === "/hub" || path.startsWith("/hub/")) return notFound(false);

    // The review tool's submit endpoint. The host travels as a request header rather than
    // in the path: an API route has no full-route cache to key, so there is nothing here
    // for a header to leak across.
    if (path === HUB_API) {
      const headers = new Headers(req.headers);
      headers.set("x-hub-host", host);
      return NextResponse.next({ request: { headers } });
    }

    const isHubPath = path === "/" || HUB_FILES.has(path) || HUB_SLUG.test(path);
    if (!isHubPath) return notFound(path.startsWith("/api/"));

    // REWRITE, never redirect. The host goes in the PATH and not in a header, because
    // Next's full-route cache keys on the pathname: two clients sharing the path /pricing
    // behind an ISR cache keyed only by path would serve one clinic's page on the other
    // clinic's hostname. The host segment is what keeps those cache entries disjoint.
    const url = req.nextUrl.clone();
    url.pathname = `/hub/${host}${path === "/" ? "" : path}`;

    // AFTER the allowlist, so nothing refused above is ever counted, and out of band so the
    // rewrite below is returned at the same speed it always was.
    if (isCountable(req)) ev.waitUntil(logHubHit(req, host, path));

    return NextResponse.rewrite(url);
  }

  // ── INTERNAL: mission.srtagency.com, previews, localhost ────────────────────

  // The hub is never double-served. The same page answering on a noindex host is a
  // canonical mess, and it keeps the two applications disjoint in both directions.
  if (path === "/hub" || path.startsWith("/hub/")) return notFound(false);

  // Unchanged from before the hub existed: NextAuth's own guard, on /dashboard only.
  // Everything else on this host keeps whatever protection it already had.
  if (path === "/dashboard" || path.startsWith("/dashboard/")) {
    return (auth as unknown as (r: NextRequest, e: NextFetchEvent) => Promise<Response>)(req, ev);
  }

  // x-hub-host is set by the external branch above and is the review submit route's only
  // statement of which client it is writing for. Strip any copy that arrived from outside,
  // so the header cannot be forged by hand-crafting a request to the internal host. The
  // external branch overwrites rather than appends, so this is the only remaining way in.
  if (req.headers.has("x-hub-host")) {
    const headers = new Headers(req.headers);
    headers.delete("x-hub-host");
    return NextResponse.next({ request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  // EVERY path, minus what the CDN serves without ever reaching a function. The rule is
  // "everything not explicitly internal is external", and that cannot be expressed as a
  // static matcher: a host-based matcher can only enumerate the hosts we already know,
  // which is exactly the set that was already safe. Deny-by-default requires seeing
  // everything.
  //
  // The favicons are excluded rather than allowlisted. They are the same bytes for every
  // host and an icon is not a leak.
  matcher: ["/((?!_next/static|_next/image|favicon\.ico|favicon\.svg).*)"],
};
