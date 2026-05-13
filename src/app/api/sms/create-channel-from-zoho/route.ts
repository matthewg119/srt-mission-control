export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { ensureSmsChannel } from "@/lib/sms-channel";

export async function POST(req: NextRequest) {
  const apiKey = req.headers.get("x-api-key") ?? "";
  if (!apiKey || apiKey !== (process.env.LEAD_THREAD_API_KEY ?? "")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json()) as { zoho_lead_id?: string };
  if (!body.zoho_lead_id) {
    return NextResponse.json({ error: "zoho_lead_id required" }, { status: 400 });
  }

  const { data: contact } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, phone, mobile_phone, business_name, zoho_lead_id")
    .eq("zoho_lead_id", body.zoho_lead_id)
    .maybeSingle();

  if (!contact) {
    return NextResponse.json({ error: "contact not found for zoho_lead_id" }, { status: 404 });
  }

  const digits = (contact.phone || contact.mobile_phone || "").replace(/\D/g, "");
  if (!digits) {
    return NextResponse.json({ error: "no phone on contact" }, { status: 422 });
  }
  const normalizedPhone = `+1${digits.slice(-10)}`;

  const { data: convo } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      { phone: normalizedPhone, contact_id: contact.id },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, slack_channel_id, slack_channel_name")
    .maybeSingle();

  if (!convo) {
    return NextResponse.json({ error: "failed to upsert sms_conversations" }, { status: 500 });
  }

  const displayName =
    [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Lead";

  const result = await ensureSmsChannel({
    conversationId: convo.id,
    phone: normalizedPhone,
    displayName,
    contactId: contact.id,
    zohoLeadId: contact.zoho_lead_id ?? null,
    businessName: contact.business_name ?? null,
  });

  return NextResponse.json({
    ok: true,
    created: result.created,
    channel_name: result.channelName,
    channel_id: result.channelId,
  });
}
