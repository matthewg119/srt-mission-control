// Cron: fire campaign SMS sends (runs every 5 minutes).
// Picks up sms_campaign_contacts where:
//   status = 'pending'
//   scheduled_at <= now()
//   parent campaign status = 'running'
//   campaign hasn't exceeded daily_limit sends today

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { sendSMS } from "@/lib/sms-sender";
import { postCampaignSlackUpdate, markCampaignComplete } from "@/lib/sms-campaign";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

async function handle(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Wave window guard — only fire inside ET business hours (8am–8pm)
  const nowET = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  const hour = nowET.getHours();
  if (hour < 8 || hour >= 20) {
    return NextResponse.json({ ok: true, processed: 0, reason: "outside_send_window" });
  }

  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  // Load all running campaigns
  const { data: runningCampaigns } = await supabaseAdmin
    .from("sms_campaigns")
    .select("id, name, template_name, daily_limit, spacing_minutes, total_contacts, sent_count")
    .eq("status", "running");

  if (!runningCampaigns || runningCampaigns.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results: Array<{ campaignId: string; sent: number; failed: number }> = [];

  for (const campaign of runningCampaigns) {
    const campaignId = campaign.id as string;
    const dailyLimit = (campaign.daily_limit as number) ?? 50;
    const templateName = (campaign.template_name as string) ?? "new-lead";

    // Count how many we've already sent today for this campaign
    const { count: sentToday } = await supabaseAdmin
      .from("sms_campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .gte("sent_at", todayStart.toISOString());

    const remainingToday = dailyLimit - (sentToday ?? 0);
    if (remainingToday <= 0) continue;

    // Fetch pending contacts due for send (up to remaining daily limit, max 20 per cron tick)
    const batchSize = Math.min(remainingToday, 20);
    const { data: pending } = await supabaseAdmin
      .from("sms_campaign_contacts")
      .select("id, phone, first_name, business_name, contact_id, assigned_sender")
      .eq("campaign_id", campaignId)
      .eq("status", "pending")
      .lte("scheduled_at", now.toISOString())
      .order("scheduled_at", { ascending: true })
      .limit(batchSize);

    if (!pending || pending.length === 0) continue;

    // Load template body
    const { data: tmpl } = await supabaseAdmin
      .from("message_templates")
      .select("body")
      .eq("name", templateName)
      .eq("type", "sms")
      .maybeSingle();

    const rawBody = (tmpl?.body as string) ??
      `Hey {{first_name}}! This is Matthew from SRT Agency — saw you were looking into business funding. I can get you funded fast. What's your monthly revenue? 💪`;

    let sent = 0;
    let failed = 0;

    for (const cc of pending) {
      const phone = cc.phone as string;
      const firstName = (cc.first_name as string) ?? "there";
      const senderName = (cc.assigned_sender as string) ?? process.env.LOOP_SENDER_1 ?? "";

      const body = rawBody.replace(/\{\{first_name\}\}/g, firstName);

      try {
        // Find or create conversation
        const { data: conv } = await supabaseAdmin
          .from("sms_conversations")
          .upsert(
            {
              phone,
              contact_id: cc.contact_id ?? null,
              assigned_sender: senderName,
            },
            { onConflict: "phone", ignoreDuplicates: false }
          )
          .select("id, slack_channel_id, sms_send_count, close_stage")
          .single();

        if (!conv) {
          failed++;
          await supabaseAdmin
            .from("sms_campaign_contacts")
            .update({ status: "failed" })
            .eq("id", cc.id);
          continue;
        }

        const convId = conv.id as string;

        // Ensure Slack channel
        await ensureSmsChannel({
          conversationId: convId,
          phone,
          displayName: (cc.business_name as string) ?? firstName,
          contactId: cc.contact_id as string | null,
          businessName: cc.business_name as string | null,
        });

        // Send via LoopMessage
        const result = await sendSMS(phone, body, convId, senderName);

        if (result.ok) {
          const sentAt = new Date().toISOString();

          // Mark campaign contact as sent
          await supabaseAdmin
            .from("sms_campaign_contacts")
            .update({ status: "sent", sent_at: sentAt, conversation_id: convId })
            .eq("id", cc.id);

          // Log outbound message
          await supabaseAdmin.from("sms_messages").insert({
            conversation_id: convId,
            direction: "outbound",
            body,
            close_stage: 1,
          });

          // Increment campaign sent_count
          try {
            await supabaseAdmin.rpc("increment_campaign_sent", { campaign_id: campaignId });
          } catch {
            await supabaseAdmin
              .from("sms_campaigns")
              .update({ sent_count: ((campaign.sent_count as number) ?? 0) + sent + 1 })
              .eq("id", campaignId);
          }

          sent++;
        } else {
          await supabaseAdmin
            .from("sms_campaign_contacts")
            .update({ status: "failed" })
            .eq("id", cc.id);
          failed++;
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown";
        console.error("[sms-campaign-sender] error for", phone, ":", msg);
        failed++;
      }
    }

    results.push({ campaignId, sent, failed });

    // Post progress every 50 sends (approximate)
    const newTotal = ((campaign.sent_count as number) ?? 0) + sent;
    if (sent > 0 && newTotal % 50 < sent) {
      await postCampaignSlackUpdate(campaignId).catch(() => null);
    }

    // Check if campaign is complete (all contacts sent/failed/opted_out)
    const { count: remainingPending } = await supabaseAdmin
      .from("sms_campaign_contacts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "pending");

    if ((remainingPending ?? 0) === 0) {
      await markCampaignComplete(campaignId).catch(() => null);
    }
  }

  const totalSent = results.reduce((sum, r) => sum + r.sent, 0);
  return NextResponse.json({ ok: true, processed: totalSent, campaigns: results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
