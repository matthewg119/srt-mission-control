// WHICH PATHS A CLIENT-CONTROLLED HOSTNAME MAY ASK FOR. Pure, edge-safe, imports nothing.
//
// This is the second half of the security boundary whose first half is classifyHost(). It lives
// here for the reason that file's own header gives: the one thing standing between a client's DNS
// zone and the CRM should fit on a screen and be testable without a database. It used to be four
// constants and a boolean expression inlined in src/middleware.ts, where nothing could reach it.
// scripts/_probe-hub-allowlist.ts now does.
//
// ‼️ DENY BY DEFAULT. AN ALLOWLIST OF HUB PATHS, NEVER A DENYLIST OF INTERNAL ONES.
// A denylist that missed one would be catastrophic in a specific way: /api/scan/*,
// /api/leads/funnel, /api/onboarding/save and /api/clients/start are PUBLIC BY DESIGN and take no
// session, so on a hostname a client's registrar controls they would be a lead-injection endpoint
// and a model-spend faucet. A new /api route added next month is refused here without anybody
// remembering to think about it. That asymmetry is the whole design.
//
// ‼️ NOTHING HERE KNOWS WHICH CLIENT OR WHICH KIND OF HOST IT IS.
// Middleware has no database, by design, so every external hostname gets the SAME answer from
// this file and the branch on `hub` / `reviews` / `site` happens in the route, after
// resolveHost(). A path allowed for one kind is therefore allowed on all of them, and the route
// behind it is what 404s. Keep that in mind before widening anything below: the blast radius of a
// new pattern is every hostname any client has ever pointed at us.

/** The per-host generated files. Rewritten, because public/robots.txt is the app's own. */
export const HUB_FILES: ReadonlySet<string> = new Set(["/robots.txt", "/sitemap.xml", "/llms.txt"]);

/**
 * One page segment. No slash, no dot, no encoded traversal — so nothing under /api or /dashboard
 * can match, and neither can /foo.php. The hub's whole public surface is the index plus one level
 * of slugs, and a Launch Lane site's marketing pages are the same shape.
 */
export const HUB_SLUG = /^\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * The answer pages of a Launch Lane site: /answers, and /answers/{one-slug}.
 *
 * ‼️ TWO SEGMENTS, WHICH RELAXES HUB_SLUG's "NO SLASH" RULE, SO IT IS SPELLED OUT IN FULL.
 *
 * HUB_SLUG forbids a slash outright, and HIT_ENDPOINT's safety rests on that: it is how
 * /api/internal/hub-hit is refused with no rule of its own. This does not weaken it, because the
 * FIRST segment is the literal word `answers`. Nothing under /api, /dashboard, /hub or /_next can
 * match, and neither can /answers/../anything: the second segment carries the same no-dot,
 * no-slash shape as HUB_SLUG.
 *
 * Written as one anchored literal deliberately. The tempting version is
 * `path.startsWith("/answers/")`, which is exactly the mistake HUB_API's comment forbids: a
 * prefix publishes every present and future path under that folder on every client hostname.
 */
export const HUB_ANSWER = /^\/answers(?:\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?)?$/;

/**
 * The only API routes reachable on a client-controlled hostname.
 *
 * ‼️ NAMES, NOT A PREFIX, AND IT STAYS THAT WAY. Turning this into a startsWith on "/api/hub/"
 * would publish every present and future route under that folder on every hostname a client's
 * registrar points at us. The hit log deliberately lives outside that folder for the same reason.
 *
 * ‼️ IT BECAME A SET OF TWO ON 2026-10-05 AND THAT IS NOT A RELAXATION. The referral invite is a
 * second write the customer-facing walk has to make, and the alternative to listing it here was
 * folding it into the submit route, which would have put a friend's phone number in the same
 * request body that writes review_tool_submissions. Keeping them two routes is what keeps them
 * two tables. Every addition to this set is a new public surface on dozens of domains we do not
 * control, so add one only when the customer-facing walk genuinely cannot work without it.
 */
export const HUB_API: ReadonlySet<string> = new Set([
  "/api/hub/reviews/submit",
  "/api/hub/reviews/invite",
]);

/**
 * Does this path SHAPE look like a hub page?
 *
 * ‼️ THIS IS NOT THE SECURITY DECISION AND MUST NOT BE READ AS ONE.
 * It answers true for `/dashboard`, `/login` and `/api`, because all three are one segment and
 * this only knows about shape. What makes those harmless is the REWRITE, not this predicate:
 * see externalPathDecision() below, which is the whole decision and the thing to call.
 */
export function isHubShape(path: string): boolean {
  return path === "/" || HUB_FILES.has(path) || HUB_SLUG.test(path) || HUB_ANSWER.test(path);
}

/**
 * What an external, client-controlled hostname gets for this path. THE WHOLE DECISION.
 *
 * ‼️ ONE FUNCTION RATHER THAN THREE CHECKS THE CALLER REMEMBERS TO ORDER CORRECTLY.
 * The order below is load-bearing and used to live inline in middleware, where a probe could see
 * the pieces but not the sequence. Testing a fragment of this is actively misleading: reading
 * `isHubShape("/dashboard") === true` on its own suggests a hole that does not exist.
 *
 * ‼️ WHY ALLOWING `/dashboard` IS SAFE, WRITTEN DOWN SO NOBODY "FIXES" IT.
 * Everything that returns "rewrite" is sent to `/hub/{host}{path}` and can only ever resolve to
 * a page belonging to THAT host's client. `/dashboard` becomes `/hub/learn.x.com/dashboard`,
 * which is a lookup for a published page with the slug "dashboard" and 404s. The real
 * `/dashboard` route is never reached, because a rewritten request never returns to the root of
 * the route tree. Adding a denylist of internal names here would be cargo cult: it would imply
 * the rewrite is not what protects them, and the next person would trust the denylist instead.
 *
 * The genuine protection is HUB_SLUG's NO-SLASH rule, which is what refuses
 * `/api/clients/start`, `/api/scan/*` and every other multi-segment internal route without
 * naming any of them.
 */
export type ExternalPathDecision =
  /** 404. Never 401/403 (which confirm the route exists) and never a redirect. */
  | "refuse"
  /** The review submit endpoint: forwarded with an x-hub-host header, not rewritten. */
  | "forward_api"
  /** Rewritten into /hub/{host}{path}. */
  | "rewrite";

export function externalPathDecision(path: string): ExternalPathDecision {
  // ‼️ FIRST, AND BEFORE THE SHAPE CHECK. `/hub` and `/hub/...` are one and two segments
  // respectively, so the shape check would pass `/hub` straight through. The internal path is
  // reachable only by the rewrite below; asking for it directly is a miss like any other, and
  // allowing it would let one client's hostname address another client's subtree.
  if (path === "/hub" || path.startsWith("/hub/")) return "refuse";

  // The AI Referral Engine's submit endpoint. The host travels as a request header rather than
  // in the path: an API route has no full-route cache to key, so there is nothing for a header
  // to leak across.
  if (HUB_API.has(path)) return "forward_api";

  return isHubShape(path) ? "rewrite" : "refuse";
}

/**
 * The internal path an external request is rewritten to.
 *
 * ‼️ THE HOST GOES IN THE PATH, NOT IN A HEADER. Next's full-route cache keys on the pathname, so
 * two clients both publishing /pricing behind a header-based lookup would share one cache entry
 * and serve each other's page. The host segment is what keeps them disjoint.
 */
export function hubRewritePath(host: string, path: string): string {
  return `/hub/${host}${path === "/" ? "" : path}`;
}

/**
 * The concierge frame document: /w/{client-slug}, one segment, same shape rule as HUB_SLUG.
 *
 * No dot, no slash, no encoded traversal, so /w/../api/anything cannot match and neither can
 * /w/foo.php. The slug is `clients.slug`, already unique-constrained, so the embed snippet a
 * client pastes carries a name they recognise rather than a uuid.
 */
export const CONCIERGE_FRAME = /^\/w\/[a-z0-9](?:[a-z0-9-]{0,78}[a-z0-9])?$/;

/**
 * Is this a path the concierge widget hostname may serve?
 *
 * ‼️ /api/concierge/ IS A PREFIX HERE, AND THAT IS ONLY SAFE BECAUSE THAT HOST IS OURS.
 * The identical relaxation on the external branch is forbidden (see HUB_API) because there the
 * hostname belongs to a client's registrar. This is not permission to loosen that one.
 */
export function isConciergePath(path: string): boolean {
  return (
    path === "/embed.js" ||
    CONCIERGE_FRAME.test(path) ||
    path === "/api/concierge" ||
    path.startsWith("/api/concierge/")
  );
}
