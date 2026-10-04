// The subfolder door: their-site.com/learn, proxied to us.
//
// ‼️ IT RENDERS THE SAME COMPONENTS AS THE HUB, AND THAT IS THE ONLY WAY THIS IS WORTH DOING.
// HubIndexBody and HubAnswerBody are imported, never reimplemented. A subfolder that drew its
// own markup would be a second hub that drifts silently, which is what hub-bodies.tsx's own
// header refuses for previews and is worse here: this one is live on a client's domain.
//
// ‼️ INTERNAL HOST ONLY, AND MIDDLEWARE IS WHAT ENFORCES IT. /s/* is refused on every external
// hostname by the allowlist with no rule of its own (HUB_SLUG forbids a slash), and on the
// internal branch it is gated on the HUB_PROXY_SECRET header. Reaching this file means a
// request carried that secret.
//
// ‼️ OUR COPY IS noindex AND THE CANONICAL POINTS AT THEIR ORIGIN. The page lives at
// their-site.com/learn/<slug>; this is the machine that answers for it. Two indexable copies
// of one page is the duplicate content the one-page-one-home rule exists to prevent, and
// middleware sets x-robots-tag on the response for the same reason the metadata below says it.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveSite } from "@/lib/hub/resolve";
import { siteUrl } from "@/lib/hub/destinations";
import { getPublished, listPublished, planLinkRows } from "@/lib/hub/pages";
import { orderIndexPages } from "@/lib/hub/plan-links";
import { NO_PLAN_LINKS, planLinksFor, type PlanLinks } from "@/lib/hub/plan-links";
import { HubIndexBody, HubAnswerBody, plainText, truncate } from "@/components/hub/hub-bodies";
import { ConciergeEmbed } from "@/lib/concierge/embed";
import { themeStyle } from "@/lib/hub/theme";
import { skinStyle, hubRootClass } from "@/lib/hub/skin";
import { universeFontClass } from "@/components/hub/universe-fonts";
import { UniverseBand, UniverseTop } from "@/components/hub/universe-chrome";
import "../../../hub/[host]/hub.css";
import "../../../hub/[host]/universes.css";

// Same five minutes as the hub. Not force-dynamic: that would make every page a cold database
// render on every crawl, on a surface whose whole job is to be crawled.
export const revalidate = 300;

interface Props {
  params: { siteKey: string; slug?: string[] };
}

/** The one slug this request is for, or null for the index. */
function slugOf(params: Props["params"]): string | null {
  const parts = params.slug ?? [];
  return parts.length > 0 ? parts[parts.length - 1] : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolveSite(decodeURIComponent(params.siteKey));
  if (resolved.status !== "ok" || resolved.kind !== "hub") {
    return { robots: { index: false, follow: false } };
  }

  const { client, destination } = resolved;
  const slug = slugOf(params);

  // ‼️ noindex ON THIS COPY, ALWAYS, AND IT IS NOT A MISTAKE TO FIX LATER. The client's origin
  // serves the indexable copy at the canonical below. Letting a proxy host be indexed too is
  // how one page becomes two and both lose.
  const base = {
    metadataBase: new URL(siteUrl(destination)),
    robots: { index: false, follow: false },
  } satisfies Metadata;

  if (!slug) {
    const where = [client.city, client.state].filter(Boolean).join(", ");
    return {
      ...base,
      title: {
        absolute: where
          ? `${client.displayName} · Questions and answers · ${where}`
          : `${client.displayName} · Questions and answers`,
      },
      alternates: { canonical: siteUrl(destination) },
    };
  }

  const page = await getPublished(client.id, slug);
  if (!page) return { robots: { index: false, follow: false } };

  const url = siteUrl(destination, page.slug);
  return {
    ...base,
    title: page.title,
    description: page.metaDescription || truncate(plainText(page.answerMd), 155),
    alternates: { canonical: url },
    openGraph: { type: "article", title: page.title, url, siteName: client.displayName },
  };
}

export default async function SubfolderPage({ params }: Props) {
  // resolveSite THROWS on a failure and returns unknown only on a genuine miss. The throw is
  // deliberately not caught: it reaches the error boundary as a 5xx, which tells a crawler to
  // come back. Catching it would 404 a live indexed page over a database blip.
  const resolved = await resolveSite(decodeURIComponent(params.siteKey));
  if (resolved.status !== "ok" || resolved.kind !== "hub") notFound();

  const { client, destination } = resolved;
  const slug = slugOf(params);

  // ‼️ LINKS STAY INSIDE THE SUBFOLDER. linkBase is what makes a page link to
  // their-site.com/learn/<other> rather than to the root of their site, where nothing is.
  const linkBase = `${destination.basePath ?? ""}/`;

  const body = slug ? await answerBody() : await indexBody();

  return (
    <div
      className={`${hubRootClass(client.skin)} ${universeFontClass(client.skin?.universe)}`.trim()}
      lang={client.language}
      style={{ ...skinStyle(client.skin), ...themeStyle(client.theme) }}
    >
      <UniverseTop
        universe={client.skin?.universe}
        name={client.displayName}
        where={[client.city, client.state].filter(Boolean).join(", ") || null}
        pages={-1}
      />
      <div className="hub-wrap">{body}</div>
      <UniverseBand universe={client.skin?.universe} name={client.displayName} where={null} pages={-1} />
    </div>
  );

  async function indexBody() {
    const [published, planRows] = await Promise.all([listPublished(client.id), planLinkRows(client.id)]);
    return (
      <>
        <HubIndexBody
          client={client}
          destination={destination}
          pages={orderIndexPages(published, planRows)}
          linkBase={linkBase}
        />
        <ConciergeEmbed clientId={client.id} />
      </>
    );
  }

  async function answerBody() {
    const page = await getPublished(client.id, slug as string);
    if (!page) notFound();

    const planRows = await planLinkRows(client.id);
    let links: PlanLinks = NO_PLAN_LINKS;
    if (planRows.length > 0) {
      try {
        links = planLinksFor(page.id, planRows, await listPublished(client.id));
      } catch (e) {
        // Decoration. A 5xx on a page that loaded fine, over links, is how a crawler records
        // an error against an indexed page. Same call the hub route makes.
        console.error(`[hub/site] plan links skipped for ${params.siteKey}/${page.slug}:`, (e as Error).message);
      }
    }

    return (
      <>
        <HubAnswerBody
          client={client}
          destination={destination}
          page={page}
          links={links}
          linkBase={linkBase}
          homeHref={linkBase}
        />
        <ConciergeEmbed clientId={client.id} magnetKey={page.leadMagnetKey} />
      </>
    );
  }
}
