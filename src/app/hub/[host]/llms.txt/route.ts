// llms.txt, per host.
//
// No engine currently uses this as a retrieval or ranking input; robots.txt, a real sitemap
// and the JSON-LD are what actually get read. It is here anyway because it costs thirty
// lines, it states plainly what the host is and who it belongs to, and an agency whose
// entire product is being legible to language models should be legible to them in the one
// format proposed for exactly that. It is a claim about intent, not a ranking tactic, and
// it is not counted as one anywhere.

import { resolveHost } from "@/lib/hub/resolve";
import { listPublished } from "@/lib/hub/pages";

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

  if (resolved.status !== "ok" || resolved.kind !== "hub") {
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });
  }

  const { client } = resolved;
  const pages = await listPublished(client.id);
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
      ? pages.map((page) => `- [${page.title}](https://${host}/${page.slug}): ${page.question}`)
      : ["- (none published yet)"]),
    "",
    ...(client.website ? ["## Elsewhere", "", `- [Main website](${client.website})`, ""] : []),
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=0, s-maxage=300",
    },
  });
}
