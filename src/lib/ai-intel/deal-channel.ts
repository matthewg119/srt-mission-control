// Per-deal Slack channel lifecycle.
//
// Once Matt sends a deal to its first lender, Vektor opens a dedicated public
// channel `#deal-<slug>-<id>` so all ongoing lender comms, funder replies,
// and status updates land in one place. The #pipeline-new thread continues
// to hold intake + bank-statement analysis and gets a one-line pointer to
// the new channel.
//
// Idempotent: if `deals.slack_deal_channel_id` is already set, the existing
// channel is returned without a second create.
//
// Slack scopes required: channels:manage, channels:write.invites, pins:write.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

export interface EnsureDealChannelResult {
  channelId: string | null;
  channelName: string | null;
  created: boolean;
  error?: string;
}

interface DealContext {
  id: string;
  slack_deal_channel_id: string | null;
  slack_deal_channel_name: string | null;
  amount: number | null;
  zoho_lead_id: string | null;
  business_name: string | null;
  onedrive_folder_url?: string | null;
}

/**
 * Ensure a dedicated Slack channel exists for the deal. Creates it on the
 * first call and returns the existing channel on subsequent calls.
 */
export async function ensureDealChannel(dealId: string): Promise<EnsureDealChannelResult> {
  const { data: deal, error } = await supabaseAdmin
    .from("deals")
    .select("id, amount, zoho_lead_id, slack_deal_channel_id, slack_deal_channel_name, contacts:contact_id(business_name)")
    .eq("id", dealId)
    .single();

  if (error || !deal) {
    return { channelId: null, channelName: null, created: false, error: error?.message ?? "deal_not_found" };
  }

  const row = deal as unknown as {
    id: string;
    amount: number | null;
    zoho_lead_id: string | null;
    slack_deal_channel_id: string | null;
    slack_deal_channel_name: string | null;
    contacts: { business_name: string | null } | null;
  };

  if (row.slack_deal_channel_id) {
    return {
      channelId: row.slack_deal_channel_id,
      channelName: row.slack_deal_channel_name,
      created: false,
    };
  }

  const businessName = row.contacts?.business_name ?? "deal";
  const channelName = buildChannelName(businessName, row.id);

  const createRes = await slack.createChannel(channelName, false);
  if (!createRes.ok || !createRes.id) {
    // name_taken is the most common cause — retry with a fresh random suffix
    // so we never block a send.
    if (createRes.error === "name_taken") {
      const retry = `${channelName}-${Math.random().toString(36).slice(2, 6)}`;
      const retryRes = await slack.createChannel(retry, false);
      if (!retryRes.ok || !retryRes.id) {
        return { channelId: null, channelName: null, created: false, error: retryRes.error ?? "create_failed" };
      }
      createRes.id = retryRes.id;
      createRes.name = retryRes.name;
    } else {
      return { channelId: null, channelName: null, created: false, error: createRes.error ?? "create_failed" };
    }
  }

  const channelId = createRes.id as string;
  const finalName = createRes.name ?? channelName;

  const matthewUserId = process.env.MATTHEW_SLACK_USER_ID ?? "";
  if (matthewUserId) {
    try {
      await slack.inviteToChannel(channelId, matthewUserId);
    } catch (e) {
      console.warn("[deal-channel] invite failed:", (e as Error).message);
    }
  }

  const welcome = buildWelcomeMessage({
    id: row.id,
    slack_deal_channel_id: channelId,
    slack_deal_channel_name: finalName,
    amount: row.amount,
    zoho_lead_id: row.zoho_lead_id,
    business_name: businessName,
  });

  try {
    const posted = (await slack.postMessage(channelId, welcome.text, welcome.blocks)) as {
      ok?: boolean; ts?: string;
    };
    if (posted.ok && posted.ts) {
      try {
        await slack.pinMessage(channelId, posted.ts);
      } catch (e) {
        console.warn("[deal-channel] pin failed:", (e as Error).message);
      }
    }
  } catch (e) {
    console.warn("[deal-channel] welcome post failed:", (e as Error).message);
  }

  await supabaseAdmin
    .from("deals")
    .update({ slack_deal_channel_id: channelId, slack_deal_channel_name: finalName })
    .eq("id", row.id);

  return { channelId, channelName: finalName, created: true };
}

export function buildChannelName(businessName: string, dealId: string): string {
  const slug = slugifyBusinessName(businessName);
  const suffix = dealId.replace(/-/g, "").slice(-6).toLowerCase() || "deal";
  // Slack channel names: lowercase, 1-80 chars, a-z 0-9 - _
  // Leave room for `deal-` (5) and `-suffix` (7).
  const max = 80 - 5 - 7;
  const clipped = slug.slice(0, max) || "deal";
  return `deal-${clipped}-${suffix}`;
}

function slugifyBusinessName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function buildWelcomeMessage(deal: DealContext): { text: string; blocks: import("@/lib/slack-bot").SlackBlock[] } {
  const amount = deal.amount ? `$${Number(deal.amount).toLocaleString()}` : "—";
  const zohoLink = deal.zoho_lead_id
    ? `<https://crm.zoho.com/crm/org/_/tab/Leads/${deal.zoho_lead_id}|Open in Zoho>`
    : "_no Zoho lead linked_";
  const onedriveLink = deal.onedrive_folder_url
    ? `<${deal.onedrive_folder_url}|OneDrive folder>`
    : "_no OneDrive folder_";
  const mcLink = `<https://mission.srtagency.com/dashboard/deals/${deal.id}|Open in Mission Control>`;

  const text = `💼 ${deal.business_name ?? "Deal"} — lender comms channel`;

  return {
    text,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `💼 ${deal.business_name ?? "Deal"}`, emoji: true },
      },
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Amount requested:* ${amount}\n*Zoho:* ${zohoLink}\n*OneDrive:* ${onedriveLink}\n*Mission Control:* ${mcLink}`,
        },
      },
      {
        type: "context",
        elements: [
          { type: "mrkdwn", text: "All lender submissions, funder replies, and status updates for this deal post here." },
        ],
      },
    ],
  };
}
