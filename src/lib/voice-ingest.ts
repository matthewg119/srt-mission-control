// Continuous voice learning — append Matthew's real approved/sent replies to the
// voice_examples corpus so the bot keeps learning from live conversations (not just
// the one-time iMessage history import).
//
// Idempotent via voice_examples.source_message_id (one voice row per sms_messages id).
// Always best-effort: never throw into the caller, never block message handling.

import { supabaseAdmin } from "@/lib/db";
import { resolveTenantId } from "@/lib/persona";

const REACTION_RE = /^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked) ".*"$/;

function usable(incoming: string, reply: string): boolean {
  if (!incoming.trim() || reply.trim().length < 2) return false;
  if (REACTION_RE.test(reply) || REACTION_RE.test(incoming)) return false;
  return true;
}

/**
 * Pair an outbound (human) reply with the inbound it answered and store it as a
 * voice example. Looks up the most recent inbound in the conversation that arrived
 * before this outbound.
 *
 * Called from two places that must not double-insert:
 *   - send time (no outboundMessageId yet) — captures the exact text the human sent
 *     and the inbound it was replying to, immediately.
 *   - echo time (is_from_me=1 ingest, with outboundMessageId) — the fallback for
 *     messages sent outside TextWin (e.g. from the phone).
 * A content-level guard (same tenant + incoming + reply) makes whichever runs first
 * win and the second a no-op.
 */
export async function appendApprovedReplyToVoice(opts: {
  conversationId: string;
  outboundMessageId?: string;
  reply: string;
  stage?: number | null;
  origin?: string;
}): Promise<void> {
  try {
    const reply = opts.reply.trim();
    if (!reply) return;

    const tenantId = await resolveTenantId();
    if (!tenantId) return;

    // Most recent inbound in this conversation (the message being replied to).
    const { data: inbound } = await supabaseAdmin
      .from("sms_messages")
      .select("body, sent_at")
      .eq("conversation_id", opts.conversationId)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const incoming = (inbound?.body as string | undefined)?.trim();
    if (!incoming || !usable(incoming, reply)) return;

    // Content-level dedupe: skip if this exact (incoming -> reply) pair is already
    // stored. Covers the send-time vs echo-time race (different source_message_id,
    // identical content) so we never train on the same reply twice.
    const { data: dup } = await supabaseAdmin
      .from("voice_examples")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("incoming", incoming)
      .eq("reply", reply)
      .limit(1)
      .maybeSingle();
    if (dup) return;

    // Insert; ignore the unique-violation when this message was already ingested.
    const { error } = await supabaseAdmin.from("voice_examples").insert({
      tenant_id: tenantId,
      source: "sms_messages",
      incoming,
      reply,
      char_len: reply.length,
      stage: opts.stage ?? null,
      source_message_id: opts.outboundMessageId ?? null,
      metadata: { origin: opts.origin ?? "live_reply" },
    });
    if (error && !/duplicate key|unique/i.test(error.message)) {
      console.error("[voice-ingest] insert error:", error.message);
    }
  } catch (err) {
    console.error("[voice-ingest] appendApprovedReplyToVoice error:", err);
  }
}
