export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const filter = searchParams.get("filter") ?? "all";
  const q = searchParams.get("q") ?? "";

  let query = supabaseAdmin
    .from("sms_conversations")
    .select("id, phone, contact_id, slack_channel_id, close_stage, last_inbound_at, last_outbound_at, outcome, first_sms_sent, assigned_sender, created_at")
    .order("last_inbound_at", { ascending: false, nullsFirst: false });

  if (filter === "replied") {
    query = query.not("last_inbound_at", "is", null);
  } else if (filter === "noreply") {
    query = query.is("last_inbound_at", null);
  }

  const { data: conversations } = await query.limit(200);

  if (!conversations) return NextResponse.json({ conversations: [] });

  // Enrich with contact name + last message
  const enriched = await Promise.all(
    (conversations).map(async (conv) => {
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
        businessName ??
        [firstName, lastName].filter(Boolean).join(" ") ??
        (conv.phone as string);

      // Apply search filter client-side (server-side for simplicity)
      if (q) {
        const needle = q.toLowerCase();
        const haystack = `${displayName} ${conv.phone}`.toLowerCase();
        if (!haystack.includes(needle)) return null;
      }

      const hasReply =
        conv.last_inbound_at !== null &&
        (conv.last_outbound_at === null ||
          new Date(conv.last_inbound_at as string) > new Date(conv.last_outbound_at as string));

      return {
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
        has_reply: hasReply,
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

  return NextResponse.json({
    conversations: enriched.filter(Boolean),
  });
}
