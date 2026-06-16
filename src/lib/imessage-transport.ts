// Transport-agnostic outbound iMessage dispatch.
//
// One entry point — dispatchOutbound(...) — that every sender (the ✅ Send card
// in slack/actions, the send_sms AI tool, the 2-minute auto-send sweep, and the
// follow-up runner) calls. The actual transport is chosen by IMESSAGE_TRANSPORT:
//
//   'mac' (default) — queue a pending row in sms_outbox. The Mac bridge polls
//     /api/imessage/outbox, sends via AppleScript, and acks. The bridge's normal
//     is_from_me read loop then mirrors the sent message into Slack + logs the
//     outbound sms_messages row, so we DO NOT insert sms_messages here (it would
//     double-log once the read loop sees the same message).
//
//   'loopmessage' — call LoopMessage's hosted iMessage API directly (24/7, no
//     Mac). LoopMessage has no is_from_me echo, so we log the outbound
//     sms_messages row here (mirrors the old imsg_send behavior).
//
// Never throws — returns { ok:false, error } on any failure.

import { supabaseAdmin } from "@/lib/db";
import { sendImessage } from "@/lib/loopmessage";

export type ImessageTransport = "mac" | "loopmessage";

export function getTransport(): ImessageTransport {
  return process.env.IMESSAGE_TRANSPORT === "loopmessage" ? "loopmessage" : "mac";
}

export interface DispatchOutboundArgs {
  conversationId: string;
  contactId?: string | null;
  phone: string;
  body: string;
  source: "manual_send" | "auto_send" | "followup" | "ai_tool";
}

export interface DispatchOutboundResult {
  ok: boolean;
  queued?: boolean;     // true when the Mac transport enqueued (delivery pending)
  messageId?: string;   // LoopMessage message id when transport === 'loopmessage'
  error?: string;
}

export async function dispatchOutbound(args: DispatchOutboundArgs): Promise<DispatchOutboundResult> {
  const { conversationId, contactId, phone, body, source } = args;

  if (!phone || !body?.trim()) {
    return { ok: false, error: "missing_phone_or_body" };
  }

  const transport = getTransport();

  if (transport === "loopmessage") {
    const send = await sendImessage({ to: phone, text: body });
    if (!send.ok) {
      return { ok: false, error: send.error ?? "loopmessage_send_failed" };
    }
    // LoopMessage has no is_from_me echo — log the outbound here.
    try {
      const { data: conv } = await supabaseAdmin
        .from("sms_conversations")
        .select("close_stage")
        .eq("id", conversationId)
        .maybeSingle();
      await supabaseAdmin.from("sms_messages").insert({
        conversation_id: conversationId,
        direction: "outbound",
        body,
        close_stage: conv?.close_stage ?? null,
        imessage_guid: send.messageId ?? null,
        metadata: { source: `loopmessage_${source}`, message_id: send.messageId ?? null },
      });
      await supabaseAdmin
        .from("sms_conversations")
        .update({ last_outbound_at: new Date().toISOString() })
        .eq("id", conversationId);
    } catch (e) {
      console.error("[imessage-transport] loopmessage log failed:", (e as Error).message);
    }
    return { ok: true, messageId: send.messageId };
  }

  // transport === 'mac' — enqueue for the Mac bridge to send. Do NOT log
  // sms_messages here; the bridge's is_from_me read loop will do that.
  try {
    const { error } = await supabaseAdmin.from("sms_outbox").insert({
      conversation_id: conversationId,
      contact_id: contactId ?? null,
      phone,
      body,
      status: "pending",
      source,
    });
    if (error) {
      console.error("[imessage-transport] outbox insert failed:", error.message);
      return { ok: false, error: error.message };
    }
    return { ok: true, queued: true };
  } catch (e) {
    const error = e instanceof Error ? e.message : "outbox_insert_exception";
    console.error("[imessage-transport] outbox insert exception:", error);
    return { ok: false, error };
  }
}
