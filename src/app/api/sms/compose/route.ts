export const dynamic = "force-dynamic";
// Compose-to-a-new-number endpoint (textwin.ai "＋ New message").
//
// Two shapes:
//   • Lookup  { phone }                       → resolve an existing contact/conversation.
//   • Create  { phone, first_name, ... }      → create the lead in Supabase.
//
// Lookup flow: normalize → resolveLead({ phone }), which matches the last 10
// digits across phone_last10 AND mobile_last10. If nothing exists and no create
// fields were sent, return { found:false } so the caller (textwin) can pop the
// "new contact" form. Either way we upsert an sms_conversations row (stamping
// last_outbound_at so the fresh chat surfaces in textwin's "Recent" before any
// message exists) and ensure the per-lead Slack channel, so the first outbound
// has somewhere to mirror.
//
// POST — Bearer CRON_SECRET (same gate + CORS as zoho/draft-sms).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { resolveLead, type LeadRef } from "@/lib/crm";
import { normalizePhone } from "@/lib/phone";
import { ensureSmsChannel } from "@/lib/sms-channel";

export const runtime = "nodejs";
export const maxDuration = 30;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface ComposeBody {
  phone: string;
  first_name?: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  monthly_revenue?: number | string;
  time_in_business?: string;
}

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

  let body: ComposeBody;
  try {
    body = (await req.json()) as ComposeBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: CORS_HEADERS });
  }

  const phone = normalizePhone(body.phone ?? "");
  if (!phone) {
    return NextResponse.json(
      { error: `invalid_phone: ${body.phone ?? ""}` },
      { status: 422, headers: CORS_HEADERS }
    );
  }

  const hasCreateFields = Boolean((body.first_name ?? "").trim());

  // ── Resolve the contact ─────────────────────────────────────────────────────
  let lead: LeadRef | null = await resolveLead({ phone });

  // Still nothing, and the caller hasn't sent contact details → ask for them.
  if (!lead && !hasCreateFields) {
    return NextResponse.json({ ok: true, found: false, phone }, { headers: CORS_HEADERS });
  }

  // ── Create a brand-new lead ─────────────────────────────────────────────────
  let created = false;
  if (!lead && hasCreateFields) {
    const firstName = (body.first_name ?? "").trim();
    const lastName = (body.last_name ?? "").trim();
    const businessName = (body.business_name ?? "").trim();
    const email = (body.email ?? "").trim();
    const revNum =
      body.monthly_revenue != null && `${body.monthly_revenue}`.trim() !== ""
        ? Math.round(Number(`${body.monthly_revenue}`.replace(/[^0-9.]/g, "")))
        : null;
    const monthlyRevenue = revNum != null && Number.isFinite(revNum) && revNum > 0 ? revNum : null;
    const timeInBusiness = (body.time_in_business ?? "").trim() || null;

    const { data: newContact, error: insErr } = await supabaseAdmin
      .from("contacts")
      .upsert(
        {
          first_name: firstName || null,
          last_name: lastName || null,
          business_name: businessName || null,
          email: email || null,
          phone,
          monthly_revenue: monthlyRevenue,
          time_in_business: timeInBusiness,
          source: "textwin compose",
        },
        { onConflict: "phone" }
      )
      .select("id")
      .single();

    if (insErr || !newContact) {
      return NextResponse.json(
        { error: `contact_create_failed: ${insErr?.message ?? "unknown"}` },
        { status: 500, headers: CORS_HEADERS }
      );
    }
    // Re-read through resolveLead so the response shape is identical whether the
    // lead already existed or was just created, blank-normalization included.
    lead = await resolveLead({ contactId: newContact.id as string });
    created = true;
  }

  // ── Upsert the conversation + Slack channel ─────────────────────────────────
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: lead?.id ?? null,
        outcome: "open",
        // Stamp activity so a freshly composed (no-inbound-yet) chat still surfaces
        // in textwin's "Recent" list.
        last_outbound_at: new Date().toISOString(),
      },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, slack_channel_id")
    .single();

  if (convErr || !conv) {
    return NextResponse.json(
      { error: `conversation_upsert_failed: ${convErr?.message ?? "unknown"}` },
      { status: 500, headers: CORS_HEADERS }
    );
  }

  // displayName falls back to the bare phone, which is the whole no-drop rule:
  // an unrecognized number still gets a thread, just an unnamed one.
  const displayName = lead?.displayName ?? phone;

  const { channelId } = await ensureSmsChannel({
    conversationId: conv.id as string,
    phone,
    displayName,
    contactId: lead?.id ?? null,
    zohoLeadId: lead?.zohoLeadId ?? undefined,
    businessName: lead?.businessName ?? null,
  });

  return NextResponse.json(
    {
      ok: true,
      found: true,
      created,
      conversation_id: conv.id,
      contact_id: lead?.id ?? null,
      zoho_lead_id: lead?.zohoLeadId ?? null,
      display_name: displayName,
      phone,
      channel_id: channelId ?? null,
    },
    { headers: CORS_HEADERS }
  );
}
