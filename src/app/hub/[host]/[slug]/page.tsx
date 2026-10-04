// One segment under a client hostname. What it MEANS depends on the kind of host.
//
//   hub host   an answer page at /{slug}. Unchanged, and still the unit the hub exists to publish.
//   site host  a pasted marketing page at /{slug}. Its answer pages live under /answers instead.
//
// ‼️ THE BRANCH IS HERE AND NOT IN MIDDLEWARE, BECAUSE MIDDLEWARE HAS NO DATABASE.
// Both kinds of host are allowed the same one-segment shape by the allowlist; only a resolved
// row knows which application this hostname is. See the header of hub-paths.ts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { siteUrl, siteRoot } from "@/lib/hub/destinations";
import { answerPageMetadata, AnswerPageBody } from "@/components/hub/answer-page";
import { publishedSitePage, listSitePages } from "@/lib/hub/site-pages";
import { SitePageBody } from "@/components/hub/site-body";
import { ConciergeEmbed } from "@/lib/concierge/embed";

export const revalidate = 300;

interface Props {
  params: { host: string; slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  // A reviews host has no slug pages at all: it is one tool on one URL.
  if (resolved.status !== "ok" || resolved.kind === "reviews") {
    return { robots: { index: false, follow: false } };
  }

  // ‼️ A `site` HOST HAS TWO NAMESPACES. A one-segment path is a MARKETING page off the root;
  // the answer pages live under /answers and are served by the sibling route. Both canonical
  // URLs come from the destination module, so neither can drift from the sitemap.
  if (resolved.kind === "site") {
    const page = await publishedSitePage(resolved.client.id, `/${params.slug}`);
    if (!page) return { robots: { index: false, follow: false } };
    const url = `${siteRoot(resolved.destination)}/${params.slug}`;
    return {
      title: page.title,
      description: page.metaDescription ?? undefined,
      alternates: { canonical: url },
      robots: { index: true, follow: true },
      openGraph: {
        type: "website",
        title: page.title,
        url,
        siteName: resolved.client.displayName,
      },
    };
  }

  return (
    (await answerPageMetadata({
      host,
      client: resolved.client,
      slug: params.slug,
      destination: resolved.destination,
    })) ?? { robots: { index: false, follow: false } }
  );
}

export default async function HubSlugPage({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind === "reviews") notFound();

  const { client } = resolved;

  if (resolved.kind === "site") {
    const page = await publishedSitePage(client.id, `/${params.slug}`);
    if (!page) notFound();
    const nav = await listSitePages(client.id);
    return (
      <>
        <SitePageBody page={page} nav={nav} />
        {/* The marketing pages are not one answer, so they name no magnet and the ladder decides. */}
        <ConciergeEmbed clientId={client.id} />
      </>
    );
  }

  const body = await AnswerPageBody({
    host,
    client,
    slug: params.slug,
    base: "",
    destination: resolved.destination,
  });
  if (!body) notFound();
  return body;
}
