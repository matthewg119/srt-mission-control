// The hub's sitemap, per host. Published pages only.
//
// ‼️ A `site` HOST HAS TWO NAMESPACES AND BOTH BELONG IN HERE.
// Its marketing pages sit at one-segment paths and its answer pages sit under /answers. Serving
// the hub shape on a site host would list every answer page at a URL that 404s and omit the
// marketing pages entirely. A sitemap full of 404s is worse than no sitemap: it is crawl budget
// spent on nothing, in the one file whose whole job is to be believed.

import { resolveHost } from "@/lib/hub/resolve";
import { listPublished } from "@/lib/hub/pages";
import { listSitePages } from "@/lib/hub/site-pages";

// NOT `export const revalidate`. That is a FULL-ROUTE cache, and revalidateTag() does not
// reach it — so publishing a page busted the data cache while this handler kept serving a
// body generated before the page existed. Observed: llms.txt and the index updated on a
// publish and the sitemap did not, from one shared query. The DB read below is still cached
// (and still tag-invalidated) inside listPublished; only the response assembly re-runs, and
// the s-maxage header below is what actually keeps the load off the origin.
export const dynamic = "force-dynamic";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export async function GET(
  _req: Request,
  { params }: { params: { host: string } }
): Promise<Response> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);

  // The AI Referral Engine is one tool on one URL and has nothing to list.
  if (resolved.status !== "ok" || resolved.kind === "reviews") {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }

  const isSite = resolved.kind === "site";
  const answerBase = isSite ? "/answers" : "";

  const entry = (loc: string, lastmod?: string | null): string =>
    [
      "  <url>",
      `    <loc>https://${escapeXml(host)}${loc}</loc>`,
      lastmod ? `    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : null,
      "  </url>",
    ]
      .filter(Boolean)
      .join("\n");

  const pages = await listPublished(resolved.client.id);
  const sitePages = isSite ? await listSitePages(resolved.client.id) : [];

  const urls = [
    entry("/"),
    // The marketing pages, minus the home page, which is already listed as "/".
    ...sitePages.filter((p) => p.path !== "/").map((p) => entry(escapeXml(p.path), p.publishedAt)),
    // The answer index is its own page on a site host; on a hub host it IS the root.
    ...(isSite ? [entry("/answers")] : []),
    ...pages.map((page) =>
      entry(`${answerBase}/${escapeXml(page.slug)}`, page.updatedAt || page.publishedAt)
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300",
    },
  });
}
