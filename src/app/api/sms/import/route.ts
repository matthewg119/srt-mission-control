// SMS Import API — parse contacts from CSV or pull from Zoho CRM.
// Returns a preview of contacts before they're committed to a campaign.
//
// POST /api/sms/import
//   body: { source: "csv", csv: "phone,first_name,business_name\n..." }
//   body: { source: "zoho", stage?: string, days_since_contact?: number, limit?: number }
//   response: { ok, contacts: [{phone, first_name, business_name, contact_id}], total, skipped }

import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/loopmessage";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const maxDuration = 60;

interface ImportedContact {
  phone: string;
  first_name: string | null;
  business_name: string | null;
  contact_id: string | null;
}

// POST — parse and return contacts preview
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const source = body.source as string;

  if (source === "csv") {
    return handleCsvImport(body);
  } else if (source === "zoho") {
    return handleZohoImport(body);
  }

  return NextResponse.json({ error: "source must be 'csv' or 'zoho'" }, { status: 400 });
}

async function handleCsvImport(body: Record<string, unknown>): Promise<NextResponse> {
  const csv = body.csv as string | undefined;
  if (!csv || typeof csv !== "string") {
    return NextResponse.json({ error: "csv string required" }, { status: 400 });
  }

  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });
  }

  // Detect column indices from header
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/[^a-z_]/g, ""));
  const phoneIdx = headers.findIndex((h) => h.includes("phone") || h === "mobile" || h === "tel");
  const firstIdx = headers.findIndex((h) => h.includes("first") || h === "name");
  const bizIdx = headers.findIndex((h) => h.includes("business") || h.includes("company") || h.includes("biz"));

  if (phoneIdx === -1) {
    return NextResponse.json({ error: "CSV must have a 'phone' column" }, { status: 400 });
  }

  const contacts: ImportedContact[] = [];
  let skipped = 0;

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
    const rawPhone = cols[phoneIdx] ?? "";
    const phone = normalizePhone(rawPhone);

    if (!phone) {
      skipped++;
      continue;
    }

    // Try to match an existing contact in DB
    const { data: dbContact } = await supabaseAdmin
      .from("contacts")
      .select("id")
      .eq("phone", phone)
      .maybeSingle();

    contacts.push({
      phone,
      first_name: firstIdx !== -1 ? (cols[firstIdx] || null) : null,
      business_name: bizIdx !== -1 ? (cols[bizIdx] || null) : null,
      contact_id: dbContact?.id ?? null,
    });
  }

  return NextResponse.json({ ok: true, contacts, total: contacts.length, skipped });
}

async function handleZohoImport(body: Record<string, unknown>): Promise<NextResponse> {
  const stage = (body.stage as string | undefined) ?? "New";
  const daysSince = (body.days_since_contact as number | undefined) ?? 30;
  const limit = Math.min((body.limit as number | undefined) ?? 500, 2000);

  try {
    // Lazy-import zoho to avoid edge runtime issues
    const { zohoRequest } = await import("@/lib/zoho");

    // Zoho COQL query — leads in the target stage not contacted recently
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);
    const cutoffStr = cutoff.toISOString().split("T")[0]; // YYYY-MM-DD

    const params = new URLSearchParams({
      criteria: `(Lead_Status:equals:${stage})AND(Last_Activity_Time:before:${cutoffStr})`,
      fields: "First_Name,Last_Name,Phone,Mobile,Company,id",
      per_page: String(Math.min(limit, 200)),
    });

    const result = await zohoRequest("GET", `/Leads/search?${params.toString()}`) as {
      data?: Array<Record<string, string | null>>;
    };

    const zohoLeads = result.data ?? [];
    const contacts: ImportedContact[] = [];
    let skipped = 0;

    for (const lead of zohoLeads) {
      const rawPhone = (lead.Phone ?? lead.Mobile ?? "") as string;
      const phone = normalizePhone(rawPhone);
      if (!phone) {
        skipped++;
        continue;
      }

      // Try to match existing contact in our DB
      const { data: dbContact } = await supabaseAdmin
        .from("contacts")
        .select("id")
        .eq("phone", phone)
        .maybeSingle();

      contacts.push({
        phone,
        first_name: (lead.First_Name as string | null) ?? null,
        business_name: (lead.Company as string | null) ?? null,
        contact_id: dbContact?.id ?? null,
      });
    }

    return NextResponse.json({ ok: true, contacts, total: contacts.length, skipped, source_count: zohoLeads.length });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: `Zoho pull failed: ${msg}` }, { status: 500 });
  }
}
