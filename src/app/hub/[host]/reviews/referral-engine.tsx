// The reviews host, server side. Resolves the destinations and hands them to the client
// component; no interactivity and no state here.
//
// ═══════════════════════════════════════════════════════════════════════════════════════════════
// ‼️ THERE IS ONE DESIGN NOW. v1 AND THE THREE "LOOKS" WERE DELETED ON 2026-10-05.
//
// This file used to carry two axes of choice. `look` picked one of three CSS skins over the v1
// chat's markup, and `engine` picked between v1 (the four-question chat with a microphone) and
// `panel` (the Virtual Agent). Both existed to be compared and then collapsed, and both said so
// in this file: "When he picks, the winner becomes DEFAULT_LOOK and the other two rulesets can
// go", and "Delete it once the new one has run long enough to trust, and delete the probe's
// second CLIENTS entry with it."
//
// Matthew picked on 2026-10-05: the refined opening card, the Virtual Agent walk, every client,
// no alternates. "dont let any other option c page persist existing we need to get rid of
// absolutely all of those old pages."
//
// ‼️ WHAT THAT BOUGHT, BEYOND TIDINESS. A second rendering of a REGULATED surface is a second
// place for the anti-gating rules to be got wrong, and scripts/_probe-review-gating.ts had to
// read both files and assert the five star expressions matched byte for byte across them. One
// file means one place a rating can route, one place a Yes can leak into a review, and one place
// to read before changing any of it.
//
// ‼️ AND THE ROLLBACK IS GIT, NOT A SECOND CODE PATH. Keeping a dead flow alive as insurance is
// how a surface nobody tests stays reachable by a query string.
// ═══════════════════════════════════════════════════════════════════════════════════════════════

import type { HubClient } from "@/lib/hub/resolve";
import { HubLogo } from "@/components/hub/hub-bodies";
import { REVIEW_PLATFORMS } from "@/lib/hub/review-destinations";
import { referralConfigFor, referralEmailConfig } from "@/lib/hub/referral-config";
import {
  VirtualAgentClient,
  type ReferralConfig,
  type ReviewDestination,
} from "./virtual-agent-client";

/**
 * ‼️ THE SIX PLATFORMS MOVED TO src/lib/hub/review-destinations.ts ON 2026-09-08, AND THE
 * WARNING THAT USED TO SIT HERE IS WHY.
 *
 * It said adding a platform here was not enough on its own, because the Review handover panel
 * and the onboarding2 question spelled out the same six names separately and all three had to
 * agree. They did not. The funnel offered six and the panel had two boxes, so SRT's own record
 * naming Trustpilot as its destination had nowhere to put a Trustpilot link and this page
 * rendered no button at all.
 *
 * One table now, read by this file, the handover route and the handover form.
 */

/**
 * Where she can post, read from the client's own review_workflow bag (intake step 4 already
 * writes to it) rather than from new columns.
 *
 * ‼️ ABSENT BEATS WRONG, AND THAT IS WHY THIS READS URLs AND NOT PLATFORM NAMES.
 * `clients.review_destination_primary` says WHICH platform the client chose, and the
 * onboarding2 funnel now asks for it. It is a name, not an address. Turning "google" into a
 * link would mean constructing a search URL and calling it their profile, which sends a real
 * patient to somebody else's business. So the name only decides ORDER; a destination appears
 * if and only if a human pasted its actual URL into the Review handover panel.
 *
 * When nothing is configured we show the copy box and say where to paste.
 */
function destinationsFor(client: HubClient): ReviewDestination[] {
  const workflow = (client.reviewWorkflow ?? {}) as Record<string, unknown>;
  const primary = client.reviewDestinationPrimary ?? null;

  const configured = REVIEW_PLATFORMS.filter((p) => {
    const raw = workflow[p.field];
    return typeof raw === "string" && raw.trim().length > 0;
  });

  // The client's chosen platform first, then the rest in declaration order. A stable order
  // matters because the first link is the one most people tap.
  const ordered = [
    ...configured.filter((p) => p.key === primary),
    ...configured.filter((p) => p.key !== primary),
  ];

  return ordered.map((p) => ({
    key: p.key,
    label: p.label,
    url: (workflow[p.field] as string).trim(),
  }));
}

/**
 * ‼️ ASYNC SINCE v5 (2026-10-05), WHICH COSTS THE CALLERS NOTHING. The referral config is a read
 * of client_service_offers, and an async server component renders as ordinary JSX, so the live
 * route and the previews did not change. What they DID gain is the referral steps, which is the
 * point: the dashboard preview is where Matthew walks it before a client ever does.
 *
 * ‼️ AND `referral` IS AN OVERRIDE, NOT A CACHE. Pass it and nothing is queried. That is how
 * /demo/agent keeps the promise in its own header that nothing it does reaches a database, while
 * still showing the invite step: it hands over a literal. Omit it and the client's real deals are
 * read. Passing `null` explicitly means "no referral on this render", which is the honest state
 * for a client with no deals on file.
 */
export async function ReferralEngine({
  client,
  referral,
}: {
  client: HubClient;
  referral?: ReferralConfig | null;
}) {
  const destinations = destinationsFor(client);
  const referralConfig = referral === undefined ? await referralConfigFor(client) : referral;
  const emailConfig = referralEmailConfig(client);

  // needsSpanish: the spec requires Spanish for the questions and requires it to be checked by a
  // native speaker, because a machine translation of a deliberately sentiment-neutral question can
  // land as a leading one, which is the one thing this tool cannot afford. So Spanish is NOT
  // generated here. English renders until reviewed copy exists.
  //
  // ‼️ THE DICTATION LANGUAGE WENT WITH v1. That distinction existed because the old chat had a
  // microphone, and `language: "both"` would have set es-ES recognition for a bilingual clinic and
  // garbled every English speaker who tapped it. There is no recogniser in this lane any more, so
  // there is nothing left to get wrong and only the note remains.
  const needsSpanish = client.language === "es" || client.language === "both";

  return (
    <>
      {/*
        The client's mark, when a confirmed theme carries one.

        ‼️ THIS WAS MISSING AND THE ABSENCE WAS INVISIBLE FROM HERE. HubLogo is drawn by every
        body in hub-bodies.tsx and this component is not one of them, so learn.{domain} showed a
        clinic's logo and reviews.{domain}, off the SAME client record and the same theme, did
        not. Nothing errored; the two hosts simply stopped looking like one business, which is
        what a customer notices and nobody testing a single page ever does.
      */}
      <HubLogo client={client} />
      {/*
        ‼️ ONE FRAME AROUND THE WHOLE FLOW. See .rev-frame in hub.css: the opening card, the chat
        panel and her finished review were three different widths on a desktop, which is three
        products in one session. The panel centres itself to this same width.
      */}
      <div className="rev-frame">
        <VirtualAgentClient
          businessName={client.displayName}
          // "Miami, FL" where both are on file, one of them where only one is, and omitted
          // entirely otherwise. Never a half-rendered ", FL".
          location={[client.city, client.state].filter(Boolean).join(", ") || null}
          clientId={client.id}
          destinations={destinations}
          needsSpanish={needsSpanish}
          referral={referralConfig}
          // Her own email box, only where the clinic actually sends her the message.
          askReferrerEmail={emailConfig.enabled && emailConfig.emailReferrer}
        />
      </div>
    </>
  );
}
