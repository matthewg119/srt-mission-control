// The hub index, and the branch between the two kinds of host.
//
// Middleware cannot tell a hub host from a reviews host: it has no database, by design. So
// learn.{domain} and reviews.{domain} both arrive here and the split happens once the row
// is resolved.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { listPublished } from "@/lib/hub/pages";
import { HubIndexBody } from "@/components/hub/hub-bodies";
import { ConciergeEmbed } from "@/lib/concierge/embed";
import { ReviewTool } from "./reviews/review-tool";

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

  const where = [client.city, client.state].filter(Boolean).join(", ");
  return {
    title: {
      absolute: where
        ? `${client.displayName} · Questions and answers · ${where}`
        : `${client.displayName} · Questions and answers`,
    },
    description: `Straight answers to the questions people actually ask about ${client.displayName}${where ? ` in ${where}` : ""}.`,
    alternates: { canonical: `https://${host}/` },
    robots: { index: true, follow: true },
  };
}

export default async function HubIndex({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok") notFound();

  const { client, kind } = resolved;

  // ‼️ NO CONCIERGE ON THE REVIEW TOOL, AND THAT IS WHY THIS RETURNS EARLY RATHER THAN SETTING A
  // FLAG. The tool is regulated separately (NOT_GATED in hub/page-gate.ts) and no model may go
  // near it. Mounting the widget in the shared layout used to put one on this page.
  if (kind === "reviews") {
    return <ReviewTool client={client} />;
  }

  const pages = await listPublished(client.id);

  return (
    <>
      <HubIndexBody client={client} host={host} pages={pages} />
      {/* The index is not one answer, so it names no magnet and the ladder decides. */}
      <ConciergeEmbed clientId={client.id} />
    </>
  );
}

