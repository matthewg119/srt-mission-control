// The Slack card for a /onboardingfree submission.
//
// Built in CODE, not by a model, the same reason buildCoachNotes() is. This card is the
// framing Matthew walks into the call holding. One invented line here is not one bad
// sentence, it is a whole conversation aimed at the wrong problem.
//
// It prints the owner's stated constraint AND the verdict, side by side, even when they
// disagree. Especially when they disagree. Nothing reconciles them.

import { ACCESS_FIELDS, type FieldDef } from "@/config/onboarding-free";
import { VERDICT_LABEL, type VerdictResult } from "./verdict";

export interface CardInput {
  business: string;
  name: string;
  email: string;
  phone: string;
  answers: Record<string, unknown>;
  result: VerdictResult;
  /** Set when this email or phone already matches a contact. Read-only lookup. */
  contactId: string | null;
}

function answer(answers: Record<string, unknown>, key: string): string {
  const raw = answers[key];
  if (Array.isArray(raw)) return raw.filter(Boolean).join(", ");
  return typeof raw === "string" ? raw.trim() : "";
}

function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com").replace(
    /\/$/,
    ""
  );
}

export function buildOnboardingFreeCard(input: CardInput): string {
  const { business, name, email, phone, answers, result, contactId } = input;
  const lines: string[] = [];

  lines.push(`:clipboard: *onboardingfree: ${business}*`);

  const who = [name, email, phone].filter(Boolean).join("  |  ");
  lines.push(who);
  if (contactId) {
    lines.push(`Known lead: ${appUrl()}/dashboard/leads/${contactId}`);
  } else {
    lines.push("_No matching contact. This is a new name to us._");
  }
  lines.push("");

  // --- the verdict -------------------------------------------------------
  lines.push(`*CONSTRAINT: ${VERDICT_LABEL[result.verdict]}*`);
  lines.push(result.reading);
  lines.push("");

  const stated = [answer(answers, "need"), answer(answers, "breakdown")]
    .filter(Boolean)
    .join(", ");
  lines.push(`*They said:* ${stated || "nothing conclusive"}`);

  const numbers = [
    `${answer(answers, "inquiries")} inquiries a week`,
    `${answer(answers, "conversion")} convert`,
    answer(answers, "capacity"),
    `responds ${answer(answers, "response_speed")}`,
  ]
    .filter((s) => s && !s.startsWith("undefined"))
    .join("  |  ");
  lines.push(`*The numbers say:* ${numbers}`);

  if (result.disagreement) {
    lines.push(`:arrows_counterclockwise: *DISAGREES.* ${result.disagreement}`);
  } else {
    lines.push(":white_check_mark: Their read and the numbers agree.");
  }
  lines.push("");

  // --- the flags ---------------------------------------------------------
  // Both of these are internal. The prospect saw a normal thank-you screen and has no
  // idea either was computed.
  if (result.verdict === "capacity") {
    lines.push(
      ":warning: *CAPACITY.* Do not sell customer-side visibility. Either take the talent " +
        "angle, which is the same work pointed at a different question, or tell them to " +
        "come back when they have hired. A saturated business does not produce a testimonial."
    );
  }
  if (result.attributionBlind) {
    lines.push(
      ":warning: *ATTRIBUTION BLIND.* They could not tell an AI referral from a Google Ads " +
        "one if it happened. Nothing they believe about their own sources is evidence, and " +
        "nothing we produce will be attributable either until that is fixed."
    );
  }
  if (result.verdict === "capacity" || result.attributionBlind) lines.push("");

  // --- the money map -----------------------------------------------------
  // money_maker and fewer_of are the ICP and the anti-ICP in the owner's own words. Every
  // other lane in this app infers those from niche_briefs.avatars, which is a guess about
  // the vertical. This is the man himself answering.
  lines.push("*MONEY*");
  lines.push(`Makes the most:  ${answer(answers, "money_maker") || "not given"}`);
  lines.push(`Wants fewer of:  ${answer(answers, "fewer_of") || "not given"}`);
  lines.push(`Best customer:   ${answer(answers, "best_customer") || "not given"}`);
  lines.push(`Loses deals to:  ${answer(answers, "lose_to") || "not given"}`);
  lines.push("");

  // --- how they get found today -----------------------------------------
  lines.push(
    `*FOUND TODAY:* ${answer(answers, "found_you") || "not given"}  |  asks how they heard: ${
      answer(answers, "asks_attribution") || "not given"
    }`
  );

  // --- talent ------------------------------------------------------------
  const role = answer(answers, "role");
  if (result.talentSide || role) {
    const hiring = answer(answers, "hiring");
    lines.push(
      `*TALENT:* ${role || "role not given"}${hiring ? `  |  hires via ${hiring}` : ""}`
    );
  }

  return lines.join("\n");
}

/**
 * The access answers, posted as a reply UNDER the card rather than as a second top-level
 * message. They arrive minutes later and are the boring half; a second card in the
 * channel would bury the constraint reading that matters.
 */
export function buildAccessReply(values: Record<string, unknown>): string {
  const lines: string[] = [":key: *Access and assets*"];
  for (const field of ACCESS_FIELDS as FieldDef[]) {
    const raw = values[field.key];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!value) continue;
    lines.push(`*${field.label}*`);
    lines.push(value);
    lines.push("");
  }
  if (lines.length === 1) return ":key: *Access screen submitted with nothing filled in.*";
  return lines.join("\n").trimEnd();
}

/** One line for the system_logs description column. */
export function describeSubmission(business: string, result: VerdictResult): string {
  return `onboardingfree: ${business} (${VERDICT_LABEL[result.verdict]}${
    result.agrees ? "" : ", disagrees with what they said"
  })`.slice(0, 300);
}
