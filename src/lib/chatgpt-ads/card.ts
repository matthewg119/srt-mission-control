// The three #hot-leads cards for /chatgpt-ads.
//
// SLACK IS THE DASHBOARD. That was an explicit instruction and it is the reason these cards
// carry every answer rather than a link to go and read them: there is no admin screen for the
// callback queue and none is wanted, so whatever is not in the message does not exist when the
// phone needs picking up.
//
// ‼️ BOT API, NOT AN INCOMING WEBHOOK. The spec asked for SLACK_HOT_LEADS_WEBHOOK. There are
// no incoming webhooks anywhere in this repo, and more to the point a webhook cannot post the
// 60-second follow-up into the thread of the message it is following up on. That threading is
// the whole design of Template A. src/lib/slack-bot.ts already holds the token.
//
// ‼️ THE RED BANNER IS AN EMOJI BAND, NOT AN ATTACHMENT COLOR. Block Kit has no coloured
// block; the colour bar is a property of the legacy `attachments` array, which slack.postMessage
// does not take. Rather than widen that helper for one card, the banner is a row of red squares,
// which renders identically on desktop, mobile and in a notification preview. It is not a
// downgrade dressed up: attachment colours are invisible in the mobile notification, which is
// the surface this alert exists for.

import type { SlackBlock } from "@/lib/slack-bot";
import { labelFor } from "@/config/chatgpt-ads";
import { accessFlag, flagEmoji, type ChatgptAdsLeadRow } from "./lead";
import { formatPhoneUS } from "@/lib/clients/normalize";
import { PROMPT_SAMPLE } from "./params";

function section(text: string): SlackBlock {
  return { type: "section", text: { type: "mrkdwn", text } };
}

function header(text: string): SlackBlock {
  return { type: "header", text: { type: "plain_text", text, emoji: true } };
}

function context(text: string): SlackBlock {
  return { type: "context", elements: [{ type: "mrkdwn", text }] };
}

/** Slack renders tel: links as a tap-to-dial on mobile, which is the point of this card. */
function telLink(phone: string | null): string {
  if (!phone) return "no phone given";
  return `<tel:${phone}|${formatPhoneUS(phone) || phone}>`;
}

function orDash(v: string | null | undefined): string {
  return v && v.trim() ? v : "not given";
}

/**
 * The lead card body, identical across all three templates.
 *
 * Slack `fields` render two per row and truncate hard, so the long free-text answers
 * (channels, the competitor gap) get their own full-width section underneath rather than a
 * field they would be cut off inside.
 */
function leadFields(row: ChatgptAdsLeadRow): SlackBlock[] {
  const gbp = accessFlag(row.gbp_access);
  const web = accessFlag(row.website_access);
  const hostLine = row.website_host ? ` (${row.website_host})` : "";

  const fields = [
    `*Business:*\n${orDash(row.business_name)}`,
    `*Phone:*\n${telLink(row.phone)}`,
    `*Email:*\n${orDash(row.email)}`,
    `*Website:*\n${orDash(row.website)}`,
    `*City:*\n${orDash(row.city)}`,
    `*Revenue:*\n${row.revenue ? labelFor("revenue", row.revenue) : "not given"}`,
    `*New patients / mo:*\n${row.patient_volume ? labelFor("patient_volume", row.patient_volume) : "not given"}`,
    `*Wants to fill:*\n${row.one_service ? labelFor("one_service", row.one_service) : "not given"}`,
    `*Google profile:*\n${flagEmoji(gbp)} ${row.gbp_access ? labelFor("gbp_access", row.gbp_access) : "not given"}`,
    `*Website access:*\n${flagEmoji(web)} ${row.website_access ? labelFor("website_access", row.website_access) : "not given"}${hostLine}`,
  ];

  const blocks: SlackBlock[] = [
    { type: "section", fields: fields.map((text) => ({ type: "mrkdwn", text })) },
  ];

  const channels = (row.channels ?? []).map((c) => labelFor("channels", c)).join(", ");
  if (channels) blocks.push(context(`*Comes from:* ${channels}`));

  // The gap line is the single most useful sentence on the call, so it gets its own row.
  if (row.ai_visibility_score !== null || row.competitor_name) {
    const parts: string[] = [];
    if (row.ai_visibility_score !== null) parts.push(`Score *${row.ai_visibility_score}/100*`);
    if (row.user_showed_count !== null) {
      parts.push(`showed up in *${row.user_showed_count}/${PROMPT_SAMPLE}* answers`);
    }
    if (row.competitor_name) {
      const comp =
        row.comp_showed_count !== null
          ? `*${row.competitor_name}* in *${row.comp_showed_count}/${PROMPT_SAMPLE}*`
          : `*${row.competitor_name}*`;
      parts.push(`beaten by ${comp}`);
    }
    blocks.push(section(parts.join(", ") + "."));
  }

  if (row.report_slug) blocks.push(context(`Report: \`/r/${row.report_slug}\``));

  return blocks;
}

// ---------------------------------------------------------------------------
// Template A, CALL ME NOW
// ---------------------------------------------------------------------------

export const CALL_SLA_MINUTES = 5;

export function callMeNowCard(row: ChatgptAdsLeadRow): { text: string; blocks: SlackBlock[] } {
  const who = row.business_name || row.email;
  return {
    // The fallback text is what a phone notification actually shows, so it carries the
    // business and the number rather than repeating the header.
    text: `<!channel> CALL ME NOW: ${who}, ${row.phone ?? "no phone"}. Call within ${CALL_SLA_MINUTES} minutes.`,
    blocks: [
      header("\u{1F6A8}\u{1F6A8} CALL ME NOW REQUEST \u{1F6A8}\u{1F6A8}"),
      section("\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}\u{1F7E5}"),
      section(`<!channel> *${who} asked to be called right now.*`),
      section(`\u{1F4DE} *Tap to call:* ${telLink(row.phone)}`),
      ...leadFields(row),
      section(`*SLA: Call within ${CALL_SLA_MINUTES} minutes.*`),
      context("They are watching a countdown on screen. It runs out in 60 seconds."),
    ],
  };
}

export function fallbackReply(row: ChatgptAdsLeadRow): string {
  const who = row.business_name || row.email;
  return (
    `\u{23F1}\u{FE0F} ${who} has been on the fallback screen for 60s, call them NOW if you haven't. ` +
    `${telLink(row.phone)}`
  );
}

// ---------------------------------------------------------------------------
// Template B, BOOKED
// ---------------------------------------------------------------------------

export function bookedCard(
  row: ChatgptAdsLeadRow,
  opts: { when: string | null; joinUrl: string | null; rescheduleUrl: string | null; emailed: boolean }
): { text: string; blocks: SlackBlock[] } {
  const who = row.business_name || row.email;
  const blocks: SlackBlock[] = [
    header(`\u{1F525} Booked: ${who}`),
    section("\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}\u{1F7E9}"),
    section(`\u{1F4C5} *${opts.when ?? "Time not returned by Calendly"}*`),
    ...leadFields(row),
  ];

  const links: string[] = [];
  if (opts.joinUrl) links.push(`<${opts.joinUrl}|Join link>`);
  if (opts.rescheduleUrl) links.push(`<${opts.rescheduleUrl}|Reschedule>`);
  if (links.length) blocks.push(context(links.join("  |  ")));

  // Say plainly what the lead has and has not received, so nobody double-sends or assumes a
  // confirmation went out that did not. There is no SMS on this funnel at all.
  blocks.push(
    context(
      opts.emailed
        ? "Confirmation email sent from matthew@srtagency.com. Calendly sends its own invite. No SMS on this funnel."
        : "Calendly sends the invite. Our confirmation email did NOT send, check the Microsoft connection. No SMS on this funnel."
    )
  );

  return { text: `Booked: ${who}, ${opts.when ?? "time unknown"}`, blocks };
}

// ---------------------------------------------------------------------------
// Template C, SELF INTAKE
//
// No @channel. Nobody has to do anything in the next five minutes, and an alert that pings
// the team for something that is not urgent is how the ones that are urgent stop being read.
// ---------------------------------------------------------------------------

export function selfIntakeCard(
  row: ChatgptAdsLeadRow,
  opts: { handoffUrl: string | null; emailed: boolean }
): { text: string; blocks: SlackBlock[] } {
  const who = row.business_name || row.email;
  const blocks: SlackBlock[] = [
    header(`\u{1F4DD} Self setup: ${who}`),
    ...leadFields(row),
  ];

  blocks.push(
    section(
      opts.handoffUrl
        ? `*Mission Control handoff:* <${opts.handoffUrl}|open their setup>`
        : "*Mission Control handoff:* could not be minted, CLIENT_LINK_SECRET is not set."
    )
  );
  blocks.push(
    context(
      `Matthew to follow up manually, email only, no auto-SMS.${
        opts.emailed ? "" : " The handoff email did NOT send, check the Microsoft connection."
      }`
    )
  );

  return { text: `Self setup: ${who}`, blocks };
}

// ---------------------------------------------------------------------------
// The under $10k wedge
//
// Not one of the three templates in the spec, and it still needs to land somewhere: these
// people booked a free review setup and somebody has to run it. Quiet, no @channel.
// ---------------------------------------------------------------------------

export function wedgeCard(row: ChatgptAdsLeadRow): { text: string; blocks: SlackBlock[] } {
  const who = row.business_name || row.email;
  return {
    text: `Review wedge: ${who}`,
    blocks: [
      header(`\u{1F331} Review wedge: ${who}`),
      section("Under $10k a month. Offered the free review management setup, not the build."),
      ...leadFields(row),
    ],
  };
}
