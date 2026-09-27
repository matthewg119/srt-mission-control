// What to call the concierge in front of a person, which depends on who it is talking to.
//
// ‼️ IT IS ONE NAME AGAIN AS OF 2026-09-26, ON MATTHEW'S INSTRUCTION, AND THAT IS A REVERSAL.
// This file existed because one engine served two audiences under two names: "AI Skin Concierge" for
// the patient lane, which reads a photo, and "AI Visibility Concierge" for the owner lane, which has
// no camera and analyses no skin. Both are now the AI Booking Bot, from the one constant in
// config/pitch.ts, because what a buyer is buying in either lane is bookings.
//
// ‼️ THIS OVERRIDES A PER-CLIENT DATABASE COLUMN, AND THAT WAS FLAGGED AND CHOSEN. Rows in
// client_audiences.lane_name let a client carry their own name for it (a restaurant read "AI Menu
// Concierge"), and this function no longer reads them. Reversing it is one line: return
// `audience.laneName ?? PRODUCT_CONCIERGE` instead. Left as a function rather than collapsed into the
// constant precisely so that reversal stays a one-line change in one file.
//
// ‼️ THE STATIC STEP LABELS DO NOT CALL THIS AND MUST NOT. A constant in config/delivery-steps.ts
// is evaluated once for every client at once, so it cannot know which lane it is describing. Those
// labels say "AI Concierge", which is true of both. This is for the places that hold a client and
// have therefore earned the right to be specific: the card body, and the instruction arms.
//
// ‼️ THE AGREEMENT WAS RENAMED TOO, AND THIS NOTE USED TO FORBID THAT. It said a term of art in
// an executed agreement is not a copy surface, which is a good rule and is why the question was put to
// Matthew rather than decided here. He chose the full rename on 2026-09-26. It is safe because the
// agreement stores its full text per signing, so every document already executed still renders the words
// it was signed under, and the template version moved to v8 so the two are distinguishable.
//
// Pure and dependency free, so both the server and any client component can read it.

import { PRODUCT_CONCIERGE } from "@/config/pitch";
import type { Audience } from "./magnets";
import type { ResolvedAudience } from "@/lib/clients/audiences";

/**
 * The product name, as it is said to a person.
 *
 * ‼️ IT TAKES AN AUDIENCE AND IGNORES IT, AND THAT IS THE 2026-09-26 DECISION RATHER THAN A BUG.
 * The argument is kept so every call site stays valid and so reversing this is one line here instead of
 * an edit in each of them. When it reads the row again, the line is:
 *
 *     return typeof audience === "string" ? PRODUCT_CONCIERGE : audience.laneName ?? PRODUCT_CONCIERGE;
 */
export function conciergeLaneName(audience: Audience | ResolvedAudience): string {
  void audience;
  return PRODUCT_CONCIERGE;
}

/** One line on what this lane actually does, for a card that has just named it. */
export function conciergeLaneBlurb(audience: Audience | ResolvedAudience): string {
  if (typeof audience !== "string") {
    return audience.stance === "owner"
      ? "It answers a business owner from the market dataset and books a call with us."
      : `It answers a ${audience.vocabulary.buyerSingular} and books them a ${audience.vocabulary.visit}.`;
  }
  return audience === "owner"
    ? "It answers a business owner from the market dataset and books a call with us."
    : "It reads one photo, returns a skin assessment, and books the visitor an appointment.";
}
