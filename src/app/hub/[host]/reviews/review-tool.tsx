// The reviews host, server side. Resolves the destinations and hands them to the client
// component; no interactivity and no state here.

import type { HubClient } from "@/lib/hub/resolve";
import { HubLogo } from "@/components/hub/hub-bodies";
import { ReviewClient, type ChatLook, type ReviewDestination } from "./review-client";

/**
 * The three chat looks, and the one everybody gets.
 *
 * PREVIEW ONLY. Matthew asked for three variations of the chat to choose between. They are
 * three CSS skins over identical markup in hub.css, and the choice is passed down from the
 * internal design preview, which requires a session. A client host has no way to set it and
 * always renders DEFAULT_LOOK, which is why that one has to look finished on its own.
 *
 * When he picks, the winner becomes DEFAULT_LOOK and the other two rulesets can go. There is
 * deliberately no column for this: it is one taste decision made once, not a per-client
 * dataset, and a column would outlive the decision it exists for.
 */
const LOOKS = ["a", "b", "c"] as const;
const DEFAULT_LOOK: ChatLook = "a";

/** Anything unrecognised is the default. The value reaches a class name, so it is validated
 *  here rather than interpolated, the same rule readSkin() follows for `hub-tpl-${x}`. */
export function readLook(raw: string | string[] | undefined): ChatLook {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (LOOKS as readonly string[]).includes(value ?? "") ? (value as ChatLook) : DEFAULT_LOOK;
}

/**
 * The six platforms a client may send reviews to, in the order they are offered when several
 * are configured. The key doubles as the `review_workflow` URL field name and as the value
 * stored in `posted_destination`.
 *
 * ‼️ ADDING A PLATFORM HERE IS NOT ENOUGH ON ITS OWN. The Review handover panel
 * (dashboard/clients/[id]/review-workflow-form.tsx) is the only writer of these URLs, and the
 * onboarding2 question offers the same six names. All three lists have to agree or a client
 * picks a platform nobody can paste a URL for.
 */
const PLATFORMS = [
  { key: "google", field: "google_url", label: "Post on Google" },
  { key: "yelp", field: "yelp_url", label: "Post on Yelp" },
  { key: "trustpilot", field: "trustpilot_url", label: "Post on Trustpilot" },
  { key: "bbb", field: "bbb_url", label: "Post on BBB" },
  { key: "facebook", field: "facebook_url", label: "Post on Facebook" },
  { key: "realself", field: "realself_url", label: "Post on RealSelf" },
] as const;

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

  const configured = PLATFORMS.filter((p) => {
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

export function ReviewTool({ client, look }: { client: HubClient; look?: ChatLook }) {
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
      <ReviewClient
        businessName={client.displayName}
        clientId={client.id}
        destinations={destinationsFor(client)}
        // The spec requires Spanish for the four questions and requires it to be checked by a
        // native speaker, because a machine translation of a deliberately sentiment-neutral
        // question can land as a leading one — the one thing this tool cannot afford. So
        // Spanish is NOT generated here. English renders until reviewed copy exists, the same
        // refusal isUnwritten() already makes for an unwritten WhatsApp draft.
        needsSpanish={client.language === "es" || client.language === "both"}
        // ‼️ THE RAW VALUE AS WELL, and it is not a duplicate of the flag above. needsSpanish is
        // true for "both", so using it to pick the DICTATION language would set es-ES recognition
        // for a bilingual client and garble every English speaker who taps the microphone.
        // Rendering a Spanish note and listening in Spanish are different decisions.
        language={client.language ?? null}
        look={look ?? DEFAULT_LOOK}
      />
    </>
  );
}
