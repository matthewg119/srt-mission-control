// Post-subscribe confirmation, and where onboarding gets booked.
//
// Payment happens FIRST and the call is a kickoff, not a sales call: by the time this
// renders the client is already paying, so the calendar is a scheduling convenience
// rather than a gate on anything.
//
// The Calendly embed is server-rendered as a plain iframe rather than their widget
// script, because the widget would be a third-party script on a page that has already
// taken money and it buys nothing here.

import type { Metadata } from "next";
import { CALENDLY_URL, CONFIRMED, FUNNEL_BASE } from "@/config/medspa-funnel";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "You are in | SRT Agency",
  alternates: { canonical: `${FUNNEL_BASE}/get-named/confirmed` },
  robots: { index: false, follow: false },
};

export default function ConfirmedPage() {
  return (
    <main className="medspa-main">
      <div className="medspa-brand">
        <span className="medspa-brand-mark" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span>SRT Agency</span>
      </div>

      <h1 className="medspa-h1">{CONFIRMED.headline}</h1>
      <p className="medspa-sub">{CONFIRMED.body}</p>

      {/*
        Unset renders the fallback sentence, never a broken iframe. Same degradation
        rule the unset guide PDF follows: a missing CTA beats a dead one.
      */}
      {CALENDLY_URL ? (
        <div className="gn-calendly">
          <iframe
            src={CALENDLY_URL}
            title="Book your onboarding call"
            width="100%"
            height="700"
            frameBorder="0"
          />
        </div>
      ) : (
        <p className="medspa-notice">{CONFIRMED.noCalendar}</p>
      )}

      <footer className="medspa-footer">
        <p>SRT Agency LLC, Search Retrieval Tactics</p>
        <p>Upstream of PHI. Nothing here is medical advice.</p>
      </footer>
    </main>
  );
}
