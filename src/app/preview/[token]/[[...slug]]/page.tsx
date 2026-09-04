// The preview a client may actually be shown — delivery steps 16 and 17.
//
// Matthew: "since step 17 is before the call we need mission control to host the preview of the
// reviews page and learn page hub to show to the client in the call."
//
// ‼️ WHY THE ONE THAT ALREADY EXISTED COULD NOT BE USED.
// reviewPreviewUrl() points at /dashboard/clients/{id}/preview, and that page calls notFound()
// without a session. So a logged-out visitor gets a 404 rather than a login screen, which is
// correct for an internal tool and useless for a link somebody opens on a call. Step 16's card
// already said out loud that it could not be handed to a client. This is that link.
//
// ‼️ NOT A THIRD HUB. It renders the same components the live route and the dashboard preview
// both render (src/components/hub/hub-bodies.tsx, ReviewTool). Three renderers of one page is
// three places for a theme to drift.
//
// ‼️ ONE DIFFERENCE FROM THE DASHBOARD PREVIEW, AND IT IS DELIBERATE: DRAFTS ARE HIDDEN HERE.
// The dashboard preview shows them because it exists to check work in progress. This one is
// shown to the person the pages are about, and a draft they read on a call is a page they will
// ask about next week whether or not it was ever published.
//
// ‼️ IT IS REACHABLE ON THE INTERNAL HOST AND ON NO OTHER, AND middleware.ts NEEDED NO EDIT FOR
// THAT. Its external branch is an allowlist of hub paths whose page rule (HUB_SLUG) forbids a
// slash, so /preview/<token> is refused on every client-controlled hostname by the rule that is
// already there. Adding it to that allowlist would publish an unreleased hub preview on domains
// clients control, which is the exact failure public/robots.txt was deleted to prevent. Do not.
//
// ‼️ SUBMISSIONS STAY DISCARDED, BY THE SAME MECHANISM AS EVERY OTHER PREVIEW.
// /api/hub/reviews/submit takes the client identity ONLY from the x-hub-host header, and
// middleware STRIPS that header on internal hosts. This page is on an internal host, so a
// submission from it has no client to write against and is refused. That is what
// PREVIEW_DISCARD_RULE states and it remains true here without a new check.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { verifyOnboardingToken } from "@/lib/clients/token";
import { loadClientForPreview } from "@/lib/hub/resolve";
import { listAllForBoard } from "@/lib/hub/pages";
import { hostsFor } from "@/lib/hub/vercel-domains";
import {
  HubIndexBody,
  HubAnswerBody,
  HubReplicaBody,
  HubReplicaIndexBody,
  type HubReplicaPage,
} from "@/components/hub/hub-bodies";
import { listReplica } from "@/lib/hub/replica-pages";
import { ConciergeEmbed } from "@/lib/concierge/embed";
import { themeStyle } from "@/lib/hub/theme";
import { skinStyle, skinClass } from "@/lib/hub/skin";
import { ReviewTool } from "@/app/hub/[host]/reviews/review-tool";
import "@/app/hub/[host]/hub.css";

// A preview must never be a cached render: you preview to see what you just saved.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// The root layout already sets index:false app-wide. Stated again here because this page renders
// a client's real content on a URL that is deliberately shareable, and it is the one place in
// the app where an accidental index would publish their pages before they are live.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

interface Props {
  params: { token: string; slug?: string[] };
  searchParams: { kind?: string };
}

export default async function TokenPreview({ params, searchParams }: Props) {
  // ‼️ EVERY FAILURE IS A 404 AND NONE OF THEM SAYS WHICH. Expired, wrong scope, bad signature
  // and never-existed all render the same miss, for the reason middleware.ts gives for never
  // answering 401 or 403: a different answer per reason is a way to learn what exists.
  const verified = verifyOnboardingToken(params.token, "preview");
  if (!verified.ok) notFound();

  const client = await loadClientForPreview(verified.clientId);
  if (!client) notFound();

  const { data: row } = await supabaseAdmin
    .from("clients")
    .select("subdomain, domain")
    .eq("id", verified.clientId)
    .maybeSingle();

  const wanted = hostsFor((row ?? { subdomain: null, domain: null }) as {
    subdomain: string | null;
    domain: string | null;
  });

  const kind =
    searchParams.kind === "reviews" ? "reviews" : searchParams.kind === "site" ? "site" : "hub";
  const host =
    wanted.find((w) => w.kind === kind)?.host ??
    `${kind === "reviews" ? "reviews" : "learn"}.{no domain set}`;

  const slug = params.slug?.[0];
  // ‼️ JOINED, NOT [0]. The replica keeps their own path, slashes and all, which is the whole
  // reason it lives here rather than on a client host: this route is a catch-all on the INTERNAL
  // host, so a nested path costs nothing, while middleware's HUB_SLUG forbids one on a hostname
  // a client's registrar controls. That rule is untouched and must stay that way.
  const replicaPath = (params.slug ?? []).join("/");

  // ── The replica of their own site ────────────────────────────────────────
  //
  // ‼️ IT DOES NOT FILTER ON STATUS, AND THAT IS NOT THE DRAFT RULE BEING BENT. The hub branch
  // below shows published pages only, because a DRAFT answer page read on a call is a promise
  // about a page that may never ship. A replica row is not a draft of anything: it has no status
  // column, no publish path and no route that could serve it on a client's domain, and the page
  // it shadows already exists on their own site. Its ribbon says exactly that.
  if (kind === "site") {
    const rows = await listReplica(verified.clientId);
    const pages: HubReplicaPage[] = rows.map((r) => ({
      id: r.id,
      path: r.path,
      navLabel: r.navLabel,
      title: r.title,
      bodyMd: r.bodyMd,
    }));

    const href = (path: string) =>
      path ? `/preview/${params.token}/${path}?kind=site` : `/preview/${params.token}?kind=site`;

    const current = replicaPath ? pages.find((p) => p.path === replicaPath) : null;
    if (replicaPath && !current) notFound();

    const magnetKey = current
      ? (rows.find((r) => r.path === current.path)?.leadMagnetKey ?? null)
      : (rows.find((r) => r.path === "")?.leadMagnetKey ?? null);

    return (
      <div
        className={`hub-root ${skinClass(client.skin)}`}
        lang={client.language}
        style={{ ...skinStyle(client.skin), ...themeStyle(client.theme) }}
      >
        <ReplicaRibbon />
        <div className="hub-wrap">
          {current ? (
            <HubReplicaBody client={client} page={current} pages={pages} href={href} />
          ) : (
            <HubReplicaIndexBody
              client={client}
              home={pages.find((p) => p.path === "") ?? null}
              pages={pages}
              href={href}
            />
          )}
        </div>
        {/*
          The whole second half of the ask: the assistant, on pages they recognise. `preview`
          carries this page's own signed token, which is the only thing that makes a widget whose
          `enabled` is still false answer at all. It turns nothing on: see
          src/lib/concierge/preview-grant.ts.
        */}
        <ConciergeEmbed clientId={verified.clientId} magnetKey={magnetKey} preview={params.token} />
      </div>
    );
  }

  return (
    <div
      className={`hub-root ${skinClass(client.skin)}`}
      lang={client.language}
      // Skin first, theme second. Same order as the live layout; see src/lib/hub/skin.ts.
      style={{ ...skinStyle(client.skin), ...themeStyle(client.theme) }}
    >
      <PreviewRibbon host={host} slug={slug} />
      <div className="hub-wrap">
        {kind === "reviews" ? (
          <ReviewTool client={client} />
        ) : slug ? (
          <PreviewAnswer clientId={verified.clientId} host={host} slug={slug} client={client} />
        ) : (
          <PreviewIndex clientId={verified.clientId} host={host} client={client} />
        )}
      </div>
    </div>
  );
}

/**
 * Published only.
 *
 * ‼️ THE ONE PLACE THIS DIVERGES FROM THE DASHBOARD PREVIEW, AND THE DIVERGENCE IS THE POINT.
 * listAllForBoard returns drafts as well as published pages, which is right for a working
 * preview and wrong for a page somebody is being shown on a call: a draft they read is a
 * promise they heard.
 */
async function PreviewIndex({
  clientId,
  host,
  client,
}: {
  clientId: string;
  host: string;
  client: Awaited<ReturnType<typeof loadClientForPreview>> & object;
}) {
  const all = await listAllForBoard(clientId);
  const pages = all.filter((p) => p.status === "published");

  return <HubIndexBody client={client} host={host} pages={pages} />;
}

async function PreviewAnswer({
  clientId,
  host,
  slug,
  client,
}: {
  clientId: string;
  host: string;
  slug: string;
  client: Awaited<ReturnType<typeof loadClientForPreview>> & object;
}) {
  const all = await listAllForBoard(clientId);
  const page = all.find((p) => p.slug === slug && p.status === "published");
  if (!page) notFound();

  return <HubAnswerBody client={client} host={host} page={page} />;
}

/**
 * The ribbon says the two things a client asks in the first ten seconds: what am I looking at,
 * and is it live yet.
 *
 * It sits OUTSIDE .hub-wrap so it cannot be mistaken for part of the page. It carries no link
 * back to the board and no client id: this URL is handed over, and a control that only makes
 * sense to us on a screen somebody else is reading is clutter at best.
 */
function PreviewRibbon({ host, slug }: { host: string; slug?: string }) {
  return (
    <div
      style={{
        background: "#1d1d1f",
        color: "rgba(255,255,255,0.75)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        padding: "10px 16px",
        font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "baseline",
      }}
    >
      <strong style={{ color: "#F5A623" }}>PREVIEW</strong>
      <span>
        This is what <code style={{ color: "#fff" }}>{host}</code>
        {slug ? `/${slug}` : ""} will serve. Nothing here is live yet and nothing is indexed.
      </span>
    </div>
  );
}

/**
 * The replica's ribbon, and it says a different thing from the hub's.
 *
 * The hub ribbon answers "is this live yet", because a client looking at answer pages wants to
 * know when they appear on their domain. A client looking at a rebuild of their OWN site asks a
 * sharper question, usually in the first five seconds and usually out loud: have you touched my
 * website. The answer is no, and it is the first thing here rather than a reassurance offered
 * after they ask.
 */
function ReplicaRibbon() {
  return (
    <div
      style={{
        background: "#1d1d1f",
        color: "rgba(255,255,255,0.75)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
        padding: "10px 16px",
        font: "13px/1.5 ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        flexWrap: "wrap",
        gap: "12px",
        alignItems: "baseline",
      }}
    >
      <strong style={{ color: "#F5A623" }}>PREVIEW</strong>
      <span>
        Your own site, rebuilt on our servers with the assistant on it. Nothing on your website has
        been changed or copied, and none of this is indexed.
      </span>
    </div>
  );
}
