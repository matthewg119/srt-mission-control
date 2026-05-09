// Unified SMS sender — LoopMessage iMessage API, enforces 300-message cap per conversation.
// Increments sms_send_count on success and alerts via Slack when approaching limit.

import { loopSendMessage } from "@/lib/loopmessage";
import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";

const CAP_WARN = 295;
const CAP_HARD = 300;

export interface SmsSendResult {
  ok: boolean;
  messageId?: string;
  provider?: "loopmessage";
  error?: string;
  blocked?: "cap_reached";
}

export async function sendSMS(
  phone: string,
  body: string,
  conversationId: string,
  senderName?: string
): Promise<SmsSendResult> {
  // Load current send count + assigned sender
  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, sms_send_count, slack_channel_id, contact_id, assigned_sender")
    .eq("id", conversationId)
    .maybeSingle();

  const count = (conv?.sms_send_count as number) ?? 0;
  const channelId = conv?.slack_channel_id as string | null;
  const resolvedSender = senderName ?? (conv?.assigned_sender as string | null) ?? process.env.LOOP_SENDER_1 ?? "";

  // Hard cap — block send
  if (count >= CAP_HARD) {
    if (channelId) {
      await slack.postMessage(
        channelId,
        `*300-message cap reached* for this conversation — cannot send more texts. Archive this conversation or start a new one.`
      );
    }
    return { ok: false, blocked: "cap_reached", error: "cap_reached" };
  }

  // Approaching cap — warn
  if (count >= CAP_WARN && channelId) {
    await slack.postMessage(
      channelId,
      `Approaching 300-message limit (${count} sent). ${CAP_HARD - count} texts remaining on this number.`
    );
  }

  if (!resolvedSender) {
    console.error("[sms-sender] No sender configured — set LOOP_SENDER_1");
    return { ok: false, error: "no_sender_configured" };
  }

  // Send via LoopMessage
  const result = await loopSendMessage(phone, body, resolvedSender);

  if (!result.ok) {
    console.error("[sms-sender] LoopMessage failed:", result.error);
    return { ok: false, error: result.error };
  }

  // Increment count + update last_outbound_at
  await supabaseAdmin
    .from("sms_conversations")
    .update({
      sms_send_count: count + 1,
      last_outbound_at: new Date().toISOString(),
      assigned_sender: resolvedSender,
    })
    .eq("id", conversationId);

  return { ok: true, messageId: result.messageId, provider: "loopmessage" };
}
