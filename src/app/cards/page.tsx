// /cards — the chatbox a clinic lands on once the QR cards are in the post.
//
// ‼️ IT SELLS NOTHING, WHICH IS THE WHOLE REASON IT IS NOT /onboarding2. That funnel shows the
// three-offer picker and talks about value; this one is reached from an email that already said
// yes to a free batch of cards. See src/config/onboarding-cards.ts for the full argument.
//
// ‼️ NOINDEX. It is the back half of an outbound sequence, not a landing page, and a clinic
// finding it in a search result would arrive with no idea what the cards are.

import type { Metadata } from "next";
import { DM_Sans, DM_Serif_Display } from "next/font/google";

import { CardsClient } from "./cards-client";
import "./cards.css";

/**
 * The two faces the reference screens are set in, self-hosted at build like every other webfont
 * in this app, so nothing about a visitor leaves for Google at view time.
 *
 * ‼️ THEY LAND ON THE PAGE, NOT ON THE APP. cards.css reads them as --cd-text and --cd-display
 * with real system stacks behind them, so if these classes are ever dropped the funnel degrades to
 * a sans and a serif rather than to whatever the root layout happens to set.
 */
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--cd-text",
  display: "swap",
});
const dmSerif = DM_Serif_Display({
  subsets: ["latin"],
  weight: ["400"],
  variable: "--cd-display",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Set up your review cards",
  description: "A few questions so your AI Referral Engine cards are ready to hand out.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function CardsPage() {
  return (
    <main className={`cd-page ${dmSans.variable} ${dmSerif.variable}`}>
      {/*
        ‼️ THE MASTHEAD MOVED INSIDE THE CARD ON 2026-10-06 AND IS NOT DUPLICATED HERE.
        Matthew: "make it all inside." It used to be a page header that stayed on screen while the
        chat ran underneath it, so a visitor three questions in was still being sold the headline.
        CARDS_HERO carries it now and it leaves with the card.
      */}
      <CardsClient />
    </main>
  );
}
