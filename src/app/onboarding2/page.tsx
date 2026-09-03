// /onboarding2. PUBLIC, no token, identity typed on screen one. Modelled on /onboardingfree.
//
// ‼️ NO SNAPSHOT IS TAKEN HERE. This is a server component and it renders once per request, but
// the agreement is frozen by POST /api/onboarding2/start, which the client calls on mount. That
// keeps one place responsible for reading the live template, and it means a page served from a
// cache can never hand somebody a stale agreement without a session behind it.
//
// Every param is optional and the page renders without all of them: the funnel is reachable from
// a cold ad with no audit report behind it, and a missing param must never block a signature.
//
// NO CALENDLY. The booking prop and the src/lib/calendly import were removed on 2026-09-03. The
// onboarding call day is agreed inside the chat and there is no calendar anywhere in this flow.
// src/lib/calendly.ts belongs to another lane and is untouched; this page simply stopped calling it.

import type { Metadata } from "next";
import { Onboarding2Funnel } from "./onboarding2-client";

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

export default async function Onboarding2Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      <Onboarding2Funnel
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
