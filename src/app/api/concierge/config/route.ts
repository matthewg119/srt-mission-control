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
import { loadConciergeConfig, type LauncherCorner } from "@/lib/concierge/config";
import { magnetByKey, pillLabel, resolveMagnet } from "@/lib/concierge/magnets";
import { conciergeAllowed, PREVIEW_TOKEN_PARAM } from "@/lib/concierge/preview-grant";
import { type MascotAssets } from "@/lib/concierge/mascot";
import { mascotForClient } from "@/lib/concierge/mascot-for-client";
import { hasBannedDash } from "@/lib/copy-guard";

export const runtime = "nodejs";

const REVALIDATE_SECONDS = 300;

interface PublicConfig {
  enabled: boolean;
  audience: string;
  headline: string | null;
  promise: string | null;
  ctaLabel: string;
  /** The corner mascot's images, or null for the plain pill. */
  mascot: MascotAssets | null;
  /** Which corner the launcher rests in, before anybody drags it. */
  corner: LauncherCorner;
  /** What the mascot says in its bubble, one at a time, in a random order. */
  lines: string[];
}

/**
 * The mascot's speech bubbles.
 *
 * ‼️ WRITTEN HERE FROM ROWS, NEVER BY A MODEL AT VIEW TIME. This is fetched once per page view on a client's
 * live website; a model call per page view is a bill per bot, and a generated line on a stranger's page is
 * a line nobody read first. Every line is the offer on the row, the page's magnet, or a fixed sentence.
 * Matthew, 2026-09-15: "saying things like Meow or Get Lead magnet here or offer every 20 seconds ish".
 */
function mascotLines(args: { audience: string; magnetTitle: string | null; treatment: string | null; clientName: string }): string[] {
  const lines = ["Meow.", "Meow! Click me if you need a hand."];
  if (args.magnetTitle) lines.push(`Psst. Free: ${args.magnetTitle}`, `Get ${args.magnetTitle} here.`);
  if (args.audience === "owner") {
    lines.push(
      "Does ChatGPT recommend you? I can check in 3 minutes.",
      "Free AI visibility audit, right here.",
      args.treatment ? `Ask me about ${args.treatment}.` : "Ask me anything."
    );
  } else {
    lines.push(`Questions before you book with ${args.clientName}?`, "Ask me anything, I answer fast.");
  }
  return lines.filter((l) => !hasBannedDash(l)).map((l) => l.slice(0, 90));
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

    const { loadOffer } = await import("@/lib/clients/offers");
    const offer = await loadOffer(config.clientId).catch(() => null);

    const body: PublicConfig = {
      enabled: true,
      mascot: await mascotForClient(config.clientId, config.mascot),
      corner: config.launcherCorner,
      lines: mascotLines({
        audience: config.audience,
        magnetTitle: magnet?.title ?? null,
        treatment: offer?.treatment ?? null,
        clientName: config.clientName,
      }),
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

  // ‼️ READABLE FROM ANY ORIGIN, AND THAT WAS THE BUG (2026-09-16). embed.js runs on the page that pasted
  // it (learn.<client domain>, the client's own site) and fetches this from the concierge host, which is
  // cross-origin. With no allow-origin header the browser threw the answer away and the loader's .catch
  // swallowed it: no teaser, no label, and a switched-off widget was never removed. It only worked on our
  // own preview, which is same-origin. `*` is right here because this body is public by construction (the
  // file header) and carries no credentials; the frame's frame-ancestors is what guards the conversation.
  const cors = { "access-control-allow-origin": "*", vary: "origin" };

  if (!cached || !granted) {
    return NextResponse.json(
      { enabled: false },
      { headers: { "cache-control": `public, max-age=60, s-maxage=${REVALIDATE_SECONDS}`, ...cors } }
    );
  }

  // ‼️ A GRANTED RESPONSE IS NEVER SHARED-CACHEABLE. The public answer for a switched-off tenant
  // is `{enabled:false}`, and a CDN that stored this body against the same URL would serve a
  // working widget to somebody holding no token. The token is in the query string, so the URLs
  // differ, but s-maxage on a response that only one caller is entitled to is the wrong default
  // to leave lying around.
  const shared = cached.tenantEnabled;

  // ‼️ THE MASCOT OVERRIDE IS PREVIEW ONLY, AND IT IS RESOLVED AFTER THE CACHE ON PURPOSE. Step 18
  // hands Matthew three links that differ only by ?mascot=, so the client can be shown three and
  // pick one on the call. Folding the key into the cache key would give this route, the busiest in
  // the lane, a fourth dimension chosen by the caller for the sake of three page views. It is a pure
  // lookup in a closed registry, so it costs nothing to apply out here. Requiring `granted` is what
  // stops a stranger repainting a client's live widget by adding a query param to our own script.
  const wanted = (params.get("mascot") ?? "").trim().slice(0, 40).toLowerCase();
  const override = token && wanted ? await mascotForClient(cached.clientId, wanted) : null;
  const body = override ? { ...cached.body, mascot: override } : cached.body;

  return NextResponse.json(body, {
    headers: {
      "cache-control": shared
        ? `public, max-age=60, s-maxage=${REVALIDATE_SECONDS}`
        : "private, no-store",
      ...cors,
    },
  });
}
