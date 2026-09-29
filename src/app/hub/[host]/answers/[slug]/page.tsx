// /answers/{slug} — one answer page on a `site` host.
//
// The same unit the hub has always published, mounted one level down because the root of this
// hostname is the client's own pasted home page.
//
// ‼️ SITE HOSTS ONLY. On a hub host the answer pages live at /{slug}, and serving them here as
// well would put every page on two URLs on one domain. The canonical would name one of them and
// the other would be a duplicate competing with it, which is the opposite of what this product
// is for. A hub host asking for /answers/x gets a 404.
//
// The shell is re-applied here because the layout deliberately omits it for site hosts.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { HubShell } from "@/components/hub/hub-shell";
import { answerPageMetadata, AnswerPageBody } from "@/components/hub/answer-page";

export const revalidate = 300;

interface Props {
  params: { host: string; slug: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind !== "site") {
    return { robots: { index: false, follow: false } };
  }

  return (
    (await answerPageMetadata({
      host,
      client: resolved.client,
      slug: params.slug,
      base: "/answers",
    })) ?? { robots: { index: false, follow: false } }
  );
}

export default async function SiteAnswerPage({ params }: Props) {
  const host = decodeURIComponent(params.host);
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok" || resolved.kind !== "site") notFound();

  const body = await AnswerPageBody({
    host,
    client: resolved.client,
    slug: params.slug,
    base: "/answers",
  });
  if (!body) notFound();

  return <HubShell client={resolved.client}>{body}</HubShell>;
}
