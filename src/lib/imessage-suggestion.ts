// iMessage reply-suggestion card. After an inbound merchant iMessage, we post a
// Vektor-drafted reply into the lead's Slack channel with ✅ Send / 🔄 Regenerate
// / 🎛 Remix / ✋ Hold buttons. ✅ Send delivers the suggested reply via the active
// transport (Mac outbox by default, or LoopMessage) — gated by the explicit human
// click. If no one acts, the draft AUTO-SENDS after ~N minutes (IMESSAGE_AUTOSEND_
// MINUTES, default 2; armed only when IMESSAGE_AUTOSEND_ENABLED is not 'false').
// ✋ Hold cancels that timer. Matthew can still copy the draft and paste it into
// Messages on his Mac; the bridge then mirrors it.
//
// The live suggestion is stored one-per-conversation in sms_pending_drafts so the
// button handlers (src/app/api/slack/actions/route.ts) + the auto-send sweep
// (src/lib/imessage-autosend.ts) can find + update it.

import { slack, type SlackBlock } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";

// Whether the 2-minute auto-send is enabled (default true).
export function autoSendEnabled(): boolean {
  return process.env.IMESSAGE_AUTOSEND_ENABLED !== "false";
}

// How many minutes to wait before auto-sending (default 2).
export function autoSendMinutes(): number {
  const n = parseInt(process.env.IMESSAGE_AUTOSEND_MINUTES || "2", 10);
  return Number.isFinite(n) && n > 0 ? n : 2;
}

// Block Kit for a suggestion. Draft goes in a code block for one-tap copy.
export function buildSuggestionBlocks(draft: string, regenerateCount = 0): SlackBlock[] {
  const mins = autoSendMinutes();
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*💬 Suggested reply* — ✅ Send now, or copy into Messages on your Mac" },
    },
    {
      type: "section",
      text: { type: "mrkdwn", text: "```" + draft + "```" },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          style: "primary",
          text: { type: "plain_text", text: "✅ Send", emoji: true },
          action_id: "imsg_send",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🔄 Regenerate", emoji: true },
          action_id: "imsg_regenerate",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "🎛 Remix", emoji: true },
          action_id: "imsg_remix",
        },
        {
          type: "button",
          text: { type: "plain_text", text: "✋ Hold", emoji: true },
          action_id: "imsg_hold",
        },
      ],
    },
  ];
  if (autoSendEnabled()) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `Auto-sends in ~${mins} min unless you Send, Edit, or Hold.` }],
    } as SlackBlock);
  }
  if (regenerateCount > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `regenerated ${regenerateCount}×` }],
    } as SlackBlock);
  }
  return blocks;
}

// Post a fresh suggestion card and persist it as the live draft for this convo.
// Also arms the auto-send timer (auto_send_at = now + N min) unless disabled.
export async function postImessageSuggestion(args: {
  channelId: string;
  conversationId: string;
  draft: string;
}): Promise<void> {
  const { channelId, conversationId, draft } = args;

  const res = await slack.postMessage(
    channelId,
    `💬 Suggested reply: ${draft}`, // fallback text for notifications
    buildSuggestionBlocks(draft)
  );

  if (res.ok && res.ts) {
    const armed = autoSendEnabled();
    const autoSendAt = armed
      ? new Date(Date.now() + autoSendMinutes() * 60 * 1000).toISOString()
      : null;
    await supabaseAdmin.from("sms_pending_drafts").upsert(
      {
        conversation_id: conversationId,
        slack_channel_id: channelId,
        slack_ts: res.ts as string,
        draft_body: draft,
        regenerate_count: 0,
        created_at: new Date().toISOString(),
        auto_send_at: autoSendAt,
        auto_send_status: armed ? "pending" : "cancelled",
      },
      { onConflict: "conversation_id" }
    );
  }
}

// Matthew replied from his Mac (is_from_me=1 ingested) → the suggestion is moot.
export async function cancelPendingSuggestion(conversationId: string): Promise<void> {
  await supabaseAdmin.from("sms_pending_drafts").delete().eq("conversation_id", conversationId);
}
