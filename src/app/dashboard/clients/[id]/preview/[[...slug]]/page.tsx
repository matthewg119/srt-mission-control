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
// The AI Referral Engine is reachable here too (?kind=reviews), and the build spec's rule is
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
import { listAllForBoard, planLinkRows } from "@/lib/hub/pages";
import { orderIndexPages, planLinksFor } from "@/lib/hub/plan-links";
import { hostsFor } from "@/lib/hub/vercel-domains";
import { HubIndexBody, HubAnswerBody } from "@/components/hub/hub-bodies";
import { themeStyle } from "@/lib/hub/theme";
import { EMPTY_SKIN, skinStyle, hubRootClass } from "@/lib/hub/skin";
import {
  ReferralEngine,
  readEngine,
  readLook,
  type ReviewEngine,
} from "@/app/hub/[host]/reviews/referral-engine";
import type { ChatLook } from "@/app/hub/[host]/reviews/referral-engine-client";
import { loadCandidates } from "@/lib/clients/hub-skin";
import {
  brandFromReference,
  candidateAt,
  withReferenceBrand,
  type SkinCandidateSet,
} from "@/lib/hub/skin-variants";
import { REVIEW_PLATFORMS, destinationLine, destinationState } from "@/lib/hub/review-destinations";
import { ReviewLinkBox } from "./review-link-box";
import { GHOST_BELOW, GHOST_NOTICE, GHOST_PAGES, ghostAnswerPage } from "@/lib/hub/ghost-content";
import { UNIVERSES, isUniverse } from "@/lib/hub/universes";
import { universeSkin } from "@/lib/hub/skin-variants";
import { universeFontClass } from "@/components/hub/universe-fonts";
import { UniverseBand, UniverseTop } from "@/components/hub/universe-chrome";
import "@/app/hub/[host]/hub.css";
import "@/app/hub/[host]/universes.css";

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
  searchParams: {
    kind?: string;
    look?: string;
    engine?: string;
    candidate?: string;
    universe?: string;
  };
}

export default async function HubPreview({ params, searchParams }: Props) {
  // Middleware guards /dashboard/*, and this checks anyway — the same reasoning every
  // /api/clients route in this repo carries. Middleware is a layer, never the only one.
  const session = await auth().catch(() => null);
  if (!session?.user) notFound();

  // ‼️ `pending: true` IS THE SECOND THING THAT MAKES THIS PREVIEW THE INTERNAL ONE, and it is
  // the same distinction it already draws about drafts. It renders the theme and the skin
  // BEFORE they are confirmed, because otherwise the only way to see a design is to sign it off
  // unseen — the deadlock themeConfirmed() was already untangled from once. The tokenised
  // /preview/[token] link is shown to clients and deliberately does NOT pass this.
  const client = await loadClientForPreview(params.id, { pending: true });
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
  // ‼️ THE ONLY PLACE THE CHAT LOOK CAN BE CHOSEN, AND IT IS BEHIND auth(). The three
  // variations exist so Matthew can pick one; a client host has no way to pass this and always
  // renders the default. readLook() validates rather than interpolates, because the value ends
  // up in a class attribute.
  const look = readLook(searchParams.look);
  // Which review flow. A separate axis from `look`: see readEngine in referral-engine.tsx.
  const engine = readEngine(searchParams.engine);

  // ‼️ A CANDIDATE IS RENDERED, NEVER STORED, AND THAT IS THE WHOLE POINT OF THE THREE.
  //
  // The screenshot lane offers three designs and applies none of them. This is how they are
  // looked at: the page renders with a candidate's tokens substituted for the client's stored
  // skin, so all three can be compared against each other and against what they already have,
  // before anything is written. `pick <n>` in the step thread is the only thing that stores one.
  //
  // Login-required, like everything else under /dashboard. A client host cannot pass this and
  // would have nothing to pass: candidates live on the client row and are cleared on the pick.
  const candidateSlot = Number(searchParams.candidate);
  const candidateSet =
    Number.isInteger(candidateSlot) && candidateSlot > 0
      ? await loadCandidates(params.id)
      : null;
  const candidate = candidateAt(candidateSet, candidateSlot);

  // The tokens actually painted. A slot nobody offered falls back to the stored skin rather
  // than to nothing: an unknown number is not a design, and rendering unstyled would read as a
  // broken page rather than as a bad link.
  // ‼️ `?universe=` SHOWS ONE OF THE SIX ON THIS CLIENT WITHOUT STORING IT (2026-09-16), so the universes can be
  // compared before any screenshot. `universe <name>` in the step thread is what keeps one.
  const universeParam = isUniverse(searchParams.universe) ? searchParams.universe : null;
  const skin = universeParam ? universeSkin(universeParam, client.skin ?? EMPTY_SKIN, "preview") : (candidate ?? client.skin);

  // ‼️ AND THE CANDIDATE'S ACCENT AND BODY FONT, LAID OVER THE THEME, THROUGH THE SAME FUNCTION
  // THE PICK STORES THEM WITH. A pick writes the reference's accent into the theme; a preview that
  // did not show it would ask somebody to choose a design without its most recognisable colour,
  // which is exactly how srtagency.com came back as three black-and-grey pages on 2026-09-11.
  const theme =
    candidate && candidateSet
      ? withReferenceBrand(
          client.theme ?? { logoUrl: null, accent: null, accentSoft: null, fontFamily: null },
          brandFromReference(candidateSet, candidate)
        )
      : client.theme;

  const host =
    wanted.find((w) => w.kind === kind)?.host ??
    // No domain on the record yet. Say so in the hostname rather than rendering a
    // plausible-looking one, because the client is looking at this on a call.
    `${kind === "reviews" ? "reviews" : "learn"}.{no domain set}`;

  const slug = params.slug?.[0];

  return (
    <div
      className={`${hubRootClass(skin)} ${universeFontClass(skin?.universe)}`.trim()}
      lang={client.language}
      // Skin first, theme second. Same order as the live layout; see src/lib/hub/skin.ts.
      style={{ ...skinStyle(skin), ...themeStyle(theme) }}
    >
      <PreviewBanner
        clientId={params.id}
        kind={kind}
        host={host}
        slug={slug}
        look={look}
        engine={engine}
        candidateSet={candidateSet}
        candidateSlot={candidate?.slot ?? null}
        universe={universeParam}
        reviewDestinations={destinationState(
          (client.reviewWorkflow ?? null) as Record<string, unknown> | null,
          client.reviewDestinationPrimary ?? null
        )}
      />
      <UniverseTop
        universe={kind === "reviews" ? null : skin?.universe}
        name={client.displayName}
        where={[client.city, client.state].filter(Boolean).join(", ") || null}
        pages={-1}
      />
      <div className="hub-wrap">
        {kind === "reviews" ? (
          <ReferralEngine client={client} look={look} engine={engine} />
        ) : slug ? (
          <PreviewAnswer clientId={params.id} host={host} slug={slug} client={client} />
        ) : (
          <PreviewIndex clientId={params.id} host={host} client={client} />
        )}
      </div>
      <UniverseBand universe={kind === "reviews" ? null : skin?.universe} name={client.displayName} where={null} pages={-1} />
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
  const pages = orderIndexPages(
    all.filter((p) => p.status !== "archived"),
    await planLinkRows(clientId)
  );

  // ‼️ SAMPLE PAGES UNDER THE REAL ONES WHEN THERE ARE FEW (2026-09-16). An almost empty page cannot show a
  // design; the banner says the Latin is a sample, and nothing here is ever on a client's domain.
  const shown = pages.length < GHOST_BELOW ? [...pages, ...GHOST_PAGES] : pages;
  return <HubIndexBody client={client} host={host} pages={shown} linkBase={previewBase(clientId)} />;
}

/** Page links inside the preview stay inside the preview. */
function previewBase(clientId: string): string {
  return `/dashboard/clients/${clientId}/preview/`;
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
  const ghost = ghostAnswerPage(slug);
  if (ghost && !all.some((p) => p.slug === slug)) {
    return <HubAnswerBody client={client} host={host} page={ghost} linkBase={previewBase(clientId)} homeHref={`/dashboard/clients/${clientId}/preview`} />;
  }
  const page = all.find((p) => p.slug === slug);
  if (!page) notFound();

  // ‼️ DRAFTS COUNT AS LINKABLE HERE, AND ONLY HERE. The live hub links published pages alone,
  // because a link to a draft is a 404 on the client's domain. This preview shows drafts, so a
  // link to one opens it, and the pillar and its supports can be walked on the call before any of
  // them is live. Same plan, same planLinksFor, a wider list of pages.
  const walkable = all
    .filter((p) => p.status !== "archived")
    .map((p) => ({ id: p.id, slug: p.slug, title: p.title }));
  const links = planLinksFor(page.id, await planLinkRows(clientId), walkable);

  return (
    <HubAnswerBody
      client={client}
      host={host}
      page={page}
      links={links}
      linkBase={previewBase(clientId)}
      homeHref={`/dashboard/clients/${clientId}/preview`}
    />
  );
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
  look,
  engine,
  candidateSet,
  candidateSlot,
  reviewDestinations,
  universe,
}: {
  clientId: string;
  kind: "hub" | "reviews";
  host: string;
  slug?: string;
  look: ChatLook;
  engine: ReviewEngine;
  candidateSet: SkinCandidateSet | null;
  candidateSlot: number | null;
  reviewDestinations: ReturnType<typeof destinationState>;
  universe: string | null;
}) {
  const other = kind === "reviews" ? "hub" : "reviews";

  // ‼️ EVERY SURFACE THAT STARTS SOMETHING PRINTS WHAT CAN BE DONE NEXT. Matthew's acceptance
  // criterion, and the shape is copied from step 15's card, which offers its four templates,
  // the screenshot lane, the preview link and the confirm link in one place. A preview that
  // shows three possible looks and gives you no way to see the other two is the bug.
  const looks: ReadonlyArray<{ key: ChatLook; label: string }> = [
    { key: "a", label: "bubbles" },
    { key: "b", label: "editorial" },
    { key: "c", label: "compact" },
  ];

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
      {/*
        ‼️ IT SAYS OUT LOUD THAT NOTHING IS STORED. Somebody comparing three designs in three
        tabs has to be able to tell, from the page itself, which one the client is actually on.
        A preview that looked identical whether or not it had been chosen would make "did I
        pick it" a question you answer by going and looking somewhere else.
      */}
      {candidateSet && (
        <span style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            {candidateSlot ? `design ${candidateSlot} of ${candidateSet.candidates.length}, not stored:` : "three on offer:"}
          </span>
          {candidateSet.candidates.map((option) => (
            <a
              key={option.slot}
              href={`/dashboard/clients/${clientId}/preview?${kind === "reviews" ? "kind=reviews&" : ""}candidate=${option.slot}`}
              style={{
                color: option.slot === candidateSlot ? "#fff" : "#F5A623",
                fontWeight: option.slot === candidateSlot ? 700 : 400,
                textDecoration: option.slot === candidateSlot ? "none" : "underline",
              }}
            >
              {option.slot}
            </a>
          ))}
          <a
            href={`/dashboard/clients/${clientId}/preview${kind === "reviews" ? "?kind=reviews" : ""}`}
            style={{ color: candidateSlot ? "#F5A623" : "#fff", textDecoration: candidateSlot ? "underline" : "none" }}
          >
            stored
          </a>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>
            Type <code style={{ color: "#fff" }}>pick {candidateSlot ?? 1}</code> in the step
            thread to keep one.
          </span>
        </span>
      )}
      {kind === "hub" && (
        <span style={{ color: "rgba(255,255,255,0.5)" }}>Drafts are shown; the live hub omits them. {GHOST_NOTICE}</span>
      )}
      {kind === "hub" && (
        <span style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "baseline", width: "100%" }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>universes:</span>
          {UNIVERSES.map((u) => (
            <a
              key={u.key}
              href={`/dashboard/clients/${clientId}/preview?universe=${u.key}`}
              title={u.blurb}
              style={{
                color: universe === u.key ? "#fff" : "#F5A623",
                fontWeight: universe === u.key ? 700 : 400,
                textDecoration: universe === u.key ? "none" : "underline",
              }}
            >
              {u.name}
            </a>
          ))}
          {universe && (
            <span style={{ color: "rgba(255,255,255,0.5)" }}>
              not stored. Type <code style={{ color: "#fff" }}>universe {universe}</code> in the step thread to keep it.
            </span>
          )}
        </span>
      )}
      {kind === "reviews" && (
        <span style={{ color: "rgba(255,255,255,0.5)" }}>
          Type into it freely. Submissions from here are discarded, not stored.
        </span>
      )}
      {kind === "reviews" && (
        <span style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>review flow:</span>
          {[
            { key: "v1" as const, label: "current" },
            { key: "panel" as const, label: "agent panel" },
            { key: "full" as const, label: "agent full screen" },
          ].map((option) => (
            <a
              key={option.key}
              href={`/dashboard/clients/${clientId}/preview?kind=reviews&engine=${option.key}&look=${look}`}
              style={{
                color: option.key === engine ? "#fff" : "#F5A623",
                fontWeight: option.key === engine ? 700 : 400,
                textDecoration: option.key === engine ? "none" : "underline",
              }}
            >
              {option.label}
            </a>
          ))}
        </span>
      )}
      {/*
        ‼️ THE THREE CHAT SKINS BELONG TO v1 AND ARE HIDDEN FOR THE OTHER TWO. They are CSS over
        the v1 chat markup, so on an agent flow they are three links that change a class nothing
        renders. A control that does nothing is the bug the comment over `looks` complains about,
        one level up.
      */}
      {kind === "reviews" && engine === "v1" && (
        <span style={{ display: "flex", gap: "8px", alignItems: "baseline" }}>
          <span style={{ color: "rgba(255,255,255,0.5)" }}>chat look:</span>
          {looks.map((option) => (
            <a
              key={option.key}
              href={`/dashboard/clients/${clientId}/preview?kind=reviews&engine=${engine}&look=${option.key}`}
              style={{
                color: option.key === look ? "#fff" : "#F5A623",
                fontWeight: option.key === look ? 700 : 400,
                textDecoration: option.key === look ? "none" : "underline",
              }}
            >
              {option.label}
            </a>
          ))}
        </span>
      )}
      {kind === "reviews" && (
        <ReviewLinkBox
          clientId={clientId}
          line={destinationLine(reviewDestinations)}
          hasLink={reviewDestinations.configured.length > 0}
          primary={reviewDestinations.primary?.key ?? null}
          platforms={REVIEW_PLATFORMS.map((p) => ({ key: p.key, name: p.name, placeholder: p.placeholder }))}
        />
      )}
      <span style={{ marginLeft: "auto", display: "flex", gap: "12px" }}>
        <a
          href={`/dashboard/clients/${clientId}/preview${other === "reviews" ? "?kind=reviews" : ""}`}
          style={{ color: "#F5A623" }}
        >
          view the {other}
        </a>
        <a href={`/dashboard/clients/${clientId}/plan`} style={{ color: "#F5A623" }}>
          plan map
        </a>
        <a href={`/dashboard/clients/${clientId}`} style={{ color: "rgba(255,255,255,0.6)" }}>
          back to the board
        </a>
      </span>
    </div>
  );
}
