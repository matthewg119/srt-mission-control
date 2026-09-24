// The Virtual Agent, on a page anybody holding the link can look at. PREVIEW ONLY.
//
// ‼️ WHY THIS EXISTS AND WHAT IT IS NOT.
//
// The three real ways to see the review tool all need something you cannot put in a message:
// reviews.{clientdomain} needs a live client, /dashboard/... needs a NextAuth session, and
// /preview/{token} needs a token signed with CLIENT_LINK_SECRET, which is a sensitive Vercel env
// and therefore unmintable from a laptop. None of those is a good way to answer "show me the two
// designs side by side".
//
// So this is the same decision /v2 made and for the same reason: a design demo on the internal
// host, noindex, ribboned, that exists to be argued about and deleted. It is reachable on any
// deployment including a branch preview, needs nothing, and changes nothing.
//
// ‼️ IT IS NOT A FOURTH RENDERER OF THE HUB, AND THE DISTINCTION MATTERS. The header of
// /preview/[token] warns that three renderers of one page is three places for a theme to drift.
// This adds a fourth CALLER of <ReferralEngine>, not a fourth rendering of it: the wrapper below
// is copied from that file line for line, skin first and theme second, so anything that drifts
// drifts in all of them together. Nothing here re-implements a bubble, a token or a question.
//
// ‼️ NOTHING IT DOES REACHES A DATABASE. The client is a literal in this file. It cannot be
// confused with a real one, its id is not a uuid, and there is no row for the submit route to
// write to even if it were called. On this host middleware strips x-hub-host, so /api/hub/reviews/
// submit 404s anything typed here: the flow can be walked as many times as you like and stores
// nothing. Same guarantee the dashboard preview prints on its own ribbon.

import type { Metadata } from "next";
import type { HubClient } from "@/lib/hub/resolve";
import { themeStyle } from "@/lib/hub/theme";
import { skinStyle, hubRootClass } from "@/lib/hub/skin";
import { ReferralEngine, readEngine, readLook } from "@/app/hub/[host]/reviews/referral-engine";
import "@/app/hub/[host]/hub.css";
import "@/app/hub/[host]/universes.css";

export const metadata: Metadata = {
  title: "Virtual Agent (preview)",
  description: "Design demo of the AI Referral Engine. Not a live page.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * A business that does not exist.
 *
 * The accent is SRT's own reef green so the panel shows what "takes the client's accent" actually
 * looks like: the chrome below stays the agent's on every client, and only the chips, the send
 * button and her own bubbles move. Swap `accent` to see that happen.
 */
const DEMO_CLIENT: HubClient = {
  id: "demo-not-a-real-client",
  displayName: "Northlight Skin Studio",
  legalName: "Northlight Skin Studio LLC",
  domain: null,
  website: null,
  addressLine1: null,
  addressLine2: null,
  city: "Austin",
  state: "TX",
  postalCode: null,
  phone: null,
  email: null,
  hours: null,
  language: "en",
  reviewDestinationPrimary: "google",
  // A destination has to be configured or the notes screen says "paste it into Google" with no
  // button, and the button is half of what there is to look at.
  reviewWorkflow: { google_review_url: "https://example.com/demo-review-destination" },
  // No onAccent here: themeStyle() computes --hub-on-accent from the accent's luminance, which is
  // the whole reason a bright accent does not get unreadable white button text. Setting it by hand
  // would be this page disagreeing with every other one about the same colour.
  theme: { logoUrl: null, accent: "#00C9A7", accentSoft: "#e6f7f3", fontFamily: null },
  skin: null,
};

// ‼️ `panel` IS THE LIVE FLOW NOW, and `v1` is kept here because a demo that can only show the
// winner cannot show what changed. Full screen was walked on 2026-09-24 and rejected.
const ENGINES = [
  { key: "panel", label: "Virtual Agent", note: "Live. Six questions, three of them behind a yes or no." },
  { key: "v1", label: "what it replaced", note: "The four-question chat, kept as the rollback." },
] as const;

export default function AgentDemo({
  searchParams,
}: {
  searchParams: { engine?: string; look?: string };
}) {
  const engine = readEngine(searchParams.engine);
  const look = readLook(searchParams.look);

  return (
    <div
      className={hubRootClass(DEMO_CLIENT.skin)}
      lang="en"
      // Skin first, theme second. Same order as the live layout and the two previews; see
      // src/lib/hub/skin.ts. Copied rather than invented, so this page cannot be the one that
      // makes a theme look different from everywhere else.
      style={{ ...skinStyle(DEMO_CLIENT.skin), ...themeStyle(DEMO_CLIENT.theme) }}
    >
      <Ribbon engine={engine} />
      <div className="hub-wrap">
        <ReferralEngine client={DEMO_CLIENT} engine={engine} look={look} />
      </div>
    </div>
  );
}

/** Dark, amber, and unmistakably not part of the page. Same treatment as the other ribbons. */
function Ribbon({ engine }: { engine: string }) {
  const current = ENGINES.find((e) => e.key === engine);
  return (
    <div
      style={{
        background: "#1d1d1f",
        color: "rgba(255,255,255,0.75)",
        borderBottom: "1px solid rgba(255,255,255,0.12)",
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
        Design demo of the review tool. Nothing here is live, nothing is indexed and nothing you
        type is stored.
      </span>
      <span style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
        <span style={{ opacity: 0.6 }}>review flow:</span>
        {ENGINES.map((choice) => (
          <a
            key={choice.key}
            href={`/demo/agent?engine=${choice.key}`}
            style={{
              color: engine === choice.key ? "#F5A623" : "rgba(255,255,255,0.75)",
              fontWeight: engine === choice.key ? 700 : 400,
              textDecoration: engine === choice.key ? "none" : "underline",
            }}
          >
            {choice.label}
          </a>
        ))}
      </span>
      {current ? <span style={{ opacity: 0.55 }}>{current.note}</span> : null}
    </div>
  );
}
