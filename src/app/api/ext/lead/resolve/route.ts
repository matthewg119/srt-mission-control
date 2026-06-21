export const dynamic = "force-dynamic";
// The single "map everything out" call. Given what the extension scraped off a
// Zoho lead page (id, name, phones, email, status), this:
//   1. picks a textable phone (textable.ts),
//   2. resolves it to a CRM contact — local match by phone_last10, else a live
//      Zoho searchLeads + seed (mirrors api/imessage/inbound resolveContact),
//   3. finds-or-creates the sms_conversations row for that phone,
//   4. computes whether a follow-up is due (for the bubble's glow/stars),
// and returns it all in one round trip.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { pickTextablePhone } from "@/lib/textable";
import { searchLeads } from "@/lib/zoho";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

interface ExtContact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
}

const CONTACT_COLS = "id, first_name, last_name, business_name, zoho_lead_id";

async function findContactByPhone(phone: string): Promise<ExtContact | null> {
  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;
  const { data, error } = await supabaseAdmin
    .from("contacts")
    .select(CONTACT_COLS)
    .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
    .limit(1)
    .maybeSingle();
  if (error) console.error("[ext/resolve] contact lookup failed:", error.message);
  return (data as ExtContact | null) ?? null;
}

// Mirrors resolveContact() in api/imessage/inbound: local match, else Zoho live
// lookup + seed so the contact is named and the next lookup is instant.
async function resolveContact(phone: string): Promise<ExtContact | null> {
  const existing = await findContactByPhone(phone);
  if (existing) return existing;

  const last10 = phone.replace(/\D/g, "").slice(-10);
  if (last10.length < 10) return null;

  const variants = [
    last10,
    `+1${last10}`,
    `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`,
  ];
  const criteria =
    "(" +
    variants.flatMap((v) => [`(Phone:equals:${v})`, `(Mobile:equals:${v})`]).join("or") +
    ")";

  let lead: Record<string, unknown> | undefined;
  try {
    const results = await searchLeads({ criteria });
    lead = results[0] as Record<string, unknown> | undefined;
  } catch (e) {
    console.error("[ext/resolve] Zoho lookup failed:", (e as Error).message);
  }
  if (!lead) return null;

  const { data: created, error } = await supabaseAdmin
    .from("contacts")
    .insert({
      first_name: (lead.First_Name as string | undefined) ?? null,
      last_name: (lead.Last_Name as string | undefined) ?? null,
      business_name: (lead.Company as string | undefined) ?? null,
      phone,
      zoho_lead_id: (lead.id as string | undefined) ?? null,
      source: "TextWin",
    })
    .select(CONTACT_COLS)
    .single();

  if (error || !created) {
    console.error("[ext/resolve] contact seed failed:", error?.message);
    return findContactByPhone(phone);
  }
  return created as ExtContact;
}

// A lead is "due" when an explicit scheduled follow-up has passed, OR (fallback)
// the lead replied and we haven't answered in 24h. Mirrors runDueFollowups()'s
// scheduled-row model in imessage-followups.ts.
async function computeDueFollowup(
  conversationId: string
): Promise<{ reason: string; due_at: string } | null> {
  const nowIso = new Date().toISOString();
  const { data: fu } = await supabaseAdmin
    .from("sms_followups")
    .select("reason, due_at")
    .eq("conversation_id", conversationId)
    .eq("status", "scheduled")
    .lte("due_at", nowIso)
    .order("due_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (fu) return { reason: fu.reason as string, due_at: fu.due_at as string };

  const { data: conv } = await supabaseAdmin
    .from("sms_conversations")
    .select("last_inbound_at, last_outbound_at, outcome")
    .eq("id", conversationId)
    .maybeSingle();
  if (conv && conv.outcome !== "dead" && conv.last_inbound_at) {
    const inboundAt = new Date(conv.last_inbound_at as string).getTime();
    const outboundAt = conv.last_outbound_at
      ? new Date(conv.last_outbound_at as string).getTime()
      : 0;
    const ageHours = (Date.now() - inboundAt) / 3_600_000;
    if (outboundAt < inboundAt && ageHours >= 24) {
      return { reason: "lead replied, no answer yet", due_at: conv.last_inbound_at as string };
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const parsed = await req.json().catch(() => null);
  const phones: string[] = Array.isArray(parsed?.phones) ? parsed.phones : [];
  const mobileHint: string | null = parsed?.mobile ?? null;
  const leadId: string | null = parsed?.leadId ?? null;

  const pick = pickTextablePhone(phones, mobileHint);
  if (!pick.textable || !pick.phone) {
    return jsonCors(req, { ok: true, textable: false, leadId });
  }

  const contact = await resolveContact(pick.phone);

  // Find-or-create the conversation for this phone (upsert mirrors scheduleFollowup).
  const { data: conv, error: convErr } = await supabaseAdmin
    .from("sms_conversations")
    .upsert(
      { phone: pick.phone, contact_id: contact?.id ?? null },
      { onConflict: "phone", ignoreDuplicates: false }
    )
    .select("id, contact_id")
    .maybeSingle();

  if (convErr || !conv) {
    return jsonCors(
      req,
      { ok: false, error: convErr?.message ?? "conversation_upsert_failed" },
      500
    );
  }

  const dueFollowup = await computeDueFollowup(conv.id as string);

  const displayName =
    contact?.business_name ||
    [contact?.first_name, contact?.last_name].filter(Boolean).join(" ") ||
    pick.phone;

  return jsonCors(req, {
    ok: true,
    textable: true,
    leadId,
    phone: pick.phone,
    conversationId: conv.id,
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.first_name,
          lastName: contact.last_name,
          businessName: contact.business_name,
          zohoLeadId: contact.zoho_lead_id,
          displayName,
        }
      : { displayName },
    dueFollowup,
  });
}
