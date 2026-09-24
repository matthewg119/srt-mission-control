// The reviews host, server side. Resolves the destinations and hands them to the client
// component; no interactivity and no state here.

import type { HubClient } from "@/lib/hub/resolve";
import { HubLogo } from "@/components/hub/hub-bodies";
import { REVIEW_PLATFORMS } from "@/lib/hub/review-destinations";
import { ReferralEngineClient, type ChatLook, type ReviewDestination } from "./referral-engine-client";
import { VirtualAgentClient } from "./virtual-agent-client";

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
 * Which review flow to render, and the one every customer gets.
 *
 * ‼️ CUT OVER TO `panel` ON 2026-09-24 (Matthew, having walked all three). This is the live
 * default now: a customer on reviews.{domain} gets the Virtual Agent and the six questions.
 * The printed QR card follows on its own, because CARD_QUESTIONS in review-script.ts is derived
 * from the walk rather than kept by hand.
 *
 * ‼️ `full` IS GONE, AND IT WAS REJECTED FOR THE REASON IT WAS BUILT TO TEST. Full screen deleted
 * the masthead and the client's mark, and put the notes step, the reading rail, the attestation,
 * the destination links and the private note inside a fixed scrolling column. The panel closes
 * when the walk ends and hands her a normal page, which is where all of that belongs.
 *
 * ‼️ `v1` STAYS SELECTABLE IN THE PREVIEWS AND IS NOT THE DEFAULT ANY MORE. It is the flow that
 * was live until today, so it is the rollback: if the Virtual Agent turns out to cost completions,
 * changing one word below puts the old one back with no other edit. Delete it once the new one has
 * run long enough to trust, and delete the probe's second CLIENTS entry with it.
 *
 * ‼️ A SEPARATE AXIS FROM `look`, DELIBERATELY. `look` picks one of three CSS skins over the v1
 * chat's markup; this picks which chat exists at all. Folding them into one parameter would hand
 * the v2 client a value that names a ruleset written for a component it is not.
 *
 * ‼️ THE LIVE ROUTE STILL NEVER CALLS readEngine. hub/[host]/page.tsx renders <ReferralEngine
 * client={...} /> with no engine, so what reviews.{domain} serves is decided HERE and not by a
 * query string a visitor can type. Only the previews pass one.
 */
const ENGINES = ["v1", "panel"] as const;
export type ReviewEngine = (typeof ENGINES)[number];
const DEFAULT_ENGINE: ReviewEngine = "panel";

/** Anything unrecognised is the default. Same rule as readLook: the value reaches a class name. */
export function readEngine(raw: string | string[] | undefined): ReviewEngine {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (ENGINES as readonly string[]).includes(value ?? "") ? (value as ReviewEngine) : DEFAULT_ENGINE;
}

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

export function ReferralEngine({
  client,
  look,
  engine = DEFAULT_ENGINE,
}: {
  client: HubClient;
  look?: ChatLook;
  engine?: ReviewEngine;
}) {
  const destinations = destinationsFor(client);
  // The three props below mean the same thing to both clients and are commented once, here,
  // rather than twice in two argument lists that would then drift.
  //
  // needsSpanish: the spec requires Spanish for the questions and requires it to be checked by a
  // native speaker, because a machine translation of a deliberately sentiment-neutral question can
  // land as a leading one, which is the one thing this tool cannot afford. So Spanish is NOT
  // generated here. English renders until reviewed copy exists.
  //
  // language: the RAW value as well, and not a duplicate of the flag. needsSpanish is true for
  // "both", so using it to pick the DICTATION language would set es-ES recognition for a bilingual
  // client and garble every English speaker who taps the microphone. Rendering a Spanish note and
  // listening in Spanish are different decisions.
  const needsSpanish = client.language === "es" || client.language === "both";
  const language = client.language ?? null;

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
      {engine === "v1" ? (
        <ReferralEngineClient
          businessName={client.displayName}
          clientId={client.id}
          destinations={destinations}
          needsSpanish={needsSpanish}
          language={language}
          look={look ?? DEFAULT_LOOK}
        />
      ) : (
        <VirtualAgentClient
          businessName={client.displayName}
          clientId={client.id}
          destinations={destinations}
          needsSpanish={needsSpanish}
          language={language}
        />
      )}
    </>
  );
}
