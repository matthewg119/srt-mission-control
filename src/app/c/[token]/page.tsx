// /c/<token> — what a patient reaches when she scans a lead's card.
//
// ‼️ THIS IS THE TRIAL PAGE, NOT THE CLIENT PAGE, AND THE DIFFERENCE IS WHERE HER ANSWERS GO.
// A provisioned client's card points at `reviews.{theirdomain}`; that host resolves to a real
// `clients` row, and /api/hub/reviews/submit writes her answers to `review_tool_submissions`
// against it. A LEAD has no clients row, and `review_tool_submissions.client_id` is a not-null
// foreign key, so there is nowhere for this page's submissions to go and no honest way to invent
// one. Provisioning a client from a QR scan would take a pilot seat and open a delivery board for
// somebody who has not been sold anything.
//
// So what this page is, exactly: the real walk, wearing the clinic's name, that a clinic can hand
// out on day one and that works on her phone. She answers, she gets her own words back, she can
// copy them and post them wherever she likes, and she can refer a friend. What is NOT kept is the
// submission row. On this host middleware strips `x-hub-host`, so the submit route resolves no
// client and refuses, which is the same guarantee /demo/agent and the dashboard preview print on
// their own ribbons. Nothing here claims otherwise to her, because nothing here mentions storage
// at all: the one thing she is promised is that nothing is posted unless she posts it, and that
// is more true here than anywhere.
//
// ‼️ IT IS NOT A FOURTH RENDERER OF THE HUB. Same rule /demo/agent follows: this is another
// CALLER of <ReferralEngine>, copied from that file skin-first theme-second, so a change to the
// walk reaches this page and every other one together.
//
// ‼️ NOINDEX. A clinic's trial page is not a search result, and the token in the path is not a
// secret worth protecting but is not worth publishing either.

import type { Metadata } from "next";

import type { HubClient } from "@/lib/hub/resolve";
import { themeStyle } from "@/lib/hub/theme";
import { skinStyle, hubRootClass } from "@/lib/hub/skin";
import { ReferralEngine } from "@/app/hub/[host]/reviews/referral-engine";
import { leadFromCardToken } from "@/lib/cards/preview-link";
import { PREVIEW_FALLBACK_NAME } from "@/config/card-preview";
import "@/app/hub/[host]/hub.css";
import "@/app/hub/[host]/universes.css";

export const metadata: Metadata = {
  title: "Tell us how it went",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * The clinic, as far as this page is concerned.
 *
 * ‼️ EVERY FIELD IS FROM THE LEAD OR IS NULL, AND THE NULLS ARE THE POINT. No review
 * destination, because we have not pulled their Maps listing yet and a URL we guessed from a
 * business name is a link that can send a real patient to somebody else's profile (the rule
 * onboarding2's q7 and /cards both carry). No phone, so the invite cannot claim to be three way.
 * The walk degrades to exactly the parts we can honestly offer.
 *
 * ‼️ THE ACCENT IS THE CARD'S PINK, so the page and the thing she just scanned are one object.
 * When the clinic is provisioned this comes off clients.theme like everybody else's.
 */
function clientFromLead(name: string, city: string | null): HubClient {
  return {
    id: "lead-trial-not-a-real-client",
    displayName: name,
    legalName: name,
    domain: null,
    website: null,
    addressLine1: null,
    addressLine2: null,
    city,
    state: null,
    postalCode: null,
    phone: null,
    email: null,
    hours: null,
    language: "en",
    reviewDestinationPrimary: "google",
    reviewWorkflow: {},
    // No onAccent: themeStyle derives it from the accent's luminance, which is what keeps button
    // text readable. Setting it here would be this page disagreeing with every other one.
    theme: { logoUrl: null, accent: "#c26b89", accentSoft: "#fdeef3", fontFamily: null },
    skin: null,
  };
}

export default async function LeadCardWalk({ params }: { params: { token: string } }) {
  const lead = await leadFromCardToken(params.token);
  const client = clientFromLead(
    lead?.businessName?.trim() || PREVIEW_FALLBACK_NAME,
    lead?.city ?? null
  );

  return (
    <div
      className={hubRootClass(client.skin)}
      lang="en"
      // Skin first, theme second. The live layout's order, copied rather than invented.
      style={{ ...skinStyle(client.skin), ...themeStyle(client.theme) }}
    >
      <div className="hub-wrap">
        {/*
          ‼️ `referral` IS PASSED AS A LITERAL WITH NO OFFERS, which is what keeps this page off
          the database AND stops it promising a deal. <ReferralEngine> reads client_service_offers
          when this is omitted, and this id is not a uuid. With no offer on file the walk skips the
          recommend question and the invite entirely rather than offering something the clinic
          never agreed to, which is the driver's existing behaviour and exactly right here: the
          deal is set on the setup call.
        */}
        <ReferralEngine
          client={client}
          referral={{
            offers: [],
            defaultOffer: null,
            defaultReferrerOffer: null,
            defaultPairOffer: null,
            clinicPhone: null,
            reviewsHost: null,
            mode: "internal",
          }}
        />
      </div>
    </div>
  );
}
