// robots.txt, sitemap.xml and llms.txt for a subfolder destination.
//
// ‼️ ONE ROUTE FOR THE THREE, WHICH IS NOT HOW THE HUB DOES IT, AND THE REASON IS THE PATH.
// The hub serves these at the root of a hostname, so each gets its own segment. A subfolder
// serves them UNDER a path -- their-site.com/learn/sitemap.xml -- which is one dynamic segment
// with three legal values. Three folders here would each need the same resolve, the same
// secret check and the same noindex header, and the first edit to one of them would be the
// edit somebody forgets to make to the other two.
//
// ‼️ robots.txt IS THE ODD ONE AND IS SERVED ANYWAY. A crawler asks for it at the ROOT of a
// host and never at a path, so their-site.com/learn/robots.txt is read by nobody. It is here
// because it is the file we hand to their developer to paste into the root one, and a URL that
// prints it is easier to act on than a block of text in a Slack message. It says so on its face.

import { NextResponse } from "next/server";
import { resolveSite } from "@/lib/hub/resolve";
import { siteUrl } from "@/lib/hub/destinations";
import { listPublished } from "@/lib/hub/pages";

// NOT `export const revalidate`. That is a FULL-ROUTE cache and revalidateTag() does not reach
// it, so publishing a page would bust the data cache while this kept serving a body generated
// before the page existed. The hub's sitemap route records the same trap, observed live.
export const dynamic = "force-dynamic";

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const TEXT = { "content-type": "text/plain; charset=utf-8" } as const;

export async function GET(
  _req: Request,
  { params }: { params: { siteKey: string; file: string } }
): Promise<Response> {
  const file = params.file;
  if (file !== "robots.txt" && file !== "sitemap.xml" && file !== "llms.txt") {
    return new NextResponse("Not found", { status: 404, headers: TEXT });
  }

  const resolved = await resolveSite(decodeURIComponent(params.siteKey));
  if (resolved.status !== "ok" || resolved.kind !== "hub") {
    return new NextResponse("Not found", { status: 404, headers: TEXT });
  }

  const { client, destination } = resolved;
  const pages = await listPublished(client.id);

  // Every URL states where the page LIVES: the client's own origin plus the base path. Built
  // by siteUrl, never composed here.
  const headers = {
    "cache-control": "public, max-age=0, s-maxage=300",
    // Our copy is never the indexable one. The canonical is on their origin.
    "x-robots-tag": "noindex",
  };

  if (file === "sitemap.xml") {
    const urls = [
      `  <url>\n    <loc>${escapeXml(siteUrl(destination))}</loc>\n  </url>`,
      ...pages.map((p) => {
        const lastmod = p.updatedAt || p.publishedAt;
        return [
          "  <url>",
          `    <loc>${escapeXml(siteUrl(destination, p.slug))}</loc>`,
          lastmod ? `    <lastmod>${new Date(lastmod).toISOString().slice(0, 10)}</lastmod>` : null,
          "  </url>",
        ]
          .filter(Boolean)
          .join("\n");
      }),
    ];
    return new NextResponse(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`,
      { headers: { ...headers, "content-type": "application/xml; charset=utf-8" } }
    );
  }

  if (file === "llms.txt") {
    const where = [client.city, client.state].filter(Boolean).join(", ");
    const lines = [
      `# ${client.displayName}`,
      "",
      where
        ? `> Answers to questions people ask about ${client.displayName}, a business in ${where}.`
        : `> Answers to questions people ask about ${client.displayName}.`,
      "",
      "Each page below answers one question in full. The text is written by the business and",
      "may be quoted directly.",
      "",
      "## Answers",
      "",
      ...(pages.length
        ? pages.map((p) => `- [${p.title}](${siteUrl(destination, p.slug)}): ${p.question}`)
        : ["- (none published yet)"]),
      "",
      ...(client.website ? ["## Elsewhere", "", `- [Main website](${client.website})`, ""] : []),
    ];
    return new NextResponse(lines.join("\n"), { headers: { ...headers, ...TEXT } });
  }

  // robots.txt. See the header: this is the text their developer pastes into the root file,
  // not a file a crawler will ever ask for here.
  return new NextResponse(
    [
      `# ${client.displayName}`,
      "#",
      "# These lines belong in the robots.txt at the ROOT of this domain.",
      `# A crawler never asks for one at ${destination.basePath ?? "/learn"}/robots.txt, so this`,
      "# copy is for pasting rather than for serving.",
      "",
      "User-agent: *",
      "Allow: /",
      "",
      `Sitemap: ${siteUrl(destination, "sitemap.xml")}`,
      "",
    ].join("\n"),
    { headers: { ...headers, ...TEXT } }
  );
}
