import { supabaseAdmin } from "@/lib/db";
import { getLead } from "@/lib/zoho";
import { normalizePhone } from "@/lib/loopmessage";

interface ContactData {
  id: string | null;
  zohoLeadId: string | null;
  firstName: string;
  lastName: string;
  businessName: string | null;
  industry: string | null;
  phone: string | null;
  email: string | null;
  city: string | null;
  state: string | null;
  amountNeeded: number | null;
  source: string | null;
  applicationStage: string | null;
}

async function resolveContact(contactId: string): Promise<ContactData | null> {
  const isZohoId = /^\d+$/.test(contactId);
  let row: Record<string, unknown> | null = null;

  if (isZohoId) {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id,first_name,last_name,email,phone,mobile_phone,business_name,industry,biz_city,biz_state,amount_needed,source,application_stage,zoho_lead_id")
      .eq("zoho_lead_id", contactId)
      .maybeSingle();
    row = data;
  } else {
    const { data } = await supabaseAdmin
      .from("contacts")
      .select("id,first_name,last_name,email,phone,mobile_phone,business_name,industry,biz_city,biz_state,amount_needed,source,application_stage,zoho_lead_id")
      .eq("id", contactId)
      .maybeSingle();
    row = data;
  }

  if (!row && isZohoId) {
    try {
      const z = await getLead(contactId);
      if (z) {
        row = {
          id: null,
          first_name: String(z.First_Name ?? ""),
          last_name:  String(z.Last_Name  ?? ""),
          email:       z.Email   ? String(z.Email)   : null,
          phone:       z.Phone   ? String(z.Phone)   : (z.Mobile ? String(z.Mobile) : null),
          business_name: z.Company  ? String(z.Company)  : null,
          industry:    z.Industry ? String(z.Industry) : null,
          biz_city:    z.Mailing_City  ? String(z.Mailing_City)  : null,
          biz_state:   z.Mailing_State ? String(z.Mailing_State) : null,
          amount_needed: z.Funding_Amount_Requested ?? null,
          source:      z.Lead_Source ? String(z.Lead_Source) : null,
          application_stage: z.Lead_Status ? String(z.Lead_Status) : null,
          zoho_lead_id: contactId,
        };
      }
    } catch { /* Zoho unavailable */ }
  }

  if (!row) return null;

  return {
    id:              row.id   as string | null,
    zohoLeadId:      row.zoho_lead_id as string | null,
    firstName:       String(row.first_name  ?? ""),
    lastName:        String(row.last_name   ?? ""),
    businessName:    row.business_name ? String(row.business_name) : null,
    industry:        row.industry      ? String(row.industry)      : null,
    phone:           (row.phone || row.mobile_phone) ? String(row.phone || row.mobile_phone) : null,
    email:           row.email         ? String(row.email)         : null,
    city:            row.biz_city      ? String(row.biz_city)      : null,
    state:           row.biz_state     ? String(row.biz_state)     : null,
    amountNeeded:    row.amount_needed ? Number(row.amount_needed) : null,
    source:          row.source        ? String(row.source)        : null,
    applicationStage: row.application_stage ? String(row.application_stage) : null,
  };
}

export default async function ContactPage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;

  // MC_VCARD_PUBLIC defaults to true — set to "false" in Vercel to require auth
  if (process.env.MC_VCARD_PUBLIC === "false") {
    return (
      <div className="min-h-screen bg-[#0A1F44] flex items-center justify-center p-4">
        <p className="text-white text-sm">Contact cards are not publicly accessible.</p>
      </div>
    );
  }

  const contact = await resolveContact(contactId);

  if (!contact) {
    return (
      <div className="min-h-screen bg-[#0A1F44] flex items-center justify-center p-4">
        <div className="text-center">
          <p className="text-white text-xl font-semibold mb-2">Lead not found</p>
          <p className="text-[rgba(255,255,255,0.5)] text-sm">This contact doesn&apos;t exist in Mission Control.</p>
        </div>
      </div>
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
  const vCardUrl = `${baseUrl}/api/vcard/${contactId}`;
  const zohoUrl = contact.zohoLeadId
    ? `https://crm.zoho.com/crm/org/leads/view/${contact.zohoLeadId}`
    : null;
  const missionUrl = contact.id
    ? `${baseUrl}/dashboard/pipeline`
    : null;

  const fullName = [contact.firstName, contact.lastName].filter(Boolean).join(" ") || "Unknown";
  const e164Phone = contact.phone ? normalizePhone(contact.phone) : null;
  const displayPhone = e164Phone ?? contact.phone;
  const location = [contact.city, contact.state].filter(Boolean).join(", ");

  return (
    <div className="min-h-screen bg-[#0A1F44] flex flex-col items-center justify-start px-4 py-10 font-sans">
      {/* Header badge */}
      <div className="text-xs font-semibold tracking-widest text-[#00B4B4] uppercase mb-6">
        SRT Agency — Lead Contact
      </div>

      {/* Contact card */}
      <div className="w-full max-w-sm bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-2xl p-6 mb-6">
        {/* Name */}
        <h1 className="text-white text-2xl font-bold mb-1">{fullName}</h1>

        {/* Business + industry */}
        {(contact.businessName || contact.industry) && (
          <p className="text-[rgba(255,255,255,0.6)] text-sm mb-4">
            {[contact.businessName, contact.industry].filter(Boolean).join(" · ")}
          </p>
        )}

        {/* Stage badge */}
        {contact.applicationStage && (
          <span className="inline-block mb-4 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[rgba(0,180,180,0.15)] text-[#00B4B4] border border-[rgba(0,180,180,0.3)]">
            {contact.applicationStage}
          </span>
        )}

        <div className="space-y-3">
          {/* Phone */}
          {displayPhone && (
            <a
              href={`tel:${e164Phone ?? displayPhone}`}
              className="flex items-center gap-3 text-sm text-white hover:text-[#00B4B4] transition-colors"
            >
              <span className="text-lg">📞</span>
              <span>{displayPhone}</span>
            </a>
          )}

          {/* Email */}
          {contact.email && (
            <a
              href={`mailto:${contact.email}`}
              className="flex items-center gap-3 text-sm text-white hover:text-[#00B4B4] transition-colors"
            >
              <span className="text-lg">✉️</span>
              <span>{contact.email}</span>
            </a>
          )}

          {/* Location */}
          {location && (
            <div className="flex items-center gap-3 text-sm text-[rgba(255,255,255,0.6)]">
              <span className="text-lg">📍</span>
              <span>{location}</span>
            </div>
          )}

          {/* Funding need */}
          {contact.amountNeeded && (
            <div className="flex items-center gap-3 text-sm text-[rgba(255,255,255,0.6)]">
              <span className="text-lg">💰</span>
              <span>Needs ${contact.amountNeeded.toLocaleString()}</span>
            </div>
          )}

          {/* Source */}
          {contact.source && (
            <div className="flex items-center gap-3 text-sm text-[rgba(255,255,255,0.4)]">
              <span className="text-lg">📌</span>
              <span>{contact.source}</span>
            </div>
          )}
        </div>
      </div>

      {/* Primary CTA */}
      <a
        href={vCardUrl}
        download
        className="w-full max-w-sm flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-[#00B4B4] text-[#0A1F44] font-bold text-base hover:bg-[#00cccc] transition-colors mb-3"
      >
        📱 Save to iPhone Contacts
      </a>

      {/* Secondary actions */}
      <div className="w-full max-w-sm flex gap-3">
        {zohoUrl && (
          <a
            href={zohoUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.6)] text-sm hover:text-white hover:border-[rgba(255,255,255,0.3)] transition-colors"
          >
            Open in Zoho
          </a>
        )}
        {missionUrl && (
          <a
            href={missionUrl}
            className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.6)] text-sm hover:text-white hover:border-[rgba(255,255,255,0.3)] transition-colors"
          >
            Mission Control
          </a>
        )}
      </div>

      <p className="mt-8 text-[rgba(255,255,255,0.2)] text-xs text-center">
        SRT Agency · srtagency.com
      </p>
    </div>
  );
}
