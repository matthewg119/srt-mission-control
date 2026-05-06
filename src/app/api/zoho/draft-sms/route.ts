// Chrome extension → draft SMS endpoint.
// Creates a Slack channel for the lead and posts an AI draft for ✅ approval.
// Does NOT send the SMS — approval via Slack reaction triggers sending.
//
// POST body: { zoho_lead_id, template_name, first_name }

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getLead } from "@/lib/zoho";
import { normalizePhone } from "@/lib/linq";
import { ensureSmsChannel, postAIDraft } from "@/lib/sms-channel";

export const runtime = "nodejs";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const SMS_TEMPLATES: Record<string, string> = {
  "nice-speaking":
    "Hey {{firstName}}! Was great speaking with you. Going to save your number and shoot you an email from matthew@srtagency.com so you have my info. Talk soon! 💪",
  "app-link":
    "Hey {{firstName}}! Here is the link to start your application — only takes 2 min 👉 srtagency.com/fullapp Let me know if you have any questions!",
  "fu1-guide":
    "Hey {{firstName}}, quick question — would it be cool if I sent over our funding guide PDF? No strings, just want to make sure you have all the info 💪",
  "fu2-authorized":
    "Hey {{firstName}}! Based on everything we talked about, you're looking solid for funding. Just need a few docs from you. What's the best time to connect?",
  "fu3-worth-reply":
    "Worth a Reply? KHRT 👊",
  "fu4-black-hole":
    "Did your inbox turn into a black hole? 😅 Still here when you're ready {{firstName}}",
  "fu5-last-ping":
    "Last ping {{firstName}} — unless you're still curious about funding options? No pressure either way 🤙",
  "fu6-say-anything":
    "Say anything and I'll take it as a win {{firstName}} 😂",
  "tuesday-opener":
    "Happy Tuesday! Are you still looking for money for your business? 💰",
};

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: CORS_HEADERS });
  }

  const body = (await req.json()) as {
    zoho_lead_id: string;
    template_name: string;
    first_name?: string;
  };

  const { zoho_lead_id, template_name, first_name: firstNameHint } = body;

  if (!zoho_lead_id || !template_name) {
    return NextResponse.json(
      { error: "missing zoho_lead_id or template_name" },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const templateRaw = SMS_TEMPLATES[template_name];
  if (!templateRaw) {
    return NextResponse.json(
      { error: `unknown template: ${template_name}`, available: Object.keys(SMS_TEMPLATES) },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // Fetch lead from Zoho
  let zohoLead;
  try {
    zohoLead = await getLead(zoho_lead_id);
  } catch (err) {
    return NextResponse.json(
      { error: `zoho_fetch_failed: ${(err as Error).message}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  const phoneRaw = (zohoLead.Mobile ?? zohoLead.Phone) as string | undefined;
  const firstName = firstNameHint || (zohoLead.First_Name ?? "") as string;
  const lastName = (zohoLead.Last_Name ?? "") as string;
  const businessName = (zohoLead.Company ?? zohoLead.Account_Name ?? "") as string;

  if (!phoneRaw) {
    return NextResponse.json(
      { error: "no_phone_on_lead" },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const phone = normalizePhone(phoneRaw);
  if (!phone) {
    return NextResponse.json(
      { error: `invalid_phone: ${phoneRaw}` },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  // Look up or create contact in Supabase
  let contactId: string | null = null;
  const { data: existingContact } = await supabaseAdmin
    .from("contacts")
    .select("id")
    .eq("zoho_lead_id", zoho_lead_id)
    .maybeSingle();

  if (existingContact) {
    contactId = existingContact.id as string;
  } else {
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
        first_sms_sent: false,
      },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, slack_channel_id")
    .single();

  if (!conv) {
    return NextResponse.json(
      { error: "conversation_upsert_failed" },
      { status: 500, headers: CORS_HEADERS }
    );
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

  if (!channelId) {
    return NextResponse.json(
      { error: "slack_channel_creation_failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // Render template
  const draft = templateRaw.replace(/\{\{firstName\}\}/g, firstName || "there");

  // Post as AI draft (✅ to send)
  await postAIDraft(channelId, 1, displayName, draft, conv.id as string);

  return NextResponse.json(
    {
      ok: true,
      channelId,
      displayName,
      phone,
      template: template_name,
      draft,
    },
    { headers: CORS_HEADERS }
  );
}
