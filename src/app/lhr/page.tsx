// /LHR: the med spa and laser hair removal opt-in page.
//
// Server component, so the headline ships in the HTML and only the interactive half is
// hydrated. The canonical points at srtagency.com because this app is served there
// through a rewrite and nothing else tells it that.
//
// Two house rules this page keeps:
//   - THE FUNNEL HAS NO EXIT. The logo is a div, not a link, and there is no nav. The
//     only anchors above the footer are none at all; the footer's legal links are the
//     exception and open in a new tab.
//   - Mobile order is title, then tagline, then the CTA, then anything long. The CTA is
//     inside <LhrClient/>, which is why the client island sits directly under the
//     subhead rather than at the bottom of the page.

import type { Metadata } from "next";
import { LhrClient } from "./lhr-client";
import { BRAND, FOOTER, HERO, LHR_BASE } from "@/config/lhr-funnel";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Restated rather than inherited. Page metadata beats layout metadata in Next, and the
// root layout sets its own robots for the whole app, so leaving this off would not
// silently inherit the layout's value.
export const metadata: Metadata = {
  title: "Free Training for Med Spa and Laser Hair Removal Owners | SRT Agency",
  description:
    "A free 5 minute training on the patient acquisition system we install for med spas and laser hair removal clinics.",
  alternates: { canonical: LHR_BASE },
  robots: { index: false, follow: false },
};

export default function LhrPage() {
  return (
    // The dark theme is applied HERE rather than in the layout, because /lhr/training
    // is white and would otherwise inherit this token block from a shared parent.
    <div className="scan-root lhr-root">
      <main className="lhr-main">
        {/*
          Logo on its own line, centred, with the eyebrow centred underneath it.
          Both are block-level for that reason: as inline elements they sat side by side
          on desktop and only stacked once the viewport got narrow enough to wrap them,
          so the mobile layout was accidentally the correct one.

          The logo is a div, never a link. This funnel has no way out.
        */}
        <div className="lhr-brand">
          <span className="lhr-brand-mark" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>{BRAND}</span>
        </div>

        <div className="lhr-eyebrow-row">
          <span className="lhr-eyebrow">{HERO.eyebrow}</span>
        </div>

        <h1 className="lhr-h1">
          {HERO.headlineLead} <em>{HERO.headlineAccent}</em> {HERO.headlineRest}
        </h1>

        <p className="lhr-sub">
          {HERO.subheadLead} <strong>{HERO.subheadEmphasis}</strong>
        </p>

        <LhrClient />

        <footer className="lhr-footer">
          <p>{FOOTER.entity}</p>
          <p>{FOOTER.compliance}</p>
          {/*
            Absolute URLs, and the only anchors on the page. The legal pages live in the
            srt-agwb repo on srtagency.com, so a relative href would resolve against
            whichever host is actually serving this and 404 on the mission-control one.
          */}
          <p>
            <a href={FOOTER.privacyUrl} target="_blank" rel="noopener noreferrer">
              {FOOTER.privacyLabel}
            </a>
            {" · "}
            <a href={FOOTER.termsUrl} target="_blank" rel="noopener noreferrer">
              {FOOTER.termsLabel}
            </a>
            {" · "}
            <a href={FOOTER.smsUrl} target="_blank" rel="noopener noreferrer">
              {FOOTER.smsLabel}
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}
