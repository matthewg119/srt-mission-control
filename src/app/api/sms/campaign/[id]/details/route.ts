export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { createCampaign } from "@/lib/sms-campaign";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: campaign } = await supabaseAdmin
    .from("sms_campaigns")
    .select("id, name, status, total_contacts, sent_count, reply_count, daily_limit, spacing_minutes, created_at, started_at, completed_at, slack_campaign_ts")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Replied contacts with last inbound message preview
  const { data: repliedContacts } = await supabaseAdmin
    .from("sms_campaign_contacts")
    .select("id, phone, first_name, business_name, sent_at, conversation_id")
    .eq("campaign_id", id)
    .eq("status", "replied");

  const replied = await Promise.all(
    (repliedContacts ?? []).map(async (cc) => {
      let replyPreview: string | null = null;
      let replyAt: string | null = null;
      let slackChannelId: string | null = null;

      if (cc.conversation_id) {
        const { data: lastMsg } = await supabaseAdmin
          .from("sms_messages")
          .select("body, created_at")
          .eq("conversation_id", cc.conversation_id)
          .eq("direction", "inbound")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        replyPreview = lastMsg ? (lastMsg.body as string).slice(0, 120) : null;
        replyAt = lastMsg ? (lastMsg.created_at as string) : null;

        const { data: conv } = await supabaseAdmin
          .from("sms_conversations")
          .select("slack_channel_id")
          .eq("id", cc.conversation_id)
          .maybeSingle();
        slackChannelId = conv?.slack_channel_id as string | null;
      }

      return {
        id: cc.id,
        phone: cc.phone,
        first_name: cc.first_name,
        business_name: cc.business_name,
        sent_at: cc.sent_at,
        conversation_id: cc.conversation_id,
        reply_preview: replyPreview,
        reply_at: replyAt,
        slack_channel_id: slackChannelId,
      };
    })
  );

  // No-reply contacts: status=sent with no inbound message
  const { data: sentContacts } = await supabaseAdmin
    .from("sms_campaign_contacts")
    .select("id, phone, first_name, business_name, sent_at, conversation_id")
    .eq("campaign_id", id)
    .eq("status", "sent");

  const noReply = await Promise.all(
    (sentContacts ?? []).map(async (cc) => {
      let hasReply = false;
      if (cc.conversation_id) {
        const { data: inbound } = await supabaseAdmin
          .from("sms_messages")
          .select("id")
          .eq("conversation_id", cc.conversation_id)
          .eq("direction", "inbound")
          .limit(1)
          .maybeSingle();
        hasReply = !!inbound;
      }
      if (hasReply) return null;
      return {
        id: cc.id,
        phone: cc.phone,
        first_name: cc.first_name,
        business_name: cc.business_name,
        sent_at: cc.sent_at,
        conversation_id: cc.conversation_id,
      };
    })
  );

  return NextResponse.json({
    campaign,
    replied,
    noReply: noReply.filter(Boolean),
  });
}

// POST /api/sms/campaign/[id]/details — create a follow-up campaign from no-reply contacts
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const { data: campaign } = await supabaseAdmin
    .from("sms_campaigns")
    .select("name, template_name, daily_limit, spacing_minutes")
    .eq("id", id)
    .maybeSingle();

  if (!campaign) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // Get no-reply contacts
  const { data: sentContacts } = await supabaseAdmin
    .from("sms_campaign_contacts")
    .select("phone, first_name, business_name, contact_id, conversation_id")
    .eq("campaign_id", id)
    .eq("status", "sent");

  const noReplyContacts = await Promise.all(
    (sentContacts ?? []).map(async (cc) => {
      if (cc.conversation_id) {
        const { data: inbound } = await supabaseAdmin
          .from("sms_messages")
          .select("id")
          .eq("conversation_id", cc.conversation_id)
          .eq("direction", "inbound")
          .limit(1)
          .maybeSingle();
        if (inbound) return null;
      }
      return { phone: cc.phone as string, first_name: cc.first_name as string | null, business_name: cc.business_name as string | null, contact_id: cc.contact_id as string | null };
    })
  );

  const contacts = noReplyContacts.filter((c): c is NonNullable<typeof c> => c !== null);
  if (contacts.length === 0) {
    return NextResponse.json({ error: "no_contacts" }, { status: 400 });
  }

  const result = await createCampaign({
    name: `${campaign.name as string} — Follow-Up`,
    templateName: campaign.template_name as string,
    contacts,
    dailyLimit: campaign.daily_limit as number,
    spacingMinutes: campaign.spacing_minutes as number,
  });

  return NextResponse.json({ ok: true, new_campaign_id: result.id, total: result.total });
}
