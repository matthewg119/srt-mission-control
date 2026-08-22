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
import { BRAND, FOOTER, LHR_BASE, TRAINING, TRAINING_VSL, youtubeId } from "@/config/lhr-funnel";
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
  const ytId = youtubeId(TRAINING_VSL.url);

  return (
    <div className="lhrw-root">
      {/* Wordmark only, no logo mark, and a div rather than a link. */}
      <div className="lhrw-brand">{BRAND}</div>

      <div className="lhrw-band">
        <h1>{TRAINING.banner}</h1>
      </div>

      <main className="lhrw-main">
        {/*
          Not <GatedVSL/>. See training.css for why: the calendar is visible the whole
          time, so there is no offer behind a watch-time threshold. A null URL renders a
          placeholder rather than an empty black box, so the page can be shipped and
          tested before the video is recorded.

          Three branches, because a <video> element cannot play a YouTube page and
          pointing its src at one produces a black box with a broken-media control.
          youtubeId() decides which: an embed for a YouTube link, the original element
          for a self-hosted file, the placeholder for nothing at all.

          The recording is a portrait phone video padded into a 1920x1080 canvas, so it
          arrives already letterboxed and the 16/9 box in training.css is the right frame
          for it. That is why nothing here or in the CSS reaches for an aspect ratio.

          youtube-nocookie.com, not youtube.com: no tracking cookie is set until someone
          actually presses play, which is the right default on a page that just collected
          a phone number. rel=0 keeps the end screen on this channel, and playsinline
          stops iOS from throwing the video into fullscreen and losing the calendar
          underneath it.

          modestbranding is deliberately absent. YouTube retired it, so passing it looks
          like the title overlay is being suppressed when it is not. The video's YouTube
          title is what shows across the top of this frame, and the only place to change
          that is YouTube Studio.
        */}
        {ytId ? (
          <iframe
            className="lhrw-video"
            src={`https://www.youtube-nocookie.com/embed/${ytId}?rel=0&playsinline=1`}
            title={TRAINING.videoTitle}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : TRAINING_VSL.url ? (
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
