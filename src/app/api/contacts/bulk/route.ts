import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

interface BulkRow {
  first_name: string;
  last_name?: string;
  business_name?: string;
  email?: string;
  phone?: string;
  amount?: number;
  pipeline?: string;
  stage?: string;
  assigned_to?: string;
}

// POST /api/contacts/bulk — bulk create contacts + deals (up to 500 per batch)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const rows: BulkRow[] = body.rows;

    if (!Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "rows array is required" }, { status: 400 });
    }

    if (rows.length > 500) {
      return NextResponse.json({ error: "Max 500 rows per batch" }, { status: 400 });
    }

    // 1. Bulk insert contacts
    const contactInserts = rows.map((r) => ({
      first_name: r.first_name || "Unknown",
      last_name: r.last_name || null,
      business_name: r.business_name || null,
      email: r.email || null,
      phone: r.phone || null,
      source: "Import",
      tags: [],
    }));

    const { data: contacts, error: contactError } = await supabaseAdmin
      .from("contacts")
      .insert(contactInserts)
      .select("id");

    if (contactError) throw contactError;
    if (!contacts || contacts.length === 0) {
      return NextResponse.json({ error: "No contacts created" }, { status: 500 });
    }

    // 2. Bulk insert deals
    const dealInserts = contacts.map((c, i) => ({
      contact_id: c.id,
      pipeline: rows[i]?.pipeline || "New Deals",
      stage: rows[i]?.stage || "Open - Not Contacted",
      amount: rows[i]?.amount || 0,
      assigned_to: rows[i]?.assigned_to || null,
      source: "Import",
    }));

    const { data: deals, error: dealError } = await supabaseAdmin
      .from("deals")
      .insert(dealInserts)
      .select("id");

    if (dealError) throw dealError;

    return NextResponse.json({
      created: contacts.length,
      contacts: contacts.length,
      deals: deals?.length || 0,
    });
  } catch (error) {
    console.error("Bulk import error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Bulk import failed" },
      { status: 500 }
    );
  }
}
