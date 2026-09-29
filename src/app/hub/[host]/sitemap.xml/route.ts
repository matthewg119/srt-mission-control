// The hub's sitemap, per host. Published pages only.

import { resolveHost } from "@/lib/hub/resolve";
import { siteUrl } from "@/lib/hub/destinations";
import { listPublished } from "@/lib/hub/pages";

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

  if (resolved.status !== "ok" || resolved.kind !== "hub") {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }

  const pages = await listPublished(resolved.client.id);

  // ‼️ EVERY <loc> IS WHERE THE PAGE LIVES, NOT THE HOST THAT SERVED THIS FILE. A sitemap
  // is the one document whose entire job is to state URLs, so a subfolder client's sitemap
  // built from the request host would list a hostname their pages are not on -- and Search
  // Console rejects a sitemap whose URLs are outside the property it was submitted for, so
  // this fails loudly rather than quietly. That is the better half of the trade, and it is
  // still worth not getting wrong.
  const urls = [
    `  <url>\n    <loc>${escapeXml(siteUrl(resolved.destination))}</loc>\n  </url>`,
    ...pages.map((page) => {
      const lastmod = page.updatedAt || page.publishedAt;
      return [
        "  <url>",
        `    <loc>${escapeXml(siteUrl(resolved.destination, page.slug))}</loc>`,
        lastmod ? `    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : null,
        "  </url>",
      ]
        .filter(Boolean)
        .join("\n");
    }),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;

  return new Response(xml, {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300",
    },
  });
}
