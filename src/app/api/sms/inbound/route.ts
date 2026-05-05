// Inbound SMS webhook — handles messages from Linq.
// Linq POSTs to this URL when a message arrives on the virtual number.
// Configure in Linq dashboard → Webhooks → set URL to:
//   https://mission.srtagency.com/api/sms/inbound

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/linq";
import { ensureSmsChannel, postInboundMessage, postAIDraft } from "@/lib/sms-channel";
import { draftSmsReply } from "@/lib/sms-ai-engine";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Linq webhook payload: { from, to, message, id, timestamp }
  const fromRaw = (payload.from ?? payload.sender ?? "") as string;
  const body = (payload.message ?? payload.text ?? payload.body ?? "") as string;

  if (!fromRaw || !body) {
    return NextResponse.json({ error: "missing_from_or_body" }, { status: 400 });
  }

  const phone = normalizePhone(fromRaw);
  if (!phone) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  // Find or create contact
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, zoho_lead_id")
    .eq("phone", phone)
    .maybeSingle();

  // Upsert SMS conversation
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: contact?.id ?? null,
        last_inbound_at: new Date().toISOString(),
      },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select()
    .single();

  if (convErr || !conv) {
    console.error("[sms/inbound] upsert conversation failed:", convErr?.message);
    return NextResponse.json({ error: "db_error" }, { status: 500 });
  }

  // Save inbound message
  await supabaseAdmin.from("sms_messages").insert({
    conversation_id: conv.id,
    direction: "inbound",
    body,
    close_stage: conv.close_stage,
  });

  // Ensure Slack channel exists
  const displayName =
    contact?.business_name ??
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ??
    phone;

  const { channelId } = await ensureSmsChannel({
    conversationId: conv.id,
    phone,
    displayName,
    contactId: contact?.id,
    zohoLeadId: contact?.zoho_lead_id,
  });

  if (!channelId) {
    console.error("[sms/inbound] no Slack channel for conversation", conv.id);
    return NextResponse.json({ ok: true, warning: "no_slack_channel" });
  }

  // Post inbound to Slack
  await postInboundMessage(channelId, displayName, body, conv.id as string);

  // Draft AI reply and post for approval (non-blocking)
  draftSmsReply(conv.id as string, body).then(async (draft) => {
    if (draft) {
      await postAIDraft(channelId, conv.close_stage as number, displayName, draft, conv.id as string);
    }
  }).catch((err) => console.error("[sms/inbound] AI draft failed:", err));

  return NextResponse.json({ ok: true });
}
