// 2-minute auto-send sweep.
//
// postImessageSuggestion arms each suggestion card with auto_send_at = now + N min
// and auto_send_status='pending'. This sweep finds drafts whose timer has elapsed
// and, with safety guards, dispatches them via the active transport (Mac outbox by
// default). It runs from two places:
//   - the top of the outbox GET handler (so it fires every ~10s when the Mac polls)
//   - a tiny Vercel cron (src/app/api/cron/sms-autosend) — belt-and-suspenders for
//     when the Mac is mid-restart.
//
// Guards (a stale or unwanted auto-send is worse than a missed one):
//   - conversation outcome 'dead' or 'closed' → skip + mark 'cancelled'.
//   - the lead replied AGAIN after this draft was created (last_inbound_at newer
//     than the draft's created_at) → the draft answers an older message, so it's
//     stale. We cancel it (status 'cancelled') and let the newer inbound's own
//     suggestion card take over. Simplest safe behavior — we never auto-send a
//     reply to a superseded message.

import { supabaseAdmin } from "@/lib/db";
import { slack } from "@/lib/slack-bot";
import { dispatchOutbound, getTransport } from "@/lib/imessage-transport";
import { autoSendMinutes } from "@/lib/imessage-suggestion";
import { normalizePhone } from "@/lib/phone";

interface PendingDraftRow {
  conversation_id: string;
  slack_channel_id: string | null;
  slack_ts: string | null;
  draft_body: string | null;
  created_at: string | null;
}

export async function sweepAutoSends(): Promise<{ sent: number }> {
  const nowIso = new Date().toISOString();

  const { data: due, error } = await supabaseAdmin
    .from("sms_pending_drafts")
    .select("conversation_id, slack_channel_id, slack_ts, draft_body, created_at")
    .eq("auto_send_status", "pending")
    .lte("auto_send_at", nowIso)
    .limit(50);

  if (error) {
    console.error("[imessage-autosend] sweep query failed:", error.message);
    return { sent: 0 };
  }

  let sent = 0;
  for (const row of (due ?? []) as PendingDraftRow[]) {
    try {
      if (!row.conversation_id || !row.draft_body) {
        await setStatus(row.conversation_id, "cancelled");
        continue;
      }

      const { data: conv } = await supabaseAdmin
        .from("sms_conversations")
        .select("id, phone, contact_id, outcome, last_inbound_at")
        .eq("id", row.conversation_id)
        .maybeSingle();

      // Guard: conversation gone, dead, or closed.
      if (!conv?.phone || conv.outcome === "dead" || conv.outcome === "closed") {
        await setStatus(row.conversation_id, "cancelled");
        continue;
      }

      // Guard: the lead replied again after this draft was created — it's stale.
      if (
        conv.last_inbound_at &&
        row.created_at &&
        new Date(conv.last_inbound_at as string).getTime() > new Date(row.created_at).getTime()
      ) {
        await setStatus(row.conversation_id, "cancelled");
        if (row.slack_channel_id && row.slack_ts) {
          await slack.updateMessage(
            row.slack_channel_id,
            row.slack_ts,
            "✋ Auto-send skipped — lead replied again, drafting a fresh reply."
          );
        }
        continue;
      }

      // Claim the row so a concurrent sweep (cron + outbox poll) can't double-send.
      const { data: claimed } = await supabaseAdmin
        .from("sms_pending_drafts")
        .update({ auto_send_status: "sending" })
        .eq("conversation_id", row.conversation_id)
        .eq("auto_send_status", "pending")
        .select("conversation_id")
        .maybeSingle();
      if (!claimed) continue; // another sweep already took it

      const phone = normalizePhone(conv.phone as string) ?? (conv.phone as string);
      const result = await dispatchOutbound({
        conversationId: row.conversation_id,
        contactId: (conv.contact_id as string | null) ?? null,
        phone,
        body: row.draft_body,
        source: "auto_send",
      });

      if (!result.ok) {
        await setStatus(row.conversation_id, "failed");
        if (row.slack_channel_id && row.slack_ts) {
          await slack.postThreadReply(row.slack_channel_id, row.slack_ts, `⚠️ Auto-send failed: ${result.error ?? "unknown"}`);
        }
        continue;
      }

      await setStatus(row.conversation_id, "sent");
      sent++;

      if (row.slack_channel_id && row.slack_ts) {
        const verb = getTransport() === "loopmessage" ? "Auto-sent" : "Auto-send queued (Mac will deliver)";
        await slack.updateMessage(
          row.slack_channel_id,
          row.slack_ts,
          `🤖 ${verb} after ${autoSendMinutes()} min: ${row.draft_body}`
        );
      }
    } catch (e) {
      console.error("[imessage-autosend] row failed:", (e as Error).message);
      try { await setStatus(row.conversation_id, "failed"); } catch { /* ignore */ }
    }
  }

  return { sent };
}

async function setStatus(conversationId: string, status: string): Promise<void> {
  if (!conversationId) return;
  await supabaseAdmin
    .from("sms_pending_drafts")
    .update({ auto_send_status: status })
    .eq("conversation_id", conversationId);
}
