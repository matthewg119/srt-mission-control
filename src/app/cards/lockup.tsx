// SRT's mark and what this is, at the top of every state of the card funnel.
//
// ‼️ IT IS THE SECTION'S IDENTITY AND THE SECTION DOES NOT CHANGE. The content under it swaps;
// this does not move, which is the whole difference between one page that progresses and two
// pages that replace each other. Matthew rejected the alternative by name on 2026-10-07 ("i dont
// like the double stacking"), on both front doors of this product in the same message.
//
// ‼️ EXTRACTED FROM cards-client.tsx ON 2026-10-09 BECAUSE /cards/p NEEDED THE SAME TWO LINES.
// It was a private function in that client component, and the page that shows a clinic the card
// is the same product arriving a week earlier in the conversation. Two copies of an identity is
// how one of them quietly becomes a different brand.
//
// A plain server component: no state, no handlers, nothing to hydrate. Importing it into a client
// component is fine (it renders there), and importing it into a server page costs no bundle.

import { CARDS_HERO } from "@/config/onboarding-cards";

export function Lockup() {
  return (
    <div className="cd-id">
      <span className="cd-mark" aria-hidden="true">
        S
      </span>
      <span className="cd-who">
        <span className="cd-name">{CARDS_HERO.brand}</span>
        <span className="cd-what">{CARDS_HERO.product}</span>
      </span>
    </div>
  );
}
