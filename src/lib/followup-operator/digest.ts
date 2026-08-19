// The 09:00 ET board in #followups_channel: who to call, who to email, who is
// waiting, and what Outlook turned up that nobody recognizes.
//
// Order of operations matters. The sweep runs BEFORE the board is computed, so
// an email Matthew sent at 11pm last night is already on it this morning.

import { slack, slackThreadLink, type SlackBlock } from "@/lib/slack-bot";
import { runSentMailSweep, type SweepResult } from "./sent-sweep";
import {
  listDueProspects,
  listWaitingProspects,
  listUnconfirmedProspects,
  updateProspect,
} from "./prospects";
import { channelFor, hasOutboundTouchToday, stepLabel } from "./cadence";
import type { OutreachProspectRow } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function followupChannel(): string {
  return process.env.SLACK_FOLLOWUPS_CHANNEL || "";
}

/** Moved to slack-bot.ts, where the second caller could find it. Re-exported so
 *  this module's existing name keeps working. */
export const threadLink = slackThreadLink;

function displayName(p: OutreachProspectRow): string {
  return p.name?.trim() || p.company?.trim() || p.email;
}

function whoLine(p: OutreachProspectRow): string {
  const bits = [p.company?.trim(), p.city?.trim()].filter(Boolean);
  return bits.length ? `${displayName(p)}, ${bits.join(", ")}` : displayName(p);
}

function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS);
}

/** Why this prospect is on the board today, in Matthew's own shorthand. */
function reasonFor(p: OutreachProspectRow): string {
  const silent = daysSince(p.last_touch_at);
  switch (p.state) {
    case "ASKED_PRICE_HOT":
      return "asked what it costs";
    case "REPLIED_INTERESTED":
      return "said yes, owed the breakdown";
    case "OBJECTION":
      return "asked a question";
    default:
      return silent === null
        ? stepLabel(p.step)
        : `${stepLabel(p.step)} landed, silent ${silent}d`;
  }
}

/** Post the prospect's own thread once and remember it. The audit thread in
 *  #ai-visibility-audits keeps the report; this one keeps the follow-ups. */
export async function ensureProspectThread(
  p: OutreachProspectRow,
  channel: string
): Promise<OutreachProspectRow> {
  if (p.slack_thread_ts && p.slack_channel_id) return p;

  const lines = [
    `*${displayName(p)}*${p.company && p.company !== p.name ? `, ${p.company}` : ""}${p.city ? `, ${p.city}` : ""}`,
    `📧 ${p.email}${p.phone ? ` · 📞 ${p.phone}` : ""}${p.website ? ` · ${p.website}` : ""}`,
    p.first_sent_at ? `First pitch ${new Date(p.first_sent_at).toDateString()}, now at ${stepLabel(p.step)}` : "No pitch logged yet",
    "",
    "_In this thread: *1/2/3* pick a draft · *call* mini pitch · *no answer* · *answered <notes>* · *snooze 3d* · *close*_",
  ];

  const res = await slack.postMessage(channel, `Follow-up file: ${displayName(p)}`, [
    { type: "section", text: { type: "mrkdwn", text: lines.join("\n") } } as SlackBlock,
  ]);

  const ts = (res?.ts as string | undefined) ?? null;
  if (!ts) return p;

  const updated = await updateProspect(p.id, { slack_channel_id: channel, slack_thread_ts: ts });
  return updated ?? p;
}

function sectionLines(header: string, items: string[]): SlackBlock[] {
  if (!items.length) return [];
  return [
    { type: "section", text: { type: "mrkdwn", text: `*${header}*` } } as SlackBlock,
    ...items.map(
      (t) => ({ type: "section", text: { type: "mrkdwn", text: t } } as SlackBlock)
    ),
  ];
}

export interface DigestResult {
  hot: number;
  calls: number;
  emails: number;
  waiting: number;
  unrecognized: number;
  deferred: number;
  sweep: SweepResult;
  posted: boolean;
  skipped?: string;
}

/**
 * Build and post the daily board.
 *
 * `dry` runs the sweep and the arithmetic but posts nothing, which is how the
 * first live run gets checked against a real mailbox without spamming Slack.
 */
export async function runFollowupDigest(opts?: { dry?: boolean }): Promise<DigestResult> {
  const dry = opts?.dry ?? false;
  const channel = followupChannel();

  // Backstop for the lead-pitch auto-send timer, which lives inside a single
  // serverless invocation and can be lost to a cold start. No-op while
  // AUDIT_AUTOSEND_ENABLED is unset, which is the shipped default.
  if (!dry) {
    const { flushDueAutoSends } = await import("@/lib/audit-engine/lead-pitch");
    const flushed = await flushDueAutoSends().catch(() => ({ sent: 0, checked: 0 }));
    if (flushed.sent) console.log(`[followup] auto-send backstop sent ${flushed.sent}`);
  }

  const sweep = await runSentMailSweep();

  const result: DigestResult = {
    hot: 0,
    calls: 0,
    emails: 0,
    waiting: 0,
    unrecognized: 0,
    deferred: 0,
    sweep,
    posted: false,
  };

  if (!channel) {
    result.skipped = "SLACK_FOLLOWUPS_CHANNEL not set";
    console.error("[followup] no digest channel configured");
    return result;
  }

  const due = await listDueProspects();
  const waiting = await listWaitingProspects();
  const unrecognized = await listUnconfirmedProspects();

  const hot: OutreachProspectRow[] = [];
  const calls: OutreachProspectRow[] = [];
  const emails: OutreachProspectRow[] = [];

  for (const p of due) {
    // Never two channels on one prospect in one day. An unanswered call does
    // not count, which is what lets the text and email follow it.
    if (await hasOutboundTouchToday(p.id)) {
      const push = new Date(Date.now() + DAY_MS);
      if (!dry) await updateProspect(p.id, { next_touch_at: push.toISOString() });
      result.deferred++;
      continue;
    }

    if (p.state === "ASKED_PRICE_HOT" || p.state === "REPLIED_INTERESTED" || p.state === "OBJECTION") {
      hot.push(p);
    } else if (channelFor(p) === "call") {
      calls.push(p);
    } else {
      emails.push(p);
    }
  }

  result.hot = hot.length;
  result.calls = calls.length;
  result.emails = emails.length;
  result.waiting = waiting.length;
  result.unrecognized = unrecognized.length;

  if (dry) return result;

  // Every prospect on the board needs a thread to be pointed at.
  const withThreads = new Map<string, OutreachProspectRow>();
  for (const p of [...hot, ...calls, ...emails]) {
    withThreads.set(p.id, await ensureProspectThread(p, channel));
  }
  const linked = (p: OutreachProspectRow): string => {
    const row = withThreads.get(p.id) ?? p;
    return row.slack_thread_ts && row.slack_channel_id
      ? `<${threadLink(row.slack_channel_id, row.slack_thread_ts)}|open>`
      : "_no thread_";
  };

  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `☀️ Follow-up Operator, ${today}`, emoji: true },
    } as SlackBlock,
  ];

  blocks.push(
    ...sectionLines(
      `🔥 HOT, answer today (${hot.length})`,
      hot.map((p) => `*${whoLine(p)}*\n${reasonFor(p)} · ${linked(p)}`)
    )
  );
  blocks.push(
    ...sectionLines(
      `📞 CALL LIST (${calls.length})`,
      calls.map((p) => `*${whoLine(p)}*\n${reasonFor(p)} · reply *call* in ${linked(p)}`)
    )
  );
  blocks.push(
    ...sectionLines(
      `✉️ EMAIL DUE (${emails.length})`,
      emails.map((p) => `*${whoLine(p)}*\n${reasonFor(p)} · ${linked(p)}`)
    )
  );

  if (waiting.length) {
    const preview = waiting
      .slice(0, 12)
      .map((p) => {
        const when = p.next_touch_at
          ? new Date(p.next_touch_at).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" })
          : "";
        return `${displayName(p)}${when ? ` (${when})` : ""}`;
      })
      .join(" · ");
    const more = waiting.length > 12 ? `, +${waiting.length - 12} more` : "";
    blocks.push(
      ...sectionLines(`⏳ WAITING (${waiting.length})`, [`${preview}${more}`])
    );
  }

  if (!hot.length && !calls.length && !emails.length) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: "_Nothing due today._" },
    } as SlackBlock);
  }

  await slack.postMessage(
    channel,
    `Follow-up Operator: ${hot.length} hot, ${calls.length} calls, ${emails.length} emails`,
    blocks
  );

  // Unrecognized addresses get their own message so the buttons stay one per row.
  for (const p of unrecognized.slice(0, 10)) {
    await slack.postMessage(channel, `New from Outlook: ${p.email}`, [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `🆕 *${p.email}*\nYou emailed this address and no audit matches it. Track it as a prospect?`,
        },
      } as SlackBlock,
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "✅ Track", emoji: true },
            style: "primary",
            action_id: "fo_track",
            value: p.id,
          },
          {
            type: "button",
            text: { type: "plain_text", text: "✖ Ignore", emoji: true },
            action_id: "fo_ignore",
            value: p.id,
          },
        ],
      } as SlackBlock,
    ]);
  }

  result.posted = true;
  return result;
}
