/**
 * SRT Call Coach — what the model is allowed to know about price on THIS call.
 *
 * ## The offer is one price with a free period in front of it (rebuilt 2026-08-25)
 *
 * It was a fast-action discount that had to be EARNED, then two real tiers, then four. It is now
 * ONE figure, PRICE_RETAINER, and nothing is charged until the inquiries land. Each of those
 * rebuilds deleted a mechanism from this file, and the same three rules survived every one:
 *
 *   1. **Withholding still beats forbidding.** On a follow-up call nothing is being sold, so the
 *      figure is not in the request AT ALL rather than accompanied by "don't quote this". A number
 *      sitting in a helpful model's context is one it will eventually reach for. That is not a
 *      theory: the old prompt-level rule leaked 349 on the FIRST price objection in 2 of 3 live
 *      runs, once as an entire "here's what I can do" card with an invented saving attached.
 *
 *   2. **No arithmetic, ever.** One figure in context is a better starting point than two, but it
 *      is not a fix: "half of that", "so about 250", "eight bucks a day" are all one step away.
 *      PRICE_RETAINER is the only price figure that exists and nothing may be derived from it.
 *
 *   3. **A request for less is answered with the FREE PERIOD, never a smaller number.** This is
 *      the rule that changed shape. It used to be "step down a tier": a smaller scope for a
 *      smaller number. There is no tier to step down to any more, and a slot in the request with
 *      nothing in it is exactly where a model invents a package. So the replacement answer is
 *      stated explicitly and it is a stronger one — a discount says the first number was soft, a
 *      free period says the number is real and we will earn it first.
 *
 * Pure, so it is testable without a call.
 */

import {
  FREE_FIRST_BUILD,
  FREE_UNTIL_LINE,
  OFFER_EXIT_LINE,
  OFFER_INCLUDES,
  PRICE_RETAINER,
  QUALIFIED_INQUIRY_DEF,
} from "@/config/pitch";

export type CoachCallType = "cold" | "followup" | "close";

/**
 * The pricing paragraph for this request.
 *
 * ‼️ On `followup` the string "349" and the string "499" do not appear in the returned text, and
 * that is the entire point of the branch. A follow-up call exists to earn "yes, send the video";
 * a price quoted to someone who has not seen the work turns a free video into a sales call, and
 * that is the one thing the stage cannot undo.
 */
export function priceBlock(callType: CoachCallType): string {
  if (callType === "followup") {
    return `PRICE:
- NOT DISCUSSED ON THIS CALL. Nothing is being sold. No price has been quoted to them and none exists in your context.
- If they ask how much: the video is free and theirs to keep, the first build on their site is free too, and price is a conversation for after they have seen the work. Then get back to the ask.
- Do not name, hint at, estimate or bracket a figure. Not "a few hundred", not "less than you'd think", not "depends on the package". Any of those is a price.`;
  }

  // ‼️ THE WORK, WITHOUT THE VALUES. OFFER_INCLUDES carries a "$2,400 value" on every line, and
  // handing those to a live coach is handing it four more numbers to do arithmetic with, on a call,
  // out loud. The value stack is a SCRIPTED beat in the Loom and nowhere else. What the coach gets
  // is the scope and the one price.
  const included = OFFER_INCLUDES.map((o) => `  ${o.work}`).join("\n");

  const shared = `- THE FREE FIRST BUILD IS THE ASK ON THIS CALL. ${FREE_FIRST_BUILD} The retainer is the conversation AFTER they have seen it, and saying that out loud is what keeps the free part credible. Never attach an expiry or a slot count to THIS. The founding-cohort seat count is a different thing and it is in the brief if it applies.
- ${OFFER_EXIT_LINE} This is a FACT about the arrangement, not a guarantee. Never turn it into "no risk", "money back", or a promise about results.
- ‼️ ${PRICE_RETAINER} IS THE ONLY PRICE FIGURE THAT EXISTS. Never do arithmetic on it. No "half", no percentages, no per-day or per-week breakdown, no annual total. There is no second figure to compare it to and you may not create one.
- ‼️ THE GUARANTEE IS IN THE CALL BRIEF AND NOWHERE ELSE. It is a VISIBILITY commitment, not a refund and not a trial. If the brief quotes it, say it in those exact words. If the brief does not quote one, or there is no brief, then there is no guarantee on this call and you may not imply one to close somebody.
- ‼️ Never invent a figure, not even hypothetically, not even to make a point. "If it were $99 a month, would you be a yes" is inventing a price: it cannot be walked back, and the owner now has a number in their head that will never be honored. Isolate on the OBSTACLE instead: "if cost weren't the issue, would you be a yes, and is there anything else".
- ‼️ IF THEY ASK FOR A LOWER NUMBER, THE ANSWER IS THE FREE PERIOD. "${FREE_UNTIL_LINE}" They are not being asked to spend anything today, which is a better answer than any discount would be. There is no smaller package, no cheaper tier and no discount. Do not invent one, do not hint one might exist, and do not ask what number would work.${QUALIFIED_INQUIRY_DEF ? ` A qualified AI-sourced inquiry means: ${QUALIFIED_INQUIRY_DEF}` : ' If they press on what "qualified" means, say you will define it together on the onboarding call rather than making up a threshold.'}
- CHATGPT ADS are a real add-on and they are QUOTED CASE BY CASE. If they ask, that is a budget conversation, not a number you say on this call. Never name a figure for the ads.`;

  if (callType === "cold") {
    return `PRICE — one retainer, month to month, and a free period in front of it:
  ${PRICE_RETAINER}, and they pay nothing until we have delivered the first inquiries.

What that covers every month:
${included}

- ‼️ The PAIN GATE outranks this. On a cold call you do not quote a price, offer the report, or describe the work until the owner has said out loud that something is wrong. Until then this figure is for answering a direct "how much", nothing else.
- If they ask how much before any pain has been named, answer in one sentence and go straight back to what they are missing. Price without a problem attached is just a number to say no to.
${shared}`;
  }

  return `PRICE — one retainer, month to month. The pitch already happened, so this is on the table:
  ${PRICE_RETAINER}, and they pay nothing until we have delivered the first inquiries.

What that covers every month:
${included}

- Lead with the free period, then the number. In that order: what they risk today is the thing that decides this call, and it is nothing.
${shared}`;
}
