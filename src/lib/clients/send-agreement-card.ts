// The body of the `agreement_signed` step card.
//
// ‼️ IT LIVES IN ITS OWN MODULE BECAUSE step-engine.ts IS SHARED AND instructionsFor() IS THE
// FILE EVERY LANE EDITS. docs/lanes/CONTRACT.md's rule for that switch is "touch only the case
// arms your brief names, put real logic in a new module, this file gets a call rather than an
// implementation." So the arm is two lines and everything it needs is here.

import { DELIVERY_STEPS } from "@/config/delivery-steps";
import { offerFor } from "@/config/pitch";
import { loadClientForAgreement, offerOfClient } from "./send-agreement";

/**
 * What the step card says, given what we know about this client's offer.
 *
 * ‼️ EVERY BRANCH ENDS BY SAYING WHAT CAN BE DONE NEXT. That is the repo's acceptance criterion
 * for a card that completes, and it is the thing most likely to be skipped: a card that tells you
 * you are blocked and does not say by what is a card that gets ignored.
 */
export async function offerForClientCard(clientId: string): Promise<string[]> {
  const client = await loadClientForAgreement(clientId).catch(() => null);
  const offer = client ? offerOfClient(client) : null;

  const tail = [
    "",
    ":ballot_box_with_check: *Signed on paper instead?* Put it in this thread and press Done: the",
    "countersigned PDF, a photo of the signed page, or a note saying where it is filed. That is a",
    "thread tick and it says so, because nobody can read a signature off a photograph.",
  ];

  if (!client) {
    return [
      ":rotating_light: *This client could not be read, so no agreement can be prepared.*",
      "Nothing is wrong with the signing path; the client row itself did not load.",
      ...tail,
    ];
  }

  if (!offer) {
    return [
      ":warning: *No offer is recorded for this client, so there is no agreement to send.*",
      "There are three now and they are three different documents: the yearly plan carries a",
      "guarantee and a refund, the monthly plan carries neither, and the free plan has no contract",
      "at all. Sending one without knowing which would put terms in front of somebody who was",
      "quoted different ones.",
      "",
      "*Next:* set the offer on the client board, then press [Re-check] on this card.",
      ...tail,
    ];
  }

  const o = offerFor(offer);

  if (!o.needsAgreement) {
    return [
      `*This client is on ${o.name}, which has no contract.*`,
      "Nothing is signed and nothing is owed. The free review workflow is a real deliverable they",
      "keep either way, and putting a document in front of them now would contradict what they",
      "were told when they picked it.",
      "",
      "*Next:* press Done with a note saying they are on the free plan, or set a paid offer on the",
      "client board if they have since moved onto one.",
    ];
  }

  const price = o.price ? `, ${o.price}` : "";
  return [
    `*Offer taken: ${o.name}${price}.*`,
    o.guarantee
      ? `The guarantee is in this document: ${o.guarantee}.`
      : "This document carries no guarantee and no refund, and says so in its own words.",
    "",
    "*Two ways to send it, and both are on this card:*",
    "  • *Draft the email* puts it in your own Outlook Drafts, addressed, with the unsigned PDF",
    "    attached and the signing link in the body. Nothing sends until you press send.",
    "  • *Send signing link* gives you the URL to paste into the chat or read out while you are",
    "    still on the call. They initial each page and sign, and their copy is emailed the moment",
    "    they do.",
    "",
    ":white_check_mark: *If they sign through the link, this step ticks itself, as a system tick.*",
    "The app will have seen the signature: a token redeemed, every page initialled against a hash",
    "the browser recomputed over the text it rendered, and the document hash echoed back and",
    "compared. That is a stronger claim than anything a person can put in a thread.",
    ...tail,
    "",
    `*Next after this:* ${nextSteps()}`,
  ];
}

/**
 * The steps that become reachable once this one is done.
 *
 * Read off DELIVERY_STEPS rather than typed, because a step list that says what comes next and is
 * maintained by hand is a step list that will eventually lie. `blockedBy` is the real edge.
 */
function nextSteps(): string {
  const unlocked = DELIVERY_STEPS.filter((s) => s.blockedBy?.includes("agreement_signed")).map(
    (s) => s.label
  );
  return unlocked.length ? unlocked.join(", ") : "the after-the-call phase";
}
