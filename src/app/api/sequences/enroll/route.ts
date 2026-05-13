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

  // Post rich Slack enrollment confirmation card with category + cancel button
  if (result.enrolled && result.enrollmentId) {
    const channel = VEKTOR_CHANNELS.emailDirector || VEKTOR_CHANNELS.main;
    if (channel) {
      const seqLabel = SEQUENCE_LABELS[sequence_slug] ?? sequence_slug;
      const catLabel = CATEGORY_LABELS[normalizedCategory] ?? normalizedCategory.toUpperCase();
      const cancelUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/api/sequences/stop`;

      await slack.postMessage(channel, `📬 ${name} enrolled in ${seqLabel} [${catLabel}]`, [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `📬 *${name}*${bizName ? ` (${bizName})` : ""} enrolled in *${seqLabel}*\nCategory: ${catLabel} · by ${enrolled_by} · first email in ~5 min`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: { type: "plain_text", text: "🚫 Cancel Workflow" },
              style: "danger",
              action_id: "sequence_cancel",
              value: JSON.stringify({ enrollment_id: result.enrollmentId }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "💳 MCA" },
              action_id: "sequence_cat_mca",
              value: JSON.stringify({ enrollment_id: result.enrollmentId, category: "mca" }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "🏛 SBA" },
              action_id: "sequence_cat_sba",
              value: JSON.stringify({ enrollment_id: result.enrollmentId, category: "sba" }),
            },
            {
              type: "button",
              text: { type: "plain_text", text: "💰 LOC" },
              action_id: "sequence_cat_loc",
              value: JSON.stringify({ enrollment_id: result.enrollmentId, category: "loc" }),
            },
          ],
        },
        {
          type: "context",
          elements: [
            {
              type: "mrkdwn",
              text: `Cancel stops all emails. Category buttons update the follow-up type. Stop URL: ${cancelUrl}`,
            },
          ],
        },
      ]);
    }
  }

  return NextResponse.json(result);
}
