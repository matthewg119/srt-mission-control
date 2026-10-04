"use client";

// The floating nudge on an AI Visibility Report. A bot, bottom right, three seconds in.
//
// ‼️ IT IS A SECOND DOOR TO THE SAME PLACE, NOT A SECOND OFFER. The href is built by the SAME
// buildOnboarding2Url() call PricingCta makes, from the same params, so tapping the bubble and
// tapping Get Started are indistinguishable downstream: same funnel, same variant, same report
// slug, same campaign. That is the whole point of the ask ("as if they clicked the Get Started
// button") and it is also what keeps this honest under PricingCta.tsx's standing ban on the report
// stating any term of its own. This component names a DELIVERABLE and a price of zero, both of
// which the destination card already says, and it states no term, no window and no guarantee.
//
// ‼️ WHY A SECOND DOOR AT ALL. Get Started sits at the very bottom of a long report. A reader who
// scores 13/100 and stops reading at the competitor table never reaches it. This one is reachable
// from anywhere on the page and is the only thing on the report that moves.
//
// ‼️ THREE SECONDS, AND THE COUNT STARTS ON MOUNT. Matthew's number. Long enough that it arrives
// after the reader has taken in the score rather than on top of it, short enough that it is still
// the same glance. It is not tied to scroll depth on purpose: a pending or failed report is a
// third of the height of a finished one, and a scroll trigger would simply never fire on those.
//
// ‼️ IT CAN BE CLOSED, AND CLOSING IT IS REMEMBERED FOR THE TAB. sessionStorage rather than
// localStorage, matching the rule onboarding2-client.tsx sets out for its own session token: a
// dismissal that outlived the tab would silently hide this from somebody opening a colleague's
// report on a shared front-desk machine weeks later, and nobody would ever find out.

import { useEffect, useState } from "react";
import { buildOnboarding2Url, scaleToSample, type ReportUtm } from "@/lib/onboarding2-link";

/** Matthew's line, verbatim. Two clauses: what they get, and what it is called. */
const NUDGE_LINE = "Expand your reputation. Get your free AI Referral Engine.";
const NUDGE_CTA = "Set it up free";
const REEF = "#00C9A7";
const MIDNIGHT = "#04252b";

/** How long after the report paints before the bot arrives. */
const APPEAR_AFTER_MS = 3000;
const DISMISS_KEY = "srt:report-nudge-dismissed";

export function ReferralEngineNudge({
  score,
  city,
  business,
  competitor,
  mentioned,
  totalPrompts,
  reportSlug,
  utm,
}: {
  score?: number | null;
  city?: string | null;
  business?: string | null;
  competitor?: string | null;
  mentioned?: number;
  totalPrompts?: number;
  reportSlug?: string | null;
  utm?: ReportUtm;
} = {}) {
  /**
   * Three states, and `armed` is the one that matters.
   *
   * ‼️ THE ELEMENT IS MOUNTED BEFORE IT IS VISIBLE, WHICH IS WHY THIS IS A CLASS TOGGLE AND NOT A
   * CONDITIONAL RENDER. A node inserted into the document and transitioned in the same frame does
   * not animate: the browser has no previous value to interpolate from, so it snaps. Mounting it
   * translated and opaque-zero, then flipping a class a tick later, is what gives it something to
   * move from.
   */
  const [armed, setArmed] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY) === "1") {
        setGone(true);
        return;
      }
    } catch {
      // Private mode, or storage blocked. Showing it is the right failure.
    }
    const id = window.setTimeout(() => setArmed(true), APPEAR_AFTER_MS);
    return () => window.clearTimeout(id);
  }, []);

  if (gone) return null;

  const userShowed =
    typeof mentioned === "number" && typeof totalPrompts === "number"
      ? scaleToSample(mentioned, totalPrompts)
      : null;

  const href = buildOnboarding2Url(
    {
      score: score ?? null,
      city: city ?? null,
      business: business ?? null,
      competitor: competitor ?? null,
      userShowed,
      // Not carried, for the reason PricingCta gives: the competitor's count is not on this scale.
      compShowed: null,
      reportSlug: reportSlug ?? null,
    },
    undefined,
    utm
  );

  function dismiss() {
    setGone(true);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Nothing to do. It will show again on the next report, which is not a fault.
    }
  }

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-end px-4 pb-4 sm:px-6 sm:pb-6"
      /*
        ‼️ FULL-WIDTH AND RIGHT-ALIGNED RATHER THAN `right-4`. At 375px the card is wider than the
        gap a right-anchored box leaves, so anchoring only the right edge pushed its left edge off
        screen and the first line of the sentence with it. A flex row that spans the viewport lets
        the card take the width it has and stay inside both margins.
      */
    >
      <div
        className={[
          "pointer-events-auto flex w-full max-w-[19rem] items-start gap-3 rounded-2xl p-3 pr-2.5 shadow-2xl",
          "transition-[transform,opacity] duration-500 ease-out motion-reduce:transition-none",
          armed ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
        ].join(" ")}
        style={{ backgroundColor: "#111111", outline: "1px solid rgba(255,255,255,0.12)" }}
        role="complementary"
        aria-label="AI Referral Engine"
        aria-hidden={!armed}
      >
        {/* The bot. Same reef disc as the assistant's avatar in the funnel it opens. */}
        <span
          aria-hidden="true"
          className="mt-0.5 grid h-9 w-9 flex-none place-items-center rounded-full"
          style={{ backgroundColor: REEF, color: MIDNIGHT }}
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="8" width="16" height="11" rx="3.5" />
            <path d="M12 8V4.5" />
            <circle cx="12" cy="3" r="1.4" fill="currentColor" stroke="none" />
            <path d="M9 13.2v1.4M15 13.2v1.4" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-snug text-white">{NUDGE_LINE}</p>
          <a
            href={href}
            className="mt-2.5 block rounded-lg px-3 py-2 text-center text-[13px] font-bold transition hover:opacity-90"
            style={{ backgroundColor: REEF, color: MIDNIGHT }}
          >
            {NUDGE_CTA}
          </a>
        </div>

        {/* ‼️ A REAL CLOSE, NOT A DECORATION. A floating card over a document somebody is reading
            has to be closeable, and a close that does nothing is worse than none. */}
        <button
          type="button"
          onClick={dismiss}
          aria-label="Close"
          className="-mt-0.5 flex-none rounded p-1 text-lg leading-none text-white/35 transition hover:text-white"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
