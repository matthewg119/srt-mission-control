// Who gets a nudge tomorrow morning.
//
// The prospect row is a denormalization; outreach_touches is the truth. So the row narrows the
// candidates and the touch log decides, which is why a prospect whose step counter drifted
// cannot smuggle themselves into a send.

import { supabaseAdmin } from "@/lib/db";
import { previousBusinessDayET } from "@/lib/followup-operator/cadence";
import { PROSPECT_COLUMNS, type OutreachProspectRow } from "@/lib/followup-operator/types";

export interface NudgeCandidate {
  prospect: OutreachProspectRow;
  /** The step-1 email we are replying to. Lives in `mailbox`, and the reply must go out from there. */
  anchorMessageId: string;
  mailbox: string;
  subject: string | null;
  sentAt: string;
}

export interface NudgeSelection {
  candidates: NudgeCandidate[];
  /** Sent on the right day but with no usable anchor. Reported, never silently dropped: this is
   *  the signature of a send that predates the touch-log fix. */
  skippedNoAnchor: Array<{ email: string; reason: string }>;
  skippedAlreadyNudged: number;
  windowStart: string;
  windowEnd: string;
}

/**
 * Prospects whose rung-1 email went out on the previous business day and who have not answered.
 *
 * confirmed = true is load-bearing. Most rows in this table were auto-enrolled by the Sent Items
 * sweep from any address Matthew ever emailed, which includes vendors, partners and his own
 * accounts. Only a prospect someone deliberately confirmed may be emailed unattended.
 */
export async function selectNudgeCandidates(now = new Date()): Promise<NudgeSelection> {
  const { start, end } = previousBusinessDayET(now);

  const { data, error } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .eq("confirmed", true)
    .eq("paused", false)
    .eq("state", "SENT_NO_REPLY")
    .eq("step", 1)
    .is("last_reply_at", null)
    .not("first_sent_at", "is", null);

  if (error) throw new Error(`selectNudgeCandidates: ${error.message}`);

  const rows = (data ?? []) as unknown as OutreachProspectRow[];
  const candidates: NudgeCandidate[] = [];
  const skippedNoAnchor: NudgeSelection["skippedNoAnchor"] = [];
  let skippedAlreadyNudged = 0;

  for (const p of rows) {
    // Every outbound email touch for this prospect, oldest first. One query per candidate is
    // fine: this list is tens of rows, once a day.
    const { data: touches } = await supabaseAdmin
      .from("outreach_touches")
      .select("step, graph_message_id, mailbox, subject, occurred_at")
      .eq("prospect_id", p.id)
      .eq("direction", "outbound")
      .eq("channel", "email")
      .order("occurred_at", { ascending: true });

    const list = touches ?? [];

    // Already nudged. Checked against the LOG, not the step counter, because the counter is
    // what would be wrong if anything upstream drifted.
    if (list.some((t) => (t.step ?? 0) >= 2)) {
      skippedAlreadyNudged++;
      continue;
    }

    const rung1 = list.find((t) => (t.step ?? 0) <= 1);
    if (!rung1) {
      skippedNoAnchor.push({ email: p.email, reason: "no rung-1 email in the touch log" });
      continue;
    }

    const sentAt = new Date(rung1.occurred_at as string);
    if (sentAt < start || sentAt >= end) continue; // not the previous business day

    if (!rung1.graph_message_id) {
      skippedNoAnchor.push({ email: p.email, reason: "rung-1 touch has no Graph message id" });
      continue;
    }
    if (!rung1.mailbox) {
      // Without this we would not know which mailbox to reply FROM, and replying from the wrong
      // address breaks the thread and reads as a spoof.
      skippedNoAnchor.push({ email: p.email, reason: "rung-1 touch has no mailbox recorded" });
      continue;
    }

    candidates.push({
      prospect: p,
      anchorMessageId: rung1.graph_message_id as string,
      mailbox: (rung1.mailbox as string).toLowerCase(),
      subject: (rung1.subject as string | null) ?? p.thread_subject,
      sentAt: sentAt.toISOString(),
    });
  }

  return {
    candidates,
    skippedNoAnchor,
    skippedAlreadyNudged,
    windowStart: start.toISOString(),
    windowEnd: end.toISOString(),
  };
}
