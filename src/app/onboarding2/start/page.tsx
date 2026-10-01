// /onboarding2/start. The conversation-first funnel, and the one every audit surface now opens.
//
// ‼️ NESTED UNDER onboarding2 SO IT INHERITS THAT LAYOUT, exactly as /onboarding2/free is. The
// Meta pixel and the noindex both come from src/app/onboarding2/layout.tsx, and the "no CSS file on
// this subtree" decision recorded there applies to this route as well rather than merely near it.
// A sibling top-level route would have had to restate the pixel. The apex rewrite already covers
// it: srt-agwb/vercel.json maps /onboarding2/:path* as well as /onboarding2, so
// srtagency.com/onboarding2/start resolves with no change over there.
//
// ‼️ NO ?offer= SHORTCUT, AND THAT IS THE ONE PARAM THIS ROUTE DELIBERATELY DOES NOT READ.
// On /onboarding2 it means "they already chose on the marketing page, do not ask twice", and the
// client opens a session on mount. Honouring it here would skip the conversation, which IS the
// route: there would be no name, no phone, no email and therefore no hot lead, and the funnel would
// silently degrade into the old one while still reporting itself as the new one. Somebody who has
// genuinely already chosen should be sent to /onboarding2?offer=..., which still works and always has.

import type { Metadata } from "next";
import { ConvoFirstFunnel } from "./convo-first-client";

// Every report param decides what the funnel carries into the signing row, so this page must be
// rendered per request rather than served from whichever build ran first.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Onboarding | SRT Agency",
  robots: { index: false, follow: false },
};

function one(v: string | string[] | undefined): string {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? "") : "";
}

function num(v: string | string[] | undefined): number | null {
  const n = Number(one(v));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

export default async function Onboarding2StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <ConvoFirstFunnel
        report={{
          score: num(sp.score),
          city: one(sp.city) || null,
          business: one(sp.business) || null,
          competitor: one(sp.competitor) || null,
          userShowed: num(sp.userShowed),
          compShowed: num(sp.compShowed),
          reportSlug: one(sp.r) || null,
        }}
        utm={{
          source: one(sp.utm_source),
          medium: one(sp.utm_medium),
          campaign: one(sp.utm_campaign),
          content: one(sp.utm_content),
        }}
      />
    </main>
  );
}
