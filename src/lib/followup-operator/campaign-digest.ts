// The 09:00 ET campaign card in #vektor-email-director.
//
// ‼️ IT PRINTS NO SEND COUNT, NO OPEN RATE, NO CLICK RATE AND NO REPLY RATE, AND THAT IS NOT AN
// OVERSIGHT TO FIX LATER.
// ReachInbox sends from mailboxes we do not own and gates its API behind Tier 4, so the number of
// emails that went out is genuinely unobservable from here. A reply rate needs that denominator.
// Printing one would mean inventing it, and a rate is exactly the figure somebody makes a spend
// decision on. Same rule as the audit engine's coverage gate and pacing.ts's "counts touches, not
// the queue": a denominator we did not measure is worse than no denominator. The card says where
// the send numbers actually live instead.
//
// Everything below is read from outreach_touches joined to outreach_prospects where
// source = 'reachinbox' -- both written by the reply sweep. No new table.

import { supabaseAdmin } from "@/lib/db";
import { slack, slackThreadLink, type SlackBlock } from "@/lib/slack-bot";
import { startOfETDay, etDateKey } from "./cadence";
import { classifyReply } from "./classify-reply";
import { campaignChannel } from "./campaign-replies";
import { displayName } from "./digest";
import type { OutreachProspectRow, OutreachTouchRow } from "./types";
import { PROSPECT_COLUMNS } from "./types";

const WEEK_DAYS = 7;

export interface CampaignDigestResult {
  dateKey: string;
  repliesYesterday: number;
  repliesWeek: number;
  bouncedYesterday: number;
  autoRepliesYesterday: number;
  newContacts: number;
  interested: number;
  askedPrice: number;
  objection: number;
  optOut: number;
  posted: boolean;
  skipped?: "no_channel" | "nothing_to_report";
  text: string;
}

/** Yesterday's Eastern day as a [start, end) pair. Snapping twice is DST-safe: 12 hours before
 *  today's ET midnight is firmly inside yesterday whichever way the clocks moved. */
export function yesterdayETRange(now: Date): { start: Date; end: Date } {
  const end = startOfETDay(now);
  const start = startOfETDay(new Date(end.getTime() - 12 * 60 * 60 * 1000));
  return { start, end };
}

/**
 * Inbound email touches in a window that belong to ReachInbox prospects.
 *
 * Touches are read FIRST and the prospects are then fetched by the ids they name. The obvious
 * order -- every reachinbox prospect, then their touches -- grows an `.in()` list with the
 * campaign forever and eventually builds a URL too long to send. A day of replies is bounded by
 * how many people answered.
 */
async function inboundInWindow(
  startISO: string
): Promise<{ touches: OutreachTouchRow[]; prospects: Map<string, OutreachProspectRow> }> {
  const { data: touchRows } = await supabaseAdmin
    .from("outreach_touches")
    .select("id, prospect_id, direction, channel, subject, body, outcome, occurred_at")
    .eq("direction", "inbound")
    .eq("channel", "email")
    .gte("occurred_at", startISO)
    .order("occurred_at", { ascending: true });

  const touches = (touchRows ?? []) as unknown as OutreachTouchRow[];
  const prospects = new Map<string, OutreachProspectRow>();
  if (!touches.length) return { touches: [], prospects };

  const ids = Array.from(new Set(touches.map((t) => t.prospect_id)));
  const { data: prospectRows } = await supabaseAdmin
    .from("outreach_prospects")
    .select(PROSPECT_COLUMNS)
    .in("id", ids)
    .eq("source", "reachinbox");

  for (const p of (prospectRows ?? []) as unknown as OutreachProspectRow[]) prospects.set(p.id, p);
  // Anything whose prospect is not a campaign prospect belongs to the follow-up ladder and is
  // reported by ITS digest, not this one.
  return { touches: touches.filter((t) => prospects.has(t.prospect_id)), prospects };
}

export async function buildCampaignDigest(now = new Date()): Promise<CampaignDigestResult> {
  const { start: yStart, end: yEnd } = yesterdayETRange(now);
  const weekStart = new Date(yEnd.getTime() - WEEK_DAYS * 24 * 60 * 60 * 1000);

  const { touches, prospects } = await inboundInWindow(weekStart.toISOString());

  const inYesterday = (t: OutreachTouchRow) => {
    const at = new Date(t.occurred_at).getTime();
    return at >= yStart.getTime() && at < yEnd.getTime();
  };

  const repliesWeek = touches.filter((t) => t.outcome === "replied");
  const yesterdayReplies = repliesWeek.filter(inYesterday);
  const bouncedYesterday = touches.filter((t) => t.outcome === "bounced" && inYesterday(t)).length;
  const autoRepliesYesterday = touches.filter((t) => t.outcome === "auto_reply" && inYesterday(t)).length;

  let interested = 0;
  let askedPrice = 0;
  let objection = 0;
  let optOut = 0;
  const lines: string[] = [];
  const namedLines: string[] = [];

  for (const t of yesterdayReplies) {
    const c = classifyReply(t.subject ?? null, t.body ?? null);
    if (c.wantsOut || c.state === "CLOSED") optOut++;
    else if (c.state === "ASKED_PRICE_HOT") askedPrice++;
    else if (c.state === "REPLIED_INTERESTED") interested++;
    else objection++;

    const p = prospects.get(t.prospect_id);
    if (!p) continue;
    const link =
      p.slack_channel_id && p.slack_thread_ts
        ? `<${slackThreadLink(p.slack_channel_id, p.slack_thread_ts)}|${displayName(p)}>`
        : displayName(p);
    namedLines.push(`• ${link} — ${p.email}`);
  }

  const { count: newContacts } = await supabaseAdmin
    .from("outreach_prospects")
    .select("id", { count: "exact", head: true })
    .eq("source", "reachinbox")
    .not("contact_id", "is", null)
    .gte("created_at", yStart.toISOString())
    .lt("created_at", yEnd.toISOString());

  const dateKey = etDateKey(yStart);
  const mark = yesterdayReplies.length ? ":envelope_with_arrow:" : ":zzz:";
  lines.push(`${mark} *ReachInbox campaign — ${dateKey}*`);
  lines.push(
    yesterdayReplies.length
      ? `*${yesterdayReplies.length}* ${yesterdayReplies.length === 1 ? "reply" : "replies"} yesterday. ${repliesWeek.length} in the last ${WEEK_DAYS} days.`
      : `No replies yesterday. ${repliesWeek.length} in the last ${WEEK_DAYS} days.`
  );

  if (yesterdayReplies.length) {
    const split = [
      interested ? `${interested} interested` : null,
      askedPrice ? `${askedPrice} asked price` : null,
      objection ? `${objection} needs a read` : null,
      optOut ? `${optOut} opt-out` : null,
    ].filter(Boolean);
    if (split.length) lines.push(split.join(" · "));
  }

  if (bouncedYesterday || autoRepliesYesterday) {
    const noise = [
      bouncedYesterday ? `${bouncedYesterday} bounced` : null,
      autoRepliesYesterday ? `${autoRepliesYesterday} auto-reply` : null,
    ].filter(Boolean);
    lines.push(`Filtered out: ${noise.join(", ")}.`);
  }

  lines.push(`New CRM contacts: ${newContacts ?? 0}.`);
  if (namedLines.length) {
    lines.push("");
    lines.push(...namedLines);
  }

  lines.push("");
  // See the header. This line is the honest substitute for a rate, not a footnote.
  lines.push("_Sends, opens and clicks are not measured here. Read those in the ReachInbox dashboard._");

  const text = lines.join("\n");
  const result: CampaignDigestResult = {
    dateKey,
    repliesYesterday: yesterdayReplies.length,
    repliesWeek: repliesWeek.length,
    bouncedYesterday,
    autoRepliesYesterday,
    newContacts: newContacts ?? 0,
    interested,
    askedPrice,
    objection,
    optOut,
    posted: false,
    text,
  };

  return result;
}

export async function runCampaignDigest(opts?: { dry?: boolean }): Promise<CampaignDigestResult> {
  const report = await buildCampaignDigest();
  if (opts?.dry) return report;

  const channel = campaignChannel();
  if (!channel) {
    console.error("[reachinbox] SLACK_VEKTOR_EMAIL_DIRECTOR_CHANNEL unset; digest not posted");
    return { ...report, skipped: "no_channel" };
  }

  // A silent channel is the goal, so a day with nothing in it says nothing. The card is worth
  // posting when there is something to report and worth withholding when there is not -- a daily
  // "0 replies" card is the pace card this lane replaced.
  if (!report.repliesYesterday && !report.bouncedYesterday && !report.newContacts) {
    return { ...report, skipped: "nothing_to_report" };
  }

  const res = await slack.postMessage(channel, `ReachInbox campaign — ${report.dateKey}`, [
    { type: "section", text: { type: "mrkdwn", text: report.text } } as SlackBlock,
  ]);

  return { ...report, posted: Boolean(res?.ts) };
}
