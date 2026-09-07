// The 09:00 ET campaign card in #vektor-email-director.
//
// !! EVERY RATE ON THIS CARD IS GATED ON HAVING MEASURED ITS OWN DENOMINATOR, AND THAT GATE IS THE
// POINT OF THE FILE.
// This card used to print no rates at all, because ReachInbox sends from mailboxes we do not own
// and gated its API behind Tier 4, so the number of emails that went out was unobservable. On
// 2026-09-07 the Slack webhook integration turned out to be open on the PRO free trial, and
// /api/webhooks/reachinbox began capturing `Email Sent`. That is the denominator, and a reply rate
// became computable for the first time.
//
// !! THE TRIAL ENDS 2026-09-15. If it is not renewed the send events stop, `sent` goes to null,
// and this card falls back to counts and says so. It must never divide by a partial send number: a
// rate is exactly the figure a spend decision gets made on, and a half-measured denominator reads
// high and looks fine. Same rule as the audit engine's coverage gate. The gate itself lives in
// reachinbox/stats.ts, where the probe asserts every branch of it offline.
//
// Replies are the UNION of the webhook and the forwarding mailbox, so the reply COUNT survives the
// trial lapsing even though the reply RATE does not.
//
// Yesterday's activity is read from outreach_touches joined to outreach_prospects where
// source = 'reachinbox'. The funnel is one call to the reachinbox_campaign_funnel() function,
// which aggregates in the database because a month of sends is far more rows than PostgREST will
// page into a serverless function.

import { supabaseAdmin } from "@/lib/db";
import { slack, slackThreadLink, type SlackBlock } from "@/lib/slack-bot";
import { startOfETDay, etDateKey } from "./cadence";
import { classifyReply } from "./classify-reply";
import { campaignChannel } from "./campaign-replies";
import { displayName } from "./digest";
import { formatFunnel, sortFunnels, type CampaignFunnel } from "@/lib/reachinbox/stats";
import type { OutreachProspectRow, OutreachTouchRow } from "./types";
import { PROSPECT_COLUMNS } from "./types";

const WEEK_DAYS = 7;
/** The funnel window. Long enough for a booking to follow a send, short enough to describe what
 *  the campaigns are doing now rather than what they did in the spring. */
const FUNNEL_DAYS = 30;

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
  funnels: CampaignFunnel[];
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

/**
 * The per-campaign funnel over the last FUNNEL_DAYS days.
 *
 * !! `sent: 0` FROM SQL BECOMES `sent: null` HERE, AND THAT CONVERSION IS THE WHOLE GATE. Send
 * counts exist only because the webhook reports them, so a campaign with zero send events was
 * never measured rather than measured as zero. A campaign that genuinely sent nothing produces no
 * events and therefore no row at all, so the two cases cannot be confused. null is what makes
 * stats.ts refuse to print a reply rate.
 */
async function fetchFunnels(): Promise<CampaignFunnel[]> {
  const { data, error } = await supabaseAdmin.rpc("reachinbox_campaign_funnel", {
    days: FUNNEL_DAYS,
  });
  if (error) {
    // The card still has yesterday's replies to report, so a missing function or a failed query
    // costs the funnel section and nothing else.
    console.error("[reachinbox] funnel rpc failed:", error.message);
    return [];
  }
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    campaign: String(r.campaign ?? "(unnamed)"),
    sent: Number(r.sent ?? 0) > 0 ? Number(r.sent) : null,
    replied: Number(r.replied ?? 0),
    bounced: Number(r.bounced ?? 0),
    opened: Number(r.opened ?? 0),
    clicked: Number(r.clicked ?? 0),
    booked: Number(r.booked ?? 0),
    closed: Number(r.closed ?? 0),
  }));
}

export async function buildCampaignDigest(now = new Date()): Promise<CampaignDigestResult> {
  const { start: yStart, end: yEnd } = yesterdayETRange(now);
  const weekStart = new Date(yEnd.getTime() - WEEK_DAYS * 24 * 60 * 60 * 1000);

  const { touches, prospects } = await inboundInWindow(weekStart.toISOString());
  const funnels = sortFunnels(await fetchFunnels());

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

  if (funnels.length) {
    lines.push("");
    lines.push(`*Last ${FUNNEL_DAYS} days, by campaign*`);
    for (const f of funnels) {
      const block = formatFunnel(f);
      lines.push("");
      lines.push(block.header);
      for (const l of block.lines) lines.push(`  ${l}`);
    }
    if (funnels.every((f) => f.sent === null)) {
      // The line that tells him the trial lapsed, in the one place he is certain to be looking.
      lines.push("");
      lines.push(
        "_No send events arrived in this window, so there is no reply rate. Check the ReachInbox " +
          "webhook is still on._"
      );
    }
  } else {
    lines.push("");
    lines.push("_No campaign events captured yet. Register the ReachInbox webhook to get rates._");
  }

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
    funnels,
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

  // ‼️ THE SILENCE RULE CHANGED ON 2026-09-07, ON MATTHEW'S EXPLICIT ASK FOR "the daily digest of
  // what we need at the end of each day". It used to withhold any day with no replies, because a
  // daily "0 replies" card was the pace card this lane had just replaced. That reasoning held while
  // the card carried nothing but yesterday. It now carries the standing funnel, which is the thing
  // he actually reads, and a campaign that sent 400 emails and got no answer is a real report
  // rather than noise. So: silent only when there is genuinely nothing, which means no activity
  // yesterday AND no campaign running at all.
  if (
    !report.repliesYesterday &&
    !report.bouncedYesterday &&
    !report.newContacts &&
    !report.funnels.length
  ) {
    return { ...report, skipped: "nothing_to_report" };
  }

  const res = await slack.postMessage(channel, `ReachInbox campaign — ${report.dateKey}`, [
    { type: "section", text: { type: "mrkdwn", text: report.text } } as SlackBlock,
  ]);

  return { ...report, posted: Boolean(res?.ts) };
}
