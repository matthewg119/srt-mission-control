export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { buildVCard, sanitizeFilename } from "@/lib/vcard";

// Accepts either a Supabase UUID or a legacy Zoho lead id (numeric string),
// which still resolves against the contacts.zoho_lead_id column.
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ contactId: string }> }
) {
  const { contactId } = await params;

  // ── 1. Resolve contact ──────────────────────────────────────────────────────
  let contact: Record<string, unknown> | null = null;
  const isZohoId = /^\d+$/.test(contactId);

  if (isZohoId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id,first_name,last_name,email,phone,mobile_phone,business_name,industry,biz_city,biz_state,amount_needed,source,zoho_lead_id")
      .eq("zoho_lead_id", contactId)
      .maybeSingle();
    contact = data;
  } else {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id,first_name,last_name,email,phone,mobile_phone,business_name,industry,biz_city,biz_state,amount_needed,source,zoho_lead_id")
      .eq("id", contactId)
      .maybeSingle();
    contact = data;
  }

  if (!contact) {
    return new NextResponse("Lead not found in Mission Control", { status: 404 });
  }

  // ── 3. Build note + categories ──────────────────────────────────────────────
  const noteParts: string[] = ["SRT Lead"];
  if (contact.zoho_lead_id) noteParts.push(`Zoho ID: ${contact.zoho_lead_id}`);
  if (contact.source)       noteParts.push(`Source: ${contact.source}`);
  const fundingNum = Number(contact.amount_needed);
  if (contact.amount_needed && !isNaN(fundingNum) && fundingNum > 0) noteParts.push(`Funding: $${fundingNum.toLocaleString()}`);
  const note = noteParts.join(" — ");

  const categories = ["SRT Lead", contact.industry].filter(Boolean).join(",");

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const profileUrl = contact.id
    ? `${baseUrl}/contacts/${contact.id}`
    : `${baseUrl}/contacts/${contact.zoho_lead_id}`;

  const vcf = buildVCard({
    firstName:    contact.first_name as string | null,
    lastName:     contact.last_name  as string | null,
    businessName: contact.business_name as string | null,
    title:        contact.industry   as string | null,
    phone:        (contact.phone || contact.mobile_phone) as string | null,
    email:        contact.email      as string | null,
    city:         contact.biz_city   as string | null,
    state:        contact.biz_state  as string | null,
    note,
    categories,
    url: profileUrl,
  });

  const fullName = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || "contact";
  const filename = sanitizeFilename(String(fullName)) + ".vcf";

  return new NextResponse(vcf, {
    headers: {
      "Content-Type":        "text/vcard; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control":       "no-store",
    },
  });
}
