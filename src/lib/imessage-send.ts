// Shared delivery for a pending iMessage suggestion draft. One code path used by
// BOTH the ✅ Send button (src/app/api/slack/actions/route.ts) and the thread-reply
// send path (src/app/api/slack/events/route.ts) so they can never drift.
//
// Loads the live draft for the suggestion card at `slackTs`, sends it via the
// active transport (Mac outbox by default, or LoopMessage), retires the card, and
// schedules any proposed follow-up. All operator-facing Slack messaging (errors +
// the sent/queued confirmation) happens here so callers just await and move on.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { dispatchOutbound } from "@/lib/imessage-transport";
import { autoScheduleFollowupOnSend } from "@/lib/imessage-followups";
import { cancelPendingSuggestion } from "@/lib/imessage-suggestion";
import { normalizePhone } from "@/lib/phone";

export async function deliverPendingDraft(args: {
  slackTs: string;
  channel: string;
  userId: string;
}): Promise<void> {
  const { data: draftRow } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id, draft_body")
    .eq("slack_ts", args.slackTs)
    .maybeSingle();

  if (!draftRow?.conversation_id || !draftRow.draft_body) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No suggestion found to send.");
    return;
  }

  const conversationId = draftRow.conversation_id as string;
  const body = draftRow.draft_body as string;

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, outcome, close_stage")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv?.phone) {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ No phone on this conversation — cannot send.");
    return;
  }
  if (conv.outcome === "dead") {
    await slack.postThreadReply(args.channel, args.slackTs, "⚠️ Conversation is marked dead — not sending.");
    return;
  }

  const phone = normalizePhone(conv.phone as string) ?? (conv.phone as string);
  const result = await dispatchOutbound({
    conversationId,
    contactId: (conv.contact_id as string | null) ?? null,
    phone,
    body,
    source: "manual_send",
  });
  if (!result.ok) {
    await slack.postThreadReply(args.channel, args.slackTs, `⚠️ Send failed: ${result.error ?? "unknown"}`);
    return;
  }

  // Replace the card with a sent confirmation and retire the live suggestion.
  // On the Mac transport delivery is async (the bridge confirms via its read
  // loop), so the card reflects "queued".
  const confirm = result.queued
    ? `📨 Queued by <@${args.userId}> — the Mac will send it: ${body}`
    : `✅ Sent by <@${args.userId}>: ${body}`;
  await slack.updateMessage(args.channel, args.slackTs, confirm);
  // Auto-schedule the proposed follow-up (best-effort) BEFORE retiring the draft,
  // since cancelPendingSuggestion deletes the row we read it from.
  await autoScheduleFollowupOnSend(conversationId);
  await cancelPendingSuggestion(conversationId);
}
