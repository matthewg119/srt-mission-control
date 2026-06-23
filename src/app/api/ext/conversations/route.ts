export const dynamic = "force-dynamic";
// TextWin extension inbox — the stacked list of ALL conversations (desktop
// parity). Mirrors the query behind textwin.ai's /api/sms/conversations but
// gated by the extension bearer token + CORS. Supports ?q= search and
// ?filter=replied|noreply.

import { NextRequest } from "next/server";
import { requireExtTenant, jsonCors, preflight } from "@/lib/ext-auth";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export function OPTIONS(req: NextRequest) {
  return preflight(req);
}

export async function GET(req: NextRequest) {
  const tenant = await requireExtTenant(req);
  if (!tenant) return jsonCors(req, { ok: false, error: "unauthorized" }, 401);

  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") ?? "all";
  const q = (searchParams.get("q") ?? "").toLowerCase().trim();

  let query = supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, slack_channel_id, last_inbound_at, last_outbound_at, outcome, created_at")
    .order("last_inbound_at", { ascending: false, nullsFirst: false });

  if (filter === "replied") query = query.not("last_inbound_at", "is", null);
  else if (filter === "noreply") query = query.is("last_inbound_at", null);

  const { data: conversations } = await query.limit(200);
  if (!conversations) return jsonCors(req, { ok: true, conversations: [] });

  // Pending follow-up email bubbles (sf_ = dialer Smart Follow-up).
  const { data: pendingEmails } = await supabaseAdmin
    .from("email_outbox")
    .select("contact_id, draft_key")
    .eq("status", "suggested");
  const followupByContact = new Set(
    (pendingEmails ?? [])
      .filter((r) => (r.draft_key as string | null)?.startsWith("sf_"))
      .map((r) => r.contact_id as string)
  );

  const enriched = await Promise.all(
    conversations.map(async (conv) => {
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

      const { data: lastMsg } = await supabaseAdmin
        .from("sms_messages")
        .select("body, direction, created_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const displayName =
        businessName ||
        [firstName, lastName].filter(Boolean).join(" ") ||
        (conv.phone as string);

      if (q) {
        const haystack = `${displayName} ${conv.phone}`.toLowerCase();
        if (!haystack.includes(q)) return null;
      }

      const hasReply =
        conv.last_inbound_at !== null &&
        (conv.last_outbound_at === null ||
          new Date(conv.last_inbound_at as string) > new Date(conv.last_outbound_at as string));

      return {
        id: conv.id,
        phone: conv.phone,
        contact_id: conv.contact_id,
        zoho_lead_id: zohoLeadId,
        display_name: displayName,
        outcome: conv.outcome,
        has_reply: hasReply,
        has_followup: conv.contact_id ? followupByContact.has(conv.contact_id as string) : false,
        last_inbound_at: conv.last_inbound_at,
        last_message: lastMsg
          ? {
              body: (lastMsg.body as string).slice(0, 80),
              direction: lastMsg.direction,
              created_at: lastMsg.created_at,
            }
          : null,
      };
    })
  );

  return jsonCors(req, { ok: true, conversations: enriched.filter(Boolean) });
}
