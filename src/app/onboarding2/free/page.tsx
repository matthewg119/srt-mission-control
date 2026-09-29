// /onboarding2/free. The free-first variant of the offer screen, in six presentations.
//
// ‼️ NESTED UNDER onboarding2 SO IT INHERITS THAT LAYOUT. The Meta pixel and the noindex both come
// from src/app/onboarding2/layout.tsx, and the "no CSS file on this subtree" decision recorded
// there applies to this route as well rather than merely near it. A sibling top-level route would
// have had to restate the pixel, which is exactly the duplication that layout exists to prevent.
// The apex rewrite already covers it: srt-agwb/vercel.json maps /onboarding2/:path* as well as
// /onboarding2, so srtagency.com/onboarding2/free resolves with no change over there.
//
// ‼️ force-dynamic IS LOAD-BEARING HERE IN A WAY IT IS NOT ON THE SIBLING PAGE. ?v is a search
// param that decides the entire layout. A statically rendered page would serve whichever variant
// happened to build first to every visitor, silently, and the test would report six identical
// numbers. The sibling page sets it too, for the agreement-freshness reason its header gives.

import type { Metadata } from "next";
import { isOfferKey, type OfferKey } from "@/config/pitch";
import { Onboarding2Funnel } from "../onboarding2-client";
import { DEFAULT_VARIANT, isVariantKey, type VariantKey } from "./variants";

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

export default async function Onboarding2FreePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const offer = one(sp.offer);

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Onboarding2Funnel
        picker="free-first"
        /*
          Unknown, missing or hand-edited values get the control rather than an error. This is the
          one place the guard differs from isOfferKey's caller: an unknown OFFER becomes null
          because there is a picker to fall back to, and there is no "no variant" state here.
        */
        variant={isVariantKey(one(sp.v)) ? (one(sp.v) as VariantKey) : DEFAULT_VARIANT}
        report={{
          score: num(sp.score),
          city: one(sp.city) || null,
          business: one(sp.business) || null,
          competitor: one(sp.competitor) || null,
          userShowed: num(sp.userShowed),
          compShowed: num(sp.compShowed),
          reportSlug: one(sp.r) || null,
        }}
        /*
          ‼️ review_free IS EXCLUDED FROM presetOffer ON THIS ROUTE, AND THAT EXCLUSION IS THE WHOLE
          POINT OF THE ROUTE.

          On /onboarding2, ?offer=review_free means "they already chose on the marketing page, do
          not ask twice", and the mount effect calls start() immediately without ever rendering the
          picker. srtagency.com's homepage already links exactly that, so it is the URL shape
          somebody is most likely to copy when building a link to this page.

          Honour it here and the session opens on mount, the ladder never renders, and the variant
          test reports zero upsell exposures against what looks like normal traffic. No error, no
          log line. Here the free offer is not a question being asked, it is the screen itself, and
          the thing behind its button is the upsell.

          year_3300 and month_349 ARE still honoured. Somebody who deliberately picked a paid plan
          on /pricing has nothing left to be upsold, and skipping straight through is what that
          link has always done.
        */
        presetOffer={
          isOfferKey(offer) && offer !== "review_free" ? (offer as OfferKey) : null
        }
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
