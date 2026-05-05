// Per-contact Slack channel manager for SMS conversations.
// Channel naming: sms-{firstname}-{last4} (renamed to sms-{biz}-{firstname}-{last4} after app received)

import { slack } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";

interface EnsureChannelArgs {
  conversationId: string;
  phone: string;
  displayName: string;
  contactId?: string | null;
  zohoLeadId?: string | null;
  businessName?: string | null;
}

interface EnsureChannelResult {
  channelId: string | null;
  channelName: string | null;
  created: boolean;
}

export async function ensureSmsChannel(args: EnsureChannelArgs): Promise<EnsureChannelResult> {
  const { conversationId, phone, displayName, contactId, zohoLeadId, businessName } = args;

  // Check if channel already exists for this conversation
  const { data: existing } = await supabaseAdmin
    .from("sms_conversations")
    .select("slack_channel_id, slack_channel_name")
    .eq("id", conversationId)
    .maybeSingle();

  if (existing?.slack_channel_id) {
    return { channelId: existing.slack_channel_id, channelName: existing.slack_channel_name, created: false };
  }

  // Build channel name
  const channelName = buildChannelName(phone, displayName, businessName ?? null);

  // Create the Slack channel
  const created = await slack.createChannel(channelName);
  if (!created.ok || !created.id) {
    // If name_taken, try with random suffix
    const fallback = `${channelName}-${Math.random().toString(36).slice(2, 5)}`;
    const retry = await slack.createChannel(fallback);
    if (!retry.ok || !retry.id) {
      console.error("[sms-channel] channel creation failed:", created.error);
      return { channelId: null, channelName: null, created: false };
    }
    return setupChannel({ conversationId, channelId: retry.id!, channelName: retry.name!, phone, displayName, contactId, zohoLeadId });
  }

  return setupChannel({ conversationId, channelId: created.id!, channelName: created.name!, phone, displayName, contactId, zohoLeadId });
}

async function setupChannel(args: {
  conversationId: string;
  channelId: string;
  channelName: string;
  phone: string;
  displayName: string;
  contactId?: string | null;
  zohoLeadId?: string | null;
}): Promise<EnsureChannelResult> {
  const { conversationId, channelId, channelName, phone, displayName, contactId, zohoLeadId } = args;

  // Invite Matthew
  const matthewId = process.env.MATTHEW_SLACK_USER_ID;
  if (matthewId) {
    await slack.inviteToChannel(channelId, matthewId);
  }

  // Post lead info card
  const zohoUrl = zohoLeadId
    ? `https://crm.zoho.com/crm/org/leads/view/${zohoLeadId}`
    : null;
  const portalUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com"}/dashboard/pipeline`;

  const cardText = [
    `📱 *New SMS Conversation — ${displayName}*`,
    ``,
    `*Phone:* ${phone}`,
    contactId ? `*Contact ID:* ${contactId}` : null,
    zohoUrl ? `*Zoho:* <${zohoUrl}|Open in Zoho>` : null,
    `*Portal:* <${portalUrl}|Mission Control>`,
    ``,
    `_Stage 1: Soft Pitch — qualify, build rapport, request application._`,
    `React ✅ to an AI draft to send it · type in thread to write your own`,
  ]
    .filter(Boolean)
    .join("\n");

  const pinRes = await slack.postMessage(channelId, cardText);
  if (pinRes.ok && pinRes.ts) {
    await slack.pinMessage(channelId, pinRes.ts as string);
  }

  // Save channel to DB
  await supabaseAdmin
    .from("sms_conversations")
    .update({ slack_channel_id: channelId, slack_channel_name: channelName })
    .eq("id", conversationId);

  return { channelId, channelName, created: true };
}

export async function postInboundMessage(
  channelId: string,
  merchantName: string,
  body: string,
  conversationId: string
): Promise<void> {
  // Save the last message ts so approval handler can find it
  const res = await slack.postMessage(
    channelId,
    `*[INCOMING]* ${merchantName}: "${body}"`
  );

  // Store the pending draft ts for the conversation
  if (res.ok && res.ts) {
    await supabaseAdmin
      .from("sms_conversations")
      .update({ last_inbound_slack_ts: res.ts as string })
      .eq("slack_channel_id", channelId);
  }
}

export async function postAIDraft(
  channelId: string,
  closeStage: number,
  merchantName: string,
  draft: string,
  conversationId: string
): Promise<string | null> {
  const stageLabel = ["", "Soft Pitch", "Wisdom Window", "UW Drama", "Close"][closeStage] ?? "Stage " + closeStage;

  const text = [
    `*[AI DRAFT — Stage ${closeStage}: ${stageLabel}]*`,
    `"${draft}"`,
    ``,
    `React ✅ to send · Or type your version below and I'll refine it`,
  ].join("\n");

  const res = await slack.postMessage(channelId, text);

  if (res.ok && res.ts) {
    // Save pending draft so ✅ reaction handler knows what to send
    await supabaseAdmin.from("sms_pending_drafts").upsert(
      {
        conversation_id: conversationId,
        slack_channel_id: channelId,
        slack_ts: res.ts as string,
        draft_body: draft,
        close_stage: closeStage,
        created_at: new Date().toISOString(),
      },
      { onConflict: "conversation_id" }
    );
    return res.ts as string;
  }

  return null;
}

export async function renameSmsChannel(
  channelId: string,
  conversationId: string,
  phone: string,
  displayName: string,
  businessName: string
): Promise<void> {
  const newName = buildChannelName(phone, displayName, businessName);
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) return;

  await fetch("https://slack.com/api/conversations.rename", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelId, name: newName }),
  });

  await supabaseAdmin
    .from("sms_conversations")
    .update({ slack_channel_name: newName })
    .eq("id", conversationId);
}

function buildChannelName(phone: string, displayName: string, businessName: string | null): string {
  const last4 = phone.replace(/\D/g, "").slice(-4);
  const firstName = displayName.split(" ")[0];

  const parts = businessName
    ? [businessName, firstName, last4]
    : [firstName, last4];

  return "sms-" + parts
    .map((p) =>
      p.toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
    )
    .join("-")
    .slice(0, 75); // Slack channel names max 80 chars
}
