// One answer page, rendered the same way wherever it is mounted.
//
// ‼️ THREE ROUTES REACH THIS AND THEY MUST NOT DRIFT.
//   hub/[host]/[slug]            a hub host's answer page, at /{slug}
//   hub/[host]/answers/[slug]    a site host's answer page, at /answers/{slug}
//   hub/[host]/answers           a hub host that genuinely published a page slugged "answers"
//
// That third one is the whole reason this is a shared function rather than a copied route. A
// static Next segment beats a dynamic one, so adding the /answers folder for site hosts silently
// took /answers away from hub hosts, where it had always been an ordinary slug. A client with a
// page there would have watched an indexed URL start 404ing with nothing in any log to explain
// it. `client_site_pages` refuses the path in a CHECK for the same class of reason.
//
// ‼️ THE CANONICAL COMES FROM siteUrl(), NOT FROM A `base` THE CALLER REMEMBERED TO PASS.
// The same page lives at /{slug} on a hub host, /answers/{slug} on a site host and
// {theirdomain}/learn/{slug} on a subfolder client, and getting it wrong does not break the page,
// it points every canonical at a URL that 404s, which is worse than breaking it. A `base` string
// could express the first two and not the third, and it put the decision in four call sites. The
// destination carries it now, so the canonical, the og:url, the sitemap entry and the llms.txt
// line are one function's answer rather than four.
//
// `linkBase` stays a path, because an internal href is relative to the origin being served and
// must NOT become absolute: on a subfolder client the page is served from our origin under their
// path, and an absolute internal link would send a reader off to the proxy host.

import type { Metadata } from "next";
import { getPublished, listPublished, planLinkRows } from "@/lib/hub/pages";
import { NO_PLAN_LINKS, planLinksFor, type PlanLinks } from "@/lib/hub/plan-links";
import { HubAnswerBody, plainText, truncate } from "@/components/hub/hub-bodies";
import { ConciergeEmbed } from "@/lib/concierge/embed";
import { pageCategoryFor } from "@/lib/hub/page-category";
import type { HubClient } from "@/lib/hub/resolve";
import { siteUrl, type Destination } from "@/lib/hub/destinations";

/** "" for a hub host (pages sit at the root), "/answers" for a site host. */
export type AnswerBase = "" | "/answers";

export async function answerPageMetadata(args: {
  host: string;
  client: HubClient;
  slug: string;
  destination: Destination;
}): Promise<Metadata | null> {
  const page = await getPublished(args.client.id, args.slug);
  if (!page) return null;

  // One URL, used twice below. Composing it in both slots is how a canonical and an og:url start
  // disagreeing about the same page, which reads to a crawler as two pages.
  const url = siteUrl(args.destination, page.slug);

  return {
    title: page.title,
    description: page.metaDescription || truncate(plainText(page.answerMd), 155),
    // The canonical is on the CLIENT's host. Never mission.srtagency.com, which is noindex, and
    // never their main site, which does not have this page.
    alternates: { canonical: url },
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: page.title,
      url,
      siteName: args.client.displayName,
    },
  };
}

/**
 * The page body, or null when no published page carries that slug.
 *
 * Returns null rather than calling notFound() so the caller decides: on /answers for a hub host,
 * a miss really is a 404, but the caller is the only thing that knows that.
 */
export async function AnswerPageBody(args: {
  host: string;
  client: HubClient;
  slug: string;
  base: AnswerBase;
  destination: Destination;
}): Promise<React.ReactElement | null> {
  const { host, client, slug, base, destination } = args;


  const page = await getPublished(client.id, slug);
  if (!page) return null;

  // ‼️ THE LINKS NEVER COST THE PAGE. planLinkRows already returns [] on failure; a failed list
  // read is caught here too, because a 5xx on a page that loaded fine, over decoration, is how an
  // indexed page gets a crawler's error recorded against it. No plan means no second read at all.
  const planRows = await planLinkRows(client.id);
  let links: PlanLinks = NO_PLAN_LINKS;
  if (planRows.length > 0) {
    try {
      links = planLinksFor(page.id, planRows, await listPublished(client.id));
    } catch (e) {
      console.error(`[hub/answer] plan links skipped for ${host}/${page.slug}:`, (e as Error).message);
    }
  }

  return (
    <>
      {/*
        ‼️ EVERY INTERNAL LINK IS RELATIVE TO THE BASE, AND GETTING IT WRONG IS SILENT.
        On a hub host the answer pages sit at /{slug}; on a site host they sit at
        /answers/{slug}. HubAnswerBody defaults both of these to "/", which is correct for the
        first and points the pillar link, the onward links and the client-name link at 404s on
        the second. Nothing throws: the page renders perfectly and its internal links are dead,
        which is the shape of bug that survives a demo.
      */}
      <HubAnswerBody
        client={client}
        destination={destination}
        page={page}
        links={links}
        linkBase={`${base}/`}
        homeHref={base || "/"}
      />
      {/*
        The concierge, carrying the offer THIS page was written toward. Renders null unless the
        client's concierge_configs.enabled is true, which only the concierge_live step sets. A
        page with no key falls back to the ladder, which is every page written before the column
        existed.
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
