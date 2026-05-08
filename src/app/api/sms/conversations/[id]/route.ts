import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, slack_channel_id, close_stage, last_inbound_at, last_outbound_at, outcome, first_sms_sent, assigned_sender")
    .eq("id", id)
    .maybeSingle();

  if (!conv) return NextResponse.json({ error: "not_found" }, { status: 404 });

  let firstName: string | null = null;
  let lastName: string | null = null;
  let businessName: string | null = null;
  let zohoLeadId: string | null = null;

  if (conv.contact_id) {
    const { data: contact } = await supabaseAdmin
      .from("contacts")
      .select("first_name, last_name, business_name, zoho_lead_id")
      .eq("id", conv.contact_id)
      .maybeSingle();
    if (contact) {
      firstName = contact.first_name as string | null;
      lastName = contact.last_name as string | null;
      businessName = contact.business_name as string | null;
      zohoLeadId = contact.zoho_lead_id as string | null;
    }
  }

  const displayName =
    businessName ??
    [firstName, lastName].filter(Boolean).join(" ") ??
    (conv.phone as string);

  return NextResponse.json({
    id: conv.id,
    phone: conv.phone,
    contact_id: conv.contact_id,
    slack_channel_id: conv.slack_channel_id,
    close_stage: conv.close_stage,
    last_inbound_at: conv.last_inbound_at,
    last_outbound_at: conv.last_outbound_at,
    outcome: conv.outcome,
    first_name: firstName,
    last_name: lastName,
    business_name: businessName,
    zoho_lead_id: zohoLeadId,
    display_name: displayName,
  });
}
