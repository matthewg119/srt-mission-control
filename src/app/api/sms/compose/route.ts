export const dynamic = "force-dynamic";
// Compose-to-a-new-number endpoint (textwin.ai "＋ New message").
//
// Two shapes:
//   • Lookup  { phone }                       → resolve an existing contact/conversation.
//   • Create  { phone, first_name, ... }      → create the lead in Supabase + Zoho.
//
// Lookup flow: normalize → match contacts by last-10 → if miss, ask Zoho live
// (searchLeads, same criteria builder as the inbound webhook) and seed a contact.
// If nothing exists and no create fields were sent, return { found:false } so the
// caller (textwin) can pop the "new contact" form. Either way we upsert an
// sms_conversations row (stamping last_outbound_at so the fresh chat surfaces in
// textwin's "Recent" before any message exists) and ensure the per-lead Slack
// channel, so the first outbound has somewhere to mirror.
//
// Zoho currency note: Monthly_Revenue is passed as an INT (never a "$X,XXX"
// string) and Lead_Status is left to createLead's default — a bad currency value
// would otherwise drop the whole create.
//
// POST — Bearer CRON_SECRET (same gate + CORS as zoho/draft-sms).

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { createLead, searchLeads, type ZohoApiRecord } from "@/lib/zoho";
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

interface ContactRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
}

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  return header === `Bearer ${secret}`;
}

const CONTACT_COLS = "id, first_name, last_name, business_name, zoho_lead_id";

// Format-agnostic match on the last 10 digits (phone_last10 / mobile_last10 are
// stored generated columns). Mirrors the inbound webhook's findContactByPhone.
async function findContactByPhone(phone: string): Promise<ContactRow | null> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select(CONTACT_COLS)
    .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
    .limit(1)
    .maybeSingle();
  if (error) console.error("[sms/compose] contact lookup failed:", error.message);
  return (data as ContactRow | null) ?? null;
}

// Ask Zoho live for a lead at this number (3 formats × 2 fields = 6 clauses, under
// Zoho's per-search criteria limit). Same builder as inbound/route.ts resolveContact.
async function searchZohoByPhone(phone: string): Promise<ZohoApiRecord | undefined> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return undefined;
  const variants = [
    last10,
    `+1${last10}`,
    `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`,
  ];
  const criteria =
    "(" +
    variants.flatMap((v) => [`(Phone:equals:${v})`, `(Mobile:equals:${v})`]).join("or") +
    ")";
  try {
    const results = await searchLeads({ criteria });
    return results[0];
  } catch (e) {
    console.error("[sms/compose] Zoho lookup failed:", (e as Error).message);
    return undefined;
  }
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
  let contact: ContactRow | null = await findContactByPhone(phone);

  if (!contact) {
    // Try Zoho live before giving up — the lead may exist in the CRM but not yet
    // be mirrored into Supabase.
    const lead = await searchZohoByPhone(phone);
    if (lead) {
      const { data: seeded } = await supabaseAdmin
        .from("contacts")
        .upsert(
          {
            first_name: (lead.First_Name as string | undefined) ?? null,
            last_name: (lead.Last_Name as string | undefined) ?? null,
            business_name: (lead.Company as string | undefined) ?? null,
            phone,
            zoho_lead_id: (lead.id as string | undefined) ?? null,
            source: "textwin compose",
          },
          { onConflict: "phone" }
        )
        .select(CONTACT_COLS)
        .single();
      contact = (seeded as ContactRow | null) ?? (await findContactByPhone(phone));
    }
  }

  // Still nothing, and the caller hasn't sent contact details → ask for them.
  if (!contact && !hasCreateFields) {
    return NextResponse.json({ ok: true, found: false, phone }, { headers: CORS_HEADERS });
  }

  // ── Create a brand-new lead (Supabase + Zoho) ───────────────────────────────
  let created = false;
  if (!contact && hasCreateFields) {
    const firstName = (body.first_name ?? "").trim();
    const lastName = (body.last_name ?? "").trim();
    const businessName = (body.business_name ?? "").trim();
    const email = (body.email ?? "").trim();
    // Strict numeric only — never a "$X,XXX" string (Zoho currency rejects it and
    // drops the whole create).
    const revNum =
      body.monthly_revenue != null && `${body.monthly_revenue}`.trim() !== ""
        ? Math.round(Number(`${body.monthly_revenue}`.replace(/[^0-9.]/g, "")))
        : null;
    const monthlyRevenue = revNum != null && Number.isFinite(revNum) && revNum > 0 ? revNum : undefined;
    const timeInBusiness = (body.time_in_business ?? "").trim() || undefined;

    let zohoLeadId: string | null = null;
    try {
      zohoLeadId = await createLead({
        firstName,
        lastName,
        businessName: businessName || undefined,
        email: email || undefined,
        phone,
        monthlyRevenue,
        timeInBusiness,
        source: "textwin compose",
      });
    } catch (e) {
      // Don't lose the contact if Zoho rejects — seed Supabase anyway and report.
      console.error("[sms/compose] createLead failed:", (e as Error).message);
    }

    const { data: newContact, error: insErr } = await supabaseAdmin
      .from("contacts")
      .upsert(
        {
          first_name: firstName || null,
          last_name: lastName || null,
          business_name: businessName || null,
          email: email || null,
          phone,
          monthly_revenue: monthlyRevenue ?? null,
          time_in_business: timeInBusiness ?? null,
          zoho_lead_id: zohoLeadId,
          source: "textwin compose",
        },
        { onConflict: "phone" }
      )
      .select(CONTACT_COLS)
      .single();

    if (insErr || !newContact) {
      return NextResponse.json(
        { error: `contact_create_failed: ${insErr?.message ?? "unknown"}` },
        { status: 500, headers: CORS_HEADERS }
      );
    }
    contact = newContact as ContactRow;
    created = true;
  }

  // ── Upsert the conversation + Slack channel ─────────────────────────────────
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      {
        phone,
        contact_id: contact?.id ?? null,
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

  const displayName =
    contact?.business_name ||
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
    phone;

  const { channelId } = await ensureSmsChannel({
    conversationId: conv.id as string,
    phone,
    displayName,
    contactId: contact?.id ?? null,
    zohoLeadId: contact?.zoho_lead_id ?? null,
    businessName: contact?.business_name ?? null,
  });

  return NextResponse.json(
    {
      ok: true,
      found: true,
      created,
      conversation_id: conv.id,
      contact_id: contact?.id ?? null,
      zoho_lead_id: contact?.zoho_lead_id ?? null,
      display_name: displayName,
      phone,
      channel_id: channelId ?? null,
    },
    { headers: CORS_HEADERS }
  );
}
