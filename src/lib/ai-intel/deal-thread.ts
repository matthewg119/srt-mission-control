// Deal-level Slack thread manager.
//
// One Slack thread per deal in #pipeline-new (SLACK_PIPELINE_CHANNEL).
// The first call posts a top-level message with the deal summary; every
// subsequent call posts a thread reply for stage changes, funder replies,
// submission receipts, notes, etc.
//
// Mirrors the pattern in src/lib/lead-thread.ts but keyed on deal rather
// than contact. Never throws — Slack/DB failures must not break upstream
// flows (Zoho webhook handlers, submission sends, etc.).

import { supabaseAdmin } from "@/lib/db";
import { slack, SlackBlock } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";
import { formatCurrency } from "@/lib/utils";

export type DealThreadAction =
  | "created"
  | "stage_change"
  | "submission_sent"
  | "funder_reply"
  | "approved"
  | "declined"
  | "lender_suggestion"
  | "nudge"
  | "note";

interface DealRow {
  id: string;
  contact_id: string | null;
  amount: number | null;
  product_type: string | null;
  source: string | null;
  zoho_stage: string | null;
  stage: string | null;
  slack_thread_ts: string | null;
  slack_channel: string | null;
}

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  phone: string | null;
  industry: string | null;
}

function stableLockKey(dealId: string): number {
  let h = 0;
  for (let i = 0; i < dealId.length; i++) h = (h * 31 + dealId.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function formatParentBlocks(deal: DealRow, contact: ContactRow | null): SlackBlock[] {
  const merchantName = contact?.business_name
    || [contact?.first_name, contact?.last_name].filter(Boolean).join(" ")
    || "New Deal";

  const blocks: SlackBlock[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `💼 ${merchantName}`, emoji: true },
    },
  ];

  const lines: string[] = [];
  if (contact?.first_name || contact?.last_name) {
    lines.push(`*Contact:* ${[contact.first_name, contact.last_name].filter(Boolean).join(" ")}`);
  }
  if (contact?.email) lines.push(`*Email:* ${contact.email}`);
  if (contact?.phone) lines.push(`*Phone:* ${contact.phone}`);
  if (contact?.industry) lines.push(`*Industry:* ${contact.industry}`);
  if (deal.amount) lines.push(`*Amount:* ${formatCurrency(deal.amount)}`);
  if (deal.product_type) lines.push(`*Product:* ${deal.product_type}`);
  if (deal.source) lines.push(`*Source:* ${deal.source}`);
  const stage = deal.zoho_stage || deal.stage;
  if (stage) lines.push(`*Stage:* ${stage}`);

  if (lines.length > 0) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: lines.join("\n") },
    });
  }

  blocks.push({
    type: "context",
    elements: [
      {
        type: "mrkdwn",
        text: `Deal ID: \`${deal.id}\` • <https://mission.srtagency.com/dashboard/deals/${deal.id}|Open in Mission Control>`,
      },
    ],
  });

  return blocks;
}

function iconFor(action: DealThreadAction): string {
  switch (action) {
    case "stage_change": return "📍";
    case "submission_sent": return "📤";
    case "funder_reply": return "📬";
    case "approved": return "🎉";
    case "declined": return "⛔";
    case "lender_suggestion": return "🧭";
    case "nudge": return "⏰";
    case "note": return "📝";
    case "created": return "💼";
    default: return "ℹ️";
  }
}

/**
 * Post (or thread-reply) a Slack update for a deal.
 * Idempotent-ish: first call creates the parent message and saves
 * `slack_thread_ts` + `slack_channel` on the deal row; every subsequent
 * call posts a thread reply. Uses an advisory lock to avoid two concurrent
 * callers both creating a parent message.
 */
export async function postDealThreadUpdate(opts: {
  dealId: string;
  action: DealThreadAction;
  text: string;
  blocks?: SlackBlock[];
  // When set, the update is posted as a top-level message in this channel
  // instead of a thread reply in #pipeline-new. Used for per-deal channels
  // created by ensureDealChannel() once submissions start flowing.
  channelOverride?: string;
}): Promise<void> {
  const { dealId, action, text, blocks: extraBlocks, channelOverride } = opts;
  if (!dealId) return;

  // Per-deal channel route: post a top-level message, don't touch the
  // pipeline thread. Channel is already created + persisted on the deal.
  if (channelOverride) {
    const icon = iconFor(action);
    const headline = `${icon} ${text}`;
    const blocks: SlackBlock[] = extraBlocks && extraBlocks.length > 0
      ? extraBlocks
      : [{ type: "section", text: { type: "mrkdwn", text: headline } }];
    try {
      await slack.postMessage(channelOverride, headline, blocks);
    } catch (err) {
      console.error("[deal-thread] channelOverride postMessage failed:", err);
    }
    return;
  }

  const channel = VEKTOR_CHANNELS.pipeline;
  if (!channel) {
    console.warn("[deal-thread] SLACK_PIPELINE_CHANNEL not set — skipping");
    return;
  }

  const lockKey = stableLockKey(dealId);
  let locked = false;
  try {
    const { data } = await supabaseAdmin.rpc("pg_try_advisory_lock", { key: lockKey });
    locked = data === true || data === 1;
  } catch {
    // RPC unavailable — proceed without lock; optimistic UPDATE guards dup parents.
  }

  try {
    const { data: deal, error } = await supabaseAdmin
      .from("deals")
      .select("id, contact_id, amount, product_type, source, zoho_stage, stage, slack_thread_ts, slack_channel")
      .eq("id", dealId)
      .single();

    if (error || !deal) {
      console.error("[deal-thread] deal not found:", dealId, error?.message);
      return;
    }

    // First touch — post parent message
    if (!deal.slack_thread_ts) {
      let contact: ContactRow | null = null;
      if (deal.contact_id) {
        const { data: c } = await supabaseAdmin
          .from("contacts")
          .select("id, first_name, last_name, business_name, email, phone, industry")
          .eq("id", deal.contact_id)
          .single();
        contact = (c as ContactRow) || null;
      }

      const parentBlocks = formatParentBlocks(deal as DealRow, contact);
      const merchantName = contact?.business_name
        || [contact?.first_name, contact?.last_name].filter(Boolean).join(" ")
        || "New Deal";
      const fallbackText = `💼 ${merchantName} — new deal`;

      let postedTs: string | null = null;
      try {
        const res = (await slack.postMessage(channel, fallbackText, parentBlocks)) as {
          ok?: boolean; ts?: string; channel?: string;
        };
        if (res.ok && res.ts) postedTs = res.ts;
      } catch (err) {
        console.error("[deal-thread] postMessage failed:", err);
      }

      if (!postedTs) return;

      const { data: updated } = await supabaseAdmin
        .from("deals")
        .update({ slack_thread_ts: postedTs, slack_channel: channel })
        .eq("id", dealId)
        .is("slack_thread_ts", null)
        .select("id");

      if (!updated || updated.length === 0) {
        console.warn("[deal-thread] race lost; orphaned parent ts:", postedTs);
      }

      // If the first call is something other than 'created', also drop the
      // triggering event into the new thread so no info is lost.
      if (action !== "created") {
        const icon = iconFor(action);
        const headline = `${icon} ${text}`;
        try {
          await slack.postThreadReply(channel, postedTs, headline, extraBlocks);
        } catch (err) {
          console.error("[deal-thread] first-reply after parent failed:", err);
        }
      }
      return;
    }

    // Subsequent — thread reply
    const icon = iconFor(action);
    const headline = `${icon} ${text}`;

    const replyBlocks: SlackBlock[] = extraBlocks && extraBlocks.length > 0
      ? extraBlocks
      : [{ type: "section", text: { type: "mrkdwn", text: headline } }];

    try {
      await slack.postThreadReply(
        deal.slack_channel || channel,
        deal.slack_thread_ts,
        headline,
        replyBlocks
      );
    } catch (err) {
      console.error("[deal-thread] postThreadReply failed:", err);
    }
  } catch (err) {
    console.error("[deal-thread] unexpected error:", err);
  } finally {
    if (locked) {
      try {
        await supabaseAdmin.rpc("pg_advisory_unlock", { key: lockKey });
      } catch {
        // ignore
      }
    }
  }
}
