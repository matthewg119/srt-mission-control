// iMessage reply-suggestion card. After an inbound merchant iMessage, we post a
// Vektor-drafted reply into the lead's Slack channel with ✅ Send / 🔄 Regenerate
// / 🎛 Remix buttons. With the LoopMessage transport live, ✅ Send delivers the
// suggested reply directly via LoopMessage (24/7, no Mac) — gated by the explicit
// human click (Vektor never auto-sends). Matthew can still copy the draft and
// paste it into Messages on his Mac if he prefers; the bridge then mirrors it.
//
// The live suggestion is stored one-per-conversation in sms_pending_drafts so the
// button handlers (src/app/api/slack/actions/route.ts) can find + update it.

import { slack, type SlackBlock } from "@/lib/slack-bot";
import { supabaseAdmin } from "@/lib/db";

// Block Kit for a suggestion. Draft goes in a code block for one-tap copy.
export function buildSuggestionBlocks(draft: string, regenerateCount = 0): SlackBlock[] {
  const blocks: SlackBlock[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*💬 Suggested reply* — ✅ Send via LoopMessage, or copy into Messages on your Mac" },
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
      ],
    },
  ];
  if (regenerateCount > 0) {
    blocks.push({
      type: "context",
      elements: [{ type: "mrkdwn", text: `regenerated ${regenerateCount}×` }],
    } as SlackBlock);
  }
  return blocks;
}

// Post a fresh suggestion card and persist it as the live draft for this convo.
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
    await supabaseAdmin.from("sms_pending_drafts").upsert(
      {
        conversation_id: conversationId,
        slack_channel_id: channelId,
        slack_ts: res.ts as string,
        draft_body: draft,
        regenerate_count: 0,
      },
      { onConflict: "conversation_id" }
    );
  }
}

// Matthew replied from his Mac (is_from_me=1 ingested) → the suggestion is moot.
export async function cancelPendingSuggestion(conversationId: string): Promise<void> {
  await supabaseAdmin.from("sms_pending_drafts").delete().eq("conversation_id", conversationId);
}
