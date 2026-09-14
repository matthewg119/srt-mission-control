// What to call the concierge in front of a person, which depends on who it is talking to.
//
// ‼️ ONE ENGINE, TWO AUDIENCES, AND THE NAME WAS ONLY EVER WRITTEN FOR ONE OF THEM.
// "AI Skin Concierge" is the patient lane: a widget on a clinic's site that reads a photo. The
// owner lane is the same machine pointed at a business owner reading our own content, and it has
// no camera, takes no photo and analyses no skin. Calling it the AI Skin Concierge on a step card
// tells somebody to go and confirm a thing that does not exist for that client.
//
// ‼️ THE STATIC STEP LABELS DO NOT CALL THIS AND MUST NOT. A constant in config/delivery-steps.ts
// is evaluated once for every client at once, so it cannot know which lane it is describing. Those
// labels say "AI Concierge", which is true of both. This is for the places that hold a client and
// have therefore earned the right to be specific: the card body, and the instruction arms.
//
// ‼️ NOT A RENAME OF THE AGREEMENT. src/config/onboarding2-agreement.ts says "AI Skin Concierge"
// in seven clauses of a document clients have signed, and its own header records that they were
// made to agree deliberately. A term of art in an executed agreement is not a copy surface.
//
// Pure and dependency free, so both the server and any client component can read it.

import type { Audience } from "./magnets";
import type { ResolvedAudience } from "@/lib/clients/audiences";

/**
 * The product name for this audience, as it is said to a person.
 *
 * ‼️ TAKES EITHER A ROW OR A BARE STANCE, AND THE ROW ALWAYS WINS. Given a ResolvedAudience it
 * returns that audience's own lane_name, so a restaurant reads "AI Menu Concierge" rather than
 * a name picked by a ternary that only knows two answers.
 *
 * ‼️ THE STANCE FORM IS A LEGACY PATH AND IT IS KEPT ON PURPOSE. Five callers hold only an
 * Audience today (step-engine, concierge-setup, concierge-audience), and widening all of them
 * inside the concierge cut would have put five board surfaces in a deploy that is already
 * changing a live widget. They upgrade as they gain a row. Until then this answers with the two
 * names that were true when there were only two lanes.
 */
export function conciergeLaneName(audience: Audience | ResolvedAudience): string {
  if (typeof audience !== "string") {
    return audience.laneName ?? (audience.stance === "owner" ? "AI Visibility Concierge" : "AI Skin Concierge");
  }
  return audience === "owner" ? "AI Visibility Concierge" : "AI Skin Concierge";
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
