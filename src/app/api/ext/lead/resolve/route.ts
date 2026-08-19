export const dynamic = "force-dynamic";
// The single "map everything out" call. Given what the extension scraped off the
// lead page (id, name, phones, email, status), this:
//   1. picks a textable phone (textable.ts),
//   2. resolves it to a CRM contact via resolveLead(), scraped id first, phone
//      second, since an id cannot be wrong and a shared front-desk line can,
//   3. finds-or-creates the sms_conversations row for that phone,
//   4. computes whether a follow-up is due (for the bubble's glow/stars),
// and returns it all in one round trip.
//
// An unresolved phone returns { displayName: phone } rather than nothing, so the
// extension still opens a thread on a number we cannot name.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { pickTextablePhone } from "@/lib/textable";
import { resolveLead } from "@/lib/crm";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
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

  const contact = await resolveLead({ zohoLeadId: leadId, phone: pick.phone });

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

  const displayName = contact?.displayName ?? pick.phone;

  return jsonCors(req, {
    ok: true,
    textable: true,
    leadId,
    phone: pick.phone,
    conversationId: conv.id,
    contact: contact
      ? {
          id: contact.id,
          firstName: contact.firstName,
          lastName: contact.lastName,
          businessName: contact.businessName,
          zohoLeadId: contact.zohoLeadId,
          displayName,
        }
      : { displayName },
    dueFollowup,
  });
}
