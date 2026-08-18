// One answer page. The unit the whole hub exists to publish.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { getPublished } from "@/lib/hub/pages";
import { HubAnswerBody, plainText, truncate } from "@/components/hub/hub-bodies";

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

  return {
    title: page.title,
    description: page.metaDescription || truncate(plainText(page.answerMd), 155),
    // The canonical is on the CLIENT's host. Never mission.srtagency.com, which is
    // noindex, and never their main site, which does not have this page.
    alternates: { canonical: `https://${host}/${page.slug}` },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: page.title,
      url: `https://${host}/${page.slug}`,
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

  return <HubAnswerBody client={client} host={host} page={page} />;
}

