// /answers — the answer index on a `site` host, and a rescued slug on a `hub` host.
//
// ‼️ THIS ROUTE EXISTS FOR TWO REASONS AND THE SECOND ONE IS EASY TO DELETE BY ACCIDENT.
//
// 1. A site host serves the client's own pasted pages at the root, so the answer index that a
//    hub host shows at `/` has to live somewhere else. It lives here.
//
// 2. A STATIC SEGMENT BEATS A DYNAMIC ONE IN NEXT. Before this folder existed, `/answers` on a
//    hub host resolved through [slug] like any other page, and a client who published a page
//    slugged "answers" was served it. Creating this folder takes that URL away from them
//    silently: no error, no log, an indexed page that simply starts 404ing. So on a hub host
//    this falls through to exactly what [slug] would have done.
//
// The shell is re-applied here because the layout deliberately omits it for site hosts, whose
// marketing pages bring their own design. See hub-shell.tsx.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { listPublished, planLinkRows } from "@/lib/hub/pages";
import { orderIndexPages } from "@/lib/hub/plan-links";
import { HubIndexBody } from "@/components/hub/hub-bodies";
import { HubShell } from "@/components/hub/hub-shell";
import { answerPageMetadata, AnswerPageBody } from "@/components/hub/answer-page";
import { ConciergeEmbed } from "@/lib/concierge/embed";

export const revalidate = 300;

const SLUG = "answers";

interface Props {
  params: { host: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind === "reviews") {
    return { robots: { index: false, follow: false } };
  }

  // A hub host: this is an ordinary page that happens to be slugged "answers".
  if (resolved.kind === "hub") {
    return (
      (await answerPageMetadata({ host, client: resolved.client, slug: SLUG, base: "" })) ?? {
        robots: { index: false, follow: false },
      }
    );
  }

  const { client } = resolved;
  const where = [client.city, client.state].filter(Boolean).join(", ");
  return {
    title: {
      absolute: where
        ? `${client.displayName} · Questions and answers · ${where}`
        : `${client.displayName} · Questions and answers`,
    },
    description: `Straight answers to the questions people actually ask about ${client.displayName}${where ? ` in ${where}` : ""}.`,
    alternates: { canonical: `https://${host}/answers` },
    robots: { index: true, follow: true },
  };
}

export default async function AnswersIndex({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind === "reviews") notFound();

  const { client } = resolved;

  // The rescue. On a hub host nothing about /answers is special, so behave exactly as [slug]
  // would have: the layout has already applied the shell for this kind of host.
  if (resolved.kind === "hub") {
    const body = await AnswerPageBody({ host, client, slug: SLUG, base: "" });
    if (!body) notFound();
    return body;
  }

  // Pillar first. planLinkRows returns [] until the plan has roles, which leaves the order alone.
  const [published, planRows] = await Promise.all([listPublished(client.id), planLinkRows(client.id)]);
  const pages = orderIndexPages(published, planRows);

  return (
    <HubShell client={client}>
      {/* linkBase, because these pages live under /answers on this host and not at the root. */}
      <HubIndexBody client={client} host={host} pages={pages} linkBase="/answers/" />
      {/* The index is not one answer, so it names no magnet and the ladder decides. */}
      <ConciergeEmbed clientId={client.id} />
    </HubShell>
  );
}
