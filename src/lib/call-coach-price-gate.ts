/**
 * SRT Call Coach — what the model is allowed to know about price on THIS call.
 *
 * ## The offer is two tiers, not one price with a lever (rebuilt 2026-08-11)
 *
 * It used to model $499 as the price and $349 as a fast-action discount that had to be EARNED,
 * withheld from the request until the owner had raised cost twice and been answered twice. That
 * was wrong about the offer: Core at $349 and Complete at $499 are two real packages, both always
 * on the table, differing in scope. A tier you can name on the first ask does not need hiding.
 *
 * The unlock machinery is gone with it. What survives is the part that was actually load-bearing:
 *
 *   1. **Withholding still beats forbidding.** On a follow-up call nothing is being sold, so the
 *      figures are not in the request AT ALL rather than accompanied by "don't quote these". A
 *      number sitting in a helpful model's context is one it will eventually reach for. That is
 *      not a theory: the old prompt-level rule leaked 349 on the FIRST price objection in 2 of 3
 *      live runs, once as an entire "here's what I can do" card with an invented saving attached.
 *
 *   2. **No arithmetic, ever.** Two figures in context is exactly the setup where a model produces
 *      a third: "half", "about 400", "twelve a day". $349 and $499 are the only price figures that
 *      exist and neither may be derived from the other.
 *
 *   3. **A request for less is answered with less SCOPE.** Complete down to Core is the move. It
 *      is a real answer that keeps the number honest; discounting says the first number was soft.
 *
 * Pure, so it is testable without a call.
 */

import { OFFER_TIERS, OFFER_EXIT_LINE, FREE_FIRST_BUILD } from "@/config/pitch";

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

  const tiers = OFFER_TIERS.map((t) => `  ${t.name}, ${t.price}: ${t.includes.join("; ")}`).join("\n");

  const shared = `- THE FREE FIRST BUILD IS THE ASK ON THIS CALL, not a tier. ${FREE_FIRST_BUILD} The tiers above are the conversation AFTER they have seen it, and saying that out loud is what keeps the free part credible. Never attach an expiry or a slot count to it.
- ${OFFER_EXIT_LINE} This is a FACT about the arrangement, not a guarantee. Never turn it into "no risk", "money back", or a promise about results.
- Never do arithmetic on these figures. No "half", no percentages, no per-day or per-week breakdown, no annual total. They are the only price figures that exist and none may be turned into another one.
- ‼️ THE GUARANTEE, IF THERE IS ONE, IS IN THE CALL BRIEF AND NOWHERE ELSE. It exists on ONE tier and is a performance commitment, not a refund and not a trial. If the brief quotes it, say it in those exact words. If the brief does not quote one, or there is no brief, then there is no guarantee on this call and you may not imply one to close somebody. Never attach it to a lower tier to make that tier easier to sell: the guarantee is what the paid layer pays for, so a tier without the ads cannot carry it.
- ‼️ Never invent a figure, not even hypothetically, not even to make a point. "If it were $99 a month, would you be a yes" is inventing a price: it cannot be walked back, and the owner now has a number in their head that will never be honored. Isolate on the OBSTACLE instead: "if cost weren't the issue, would you be a yes, and is there anything else".
- If they ask for a lower number the answer is a SMALLER SCOPE, never a smaller number. Stepping down the ladder is a real answer. There is no discount below Core. Do not invent one, do not hint one might exist, do not ask what number would work.
- Say out loud that stepping down off the ChatGPT Ads tier means losing the guarantee with it, because there are no ads left to deliver it. That is honest, and it is usually the strongest reason to stay.`;

  if (callType === "cold") {
    return `PRICE — the tiers, all month to month:
${tiers}

- ‼️ The PAIN GATE outranks this. On a cold call you do not quote a price, offer the report, or describe the packages until the owner has said out loud that something is wrong. Until then these figures are for answering a direct "how much", nothing else.
- If they ask how much before any pain has been named, give the range in one sentence and go straight back to what they are missing. Price without a problem attached is just a number to say no to.
${shared}`;
  }

  return `PRICE — the tiers, all month to month. The pitch already happened, so these are on the table:
${tiers}

- Lead with the one that fits what they told you they want, then name the neighbours. Do not present them as cheap and expensive; they are narrower and wider.
${shared}`;
}
