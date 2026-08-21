"use client";

// The two interactive pieces of the training page: the scroll-to-calendar button and
// the Calendly embed.
//
// A client component only because both need the browser. Everything else on this page
// is a server component so the copy ships in the HTML.

import { useEffect, useRef } from "react";
import Script from "next/script";
import { CALENDLY_URL, TRAINING } from "@/config/lhr-funnel";
import { track } from "@/lib/medspa/pixel";

export function BookButton() {
  return (
    <button
      type="button"
      className="lhrw-cta"
      onClick={() => {
        // Scroll rather than navigate. The calendar is already on the page, and a link
        // to an anchor would push a history entry that sends the back button to the top
        // of this same page instead of out of the funnel.
        document
          .getElementById("lhrw-calendar")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }}
    >
      {TRAINING.cta}
    </button>
  );
}

export function Calendly() {
  const mounted = useRef(false);

  // Fires once, when someone reaches the booking step. Gated by track(), so it only
  // reports for visitors who arrived on a real ad click.
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;
    track("Schedule");
  }, []);

  // Tri-state, the same treatment PAYMENT_LINK and site_signals get. An unset URL is a
  // real state, not a config error to paper over: rendering the widget div with no
  // data-url produces an empty bordered box that looks like a calendar failing to load,
  // which is worse than a sentence saying we will reach out.
  if (!CALENDLY_URL) {
    return <p className="lhrw-nocal">{TRAINING.noCalendar}</p>;
  }

  return (
    <>
      <div className="lhrw-calendly calendly-inline-widget" data-url={CALENDLY_URL} />
      {/*
        afterInteractive, not beforeInteractive: the widget is below the fold behind a
        video, so it must never compete with the page paint. next/script also dedupes by
        id, which matters because this component can remount.
      */}
      <Script
        id="calendly-widget"
        src="https://assets.calendly.com/assets/external/widget.js"
        strategy="afterInteractive"
      />
    </>
  );
}
