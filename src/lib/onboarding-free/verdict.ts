// What is this business actually constrained by?
//
// A PURE FUNCTION, no model call, same precedent as delivery-guards.ts and
// call-coach-language.ts. A prose instruction is not a guard, and this is the one output
// of the whole form that a call gets planned around. It is deterministic so it can be
// argued with, and so a wrong verdict is a bug somebody can point at rather than a bad
// generation nobody can reproduce.
//
// THE PREMISE. `need` and `breakdown` are what the owner BELIEVES is wrong. `inquiries`,
// `conversion`, `capacity` and `response_speed` are numbers about his week. When they
// disagree, the numbers win and the disagreement is printed. It is never smoothed over:
// an owner who says "more customers" while 50 inquiries a week convert into "just a few"
// is telling us something true about his attention and something false about his problem,
// and both halves are worth walking into the call holding.
//
// `capacity` outranks everything. Nothing below it is worth solving for a business that
// cannot serve what it already has.

import {
  ASKS_ATTRIBUTION,
  BREAKDOWN,
  CAPACITY,
  CONVERSION,
  FOUND_YOU,
  INQUIRIES,
  NEED,
  RESPONSE_SPEED,
} from "@/config/onboarding-free";

export type Verdict = "capacity" | "conversion" | "speed" | "top_of_funnel" | "unclear";

export interface VerdictResult {
  verdict: Verdict;
  /** One line naming what the numbers say, for the card and for the call. */
  reading: string;
  /** True when the owner's stated constraint lines up with the verdict. */
  agrees: boolean;
  /** Why it disagrees. Null when it agrees. */
  disagreement: string | null;
  /** They need people, not customers. Not exclusive with any verdict. */
  talentSide: boolean;
  /** They cannot attribute anything, so nothing they believe about the source is evidence. */
  attributionBlind: boolean;
}

export const VERDICT_LABEL: Record<Verdict, string> = {
  capacity: "CAPACITY",
  conversion: "CONVERSION",
  speed: "SPEED TO LEAD",
  top_of_funnel: "TOP OF FUNNEL",
  unclear: "UNCLEAR",
};

const READING: Record<Verdict, string> = {
  capacity:
    "They cannot serve more work than they already have. Visibility for customers is not the bottleneck.",
  conversion:
    "Inquiries arrive and do not convert. They are not starving, they are leaking, and more visibility pours into the same hole.",
  speed:
    "Inquiries arrive and nobody answers them fast enough. The constraint is response time, not being found.",
  top_of_funnel:
    "Few inquiries, and they close most of what they get. Being found is genuinely the binding constraint.",
  unclear:
    "The answers do not point anywhere on their own. Ask on the call before deciding what to build.",
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * Which verdict the OWNER's own answers imply, so his opinion can be compared against the
 * numbers on the same scale.
 *
 * `need` alone is too coarse: "more customers" is what almost everyone says, and it means
 * four different things depending on `breakdown`. Only that second answer is specific
 * enough to disagree with.
 */
function statedVerdict(answers: Record<string, unknown>): Verdict | null {
  const need = str(answers.need);
  const breakdown = str(answers.breakdown);

  if (need === NEED.talent) return "capacity";
  if (need === NEED.unsure) return null;

  // Compared against the exported constants, never against a copy of the label. An
  // option reworded in the config and matched as a literal here is a verdict that
  // silently stops firing, which is the worst way for this to break: it keeps answering.
  if (breakdown === BREAKDOWN.unknown) return "top_of_funnel";
  if (breakdown === BREAKDOWN.noContact) return "top_of_funnel";
  if (breakdown === BREAKDOWN.noBooking) return "conversion";
  if (breakdown === BREAKDOWN.noCapacity) return "capacity";
  if (breakdown === BREAKDOWN.noRepeat) return "conversion";
  return null;
}

export function computeVerdict(answers: Record<string, unknown>): VerdictResult {
  const need = str(answers.need);
  const capacity = str(answers.capacity);
  const inquiries = str(answers.inquiries);
  const conversion = str(answers.conversion);
  const speed = str(answers.response_speed);
  const asks = str(answers.asks_attribution);
  const found = list(answers.found_you);

  const busy = inquiries === INQUIRIES.many || inquiries === INQUIRIES.flood;

  // Priority order. First match wins, and the order is the argument.
  let verdict: Verdict;
  if (capacity === CAPACITY.bookedOut || capacity === CAPACITY.mustHire) {
    // Overrides everything below it. This is the guardrail the whole form exists for.
    verdict = "capacity";
  } else if (busy && conversion === CONVERSION.few) {
    verdict = "conversion";
  } else if (
    (speed === RESPONSE_SPEED.nextDay || speed === RESPONSE_SPEED.slips) &&
    inquiries !== INQUIRIES.none
  ) {
    // Gated on having inquiries to be slow about. A business with five a week that
    // answers the next day is not losing them to speed, it is short of them.
    verdict = "speed";
  } else if (
    inquiries === INQUIRIES.none &&
    (conversion === CONVERSION.almostAll || conversion === CONVERSION.half)
  ) {
    verdict = "top_of_funnel";
  } else {
    verdict = "unclear";
  }

  const stated = statedVerdict(answers);
  const agrees = stated === null ? true : stated === verdict;
  const disagreement =
    agrees || stated === null
      ? null
      : `They said ${VERDICT_LABEL[stated]}. The numbers say ${VERDICT_LABEL[verdict]}.`;

  const talentSide =
    need === NEED.talent || need === NEED.both || capacity === CAPACITY.mustHire;

  // Any one of these means they cannot tell where a customer came from, so nothing they
  // believe about their own sources is evidence, and no result we produce will be
  // attributable to us either. That second half is why it is flagged rather than noted.
  const attributionBlind =
    asks === ASKS_ATTRIBUTION.no ||
    conversion === CONVERSION.untracked ||
    found.includes(FOUND_YOU.noIdea);

  return {
    verdict,
    reading: READING[verdict],
    agrees,
    disagreement,
    talentSide,
    attributionBlind,
  };
}
