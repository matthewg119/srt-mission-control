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

/** The only API route reachable on a client-controlled hostname. Named, not prefixed. */
const HUB_API = "/api/hub/reviews/submit";

export default function middleware(req: NextRequest, ev: NextFetchEvent) {
  const host = normalizeHost(req.headers.get("host"));
  const path = req.nextUrl.pathname;

  // ── EXTERNAL: a hostname somebody else's registrar points at us ─────────────
  if (classifyHost(host) === "external") {
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
