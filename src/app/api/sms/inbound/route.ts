export const dynamic = "force-dynamic";
// Inbound iMessage webhook — handles messages from LoopMessage.
// LoopMessage POSTs to this URL when a message arrives on any of our sender numbers.
// Configure in LoopMessage dashboard → Webhook URL:
//   https://mission.srtagency.com/api/sms/inbound

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/loopmessage";
import { ensureSmsChannel, postInboundMessage, postAIDraft } from "@/lib/sms-channel";
import { draftSmsReply } from "@/lib/sms-ai-engine";
import { markZohoHotLead } from "@/lib/zoho";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const providedSecret = req.headers.get("loop-secret-key") ?? req.headers.get("Loop-Secret-Key");
  const expected = process.env.LOOP_SECRET_KEY;
  if (expected && providedSecret !== expected) {
    console.warn("[sms/inbound] signature mismatch");
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // LoopMessage webhook payload:
  // { sender: "+1...", text: "...", sender_name: "our-slug", message_id: "...", ... }
  const fromRaw = (payload.sender ?? payload.from ?? "") as string;
  const body = (payload.text ?? payload.message ?? payload.body ?? "") as string;
  const receivedOnSender = (payload.sender_name ?? "") as string;

  if (!fromRaw || !body) {
    return NextResponse.json({ error: "missing_sender_or_body" }, { status: 400 });
  }

  const phone = normalizePhone(fromRaw);
  if (!phone) {
    return NextResponse.json({ error: "invalid_phone" }, { status: 400 });
  }

  // Find existing contact by phone
  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name, zoho_lead_id")
    .eq("phone", phone)
    .maybeSingle();

  // Upsert SMS conversation — preserve assigned_sender if already set
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: contact?.id ?? null,
        last_inbound_at: new Date().toISOString(),
        // Only set assigned_sender if this is the first time we see this phone
        ...(receivedOnSender ? { assigned_sender: receivedOnSender } : {}),
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

  // Update campaign contact status to 'replied' if this phone is in an active campaign
  await supabaseAdmin
    .from("sms_campaign_contacts")
    .update({ status: "replied" })
    .eq("phone", phone)
    .eq("status", "sent");

  // Ensure Slack channel exists. Prefer the lead's name for channel naming
  // (sms-first-last); fall back to business name, then phone.
  const displayName =
    ([contact?.first_name, contact?.last_name].filter(Boolean).join(" ") || null) ??
    contact?.business_name ??
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

  // Post inbound to Slack + post to campaign outreach feed
  await postInboundMessage(channelId, displayName, body, conv.id as string);
  await postCampaignReplyNotification(phone, displayName, channelId);

  // Hot lead: update Zoho + post 🔥 to channel (non-blocking)
  if (contact?.zoho_lead_id) {
    markZohoHotLead(contact.zoho_lead_id as string, body, channelId).catch(
      (e) => console.error("[sms/inbound] hot lead failed:", e)
    );
  }

  // Draft AI reply and post for approval (non-blocking)
  const autoDelay = getAutoSendDelaySecs(new Date(), conv.last_inbound_at as string | null);
  draftSmsReply(conv.id as string, body).then(async (draft) => {
    if (draft) {
      await postAIDraft(channelId, conv.close_stage as number, displayName, draft, conv.id as string, autoDelay);
    }
  }).catch((err) => console.error("[sms/inbound] AI draft failed:", err));

  return NextResponse.json({ ok: true });
}

async function postCampaignReplyNotification(
  phone: string,
  displayName: string,
  perContactChannelId: string
): Promise<void> {
  const outreachChannelId = process.env.SLACK_SMS_OUTREACH_CHANNEL;
  if (!outreachChannelId) return;

  // Only notify if this phone came from a campaign
  const { data: cc } = await supabaseAdmin
    .from("sms_campaign_contacts")
    .select("campaign_id")
    .eq("phone", phone)
    .not("sent_at", "is", null)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!cc) return;

  const { data: campaign } = await supabaseAdmin
    .from("sms_campaigns")
    .select("name, reply_count")
    .eq("id", cc.campaign_id)
    .maybeSingle();

  if (!campaign) return;

  // Bump reply_count on campaign
  await supabaseAdmin
    .from("sms_campaigns")
    .update({ reply_count: ((campaign.reply_count as number) ?? 0) + 1 })
    .eq("id", cc.campaign_id);

  const last4 = phone.replace(/\D/g, "").slice(-4);
  const { slack } = await import("@/lib/slack-bot");
  await slack.postMessage(
    outreachChannelId,
    `Reply from *${displayName}* (${last4}) — <#${perContactChannelId}>`
  );
}

// Returns auto-send delay in seconds based on ET time of day.
// After 9pm: 3 min (180s), or 60s if it's an active back-and-forth.
// After midnight: 5 min (300s), or 60s if active.
// Daytime: always 90s.
function getAutoSendDelaySecs(now: Date, lastInboundAt: string | null): number {
  const etHour = parseInt(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })
      .format(now),
    10
  );

  const isActiveConvo =
    lastInboundAt !== null &&
    now.getTime() - new Date(lastInboundAt).getTime() < 2 * 60 * 1000;

  if (etHour >= 0 && etHour < 6) {
    return isActiveConvo ? 60 : 300;
  }
  if (etHour >= 21) {
    return isActiveConvo ? 60 : 180;
  }
  return 90;
}
