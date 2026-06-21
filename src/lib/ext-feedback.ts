// TextWin Train loop — record in-bubble feedback.
//
// Every approve / edit / thumbs-down is logged to ext_feedback for observability.
// The POSITIVE signals (approve, edit) are also appended to voice_examples — the
// same corpus matchVoiceExamples() retrieves — so a correction made in the bubble
// improves the live model immediately. On an edit, the human-corrected text is the
// training target (reply), and the original AI suggestion is kept in metadata.
// Thumbs-down is logged only; it never adds a positive voice example.
//
// Always best-effort: never throws into the caller.

import { supabaseAdmin } from "@/lib/db";

export type ExtFeedbackKind = "approve" | "edit" | "thumbs_down";

export interface RecordExtFeedbackArgs {
  tenantId: string;
  conversationId: string;
  kind: ExtFeedbackKind;
  finalBody?: string | null; // what was actually sent (approve = AI text, edit = human text)
  aiSuggestion?: string | null; // the original AI suggestion
  inbound?: string | null; // the message being replied to; looked up if omitted
}

const REACTION_RE = /^(Liked|Loved|Laughed at|Emphasized|Questioned|Disliked) ".*"$/;

async function lastInbound(conversationId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from("sms_messages")
    .select("body")
    .eq("conversation_id", conversationId)
    .eq("direction", "inbound")
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.body as string | undefined)?.trim() ?? null;
}

export async function recordExtFeedback(args: RecordExtFeedbackArgs): Promise<void> {
  const { tenantId, conversationId, kind } = args;
  const reply = (args.finalBody ?? "").trim();
  const incoming = (args.inbound ?? (await lastInbound(conversationId)) ?? "").trim();

  // 1) Always log the event (best-effort).
  try {
    await supabaseAdmin.from("ext_feedback").insert({
      tenant_id: tenantId,
      conversation_id: conversationId,
      kind,
      inbound: incoming || null,
      ai_suggestion: args.aiSuggestion ?? null,
      final_body: reply || null,
    });
  } catch (e) {
    console.error("[ext-feedback] event log failed:", (e as Error).message);
  }

  if (kind === "thumbs_down") return;

  // 2) Positive signal -> voice example. Skip junk / iMessage reaction strings.
  if (!incoming || reply.length < 2) return;
  if (REACTION_RE.test(incoming) || REACTION_RE.test(reply)) return;

  try {
    const { error } = await supabaseAdmin.from("voice_examples").insert({
      tenant_id: tenantId,
      source: "textwin_ext",
      incoming,
      reply,
      char_len: reply.length,
      metadata: {
        origin: kind === "edit" ? "textwin_edit" : "textwin_approve",
        ai_suggestion: args.aiSuggestion ?? null,
      },
    });
    if (error && !/duplicate key|unique/i.test(error.message)) {
      console.error("[ext-feedback] voice insert failed:", error.message);
    }
  } catch (e) {
    console.error("[ext-feedback] voice insert exception:", (e as Error).message);
  }
}
