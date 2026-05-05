// Outbound SMS sender — called by Slack approval handler and Zoho buttons.
// POST body: { conversationId, body, approvedBy, templateName? }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendSMS } from "@/lib/sms-sender";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { conversationId, body, approvedBy, templateName, aiDraft, matthewApprovedAi } =
    (await req.json()) as {
      conversationId: string;
      body: string;
      approvedBy?: string;
      templateName?: string;
      aiDraft?: string;
      matthewApprovedAi?: boolean;
    };

  if (!conversationId || !body) {
    return NextResponse.json({ error: "missing_conversationId_or_body" }, { status: 400 });
  }

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, close_stage")
    .eq("id", conversationId)
    .maybeSingle();

  if (!conv) {
    return NextResponse.json({ error: "conversation_not_found" }, { status: 404 });
  }

  const result = await sendSMS(conv.phone as string, body, conversationId);

  if (!result.ok) {
    if (result.blocked === "cap_reached") {
      return NextResponse.json({ error: "cap_reached" }, { status: 429 });
    }
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  // Save outbound message
  await supabaseAdmin.from("sms_messages").insert({
    conversation_id: conversationId,
    direction: "outbound",
    body,
    ai_draft: aiDraft ?? null,
    matthew_approved_ai: matthewApprovedAi ?? null,
    close_stage: conv.close_stage,
  });

  // Log to training log when there was an AI draft (learn from every send)
  if (aiDraft !== undefined) {
    await supabaseAdmin.from("sms_training_log").insert({
      conversation_id: conversationId,
      ai_suggestion: aiDraft,
      matthew_version: matthewApprovedAi === false ? body : null,
      matthew_approved_ai: matthewApprovedAi ?? true,
      close_stage: conv.close_stage,
      outcome: "open",
    });
  }

  return NextResponse.json({ ok: true, messageId: result.messageId, provider: result.provider });
}
