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
import "./hub.css";

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
    // The review tool is a page for one customer, on her own phone, from a QR code. It is
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

  return (
    <div className="hub-root" lang={resolved.client.language}>
      <div className="hub-wrap">{children}</div>
    </div>
  );
}
