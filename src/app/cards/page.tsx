// /cards — the chatbox a clinic lands on once the QR cards are in the post.
//
// ‼️ IT SELLS NOTHING, WHICH IS THE WHOLE REASON IT IS NOT /onboarding2. That funnel shows the
// three-offer picker and talks about value; this one is reached from an email that already said
// yes to a free batch of cards. See src/config/onboarding-cards.ts for the full argument.
//
// ‼️ NOINDEX. It is the back half of an outbound sequence, not a landing page, and a clinic
// finding it in a search result would arrive with no idea what the cards are.

import type { Metadata } from "next";

import { CardsClient } from "./cards-client";
import "./cards.css";

export const metadata: Metadata = {
  title: "Set up your review cards",
  description: "A few questions so your AI Referral Engine cards are ready to hand out.",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default function CardsPage() {
  return (
    <main className="cd-page">
      <header className="cd-masthead">
        <p className="cd-eyebrow">AI Referral Engine</p>
        <h1>Your review cards</h1>
        <p className="cd-lede">
          A couple of minutes. Then we print your batch and you can start handing them out at the
          front desk.
        </p>
      </header>

      <CardsClient />
    </main>
  );
}
