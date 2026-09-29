// One answer page. The unit the whole hub exists to publish.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { siteUrl } from "@/lib/hub/destinations";
import { getPublished, listPublished, planLinkRows } from "@/lib/hub/pages";
import { NO_PLAN_LINKS, planLinksFor, type PlanLinks } from "@/lib/hub/plan-links";
import { HubAnswerBody, plainText, truncate } from "@/components/hub/hub-bodies";
import { ConciergeEmbed } from "@/lib/concierge/embed";
import { pageCategoryFor } from "@/lib/hub/page-category";

export const revalidate = 300;

interface Props {
  params: { host: string; slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  // A reviews host has no slug pages at all: it is one tool on one URL.
  if (resolved.status !== "ok" || resolved.kind !== "hub") {
    return { robots: { index: false, follow: false } };
  }

  const page = await getPublished(resolved.client.id, params.slug);
  if (!page) return { robots: { index: false, follow: false } };

  // One URL, used twice. Composing it in both slots is how a canonical and an og:url start
  // disagreeing about the same page, which reads to a crawler as two pages.
  const url = siteUrl(resolved.destination, page.slug);

  return {
    title: page.title,
    description: page.metaDescription || truncate(plainText(page.answerMd), 155),
    // The canonical is where the page LIVES. Never mission.srtagency.com, which is noindex,
    // never their main site, which does not have this page, and never the request host,
    // which on a subfolder is ours rather than theirs.
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: page.title,
      url,
      siteName: resolved.client.displayName,
    },
  };
}

export default async function HubPage({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind !== "hub") notFound();

  const { client } = resolved;
  const page = await getPublished(client.id, params.slug);
  if (!page) notFound();

  // ‼️ THE LINKS NEVER COST THE PAGE. planLinkRows already returns [] on failure; a failed list
  // read is caught here too, because a 5xx on a page that loaded fine, over decoration, is how an
  // indexed page gets a crawler's error recorded against it. No plan means no second read at all.
  const planRows = await planLinkRows(client.id);
  let links: PlanLinks = NO_PLAN_LINKS;
  if (planRows.length > 0) {
    try {
      links = planLinksFor(page.id, planRows, await listPublished(client.id));
    } catch (e) {
      console.error(`[hub/slug] plan links skipped for ${host}/${page.slug}:`, (e as Error).message);
    }
  }

  return (
    <>
      <HubAnswerBody client={client} destination={resolved.destination} page={page} links={links} />
      {/*
        The concierge, carrying the offer THIS page was written toward. Renders null unless the
        client's concierge_configs.enabled is true, which only the concierge_live step sets.
        A page with no key falls back to the ladder, which is every page written before the
        column existed.
      */}
      <ConciergeEmbed
        clientId={client.id}
        magnetKey={page.leadMagnetKey}
        ctaLine={page.ctaLine}
        category={await pageCategoryFor(client.id, page.id)}
      />
    </>
  );
}

