export const dynamic = "force-dynamic";
// Cron: fire delayed first SMS messages (runs every 5 minutes).
// Picks up sms_conversations where:
//   first_sms_scheduled_at <= now()
//   first_sms_sent = false
//   phone is set

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { sendSMS } from "@/lib/sms-sender";

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

  const now = new Date().toISOString();

  // Find all conversations with a scheduled but unsent first SMS
  const { data: pending, error } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, first_sms_template")
    .eq("first_sms_sent", false)
    .not("first_sms_scheduled_at", "is", null)
    .lte("first_sms_scheduled_at", now)
    .limit(50);

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results: Array<{ phone: string; ok: boolean; error?: string }> = [];

  for (const conv of pending ?? []) {
    try {
      // Load contact info for template rendering
      const { data: contact } = conv.contact_id
        ? await supabaseAdmin
            .from("contacts")
            .select("first_name, business_name, zoho_lead_id")
            .eq("id", conv.contact_id)
            .maybeSingle()
        : { data: null };

      const firstName = (contact?.first_name as string) ?? "there";

      // Look up template from message_templates table
      const { data: tmpl } = await supabaseAdmin
        .from("message_templates")
        .select("body")
        .eq("name", conv.first_sms_template ?? "new-lead")
        .eq("type", "sms")
        .maybeSingle();

      // Fallback text if template not found (placeholder — Matthew should seed real copy)
      const rawBody = (tmpl?.body as string) ??
        `Hey {{first_name}}! This is Matthew from SRT Agency — saw you were looking into business funding. Happy to help you get the capital you need quickly. What's the best way to connect? 💪`;

      const body = rawBody.replace(/\{\{first_name\}\}/g, firstName);

      // Ensure Slack channel exists
      await ensureSmsChannel({
        conversationId: conv.id as string,
        phone: conv.phone as string,
        displayName: (contact?.business_name as string) ?? firstName,
        contactId: conv.contact_id as string | null,
        zohoLeadId: contact?.zoho_lead_id as string | null,
      });

      // Send the SMS
      const result = await sendSMS(conv.phone as string, body, conv.id as string);

      if (result.ok) {
        // Mark as sent
        await supabaseAdmin
          .from("sms_conversations")
          .update({ first_sms_sent: true })
          .eq("id", conv.id);

        // Log outbound message
        await supabaseAdmin.from("sms_messages").insert({
          conversation_id: conv.id,
          direction: "outbound",
          body,
          close_stage: 1,
        });

        results.push({ phone: conv.phone as string, ok: true });
      } else {
        results.push({ phone: conv.phone as string, ok: false, error: result.error });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "unknown";
      console.error("[sms-delayed-sends] error for", conv.phone, ":", msg);
      results.push({ phone: conv.phone as string, ok: false, error: msg });
    }
  }

  return NextResponse.json({ ok: true, processed: results.length, results });
}

export async function GET(req: NextRequest) { return handle(req); }
export async function POST(req: NextRequest) { return handle(req); }
