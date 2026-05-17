import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { enrollContact } from "@/lib/sequence-engine";
import { slack } from "@/lib/slack-bot";
import { VEKTOR_CHANNELS } from "@/config/vektor";

export const dynamic = "force-dynamic";

// Category display labels and emoji for Slack cards
const CATEGORY_LABELS: Record<string, string> = {
  mca: "💳 MCA",
  sba: "🏛 SBA",
  loc: "💰 Line of Credit",
  cre: "🏢 Commercial RE",
};

const SEQUENCE_LABELS: Record<string, string> = {
  "fu-new-inbound":     "FU — New Inbound Lead",
  "awaiting-statements":"Awaiting Bank Statements",
  "pre-approved-nurture":"Pre-Approved Nurture",
  "post-call-followup": "Post-Call Follow-Up",
  "approved-nurture":   "Renewal Nurture",
  "post-call-daily":    "Post-Call Daily (4-day)",
  "website-lead-nurture":"Website Lead Nurture",
  "application-abandoned":"Application Abandoned",
};

/**
 * POST /api/sequences/enroll
 *
 * Called by Zoho CRM buttons (Deluge invokeurl), Mission Control UI, and the
 * v21 Chrome extension (uses zoho_lead_id as alias for zoho_contact_id).
 *
 * Body: {
 *   zoho_contact_id?: string,  // Zoho Lead ID — legacy field name
 *   zoho_lead_id?: string,     // Zoho Lead ID — v21 extension field name (same thing)
 *   sequence_slug: string,     // e.g. "fu-new-inbound"
 *   enrolled_by?: string,      // e.g. "extension" | "zoho_button" | "ui"
 *   category?: string,         // "mca" | "sba" | "loc" | "cre" (default: "mca")
 * }
 */
export async function POST(req: NextRequest) {
  let body: {
    zoho_contact_id?: string;
    zoho_lead_id?: string;
    sequence_slug?: string;
    enrolled_by?: string;
    category?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  // Accept both field names — v21 extension sends zoho_lead_id
  const zohoId = body.zoho_contact_id || body.zoho_lead_id;
  const { sequence_slug, enrolled_by = "unknown", category = "mca" } = body;

  if (!zohoId || !sequence_slug) {
    return NextResponse.json(
      { error: "zoho_contact_id (or zoho_lead_id) and sequence_slug are required" },
      { status: 400 }
    );
  }

  const normalizedCategory = ["mca", "sba", "loc", "cre"].includes(category) ? category : "mca";

  // Look up the Supabase contact by Zoho Lead ID
  const { data: contact, error: contactErr } = await supabaseAdmin
    .from("contacts")
    .select("id, email, first_name, last_name, business_name, do_not_contact")
    .eq("zoho_lead_id", zohoId)
    .maybeSingle();

  if (contactErr || !contact) {
    return NextResponse.json(
      { enrolled: false, reason: `Contact not found for Zoho ID: ${zohoId}` },
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
  const bizName = contact.business_name ?? "";

  const result = await enrollContact(
    sequence_slug,
    contact.id,
    contact.email,
    name,
    { enrolled_by, businessName: bizName, category: normalizedCategory }
  );

  // Slack enrollment notifications paused — email marketing channel silenced

  return NextResponse.json(result);
}
