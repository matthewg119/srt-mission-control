// The 7:30am nudge run.
//
// This is the first thing in this repo that sends email on its own, and it is deliberately kept
// out of audit-engine/. The invariant written into audit-tools.ts and call-coach/wrap-card.ts
// ("microsoft.sendDraft is not imported by this file and must not be") stays exactly as it is:
// first-contact emails are still drafts a person reviews. Only a follow-up on a thread that a
// person already started can leave unattended, and only behind OUTREACH_SENDER_ENABLED.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { etDateKey, startOfETDay } from "@/lib/followup-operator/cadence";
import { mailboxHeadroom, headroomGauge } from "@/lib/followup-operator/mailboxes";
import { followupChannel } from "@/lib/followup-operator/digest";
import { selectNudgeCandidates, type NudgeCandidate } from "./select";
import { buildNudgeHtml, nudgeBodyPreview } from "./body";
import { enqueueSend, senderEnabled, nudgeDailyCap } from "./queue";

export interface NudgeRunResult {
  queued: number;
  skippedDuplicate: number;
  skippedCapped: number;
  skippedNoAnchor: Array<{ email: string; reason: string }>;
  skippedAlreadyNudged: number;
  overflow: Array<{ email: string; mailbox: string }>;
  candidates: Array<{ email: string; mailbox: string; anchorMessageId: string; sendAfter: string | null }>;
  dry: boolean;
  aborted?: string;
}

/** The once-per-Eastern-day claim. A conditional UPDATE rather than a read-then-write, because
 *  the cron fires at two candidate UTC hours and someone may also hit the URL by hand. */
async function claimToday(now: Date): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from("outreach_sweep_state")
    .update({ last_nudge_run_at: now.toISOString(), updated_at: now.toISOString() })
    .eq("id", 1)
    .or(`last_nudge_run_at.is.null,last_nudge_run_at.lt.${startOfETDay(now).toISOString()}`)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

export async function runNudgeSend(opts?: { dry?: boolean; force?: boolean }): Promise<NudgeRunResult> {
  const dry = opts?.dry ?? false;
  const now = new Date();
  const channel = followupChannel();

  const result: NudgeRunResult = {
    queued: 0,
    skippedDuplicate: 0,
    skippedCapped: 0,
    skippedNoAnchor: [],
    skippedAlreadyNudged: 0,
    overflow: [],
    candidates: [],
    dry,
  };

  // If the touch log is empty, every selection query below is about to return nonsense, and the
  // thing that made it empty took three weeks to notice last time. Refuse to run.
  const { count: touchCount } = await supabaseAdmin
    .from("outreach_touches").select("id", { count: "exact", head: true });
  if (!touchCount) {
    result.aborted = "outreach_touches is empty, which means touch logging has regressed";
    if (channel && !dry) {
      await slack.postMessage(channel, `:rotating_light: Nudge sender ABORTED: ${result.aborted}`).catch(() => {});
    }
    return result;
  }

  if (!dry && !senderEnabled()) {
    result.aborted = "OUTREACH_SENDER_ENABLED is not set";
    return result;
  }

  if (!dry && !opts?.force && !(await claimToday(now))) {
    result.aborted = "already ran today";
    return result;
  }

  const selection = await selectNudgeCandidates(now);
  result.skippedNoAnchor = selection.skippedNoAnchor;
  result.skippedAlreadyNudged = selection.skippedAlreadyNudged;

  if (channel && !dry) {
    await slack
      .postMessage(
        channel,
        `:sunrise: Nudge sender starting. ${selection.candidates.length} due from ${etDateKey(new Date(selection.windowStart))}. ${headroomGauge(await mailboxHeadroom(now))}`
      )
      .catch(() => {});
  }

  const cap = nudgeDailyCap();
  const html = await buildNudgeHtml();
  let queuedSoFar = 0;

  for (const c of selection.candidates as NudgeCandidate[]) {
    // Hard stop at the shared cap, and the overflow is NAMED rather than counted, so it is
    // obvious who did not get one.
    if (queuedSoFar >= cap) {
      result.overflow.push({ email: c.prospect.email, mailbox: c.mailbox });
      continue;
    }

    if (dry) {
      result.candidates.push({
        email: c.prospect.email,
        mailbox: c.mailbox,
        anchorMessageId: c.anchorMessageId,
        sendAfter: null,
      });
      queuedSoFar++;
      continue;
    }

    const outcome = await enqueueSend(
      {
        prospectId: c.prospect.id,
        kind: "nudge",
        step: 2,
        recipient: c.prospect.email,
        // The mailbox the ORIGINAL went out from, never today's rotation pick.
        mailbox: c.mailbox,
        replyToMessageId: c.anchorMessageId,
        subject: c.subject,
        bodyHtml: html,
        dedupeKey: `nudge:${c.prospect.id}:2`,
      },
      now
    );

    if ("skipped" in outcome) {
      if (outcome.skipped === "duplicate") result.skippedDuplicate++;
      else result.skippedCapped++;
      continue;
    }

    const { data: row } = await supabaseAdmin
      .from("outreach_send_queue").select("send_after").eq("id", outcome.id).maybeSingle();
    result.candidates.push({
      email: c.prospect.email,
      mailbox: c.mailbox,
      anchorMessageId: c.anchorMessageId,
      sendAfter: (row?.send_after as string | null) ?? null,
    });
    result.queued++;
    queuedSoFar++;
  }

  if (channel && !dry) {
    const lines = [
      `:white_check_mark: Nudge sender done. ${result.queued} queued, ${result.skippedDuplicate} already queued, ${result.skippedAlreadyNudged} already nudged.`,
    ];
    if (result.skippedNoAnchor.length) {
      lines.push(`:warning: ${result.skippedNoAnchor.length} had no usable thread anchor: ${result.skippedNoAnchor.map((s) => s.email).join(", ")}`);
    }
    if (result.overflow.length) {
      lines.push(`:no_entry: Over the ${cap}/day cap, not queued: ${result.overflow.map((o) => o.email).join(", ")}`);
    }
    await slack.postMessage(channel, lines.join("\n")).catch(() => {});
  }

  return result;
}

/** The --dry-run report, printed for a human to read before anything is armed. */
export function formatNudgeDryRun(r: NudgeRunResult, windowLabel: string): string {
  const lines: string[] = [];
  lines.push("=".repeat(78));
  lines.push("NUDGE SENDER, DRY RUN. Nothing was queued and nothing was sent.");
  lines.push("=".repeat(78));
  lines.push("");
  if (r.aborted) {
    lines.push(`ABORTED: ${r.aborted}`);
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`Selection window (previous business day, ET): ${windowLabel}`);
  lines.push(`Daily cap (shared across mailboxes): ${nudgeDailyCap()}`);
  lines.push(`Kill switch OUTREACH_SENDER_ENABLED: ${senderEnabled() ? "ARMED" : "not set, so nothing can send"}`);
  lines.push("");
  lines.push("BODY, exactly as it will render:");
  lines.push("-".repeat(78));
  for (const l of nudgeBodyPreview().split("\n")) lines.push(`  ${l}`);
  lines.push("-".repeat(78));
  lines.push("");
  lines.push(`QUEUE (${r.candidates.length}):`);
  if (!r.candidates.length) lines.push("  (nobody is due)");
  for (const c of r.candidates) {
    lines.push(`  ${c.email.padEnd(40)} from ${c.mailbox.padEnd(26)} thread ${c.anchorMessageId.slice(0, 24)}...`);
    lines.push(`  ${" ".repeat(40)} send ${c.sendAfter ?? "on the next 5-minute tick, jittered 5-8 min apart"}`);
  }
  lines.push("");
  if (r.skippedAlreadyNudged) lines.push(`Skipped, already nudged: ${r.skippedAlreadyNudged}`);
  if (r.skippedNoAnchor.length) {
    lines.push(`Skipped, no usable thread anchor (${r.skippedNoAnchor.length}):`);
    for (const s of r.skippedNoAnchor) lines.push(`  ${s.email.padEnd(40)} ${s.reason}`);
  }
  if (r.overflow.length) {
    lines.push(`OVER THE CAP, would not be queued (${r.overflow.length}):`);
    for (const o of r.overflow) lines.push(`  ${o.email}`);
  }
  lines.push("");
  return lines.join("\n");
}
