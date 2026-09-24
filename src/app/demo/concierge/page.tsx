// The AI Concierge in its panel, on a page anybody holding the link can look at. PREVIEW ONLY.
//
// ‼️ WHY THIS PAGE EXISTS: /w/{slug} IS THE WRONG WAY TO LOOK AT THE WIDGET, AND IT IS NOT OBVIOUS.
// That route is the iframe DOCUMENT. Opened directly it fills the browser window, because the
// thing that gives it its size is the 380px panel embed.js injects on the host page. Looking at it
// bare is how you conclude the product is a full-screen chat when it is a corner chatbox.
//
// ‼️ THE SCRIPT TAG IS WRITTEN HERE RATHER THAN THROUGH <ConciergeEmbed>, AND THE REASON IS DNS.
// ConciergeEmbed points a live page at conciergeOrigin(), which is concierge.srtagency.com, and
// that hostname DOES NOT RESOLVE TODAY (checked 2026-09-24; learn. and reviews.srtagency.com are
// missing too). A demo that loads a script from a dead host is a page with no widget on it and no
// error to explain why, because every failure path in embed.js is silent by design.
//
// Loading /embed.js from OUR OWN origin is the same route the tokenised preview already takes, and
// for the same reason its comment gives: the loader, the frame it derives and the API calls it
// makes are then all same-origin with the page and need no DNS record anywhere. embed.js reads its
// own <script src> to work that out, so there is nothing to configure.
//
// ‼️ THE `enabled` GATE IS STILL HONOURED. embeddableClient() is not exported, so the check is
// repeated here as one query rather than reached around: a switched-off tenant renders no script
// tag at all, exactly as it would on a client's real website. This page relaxes nothing.

import type { Metadata } from "next";
import { supabaseAdmin } from "@/lib/db";

export const metadata: Metadata = {
  title: "AI Concierge (preview)",
  description: "Design demo of the AI Concierge widget. Not a live page.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/** The tenant to demo. A slug, so this page holds no client id. */
const DEMO_SLUG = "srt-agency-llc";

async function embeddableSlug(slug: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("concierge_configs")
    .select("enabled, clients!inner(slug)")
    .eq("clients.slug", slug)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as Record<string, unknown>;
  if (row.enabled !== true) return null;
  const client = (Array.isArray(row.clients) ? row.clients[0] : row.clients) as
    | Record<string, unknown>
    | undefined;
  return typeof client?.slug === "string" ? client.slug : null;
}

export default async function ConciergeDemo() {
  const slug = await embeddableSlug(DEMO_SLUG);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#ffffff",
        color: "#14181f",
        font: "16px/1.6 ui-sans-serif, system-ui, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
      }}
    >
      <Ribbon live={slug !== null} />

      {/*
        Sample page body, and it is deliberately plain. The point of this page is the corner, so
        anything competing with it would be in the way. It exists so the panel has a page to sit
        on top of, which is the whole thing /w/{slug} cannot show you.
      */}
      <main style={{ maxWidth: "44rem", margin: "0 auto", padding: "3rem 1.25rem 8rem" }}>
        <p style={{ textTransform: "uppercase", letterSpacing: "0.08em", fontSize: "0.75rem", color: "#5b6672", margin: 0 }}>
          Sample page
        </p>
        <h1 style={{ fontSize: "2rem", lineHeight: 1.2, margin: "0.5rem 0 1rem" }}>
          This is a stand in for a client page.
        </h1>
        <p style={{ color: "#3d4752", margin: "0 0 1rem" }}>
          The words here do not matter. What matters is the corner: tap the launcher and the
          assistant opens as a panel over this page, which is how a visitor meets it on a real
          site. It is the same chrome, the same bubbles and the same chips as the review tool.
        </p>
        <p style={{ color: "#3d4752", margin: "0 0 1rem" }}>
          The only thing that differs between the two is the accent. Here it is ours, because this
          is our product. On a client page it is theirs, read off their own site.
        </p>
        <p style={{ color: "#5b6672", margin: 0, fontSize: "0.9375rem" }}>
          Nothing typed into the assistant on this page is treated differently from a real
          conversation: it is a live widget pointed at a live tenant, so anything entered becomes a
          real session.
        </p>
      </main>

      {slug ? (
        // A plain <script src>, not next/script and not inline code, for the reasons the header of
        // lib/concierge/embed.tsx gives: document.currentScript has to be set for it, and an inline
        // script would need a CSP nonce threaded through a layout this lane does not own.
        // eslint-disable-next-line @next/next/no-sync-scripts
        <script async src="/embed.js" data-client={slug} />
      ) : null}
    </div>
  );
}

function Ribbon({ live }: { live: boolean }) {
  return (
    <div
      style={{
        background: "#1d1d1f",
        color: "rgba(255,255,255,0.75)",
        padding: "10px 16px",
        font: "13px/1.6 ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        flexWrap: "wrap",
        gap: "14px",
        alignItems: "baseline",
      }}
    >
      <strong style={{ color: "#F5A623" }}>PREVIEW</strong>
      <span>
        The AI Concierge as a visitor meets it. Tap the launcher in the corner.
      </span>
      {live ? null : (
        <span style={{ color: "#F5A623" }}>
          The concierge is switched off for this tenant, so no widget is on this page. Turn it on
          at step 36.
        </span>
      )}
    </div>
  );
}
