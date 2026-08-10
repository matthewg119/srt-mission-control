/**
 * SRT Call Coach — when the $349 lever is allowed to exist.
 *
 * $499/mo is the price. $349/mo is a real fast-action price Matthew honors, but only as a last
 * resort: after the obstacle has been isolated and two answers on it have already failed.
 *
 * ‼️ This is a CODE gate, not a prompt rule, and it had to become one. Telling the model "do not
 * mention 349 until two responses have failed" leaked the number on the FIRST price objection in
 * 2 of 3 live runs, in one case as an entire "here's what I can do" card. The model reads its own
 * three suggestions as an escalating sequence and helpfully supplies step three, and no amount of
 * emphasis in the prompt fixed it.
 *
 * Same doctrine the follow-up COACH NOTES already run on: the brief WITHHOLDS the price rather
 * than forbidding it, because a number sitting in a helpful model's context is one it will
 * eventually reach for. Absent beats forbidden. When this returns false the string "349" is not
 * in the request at all, so there is nothing to leak.
 *
 * Pure, so it is testable without a call.
 */

/** Money talk, in both languages, since these calls run in Spanglish. */
const MONEY_RE =
  /\b(price|pricing|cost|costs|expensive|afford|budget|money|pay|paying|payment|cheaper|discount|\$\s?\d|\d{3,}\s?(?:a|per)\s?month|precio|caro|cara|costo|presupuesto|dinero|pagar|barato|descuento|mensual(?:es|idad)?)\b/i;

export interface GateTurn {
  speaker?: string | null;
  text?: string | null;
}

/** The owner. Anything that is not the rep is treated as the owner, matching the two-socket split. */
function isOwner(t: GateTurn): boolean {
  return (t.speaker ?? "").toLowerCase() !== "rep";
}

/**
 * True once the owner has raised money at least TWICE and Matthew has already answered it at
 * least twice. That is "isolated, and two responses failed" made mechanical: he pushed back, it
 * got worked, and he is still on it.
 *
 * Both halves are required. Counting only the owner's mentions would unlock on someone who says
 * "how much" and then "that's a lot" back to back, before Matthew has actually tried anything.
 */
export function priceLeverUnlocked(turns: GateTurn[] | undefined | null): boolean {
  if (!Array.isArray(turns) || turns.length === 0) return false;

  const firstMoneyIdx = turns.findIndex((t) => isOwner(t) && MONEY_RE.test(t.text ?? ""));
  if (firstMoneyIdx === -1) return false;

  const ownerMoneyTurns = turns.filter((t) => isOwner(t) && MONEY_RE.test(t.text ?? "")).length;
  const repRepliesAfter = turns.slice(firstMoneyIdx + 1).filter((t) => !isOwner(t)).length;

  return ownerMoneyTurns >= 2 && repRepliesAfter >= 2;
}

/**
 * The pricing paragraph for this specific request. Locked is the default and says nothing about a
 * discount existing, because the model cannot quote what it was never told.
 */
export function priceBlock(unlocked: boolean): string {
  if (!unlocked) {
    return `PRICE:
- The price is $499/month. It is the ONLY price figure that exists on this call.
- If they ask for a lower number the answer is a SMALLER SCOPE, never a smaller number. There is no discount to offer. Do not invent one, do not hint that one might exist, do not ask what number would work.
- ‼️ Do not name any other figure, not even hypothetically, not even to make a point. "If it were $99 a month, would you be a yes" is INVENTING A PRICE: he cannot walk it back, and the owner now has a number in their head that Matthew will never honor. Isolate on the OBSTACLE, never on an imaginary price: "if cost weren't the issue, would you be a yes, is there anything else".
- Never do arithmetic on $499 and never derive a second figure from it. No percentages, no "half", no per-day or per-week breakdown.`;
  }

  return `PRICE — the discount is UNLOCKED on this call. He has raised cost more than once and it has already been worked twice without moving:
- The price is $499/month. $349/month is a real fast-action price Matthew honors, for deciding today.
- Offer it as a real price for a real reason. NO countdown, NO invented deadline, NO "only a few spots left". A real discount does not need a fake reason.
- Never do arithmetic on the two figures. No "half off", no percentages, no "saves you X a year". 499 and 349 are the only price figures that exist and neither may be turned into a third one.
- If 349 does not move it either, the next move is a SMALLER SCOPE or a clean exit, not a third number.`;
}
