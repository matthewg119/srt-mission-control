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

// ‼️ THE DEFAULT IS THE CONVERSATION NOW (Matthew, 2026-09-30). A bare /onboarding2 renders
// ConvoFirstFunnel, the same thing /onboarding2/start serves. The old two-card picker is still
// here and is still reachable, but only down the ?offer= branch below, which the marketing site
// owns. See the note over `preset` for exactly which values take which door and why.

import type { Metadata } from "next";
import { isOfferKey, type OfferKey } from "@/config/pitch";
import { Onboarding2Funnel } from "./onboarding2-client";
import { ConvoFirstFunnel } from "./start/convo-first-client";

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

  const report = {
    score: num(sp.score),
    city: one(sp.city) || null,
    business: one(sp.business) || null,
    competitor: one(sp.competitor) || null,
    userShowed: num(sp.userShowed),
    compShowed: num(sp.compShowed),
    reportSlug: one(sp.r) || null,
  };
  const utm = {
    source: one(sp.utm_source),
    medium: one(sp.utm_medium),
    campaign: one(sp.utm_campaign),
    content: one(sp.utm_content),
  };

  /*
    ‼️ ONLY A **PAID** ?offer= STILL SKIPS THE CONVERSATION, AND EXCLUDING review_free IS THE
    WHOLE POINT OF THIS LINE. It is the same exclusion /onboarding2/free/page.tsx makes, for the
    same reason, and it is worth restating rather than cross-referencing because getting it wrong
    here is silent.

    srtagency.com's free-tool button links /onboarding2?offer=review_free. Honour that now and the
    old client opens a session on mount, the conversation never runs, and we take a signing row
    with no name, no phone and no email on it. No error, no log line, and the #hot-leads lane would
    simply go quiet for the funnel's single largest source of traffic while every dashboard still
    showed sign-ups arriving. Free is what the conversation LEADS TO here, so there is nothing to
    skip: somebody who tapped "start free" on the marketing page gets asked who they are and is
    then shown the free card they already chose, pre-selected by nothing and costing them four
    questions they were always going to be asked.

    year_3300 and month_349 DO still skip. /pricing links those, and somebody who has deliberately
    picked a paid plan has already made the decision this conversation exists to lead up to.
    Sending them back through four questions to reach a picker they have answered would be asking
    the same question twice, which is the fault this whole branch is written to avoid.
  */
  const offer = one(sp.offer);
  const preset = isOfferKey(offer) && offer !== "review_free" ? (offer as OfferKey) : null;

  if (!preset) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] text-white">
        <ConvoFirstFunnel report={report} utm={utm} />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#0a0a0a] text-white">
      {/*
        The old two-card funnel, now reachable only with a PAID ?offer=. `preset` is non-null by
        the guard above, so this opens a session on mount and the picker never renders: exactly
        what a /pricing link has always done.
      */}
      <Onboarding2Funnel report={report} presetOffer={preset} utm={utm} />
    </main>
  );
}
