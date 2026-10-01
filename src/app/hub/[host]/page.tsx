// The root of a client hostname, and the branch between the three kinds of host.
//
// Middleware cannot tell them apart: it has no database, by design. So learn.{domain},
// reviews.{domain} and a Launch Lane client's own apex all arrive here and the split happens
// once the row is resolved.
//
//   hub      the answer index
//   reviews  the AI Referral Engine, one tool on one URL
//   site     the client's own pasted home page. Its answer index moved to /answers.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { siteUrl } from "@/lib/hub/destinations";
import { listPublished, planLinkRows } from "@/lib/hub/pages";
import { orderIndexPages } from "@/lib/hub/plan-links";
import { HubIndexBody } from "@/components/hub/hub-bodies";
import { ConciergeEmbed } from "@/lib/concierge/embed";
import { ReferralEngine } from "./reviews/referral-engine";
import { publishedSitePage, listSitePages } from "@/lib/hub/site-pages";
import { SitePageBody } from "@/components/hub/site-body";

export const revalidate = 300;

interface Props {
  params: { host: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok") return { robots: { index: false, follow: false } };

  const { client, kind } = resolved;

  if (kind === "reviews") {
    return {
      title: `Share your experience · ${client.displayName}`,
      robots: { index: false, follow: false },
    };
  }

  // A site host's root is the client's own home page, not an answer index.
  if (kind === "site") {
    const home = await publishedSitePage(client.id, "/");
    if (!home) return { robots: { index: false, follow: false } };
    return {
      title: { absolute: home.title },
      description: home.metaDescription ?? undefined,
      alternates: { canonical: `https://${host}/` },
      robots: { index: true, follow: true },
      openGraph: { type: "website", title: home.title, url: `https://${host}/`, siteName: client.displayName },
    };
  }

  const where = [client.city, client.state].filter(Boolean).join(", ");
  return {
    title: {
      absolute: where
        ? `${client.displayName} · Questions and answers · ${where}`
        : `${client.displayName} · Questions and answers`,
    },
    description: `Straight answers to the questions people actually ask about ${client.displayName}${where ? ` in ${where}` : ""}.`,
    alternates: { canonical: siteUrl(resolved.destination) },
    robots: { index: true, follow: true },
  };
}

export default async function HubIndex({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok") notFound();

  const { client, kind, destination } = resolved;

  // ‼️ NO CONCIERGE ON THE AI REFERRAL ENGINE, AND THAT IS WHY THIS RETURNS EARLY RATHER THAN SETTING A
  // FLAG. The tool is regulated separately (NOT_GATED in hub/page-gate.ts) and no model may go
  // near it. Mounting the widget in the shared layout used to put one on this page.
  if (kind === "reviews") {
    return <ReferralEngine client={client} />;
  }

  // ‼️ A SITE HOST'S ROOT IS THEIR HOME PAGE. Its answer index moved to /answers, and
  // client_site_pages refuses a page at that path in a CHECK so the two can never collide.
  //
  // A missing home page is a 404 rather than a fallback to the answer index: the apex of a
  // domain we sold them silently serving our list of questions, under their name, is a worse
  // outcome than an honest miss, and the site_live verifier catches it before anybody is looking.
  if (kind === "site") {
    const home = await publishedSitePage(client.id, "/");
    if (!home) notFound();
    const nav = await listSitePages(client.id);
    return (
      <>
        <SitePageBody page={home} nav={nav} />
        {/* The home page is not one answer, so it names no magnet and the ladder decides. */}
        <ConciergeEmbed clientId={client.id} />
      </>
    );
  }

  // Pillar first. planLinkRows returns [] until the plan has roles, which leaves the order alone.
  const [published, planRows] = await Promise.all([listPublished(client.id), planLinkRows(client.id)]);
  const pages = orderIndexPages(published, planRows);

  return (
    <>
      <HubIndexBody client={client} destination={destination} pages={pages} />
      {/* The index is not one answer, so it names no magnet and the ladder decides. */}
      <ConciergeEmbed clientId={client.id} />
    </>
  );
}

