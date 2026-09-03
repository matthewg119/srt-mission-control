// /chatgpt-ads. PUBLIC, no token.
//
// This is what sits at the bottom of an AI visibility report: the path from "here is your
// score" to "here is how you start". The report links here with the score, the city, the
// business name and the competitor already in the query string, so the first thing the
// visitor sees is a video about their own number.
//
// Public path is srtagency.com/chatgpt-ads, served by a rewrite in srt-agwb's vercel.json,
// the same arrangement /onboardingfree and /LHR already use. All lowercase, so the
// /webflow-Aivisibility casing trap does not apply.
//
// noindex. It is a personalized landing page reached from a link, and half of it is a state
// machine no crawler runs. The root layout already sets it; page metadata beats layout
// metadata, so it is restated here rather than assumed.
//
// ‼️ THE SERVER READS THE PARAMS, NOT THE CLIENT. useSearchParams would force a Suspense
// boundary and, more to the point, would render the generic headline first and swap it a beat
// later. The whole hero is one personalized sentence; watching it change after paint is worse
// than not personalizing at all.

import type { Metadata } from "next";
import { readReportParams } from "@/lib/chatgpt-ads/params";
import { bookingPageUrl, isCalendlyConfigured } from "@/lib/calendly";
import { ChatgptAdsFunnel } from "./chatgpt-ads-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Your AI visibility",
  robots: { index: false, follow: false },
};

export default async function ChatgptAdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const params = readReportParams({
    get: (k: string) => {
      const v = sp[k];
      return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
    },
  });

  const utm = {
    source: typeof sp.utm_source === "string" ? sp.utm_source : "",
    medium: typeof sp.utm_medium === "string" ? sp.utm_medium : "",
    campaign: typeof sp.utm_campaign === "string" ? sp.utm_campaign : "",
    content: typeof sp.utm_content === "string" ? sp.utm_content : "",
  };

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <ChatgptAdsFunnel
        params={params}
        utm={utm}
        // Server-side env, handed down once. MATTHEW_CALLER_ID_NUMBER is deliberately NOT a
        // NEXT_PUBLIC_ var: it is shown on one screen to one person who just asked to be
        // called, and there is no reason for it to sit in the JS bundle of every page load.
        callerId={process.env.MATTHEW_CALLER_ID_NUMBER || null}
        booking={{
          fifteenMin: {
            live: isCalendlyConfigured("15min"),
            url: bookingPageUrl("15min"),
          },
          install: {
            live: isCalendlyConfigured("install"),
            url: bookingPageUrl("install"),
          },
        }}
      />
    </main>
  );
}
