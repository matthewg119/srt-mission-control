// The one thing that lets a SWITCHED-OFF widget answer, and only on a preview we minted.
//
// ‼️ THE BUG THIS FIXES. `concierge_preview` (before the call) creates the config row and posts a
// demo link so the Concierge can be walked on the call; `concierge_live` (after the call) flips
// `enabled`. That is what config.ts and concierge-setup.ts both say. But /w/{slug} and all four
// of /api/concierge/{config,start,turn,booked} refuse a tenant whose `enabled` is false, so the
// demo link `concierge_preview` posts has always 404'd. The step's own card says "Walk it on the
// call. The scan is the demo, not the slide", and there was nothing to walk.
//
// ‼️ THIS IS A MECHANISM, NOT A LOOSENING, AND THE DISTINCTION IS THE WHOLE FILE.
//
// `enabled` keeps its exact meaning: it is the only thing that puts this widget on a real
// website, it still defaults false, and nothing in the preview lane may flip it. What a grant
// says is narrower: "the person holding this link is somebody WE gave it to, about THIS client,
// within the last fourteen days". A page on the open internet cannot hold one, because the token
// is HMAC-signed with CLIENT_LINK_SECRET and scoped to `preview`.
//
// ‼️ IT MUST BE CHECKED AGAINST THE CONFIG'S OWN clientId, NEVER JUST VERIFIED. A valid preview
// token for clinic A must not open clinic B's widget. Verifying the signature and forgetting the
// identity comparison is the one way to get this wrong, so the comparison lives inside this
// function and no caller does it themselves.
//
// ‼️ NO SECOND TOKEN SCHEME. token.ts already carries the reasoning: an onboarding link cannot
// open a preview and a preview link cannot open the onboarding funnel, because verification takes
// the scope it EXPECTS. This reuses that, with the same 14-day TTL as every other preview link,
// so there is one revocation story (rotate CLIENT_LINK_SECRET) rather than two.

import { verifyOnboardingToken } from "@/lib/clients/token";

/** The query parameter the token travels in, used by embed.js, the frame and the API routes. */
export const PREVIEW_TOKEN_PARAM = "pt";

/**
 * May this caller talk to a tenant whose widget is switched off?
 *
 * `false` for a missing token, a forged one, an expired one, an onboarding-scoped one, and a
 * valid preview token belonging to a different client. Every one of those is the same answer for
 * the reason middleware.ts gives for never distinguishing 401 from 404: a different answer per
 * reason is a way to learn what exists.
 */
export function previewGrant(token: string | null | undefined, clientId: string): boolean {
  if (!token || !clientId) return false;

  const verified = verifyOnboardingToken(token, "preview");
  if (!verified.ok) return false;

  return verified.clientId === clientId;
}

/**
 * The standard gate for the five places that used to read `if (!config.enabled)`.
 *
 * Exists so the check is written once. Five copies of a two-clause condition is five chances for
 * one of them to be relaxed to `if (token)` by somebody debugging a 404 at speed.
 */
export function conciergeAllowed(
  config: { enabled: boolean; clientId: string },
  token: string | null | undefined
): boolean {
  return config.enabled || previewGrant(token, config.clientId);
}
