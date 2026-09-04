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

export const runtime = "nodejs";

const REVALIDATE_SECONDS = 300;

interface PublicConfig {
  enabled: boolean;
  audience: string;
  headline: string | null;
  promise: string | null;
  ctaLabel: string;
}

const publicConfig = unstable_cache(
  async (slug: string, category: string | null, magnetKey: string | null): Promise<PublicConfig | null> => {
    const config = await loadConciergeConfig(slug);
    if (!config || !config.enabled) return null;

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

    return {
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
  },
  ["concierge-public-config"],
  { revalidate: REVALIDATE_SECONDS, tags: ["concierge-config"] }
);

/**
 * ‼️ CORS, AND IT WAS MISSING, WHICH MADE THIS ROUTE UNREACHABLE FROM EVERY PAGE THAT USES IT.
 * embed.js is served with `access-control-allow-origin: *` and this one was not, so the loader's
 * fetch was blocked by the browser on any page not on our own origin. That is every client hub
 * (learn.<clientdomain> calling concierge.srtagency.com) and every third-party site. The failure
 * was invisible because the fetch is deliberately not awaited and its rejection is swallowed: the
 * pill simply kept the neutral fallback label and the teaser never appeared. Nothing looked broken.
 *
 * `*` rather than an origin echo, deliberately. The response is a hand-picked public subset with
 * nothing private in it, it takes no credentials, and echoing an origin would mean this route
 * quietly became the place that decides which sites may talk to us. That decision belongs to
 * `allowed_origins` and frame-ancestors on /w/[slug], which is where the widget actually lives.
 */
function publicHeaders(): Record<string, string> {
  return {
    "cache-control": `public, max-age=60, s-maxage=${REVALIDATE_SECONDS}`,
    "access-control-allow-origin": "*",
  };
}

export async function GET(req: NextRequest) {
  const params = new URL(req.url).searchParams;
  const slug = (params.get("c") ?? "").trim().toLowerCase();
  const category = (params.get("category") ?? "").trim() || null;
  // Bounded before it reaches the cache key. An unbounded query param is a cache key somebody
  // else chooses, and this route is fetched once per page view from a third party's page.
  const magnetKey = (params.get("magnet") ?? "").trim().slice(0, 60).toLowerCase() || null;

  const config = slug ? await publicConfig(slug, category, magnetKey) : null;

  // A disabled or unknown tenant answers 200 with enabled false rather than 404, because this one
  // is fetched by a script tag on somebody else's page: a 404 in their console reads as our
  // outage, and there is nothing secret about a widget being off.
  if (!config) {
    return NextResponse.json({ enabled: false }, { headers: publicHeaders() });
  }

  return NextResponse.json(config, { headers: publicHeaders() });
}
