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
import { ReferralEngine } from "@/app/hub/[host]/reviews/referral-engine";
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
  // A number, so the invite step can show what a genuinely three-way text looks like: the
  // `sms:` href carries the clinic as a second recipient and the chip is allowed to say so.
  // 555-01xx is the reserved fictional range, so it cannot ring anybody.
  phone: "+15555550142",
  email: null,
  hours: null,
  language: "en",
  reviewDestinationPrimary: "google",
  // A destination has to be configured or the notes screen says "paste it into Google" with no
  // button, and the button is half of what there is to look at.
  //
  // ‼️ THE KEY IS `google_url` AND IT WAS `google_review_url` UNTIL 2026-10-05, WHICH MEANT THIS
  // PAGE HAD NEVER ONCE SHOWN THE BUTTON. REVIEW_PLATFORMS in review-destinations.ts owns the
  // field names and `google_url` is what destinationsFor() looks for, so the old key matched
  // nothing, the list came back empty and the demo rendered exactly the fallback hint the comment
  // above says it was configured to avoid. Nothing errored, which is why it survived.
  reviewWorkflow: { google_url: "https://example.com/demo-review-destination" },
  // No onAccent here: themeStyle() computes --hub-on-accent from the accent's luminance, which is
  // the whole reason a bright accent does not get unreadable white button text. Setting it by hand
  // would be this page disagreeing with every other one about the same colour.
  theme: { logoUrl: null, accent: "#00C9A7", accentSoft: "#e6f7f3", fontFamily: null },
  skin: null,
};

/**
 * The same tool as a med spa would be sent it: white ground, light pink accent.
 *
 * ‼️ TWO LITERALS AND NOT TWO RENDERERS. Everything below `theme` is the same object shape the
 * live route hands over, so this is the hub's own theming doing the work and not a stylesheet
 * written for a demo. That is the whole value of it: what Matthew sends a prospect is what a
 * client gets.
 *
 * ‼️ `--hub-on-accent` IS NOT SET AND MUST NOT BE. onAccent() derives it from the accent's WCAG
 * luminance, so this pink gets near-black button text automatically. Hand-setting white here
 * would be an unreadable button and this page disagreeing with every other one about one colour.
 *
 * `skin: null` is correct rather than lazy: the hub's default ground is already #ffffff, so
 * "white and light pink" is exactly an accent and an accent-soft, with no template involved.
 */
const MEDSPA_CLIENT: HubClient = {
  ...DEMO_CLIENT,
  id: "demo-medspa-123-not-a-real-client",
  displayName: "Med Spa 123",
  legalName: "Med Spa 123 LLC",
  city: "Miami",
  state: "FL",
  theme: { logoUrl: null, accent: "#d6809c", accentSoft: "#fdeef3", fontFamily: null },
};

/**
 * The referral deals, handed over as a literal.
 *
 * ‼️ A LITERAL IS WHAT KEEPS THIS PAGE'S PROMISE THAT NOTHING IT DOES REACHES A DATABASE.
 * <ReferralEngine> reads client_service_offers when `referral` is omitted; passing it means
 * nothing is queried, which matters here because `id` is not a uuid and the real read would be a
 * pointless round trip that logs an error.
 *
 * ‼️ THE FIGURES ARE EXAMPLES AND LIVE ONLY ON THIS PAGE. Every real clinic's deals are set on
 * the onboarding call, one per service. Nothing in src/lib/ or src/config/ carries a percentage
 * or a price for this feature, deliberately: a number in the bundle is a discount we invented
 * turning up in a message a patient sends to her friend. See the header of review-script.ts.
 *
 * ‼️ AND IT IS NOT PRE-FILLED PATIENT ANSWERS. PREVIEW_DEMO_RULE in referral-engine-preview.ts
 * forbids shipping sample answers, and these are not answers: they are clinic configuration,
 * the same kind of thing as the destination URL above.
 */
const DEMO_REFERRAL = {
  offers: [
    {
      serviceLabel: "Botox",
      offerText: "20% off their first visit",
      referrerOfferText: "20% off your next session",
    },
    {
      serviceLabel: "Lip filler",
      offerText: "20% off their first syringe",
      referrerOfferText: "20% off your next session",
    },
    {
      serviceLabel: "Hydrafacial",
      offerText: "their first facial free",
      referrerOfferText: "20% off your next session",
    },
  ],
  defaultOffer: "20% off their first visit",
  defaultReferrerOffer: "20% off your next session",
  clinicPhone: DEMO_CLIENT.phone,
  // No reviews host on a client that does not exist, so claimUrl falls back to this origin and
  // the link in the previewed message is openable from the demo.
  reviewsHost: null,
};

/**
 * The two shapes of the referral, so both can be walked and compared.
 *
 * ‼️ THE ONLY DIFFERENCE IS WHO PUTS THE LINK IN FRONT OF THE FRIEND. Everything before the
 * invite step is identical, which is the point: a clinic can be switched between them without
 * re-teaching the front desk anything, and the comparison is therefore about the one thing that
 * actually differs.
 */
const MODES = [
  {
    key: "text",
    label: "she texts them",
    note: "The invite opens a group text on her phone with the clinic on it. Her thumb sends it.",
  },
  {
    key: "internal",
    label: "the clinic follows up",
    note: "Nothing is sent. The referral is recorded and a human at the clinic works the lead.",
  },
] as const;

type DemoMode = (typeof MODES)[number]["key"];

function readMode(raw: string | string[] | undefined): DemoMode {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return MODES.some((m) => m.key === value) ? (value as DemoMode) : "text";
}

/** Which fake clinic the demo is wearing. Narrowed, never interpolated. */
const CLIENTS = [
  { key: "default", label: "Northlight (teal)", client: DEMO_CLIENT },
  { key: "medspa123", label: "Med Spa 123 (pink)", client: MEDSPA_CLIENT },
] as const;

type DemoClientKey = (typeof CLIENTS)[number]["key"];

function readClient(raw: string | string[] | undefined): DemoClientKey {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return CLIENTS.some((c) => c.key === value) ? (value as DemoClientKey) : "default";
}

// ‼️ THE "review flow" SWITCHER WENT WITH v1 ON 2026-10-05. It offered the Virtual Agent and
// "what it replaced", because the two were being compared. Matthew picked; there is one flow and
// nothing to switch between. See the banner in referral-engine.tsx.

export default function AgentDemo({
  searchParams,
}: {
  searchParams: { client?: string; mode?: string };
}) {
  const clientKey = readClient(searchParams.client);
  const client = (CLIENTS.find((c) => c.key === clientKey) ?? CLIENTS[0]).client;
  const mode = readMode(searchParams.mode);

  return (
    <div
      className={hubRootClass(client.skin)}
      lang="en"
      // Skin first, theme second. Same order as the live layout and the two previews; see
      // src/lib/hub/skin.ts. Copied rather than invented, so this page cannot be the one that
      // makes a theme look different from everywhere else.
      style={{ ...skinStyle(client.skin), ...themeStyle(client.theme) }}
    >
      <Ribbon clientKey={clientKey} mode={mode} />
      <div className="hub-wrap">
        {/* `referral` passed as a literal, so nothing is queried. See DEMO_REFERRAL. */}
        <ReferralEngine
          client={client}
          referral={{ ...DEMO_REFERRAL, clinicPhone: client.phone, mode }}
        />
      </div>
    </div>
  );
}

/** Dark, amber, and unmistakably not part of the page. Same treatment as the other ribbons. */
function Ribbon({ clientKey, mode }: { clientKey: string; mode: string }) {
  const currentMode = MODES.find((m) => m.key === mode);
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
        <span style={{ opacity: 0.6 }}>referral:</span>
        {MODES.map((choice) => (
          <a
            key={choice.key}
            href={`/demo/agent?client=${clientKey}&mode=${choice.key}`}
            style={{
              color: mode === choice.key ? "#F5A623" : "rgba(255,255,255,0.75)",
              fontWeight: mode === choice.key ? 700 : 400,
              textDecoration: mode === choice.key ? "none" : "underline",
            }}
          >
            {choice.label}
          </a>
        ))}
      </span>
      {currentMode ? <span style={{ opacity: 0.55 }}>{currentMode.note}</span> : null}
      <span style={{ display: "flex", gap: "10px", alignItems: "baseline" }}>
        <span style={{ opacity: 0.6 }}>skin:</span>
        {CLIENTS.map((choice) => (
          <a
            key={choice.key}
            href={`/demo/agent?client=${choice.key}&mode=${mode}`}
            style={{
              color: clientKey === choice.key ? "#F5A623" : "rgba(255,255,255,0.75)",
              fontWeight: clientKey === choice.key ? 700 : 400,
              textDecoration: clientKey === choice.key ? "none" : "underline",
            }}
          >
            {choice.label}
          </a>
        ))}
      </span>
    </div>
  );
}
