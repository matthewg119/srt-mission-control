export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getLead } from "@/lib/zoho";
import { buildVCard, sanitizeFilename } from "@/lib/vcard";

// Accepts either a Zoho Lead ID (numeric string) or a Supabase UUID.
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

  // ── 2. Zoho fallback ────────────────────────────────────────────────────────
  if (!contact && isZohoId) {
    try {
      const zohoRecord = await getLead(contactId);
      if (zohoRecord) {
        contact = {
          first_name: String(zohoRecord.First_Name ?? ""),
          last_name:  String(zohoRecord.Last_Name  ?? ""),
          email:       zohoRecord.Email   ? String(zohoRecord.Email)   : null,
          phone:       zohoRecord.Phone   ? String(zohoRecord.Phone)   : (zohoRecord.Mobile ? String(zohoRecord.Mobile) : null),
          business_name: zohoRecord.Company  ? String(zohoRecord.Company)  : null,
          industry:    zohoRecord.Industry ? String(zohoRecord.Industry) : null,
          biz_city:    zohoRecord.Mailing_City  ? String(zohoRecord.Mailing_City)  : null,
          biz_state:   zohoRecord.Mailing_State ? String(zohoRecord.Mailing_State) : null,
          amount_needed: zohoRecord.Funding_Amount_Requested ?? null,
          source:      zohoRecord.Lead_Source ? String(zohoRecord.Lead_Source) : null,
          zoho_lead_id: contactId,
          id: null,
        };
      }
    } catch {
      // Zoho unavailable — fall through to 404
    }
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
