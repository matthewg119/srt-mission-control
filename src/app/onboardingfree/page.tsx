// The free-build constraint quiz. PUBLIC, no token.
//
// This is the link that goes out when a prospect replies "Yes" to the free-build email.
// Unlike /onboarding there is no `clients` row to sign a token against and no row to
// resume from, so identity is typed on the last screen and matched back to `contacts`
// read only. The guards live on the submit route: honeypot, time trap, per-IP ledger.
//
// Public path is /onboardingfree on srtagency.com, served by a rewrite in srt-agwb's
// vercel.json. All lowercase, so the /webflow-Aivisibility casing trap does not apply.
//
// noindex, because this is a link handed to one person in a reply, not a page anyone
// should find. The root layout already sets it; page metadata beats layout metadata, so
// it is restated here rather than assumed.

import type { Metadata } from "next";
import { OnboardingFreeFunnel } from "./onboarding-free-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "A few questions",
  robots: { index: false, follow: false },
};

export default function OnboardingFreePage() {
  return (
    <main className="min-h-screen bg-[#0B1426] px-4 py-10 text-white">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 text-center text-lg font-bold tracking-wide">SRT Agency</div>
        <OnboardingFreeFunnel />
      </div>
    </main>
  );
}
