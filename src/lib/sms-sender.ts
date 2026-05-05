// Unified SMS sender — Linq primary, enforces 300-message cap per conversation.
// Increments sms_send_count on success and alerts via Slack when approaching limit.

import { linqSendSMS } from "@/lib/linq";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

const CAP_WARN = 295;
const CAP_HARD = 300;

export interface SmsSendResult {
  ok: boolean;
  messageId?: string;
  provider?: "linq";
  error?: string;
  blocked?: "cap_reached";
}

export async function sendSMS(
  phone: string,
  body: string,
  conversationId: string
): Promise<SmsSendResult> {
  // Load current send count
  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, sms_send_count, slack_channel_id, contact_id")
    .eq("id", conversationId)
    .maybeSingle();

  const count = (conv?.sms_send_count as number) ?? 0;
  const channelId = conv?.slack_channel_id as string | null;

  // Hard cap — block send
  if (count >= CAP_HARD) {
    if (channelId) {
      await slack.postMessage(
        channelId,
        `🚫 *300-message cap reached* for this conversation — cannot send more texts. Switch to a new number or archive this conversation.`
      );
    }
    return { ok: false, blocked: "cap_reached", error: "cap_reached" };
  }

  // Approaching cap — warn
  if (count >= CAP_WARN && channelId) {
    await slack.postMessage(
      channelId,
      `⚠️ Approaching 300-message limit (${count} sent). ${CAP_HARD - count} texts remaining on this number.`
    );
  }

  // Send via Linq (primary)
  const result = await linqSendSMS(phone, body);

  if (!result.ok) {
    console.error("[sms-sender] Linq failed:", result.error);
    return { ok: false, error: result.error };
  }

  // Increment count + update last_outbound_at
  await supabaseAdmin
    .from("sms_conversations")
    .update({
      sms_send_count: count + 1,
      last_outbound_at: new Date().toISOString(),
    })
    .eq("id", conversationId);

  return { ok: true, messageId: result.messageId, provider: "linq" };
}
