// The hub preview. Runner v3 5f and 5g.
//
// "Served at an internal preview host on our own domain — noindex, no client DNS, not the
// live hub host. The client sees exactly what it will look like and asks for changes
// BEFORE anything goes live."
//
// NOT A SECOND HUB. It renders the same components the live route renders
// (src/components/hub/hub-bodies.tsx). The only differences are the two that have to
// differ: drafts are visible here and not there, and the hostname is COMPOSED from the
// client record rather than resolved from client_hosts, so a preview works before a single
// domain is attached — which is the point, because 5f happens before the DNS conversation.
//
// ‼️ WHY THIS IS SAFE TO PUT UNDER /dashboard, AND WHY THAT IS NOT AN ACCIDENT
//
// The review tool is reachable here too (?kind=reviews), and the build spec's rule is
// absolute: a submission from a preview must never reach review_tool_submissions, "gated on
// the HOST, not on a flag someone can forget to set."
//
// That gate already exists and this route inherits it rather than re-implementing it.
// /api/hub/reviews/submit takes the client identity ONLY from the x-hub-host header, and
// middleware.ts STRIPS that header on internal hosts. /dashboard is only reachable on an
// internal host. So a submission from here has no client to write against and is refused.
// Verified by request, 2026-08-18:
//
//   POST /api/hub/reviews/submit with a FORGED x-hub-host on localhost -> 404
//   POST /api/hub/reviews/submit with a clientId in the BODY           -> 404 Not found
//
// If anyone ever makes that route read a client id from the body or a query param, this
// preview becomes a corpus-poisoning hole on the same commit. That is the thing to protect.

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { loadClientForPreview } from "@/lib/hub/resolve";
import { listAllForBoard } from "@/lib/hub/pages";
import { hostsFor } from "@/lib/hub/vercel-domains";
import { HubIndexBody, HubAnswerBody } from "@/components/hub/hub-bodies";
import { themeStyle } from "@/lib/hub/theme";
import { ReviewTool } from "@/app/hub/[host]/reviews/review-tool";
import "@/app/hub/[host]/hub.css";

// A preview must never be a cached render: you preview to see what you just saved.
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Belt and braces. The root layout already sets index:false app-wide and middleware only
// serves /dashboard on internal hosts, but this page renders a client's real content and
// is the one place in the app where an accidental index would publish it early.
export const metadata: Metadata = {
  robots: { index: false, follow: false, nocache: true },
};

interface Props {
  params: { id: string; slug?: string[] };
  searchParams: { kind?: string };
}

export default async function HubPreview({ params, searchParams }: Props) {
  // Middleware guards /dashboard/*, and this checks anyway — the same reasoning every
  // /api/clients route in this repo carries. Middleware is a layer, never the only one.
  const session = await auth().catch(() => null);
  if (!session?.user) notFound();

  const client = await loadClientForPreview(params.id);
  if (!client) notFound();

  // The hostname the client WILL have. Composed, not resolved, so this works before the
  // domain is attached. subdomainLabel handles rows still carrying the full-host shape.
  const { data: row } = await supabaseAdmin
    .from("clients")
    .select("subdomain, domain")
    .eq("id", params.id)
    .maybeSingle();

  const wanted = hostsFor((row ?? { subdomain: null, domain: null }) as {
    subdomain: string | null;
    domain: string | null;
  });

  const kind = searchParams.kind === "reviews" ? "reviews" : "hub";
  const host =
    wanted.find((w) => w.kind === kind)?.host ??
    // No domain on the record yet. Say so in the hostname rather than rendering a
    // plausible-looking one, because the client is looking at this on a call.
    `${kind === "reviews" ? "reviews" : "learn"}.{no domain set}`;

  const slug = params.slug?.[0];

  return (
    <div className="hub-root" lang={client.language} style={themeStyle(client.theme)}>
      <PreviewBanner clientId={params.id} kind={kind} host={host} slug={slug} />
      <div className="hub-wrap">
        {kind === "reviews" ? (
          <ReviewTool client={client} />
        ) : slug ? (
          <PreviewAnswer clientId={params.id} host={host} slug={slug} client={client} />
        ) : (
          <PreviewIndex clientId={params.id} host={host} client={client} />
        )}
      </div>
    </div>
  );
}

/** Drafts included, which is the whole difference from the live index. */
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
  const pages = all.filter((p) => p.status !== "archived");

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
  const page = all.find((p) => p.slug === slug);
  if (!page) notFound();

  return <HubAnswerBody client={client} host={host} page={page} />;
}

/**
 * The banner says three things, and each of them is a question somebody asks on a call:
 * what am I looking at, is this live, and what is missing from it.
 *
 * It sits OUTSIDE .hub-wrap so it cannot be mistaken for part of the page, and it is the
 * one piece of markup here that the live route does not have.
 */
function PreviewBanner({
  clientId,
  kind,
  host,
  slug,
}: {
  clientId: string;
  kind: "hub" | "reviews";
  host: string;
  slug?: string;
}) {
  const other = kind === "reviews" ? "hub" : "reviews";

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
        {slug ? `/${slug}` : ""} will serve. Nothing here is live and nothing is indexed.
      </span>
      {kind === "hub" && (
        <span style={{ color: "rgba(255,255,255,0.5)" }}>Drafts are shown; the live hub omits them.</span>
      )}
      {kind === "reviews" && (
        <span style={{ color: "rgba(255,255,255,0.5)" }}>
          Type into it freely. Submissions from here are discarded, not stored.
        </span>
      )}
      <span style={{ marginLeft: "auto", display: "flex", gap: "12px" }}>
        <a
          href={`/dashboard/clients/${clientId}/preview${other === "reviews" ? "?kind=reviews" : ""}`}
          style={{ color: "#F5A623" }}
        >
          view the {other}
        </a>
        <a href={`/dashboard/clients/${clientId}`} style={{ color: "rgba(255,255,255,0.6)" }}>
          back to the board
        </a>
      </span>
    </div>
  );
}
