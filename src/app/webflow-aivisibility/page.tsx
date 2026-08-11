// VSL-A: the page that sells the free training.
//
// Server component, so the copy ships in the HTML and only the interactive half is
// hydrated. The canonical points at srtagency.com because this app is served there
// through a rewrite and nothing else tells it that.
//
// Two house rules this page keeps:
//   - The funnel has NO EXIT. The logo is a div, not a link, and there is no nav.
//   - Only cleared statistics, each with its source printed. An AEO agency that
//     cites nothing is failing its own pitch.

import type { Metadata } from "next";
import { FunnelClient } from "./funnel-client";
import { LANDING, FUNNEL_BASE } from "@/config/medspa-funnel";
import { isCheckoutEnabled } from "@/lib/medspa/stripe";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export const metadata: Metadata = {
  title: "The 20 Questions Your Patients Ask ChatGPT Before They Book | SRT Agency",
  description:
    "A free training for med spa owners on how AI search decides which clinics it names, and what changes it.",
  alternates: { canonical: FUNNEL_BASE },
  robots: { index: false, follow: false },
};

export default function MedspaLandingPage() {
  return (
    <main className="medspa-main">
      {/* A div, never a link. This funnel has no way out. */}
      <div className="medspa-brand">
        <span className="medspa-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>SRT Agency</span>
      </div>

      <span className="medspa-eyebrow">{LANDING.eyebrow}</span>

      <h1 className="medspa-h1">{LANDING.headline}</h1>
      <p className="medspa-sub">{LANDING.subhead}</p>

      {/* Decided on the server. The browser never gets to flip it. */}
      <FunnelClient checkoutEnabled={isCheckoutEnabled()} />

      <div className="medspa-stats">
        {LANDING.stats.map((s) => (
          <div className="medspa-stat" key={s.value}>
            <div className="medspa-stat-value">{s.value}</div>
            <div className="medspa-stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      <footer className="medspa-footer">
        <p>SRT Agency LLC, Search Retrieval Tactics</p>
        <p>
          Upstream of PHI. Nothing here is medical advice.
        </p>
      </footer>
    </main>
  );
}
