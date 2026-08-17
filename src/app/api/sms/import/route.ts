export const dynamic = "force-dynamic";
// SMS Import API — parse contacts from CSV or pull from the CRM.
// Returns a preview of contacts before they're committed to a campaign.
//
// POST /api/sms/import
//   body: { source: "csv", csv: "phone,first_name,business_name\n..." }
//   body: { source: "crm" | "zoho", stage?: string, days_since_contact?: number, limit?: number }
//   response: { ok, contacts: [{phone, first_name, business_name, contact_id}], total, skipped }
//
// "zoho" is still accepted as a source name so the shipped dialer keeps working.
// It reads `contacts` like everything else now.

import { NextRequest, NextResponse } from "next/server";
import { normalizePhone } from "@/lib/phone";
import { supabaseAdmin } from "@/lib/db";
import { normalizeStage } from "@/config/stage-display";

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
  } else if (source === "crm" || source === "zoho") {
    return handleCrmImport(body);
  }

  return NextResponse.json({ error: "source must be 'csv' or 'crm'" }, { status: 400 });
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

// ‼️ This used to reach Zoho through a DYNAMIC `await import("@/lib/zoho")`,
// which a static grep for the module does not see. It is the one call that
// would have survived the whole cutover silently and then 500'd the first time
// somebody pulled a texting list after the account was closed.
//
// The COQL search is now a `contacts` query. Two mapping notes:
//   • Lead_Status became application_stage, and its vocabulary changed with the
//     stage collapse. The caller's value goes through normalizeStage(), so a
//     dialer still sending a pre-collapse label lands on a real stage instead
//     of quietly matching nothing.
//   • Last_Activity_Time became last_activity_at. Rows that have never had any
//     activity are INCLUDED, which is the intent of "not contacted in N days".
//     Zoho's `before:` comparison dropped them, so the list used to silently
//     exclude exactly the leads most worth texting.
async function handleCrmImport(body: Record<string, unknown>): Promise<NextResponse> {
  const stage = normalizeStage((body.stage as string | undefined) ?? null);
  const daysSince = (body.days_since_contact as number | undefined) ?? 30;
  const limit = Math.min((body.limit as number | undefined) ?? 500, 2000);

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysSince);

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .select("id, first_name, business_name, phone, mobile_phone, last_activity_at")
      .eq("application_stage", stage)
      .or(`last_activity_at.is.null,last_activity_at.lt.${cutoff.toISOString()}`)
      .eq("do_not_contact", false)
      .limit(limit);

    if (error) {
      return NextResponse.json({ error: `CRM pull failed: ${error.message}` }, { status: 500 });
    }

    const rows = data ?? [];
    const contacts: ImportedContact[] = [];
    let skipped = 0;

    for (const row of rows) {
      const phone = normalizePhone(
        (row.mobile_phone as string | null) ?? (row.phone as string | null) ?? ""
      );
      if (!phone) {
        skipped++;
        continue;
      }
      contacts.push({
        phone,
        first_name: (row.first_name as string | null) ?? null,
        business_name: (row.business_name as string | null) ?? null,
        contact_id: row.id as string,
      });
    }

    return NextResponse.json({
      ok: true,
      contacts,
      total: contacts.length,
      skipped,
      source_count: rows.length,
      stage,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unknown";
    return NextResponse.json({ error: `CRM pull failed: ${msg}` }, { status: 500 });
  }
}
