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
import { themeStyle } from "@/lib/hub/theme";
import { skinStyle, skinClass } from "@/lib/hub/skin";
import { ConciergeEmbed } from "@/lib/concierge/embed";
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
    // The theme is four CSS custom properties overriding what hub.css already declares
    // on .hub-root, so a themed hub and an unthemed one are the same markup. themeStyle
    // returns {} when there is no confirmed theme.
    // ‼️ SKIN FIRST, THEME SECOND, IN THE SPREAD AND IN EVERY OTHER RENDERER.
    // They write disjoint variables today, so the order is invisible — and the day one of them
    // grows an accent, the CLIENT's brand has to beat a colour read off a reference image.
    // skinClass() always returns a class, including for the default template, so the live page
    // and both previews carry the same attribute.
    <div
      className={`hub-root ${skinClass(resolved.client.skin)}`}
      lang={resolved.client.language}
      style={{ ...skinStyle(resolved.client.skin), ...themeStyle(resolved.client.theme) }}
    >
      <div className="hub-wrap">{children}</div>
      {/*
        The concierge, on every page we host for this client, from one place.

        ‼️ IN THE LAYOUT RATHER THAN IN hub-bodies.tsx OR THE SKIN, AND THAT IS THE POINT.
        Matthew asked for it on all of their pages, and the layout is the only file that is all of
        their pages. skin.ts forbids markup in a skin ("a skin that could carry its own HTML would
        be a skin that could silently delete the thing we sell") and draft-page.ts rejects any link
        inside answer_md, so both of those rails stay intact and neither had to be loosened.

        Renders null unless that client's concierge_configs.enabled is true, which only the
        concierge_live delivery step sets.
      */}
      <ConciergeEmbed clientId={resolved.client.id} />
    </div>
  );
}
