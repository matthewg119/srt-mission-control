// What to call the concierge in front of a person.
//
// ‼️ IT READS THE CLIENT'S ROW AGAIN AS OF 2026-09-30, AND THAT IS A SECOND REVERSAL.
//
// The history matters, because this file has now changed direction twice on instruction and the
// next person deserves to know neither change was drive-by:
//
//   originally  two names for two lanes: "AI Skin Concierge" for the patient lane and
//               "AI Visibility Concierge" for the owner lane.
//   2026-09-26  Matthew collapsed both to one product name, PRODUCT_CONCIERGE, because what a
//               buyer buys in either lane is bookings. This function kept its argument and
//               ignored it, and its own note recorded the exact one-line reversal.
//   2026-09-30  Matthew asked for per-client naming, because the lane now onboards clients in
//               any trade and a dentist's visitors should not meet a bot named for skin.
//
// ‼️ THE 2026-09-26 DECISION IS NOT SIMPLY UNDONE, AND THE RETIRED NAMES ARE WHY.
// A blind `return audience.laneName` would resurrect "AI Skin Concierge" on every client whose
// row was seeded BEFORE the rename, since those rows still carry it. That is the exact string
// the rename existed to remove, and it would come back silently, on live client domains, as a
// side effect of a change about dentists. So the two retired product names are treated as "no
// opinion" and fall through to PRODUCT_CONCIERGE. A client row wins only when it carries a name
// nobody retired, which is precisely the case this change is for.
//
// The default is unchanged: a string audience, an absent row, an empty name or a retired name
// all still read PRODUCT_CONCIERGE.
//
// ‼️ THE STATIC STEP LABELS DO NOT CALL THIS AND MUST NOT. A constant in config/delivery-steps.ts
// is evaluated once for every client at once, so it cannot know which lane it is describing. Those
// labels say "AI Concierge", which is true of both. This is for the places that hold a client and
// have therefore earned the right to be specific: the card body, and the instruction arms.
//
// ‼️ THE AGREEMENT IS NOT A COPY SURFACE AND STILL IS NOT. It stores its full text per signing, so
// every document already executed renders the words it was signed under whatever this returns.
//
// Pure and dependency free, so both the server and any client component can read it.

import { PRODUCT_CONCIERGE } from "@/config/pitch";
import type { Audience } from "./magnets";
import type { ResolvedAudience } from "@/lib/clients/audiences";

/**
 * Names this function will not hand back, because they are OUR retired product names rather than
 * anybody's choice.
 *
 * Compared case-insensitively and trimmed: these arrived from a code preset, not from a person
 * typing, so the spelling is known, but a row edited by hand should not slip through on a capital.
 */
const RETIRED_LANE_NAMES: ReadonlySet<string> = new Set([
  "ai skin concierge",
  "ai visibility concierge",
]);

/**
 * The product name, as it is said to a person.
 *
 * A string audience is the structural stance ('patient' / 'owner') with no row behind it, so
 * there is nothing client-specific to read and it always answers PRODUCT_CONCIERGE.
 */
export function conciergeLaneName(audience: Audience | ResolvedAudience): string {
  if (typeof audience === "string") return PRODUCT_CONCIERGE;

  const named = (audience.laneName ?? "").trim();
  if (!named) return PRODUCT_CONCIERGE;
  if (RETIRED_LANE_NAMES.has(named.toLowerCase())) return PRODUCT_CONCIERGE;

  return named;
}

/** One line on what this lane actually does, for a card that has just named it. */
export function conciergeLaneBlurb(audience: Audience | ResolvedAudience): string {
  if (typeof audience !== "string") {
    return audience.stance === "owner"
      ? "It answers a business owner from the market dataset and books a call with us."
      : `It answers a ${audience.vocabulary.buyerSingular} and books them a ${audience.vocabulary.visit}.`;
  }
  // ‼️ NO SKIN, NO PHOTO. This branch is the one with NO row behind it, so it cannot name a
  // buyer or a visit and has to stay generic. It used to say "reads one photo, returns a skin
  // assessment", which described a med spa specifically and, as of the no-website lane, is wrong
  // for most clients and describes a flow that was never wired in any case: there is no upload
  // route and selectProvider() has no callers.
  return audience === "owner"
    ? "It answers a business owner from the market dataset and books a call with us."
    : "It answers a visitor on the client's own site and books them in.";
}
