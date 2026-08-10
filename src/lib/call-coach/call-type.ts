// Which call this is, decided in CODE from persisted state and the real mailbox.
//
// It is the single most consequential switch in the coach. Get it wrong and the opener is wrong,
// the pain gate is wrong, and the price is either quoted to someone who has seen nothing or
// withheld from someone ready to buy.
//
// ‼️ `loom_url` and `redesign_url` are NOT inputs here and must never be added. A stored asset
// proves the video was MADE, not that it was sent, and certainly not that it was watched. Keying
// off it is a documented past bug (call-script.ts): it opened selling to people who never pressed
// play, and made one signal mean a gentle Monday follow-up and a Thursday price conversation.
//
// ‼️ `outreach_stage === "drafted"` does NOT lift cold to followup. Drafted means a draft is
// QUEUED, not sent. Treating intent as delivery is how you open a follow-up call about an email
// still sitting in the outbox, and the prospect says "I never got anything" in the first sentence.

import type { ThreadTruth } from "@/lib/audit-engine/thread-truth";
import type { AuditReportRow } from "@/lib/audit-engine/types";
import type { CoachCallType } from "@/lib/call-coach-price-gate";

export type { CoachCallType };

export interface ProspectState {
  state: string | null;
  first_sent_at: string | null;
}

export interface CallTypeDecision {
  type: CoachCallType;
  /** Why, in plain words. Printed in the brief and on the wrap card so a wrong mode is visible. */
  reasons: string[];
}

/** Prospect states that mean they engaged. Any of them makes this a decision conversation. */
const WARM_STATES = new Set(["REPLIED_INTERESTED", "ASKED_PRICE_HOT", "OBJECTION"]);

export function decideCallType(input: {
  report: AuditReportRow | null;
  truth: ThreadTruth | null;
  prospect: ProspectState | null;
}): CallTypeDecision {
  const { report, truth, prospect } = input;
  const reasons: string[] = [];

  // ── close ────────────────────────────────────────────────────────────────
  if (truth?.theyReplied) {
    reasons.push(
      `They have replied to us${truth.lastInboundAt ? ` (last ${truth.lastInboundAt.slice(0, 10)})` : ""}, so the conversation is live.`
    );
    return { type: "close", reasons };
  }
  if (report?.outreach_stage === "revealed") {
    reasons.push("Everything was handed over: report, video and price. This is a decision, not an introduction.");
    return { type: "close", reasons };
  }
  if (prospect?.state && WARM_STATES.has(prospect.state)) {
    reasons.push(`The follow-up operator has them as ${prospect.state}, which only happens after they engage.`);
    return { type: "close", reasons };
  }

  // ── followup ─────────────────────────────────────────────────────────────
  // Requires BOTH an audit to talk about AND proof that something actually left the building.
  const hasAudit = Boolean(report && report.status === "done");
  const delivered = Boolean(truth?.lastOutboundAt) || Boolean(prospect?.first_sent_at);

  if (hasAudit && delivered) {
    const days = truth?.daysSilent;
    reasons.push(
      `An audit exists and at least one email actually went out${days != null ? `, ${days} day(s) ago with no reply` : ""}. They have not engaged with it.`
    );
    reasons.push("Nothing is sold on this call. The job is to earn the reply.");
    return { type: "followup", reasons };
  }

  // ── cold ─────────────────────────────────────────────────────────────────
  if (hasAudit && !delivered) {
    // The specific trap: a report finished, a draft was written, and nobody pressed send.
    reasons.push(
      report?.outreach_stage === "drafted"
        ? "An audit exists and a draft was written, but nothing has actually been sent. A queued draft is not a delivered email, so this is still a first conversation."
        : "An audit exists but nothing has been sent to them yet."
    );
  } else if (!hasAudit) {
    reasons.push("No finished AI visibility audit for this business, so there are no measured numbers to talk about.");
  }
  reasons.push("Their pain is unknown and has to be discovered on the call.");
  return { type: "cold", reasons };
}

/** The one-line label for the top of the brief. */
export function callTypeLabel(d: CallTypeDecision): string {
  switch (d.type) {
    case "cold":
      return "COLD CALL — first real conversation, nothing has landed with them";
    case "followup":
      return "FOLLOW-UP — an email went out, they have not engaged, NOTHING IS BEING SOLD";
    case "close":
      return "CLOSING CALL — they have seen the work, this is a decision";
  }
}
