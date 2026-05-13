import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { stopAllForContact } from "@/lib/sequence-engine";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";

export const dynamic = "force-dynamic";

/**
 * POST /api/sequences/stop
 *
 * Called by Zoho CRM "Stop All Sequences" button and Zoho auto-stop workflow rule.
 *
 * Body: {
 *   zoho_contact_id: string,
 *   reason: string,   // e.g. "Zoho status changed to: Not Interested"
 * }
 */
export async function POST(req: NextRequest) {
  let body: { zoho_contact_id?: string; reason?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { zoho_contact_id, reason = "manually stopped" } = body;

  if (!zoho_contact_id) {
    return NextResponse.json({ error: "zoho_contact_id is required" }, { status: 400 });
  }

  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("contacts")
    .select("id, first_name, last_name, business_name")
    .eq("zoho_lead_id", zoho_contact_id)
    .maybeSingle();

  if (contactErr || !contact) {
    return NextResponse.json(
      { stopped: 0, reason: `Contact not found for Zoho ID: ${zoho_contact_id}` },
      { status: 404 }
    );
  }

  const count = await stopAllForContact(contact.id, reason);

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Merchant";

  if (count > 0) {
    const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
    if (channel) {
      await slack.postMessage(
        channel,
        `🛑 *${name}* (${contact.business_name ?? "—"}) — ${count} sequence(s) stopped.\nReason: ${reason}`
      );
    }
  }

  return NextResponse.json({ stopped: count, contact_id: contact.id });
}
