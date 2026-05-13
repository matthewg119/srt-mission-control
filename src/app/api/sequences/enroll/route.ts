import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { enrollContact } from "@/lib/sequence-engine";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";

export const dynamic = "force-dynamic";

/**
 * POST /api/sequences/enroll
 *
 * Called by Zoho CRM buttons (Deluge invokeurl) and Mission Control UI.
 *
 * Body: {
 *   zoho_contact_id: string,  // Zoho Lead ID (used to look up Supabase contact)
 *   sequence_slug: string,    // e.g. "fu-new-inbound"
 *   enrolled_by: string,      // e.g. "zoho_button" | "ui" | "Matthew"
 * }
 */
export async function POST(req: NextRequest) {
  let body: { zoho_contact_id?: string; sequence_slug?: string; enrolled_by?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { zoho_contact_id, sequence_slug, enrolled_by = "unknown" } = body;

  if (!zoho_contact_id || !sequence_slug) {
    return NextResponse.json({ error: "zoho_contact_id and sequence_slug are required" }, { status: 400 });
  }

  // Look up the Supabase contact by Zoho Lead ID
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("contacts")
    .select("id, email, first_name, last_name, business_name, do_not_contact")
    .eq("zoho_lead_id", zoho_contact_id)
    .maybeSingle();

  if (contactErr || !contact) {
    return NextResponse.json(
      { enrolled: false, reason: `Contact not found for Zoho ID: ${zoho_contact_id}` },
      { status: 404 }
    );
  }

  if (contact.do_not_contact) {
    return NextResponse.json({ enrolled: false, reason: "Contact is marked do_not_contact" });
  }

  if (!contact.email) {
    return NextResponse.json({ enrolled: false, reason: "Contact has no email address" });
  }

  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "Merchant";

  const result = await enrollContact(
    sequence_slug,
    contact.id,
    contact.email,
    name,
    { enrolled_by, businessName: contact.business_name ?? "" }
  );

  // Post Slack confirmation
  if (result.enrolled) {
    const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
    if (channel) {
      await slack.postMessage(
        channel,
        `✅ *${name}* (${contact.business_name ?? "—"}) enrolled in \`${sequence_slug}\` by ${enrolled_by}. First email in ~5 min.`
      );
    }
  }

  return NextResponse.json(result);
}
