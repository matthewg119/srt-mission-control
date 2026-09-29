// The hub shell.
//
// Reachable ONLY through the middleware rewrite: an external host asking for /x lands here
// as /hub/{host}/x. The host is a PATH SEGMENT rather than a header on purpose — Next's
// full-route cache keys on the pathname, so two clinics that both publish /pricing would
// otherwise share one cache entry and serve each other's page.
//
// THE ROOT LAYOUT SETS robots: { index: false } FOR THE WHOLE APP, because
// mission.srtagency.com is an internal tool with nothing public on it. Every hub page has
// to override that, and page metadata beating layout metadata is the same mechanism
// src/app/scan/page.tsx already relies on. Being read by AI crawlers is the entire product
// here, so this is not a detail.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { resolveHost } from "@/lib/hub/resolve";
import { HubShell, SiteShell } from "@/components/hub/hub-shell";
import "./hub.css";
import "./universes.css";

// Not force-dynamic. Every dashboard page and API route in this repo sets
// `dynamic = "force-dynamic"` out of habit, and it is exactly wrong here: it would make
// every client page a cold database render on every crawl. Five minutes of ISR instead.
export const revalidate = 300;

interface Props {
  children: React.ReactNode;
  params: { host: string };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const resolved = await resolveHost(decodeURIComponent(params.host));
  if (resolved.status !== "ok") {
    return { robots: { index: false, follow: false } };
  }

  const { client, host, kind } = resolved;

  return {
    // metadataBase is the CLIENT's host, never mission.srtagency.com, so every canonical
    // and every og:url resolves onto their domain.
    metadataBase: new URL(`https://${host}`),
    title: {
      default: client.displayName,
      template: `%s · ${client.displayName}`,
    },
    // The AI Referral Engine is a page for one customer, on her own phone, from a QR code. It is
    // not a thing to be found, and it is the one host here that should stay out of an
    // index. The hub is the opposite.
    robots:
      kind === "reviews"
        ? { index: false, follow: false }
        : { index: true, follow: true },
  };
}

export default async function HubLayout({ children, params }: Props) {
  const host = decodeURIComponent(params.host);

  // resolveHost THROWS when the lookup fails and returns unknown only on a genuine miss.
  // The throw is deliberately not caught: it reaches the error boundary and becomes a 5xx,
  // which tells a crawler to come back. Catching it here and calling notFound() would 404
  // a live, indexed client site over a ten-minute database blip, and that is the one
  // failure this whole feature exists to avoid.
  const resolved = await resolveHost(host);
  if (resolved.status !== "ok") notFound();

  // ‼️ A `site` HOST OPTS OUT OF THE SHELL FOR ITS MARKETING PAGES, AND KEEPS IT FOR /answers.
  //
  // A pasted page arrives with its own header, footer, grid and <style> block. Wrapping it in
  // .hub-root and .hub-wrap would put our measure, our padding and our ground colour underneath
  // a design that already has all three, and the theme on top of that is OUR inference about
  // their brand sitting over their own decision, on their own domain.
  //
  // The layout cannot tell WHICH child is rendering -- params for a child dynamic segment never
  // reach it, the same limitation that moved the concierge out of here -- so it does the half it
  // can see: a site host gets the bare wrapper, and the /answers routes put the shell back on
  // themselves with the same <HubShell> this renders. hub and reviews hosts are untouched.
  if (resolved.kind === "site") {
    return <SiteShell lang={resolved.client.language}>{children}</SiteShell>;
  }

  return (
    <HubShell client={resolved.client}>
      {children}
      {/*
        ‼️ THE CONCIERGE USED TO BE MOUNTED HERE AND IT MOVED, ON PURPOSE. Do not put it back.

        The layout is the only file that is all of a client's pages, which is exactly why it cannot
        know WHICH page it is. Once a page names the magnet it was drafted toward
        (client_pages.lead_magnet_key), the widget has to be mounted somewhere that has read the
        page row, and a layout never does: params for a child dynamic segment do not reach it.

        It now sits in page.tsx and [slug]/page.tsx, which between them are still all of a client's
        pages. Two mounts instead of one, and the slug page already holds the row, so the key costs
        no extra query. skin.ts still forbids markup in a skin and draft-page.ts still rejects links
        inside answer_md: neither rail was loosened to do this.

        The move also took the widget OFF the reviews host, which it should never have been on.
        This layout wraps both kinds of host and the AI Referral Engine is regulated separately, with
        NOT_GATED in hub/page-gate.ts saying no model may go near it.
      */}
    </HubShell>
  );
}
