// Zoho CRM → initiate SMS conversation endpoint.
// Called by Zoho custom buttons (Deluge scripts) to start a text conversation
// for any lead/contact in the CRM — not just /bfunding signups.
//
// POST body: { zoho_lead_id, template, enroll_sequence? }
// Templates: "new-lead" | "nice-speaking-with-you" | "fu-1"

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getLead } from "@/lib/zoho";
import { normalizePhone } from "@/lib/loopmessage";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { sendSMS } from "@/lib/sms-sender";
import { slack } from "@/lib/slack-bot";

export const runtime = "nodejs";
export const maxDuration = 30;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as {
    zoho_lead_id: string;
    template: string;
    enroll_sequence?: boolean;
  };

  const { zoho_lead_id, template, enroll_sequence } = body;

  if (!zoho_lead_id || !template) {
    return NextResponse.json({ error: "missing zoho_lead_id or template" }, { status: 400 });
  }

  // Fetch lead from Zoho CRM
  let zohoLead;
  try {
    zohoLead = await getLead(zoho_lead_id);
  } catch (err) {
    return NextResponse.json({ error: `zoho_fetch_failed: ${(err as Error).message}` }, { status: 500 });
  }

  const phoneRaw = (zohoLead.Mobile ?? zohoLead.Phone) as string | undefined;
  const firstName = (zohoLead.First_Name ?? "") as string;
  const lastName = (zohoLead.Last_Name ?? "") as string;
  const businessName = (zohoLead.Company ?? zohoLead.Account_Name ?? "") as string;

  if (!phoneRaw) {
    return NextResponse.json({ error: "no_phone_on_lead" }, { status: 422 });
  }

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json({ error: `invalid_phone: ${phoneRaw}` }, { status: 422 });
  }

  // Look up or create Supabase contact
  let contactId: string | null = null;
  const { data: existingContact } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("zoho_lead_id", zoho_lead_id)
    .maybeSingle();

  if (existingContact) {
    contactId = existingContact.id as string;
  } else {
    // Create stub contact
    const { data: newContact } = await supabaseAdmin
      .from("contacts")
      .upsert(
        {
          first_name: firstName,
          last_name: lastName,
          business_name: businessName || null,
          phone,
          zoho_lead_id,
        },
        { onConflict: "phone" }
      )
      .select("id")
      .single();
    contactId = newContact?.id ?? null;
  }

  // Create or find SMS conversation
  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: contactId,
        outcome: "open",
        first_sms_sent: true,
      },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, sms_send_count")
    .single();

  if (!conv) {
    return NextResponse.json({ error: "conversation_upsert_failed" }, { status: 500 });
  }

  const displayName = businessName || [firstName, lastName].filter(Boolean).join(" ") || phone;

  // Ensure Slack channel exists
  const { channelId } = await ensureSmsChannel({
    conversationId: conv.id as string,
    phone,
    displayName,
    contactId,
    zohoLeadId: zoho_lead_id,
    businessName: businessName || null,
  });

  // Look up template body
  const { data: tmpl } = await supabaseAdmin
    .from("message_templates")
    .select("body, subject")
    .eq("name", template)
    .eq("type", "sms")
    .maybeSingle();

  const rawBody =
    (tmpl?.body as string) ??
    FALLBACK_TEMPLATES[template as keyof typeof FALLBACK_TEMPLATES] ??
    `Hey {{first_name}}, this is Matthew from SRT Agency. Following up on your funding inquiry — let me know a good time to connect! 💪`;

  const messageBody = rawBody.replace(/\{\{first_name\}\}/g, firstName || "there");

  // Send SMS
  const sendResult = await sendSMS(phone, messageBody, conv.id as string);

  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error, blocked: sendResult.blocked }, { status: sendResult.blocked === "cap_reached" ? 429 : 500 });
  }

  // Log outbound message
  await supabaseAdmin.from("sms_messages").insert({
    conversation_id: conv.id,
    direction: "outbound",
    body: messageBody,
    close_stage: 1,
  });

  // Post to Slack channel confirming conversation started
  if (channelId) {
    await slack.postMessage(
      channelId,
      `📱 *Conversation started via Zoho button*\nTemplate: \`${template}\`\nSent to: ${displayName} (${phone})\n\n> ${messageBody}`
    );
  }

  // Enroll in sequence if requested (FU-1 flow)
  if (enroll_sequence && contactId) {
    try {
      const { enrollContact } = await import("@/lib/sequence-engine");
      const contactEmail = (zohoLead.Email ?? "") as string;
      if (contactEmail) {
        await enrollContact("sms-fu1-sequence", contactId, contactEmail, displayName, {});
      }
    } catch (err) {
      console.error("[zoho/initiate-sms] sequence enrollment failed:", (err as Error).message);
    }
  }

  return NextResponse.json({
    ok: true,
    channelId,
    messageSent: true,
    phone,
    template,
  });
}

// Placeholder templates — replace with real copy from Matthew
const FALLBACK_TEMPLATES = {
  "new-lead":
    `Hey {{first_name}}! This is Matthew from SRT Agency — saw you were looking into business funding. What's a good time to connect? I think we can get you something solid 💪`,
  "nice-speaking-with-you":
    `Hey {{first_name}}, was great speaking with you today! Just following up on what we discussed. Ready to move forward whenever you are 🤙`,
  "fu-1":
    `Hey {{first_name}}, just circling back — still want to help you get funded. What's been the hold up? Sometimes I can clear the path 💪`,
};
