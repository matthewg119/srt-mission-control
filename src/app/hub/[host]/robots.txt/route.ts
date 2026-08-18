// The hub's robots.txt, per host.
//
// THIS IS THE FILE THE WHOLE FEATURE DEPENDS ON. The app's own robots.txt disallows every
// AI crawler by name — GPTBot, OAI-SearchBot, PerplexityBot, ClaudeBot, Google-Extended and
// the rest — because mission.srtagency.com is an internal tool. That file used to live in
// public/, which is served for EVERY hostname a deployment answers for, so it would have
// blocked exactly the crawlers a client is paying to be found by. It now lives in
// src/app/robots.txt/route.ts and answers only for the internal host; middleware sends a
// client host here instead.
//
// A hub that renders perfectly and is disallowed is the only failure mode that matters,
// and it is invisible from a browser. Verify it with a request, never by reading the code.

import { resolveHost } from "@/lib/hub/resolve";

// NOT `export const revalidate`. That is a FULL-ROUTE cache, and revalidateTag() does not
// reach it — so publishing a page busted the data cache while this handler kept serving a
// body generated before the page existed. Observed: llms.txt and the index updated on a
// publish and the sitemap did not, from one shared query. The DB read below is still cached
// (and still tag-invalidated) inside listPublished; only the response assembly re-runs, and
// the s-maxage header below is what actually keeps the load off the origin.
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { host: string } }
): Promise<Response> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);

  const text = (() => {
    // An unknown host gets a closed file. It is not a client's site, so nothing here should
    // invite a crawl.
    if (resolved.status !== "ok") {
      return "User-agent: *\nDisallow: /\n";
    }

    // The review tool is one customer's page, opened from a QR code on a printed card. It
    // is a tool, not content, and it has nothing to be found.
    if (resolved.kind === "reviews") {
      return "User-agent: *\nDisallow: /\n";
    }

    return [
      `# ${resolved.client.displayName}`,
      "#",
      "# Answers to questions people ask about this business, published in full.",
      "# Crawling, reading and quoting these pages is the point of them.",
      "",
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: https://${host}/sitemap.xml`,
      "",
    ].join("\n");
  })();

  return new Response(text, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300",
    },
  });
}
