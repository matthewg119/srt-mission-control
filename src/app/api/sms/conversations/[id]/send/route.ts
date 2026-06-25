export const dynamic = "force-dynamic";
// Manual send — actually delivers a reply to the lead from the SalesTwin 3.0
// Real mode composer. Mirrors the proven send path in slack/actions sendSuggestion
// and the send_sms AI tool: dispatchOutbound(source: "manual_send"), the
// outcome === 'dead' guard, and normalizePhone with raw fallback.
//
// Under IMESSAGE_TRANSPORT=mac this queues to sms_outbox and returns { queued:true };
// the Mac bridge sends it and its is_from_me echo logs the outbound sms_messages row
// a few seconds later (so the UI shows an optimistic bubble and polling replaces it).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/db";
import { dispatchOutbound } from "@/lib/imessage-transport";
import { normalizePhone } from "@/lib/phone";
import { appendApprovedReplyToVoice } from "@/lib/voice-ingest";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { id } = await params;

  const parsed = await req.json().catch(() => null);
  const body = (parsed?.body as string | undefined)?.trim();
  if (!body) return NextResponse.json({ error: "body required" }, { status: 400 });

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, outcome")
    .eq("id", id)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!conv.phone) return NextResponse.json({ error: "no phone on this conversation" }, { status: 400 });
  if (conv.outcome === "dead") {
    return NextResponse.json({ error: "Conversation is marked dead. Not sending." }, { status: 400 });
  }

  const phone = normalizePhone(conv.phone as string) ?? (conv.phone as string);
  const result = await dispatchOutbound({
    conversationId: id,
    contactId: (conv.contact_id as string | null) ?? null,
    phone,
    body,
    source: "manual_send",
  });

  if (!result.ok) {
    return NextResponse.json({ error: result.error ?? "send failed" }, { status: 500 });
  }

  // Train the voice model on exactly what the human sent (paired with the inbound it
  // answered). Fire-and-forget; content-deduped against the later is_from_me echo.
  void appendApprovedReplyToVoice({ conversationId: id, reply: body, origin: "live_send" });

  return NextResponse.json({
    ok: true,
    queued: result.queued ?? false,
    messageId: result.messageId ?? null,
  });
}
