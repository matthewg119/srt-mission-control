// /lhr/training: what a qualified opt-in sees. White, video, then a calendar.
//
// Server component, so the banner and the copy ship in the HTML and only the calendar
// and the scroll button hydrate.
//
// ‼️ THIS PAGE IS PUBLIC AND UNGATED, and that is a decision rather than an oversight.
//
// The medspa funnel's /training is behind an HMAC seat (MEDSPA_LINK_SECRET, signAccess)
// because a paid tripwire sits on the other side of it and the page is somebody's
// private purchase. Nothing here is bought: the lead has already been captured by the
// time anyone arrives, the video is a sales asset we want watched, and the calendar is a
// public booking link either way.
//
// A token would add exactly one thing, a failure mode. An expired or mangled ?k= turns
// a visitor who just handed over their phone number into a 404, and that is a lead paid
// for and then lost at the last step. If the video ever becomes genuinely gated, the
// pieces already exist: sign the system_logs row id in api/lhr/optin and verify it here
// with the same verifyAccess() the medspa funnel uses.
//
// It stays noindex, so it is unlisted rather than secret.

import type { Metadata } from "next";
import { BookButton, Calendly } from "./training-client";
import { BRAND, FOOTER, LHR_BASE, TRAINING, TRAINING_VSL } from "@/config/lhr-funnel";
import "./training.css";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Restated rather than inherited. Page metadata beats layout metadata in Next, and the
// root layout sets its own robots for the whole app.
export const metadata: Metadata = {
  title: "Your Training | SRT Agency",
  description: "The patient acquisition system we install for med spas and laser hair removal clinics.",
  alternates: { canonical: `${LHR_BASE}/training` },
  robots: { index: false, follow: false },
};

export default function LhrTrainingPage() {
  return (
    <div className="lhrw-root">
      {/* Wordmark only, no logo mark, and a div rather than a link. */}
      <div className="lhrw-brand">{BRAND}</div>

      <div className="lhrw-band">
        <h1>{TRAINING.banner}</h1>
      </div>

      <main className="lhrw-main">
        {/*
          An ordinary <video>, not <GatedVSL/>. See training.css for why: the calendar is
          visible the whole time, so there is no offer behind a watch-time threshold.
          A null URL renders a placeholder rather than an empty black box, so the page
          can be shipped and tested before the video is recorded.
        */}
        {TRAINING_VSL.url ? (
          <video
            className="lhrw-video"
            src={TRAINING_VSL.url}
            poster={TRAINING_VSL.poster ?? undefined}
            controls
            playsInline
            preload="metadata"
          />
        ) : (
          <div className="lhrw-video-placeholder">
            <div className="lhrw-video-placeholder-title">{TRAINING.videoPlaceholderTitle}</div>
            <p className="lhrw-video-placeholder-body">{TRAINING.videoPlaceholderBody}</p>
          </div>
        )}

        <BookButton />

        <section className="lhrw-calendar" id="lhrw-calendar">
          <h2>{TRAINING.calendarHeading}</h2>
          <Calendly />
        </section>

        <footer className="lhrw-footer">
          <p>{FOOTER.entity}</p>
          <p>{FOOTER.compliance}</p>
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
