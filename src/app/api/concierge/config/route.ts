// What the loader needs before anybody speaks: is this widget on, and what does the header say.
//
// ‼️ CACHED, AND IT CARRIES NOTHING PRIVATE. This is fetched once per page view on a client's own
// site, so it is the highest-traffic route in the lane and it must not hit the database every time.
// unstable_cache with revalidate 300 mirrors src/lib/hub/resolve.ts, which the concierge migration
// named as the shape to copy.
//
// ‼️ THE RESPONSE IS A SUBSET, CHOSEN BY HAND. allowed_origins, the analysis provider, the scan cap
// and the client's own booking phone are all in the config row and none of them are here. A field
// added to ConciergeConfig must be added HERE deliberately to become public, rather than appearing
// on a third-party page because somebody widened a type.

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";
import { loadConciergeConfig } from "@/lib/concierge/config";
import { magnetByKey, pillLabel, resolveMagnet } from "@/lib/concierge/magnets";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";

export const runtime = "nodejs";

const REVALIDATE_SECONDS = 300;

interface PublicConfig {
  enabled: boolean;
  audience: string;
  headline: string | null;
  promise: string | null;
  ctaLabel: string;
}

/**
 * The cached answer, plus the two facts the gate needs.
 *
 * ‼️ THE enabled CHECK MOVED OUT OF THE CACHE AND INTO THE HANDLER, AND IT HAD TO. A preview
 * token varies per client and per mint, so folding it into the cache key would give this route a
 * cache key a caller chooses, on the highest-traffic endpoint in the lane. The cached value stays
 * keyed on (slug, category, magnetKey) exactly as before; only the decision moved.
 *
 * clientId is on THIS shape and never on PublicConfig. The response is a subset chosen by hand,
 * per this file header, and an internal id is not part of it.
 */
interface CachedConfig {
  tenantEnabled: boolean;
  clientId: string;
  body: PublicConfig;
}

const publicConfig = unstable_cache(
  async (slug: string, category: string | null, magnetKey: string | null): Promise<CachedConfig | null> => {
    const config = await loadConciergeConfig(slug);
    if (!config) return null;

    // The header text comes off the resolved magnet, so editing a row changes the page with no
    // deploy. Matthew's instruction: the best magnet is the header.
    //
    // ‼️ A NAMED KEY BYPASSES THE LADDER ENTIRELY RATHER THAN BIASING IT. The ladder answers
    // "what would we offer somebody standing here", ranked over placement columns. A key on the
    // page is a decision a person made before the page was written, and a decision that a
    // ranking can outvote is not a decision. It also reaches rows the ladder cannot: every
    // category-scoped row is unreachable on a page that passes no category, which is every page.
    const magnet = magnetKey
      ? await magnetByKey(magnetKey, config.audience)
      : await resolveMagnet({
          audience: config.audience,
          clientId: config.clientId,
          vertical: config.vertical,
          treatment: null,
          category,
        });

    const body: PublicConfig = {
      enabled: true,
      audience: config.audience,
      headline: magnet?.title ?? null,
      promise: magnet?.promise ?? null,
      // ‼️ THE PILL SAYS WHAT IS ON OFFER, AND THE PER-AUDIENCE STRING IS THE LAST RESORT RATHER
      // THAN THE ANSWER. It used to be the answer, which meant every page on every hub read
      // "Check my visibility" no matter what the widget was actually about to hand over. A page
      // that resolves no magnet still gets a working launcher, because the conversation is worth
      // having on its own, and the publish gate is what stops that shipping unnoticed.
      ctaLabel: magnet
        ? pillLabel(magnet)
        : config.audience === "owner"
          ? "Check my visibility"
          : "Start my free scan",
    };

    return { tenantEnabled: config.enabled, clientId: config.clientId, body };
  },
  ["concierge-public-config"],
  { revalidate: REVALIDATE_SECONDS, tags: ["concierge-config"] }
);

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const slug = (params.get("c") ?? "").trim().toLowerCase();
  const category = (params.get("category") ?? "").trim() || null;
  // Bounded before it reaches the cache key. An unbounded query param is a cache key somebody
  // else chooses, and this route is fetched once per page view from a third party's page.
  const magnetKey = (params.get("magnet") ?? "").trim().slice(0, 60).toLowerCase() || null;
  const token = params.get(PREVIEW_TOKEN_PARAM);

  const cached = slug ? await publicConfig(slug, category, magnetKey) : null;

  // A disabled or unknown tenant answers 200 with enabled false rather than 404, because this one
  // is fetched by a script tag on somebody else's page: a 404 in their console reads as our
  // outage, and there is nothing secret about a widget being off.
  //
  // A signed preview token for THIS client is the one thing that opens a switched-off tenant, so
  // that the demo link concierge_preview posts before the call actually works. See
  // src/lib/concierge/preview-grant.ts.
  const granted =
    cached !== null &&
    conciergeAllowed({ enabled: cached.tenantEnabled, clientId: cached.clientId }, token);

  if (!cached || !granted) {
    return NextResponse.json(
      { enabled: false },
      { headers: { "cache-control": `public, max-age=60, s-maxage=${REVALIDATE_SECONDS}` } }
    );
  }

  // ‼️ A GRANTED RESPONSE IS NEVER SHARED-CACHEABLE. The public answer for a switched-off tenant
  // is `{enabled:false}`, and a CDN that stored this body against the same URL would serve a
  // working widget to somebody holding no token. The token is in the query string, so the URLs
  // differ, but s-maxage on a response that only one caller is entitled to is the wrong default
  // to leave lying around.
  const shared = cached.tenantEnabled;

  return NextResponse.json(cached.body, {
    headers: {
      "cache-control": shared
        ? `public, max-age=60, s-maxage=${REVALIDATE_SECONDS}`
        : "private, no-store",
    },
  });
}
