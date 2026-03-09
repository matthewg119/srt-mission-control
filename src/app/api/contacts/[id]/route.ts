import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// PATCH /api/contacts/[id] — update contact fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const allowedFields = [
      "first_name", "last_name", "email", "phone", "mobile_phone", "additional_phone",
      "business_name", "legal_name", "dba", "industry", "ein", "incorporation_date",
      "address_street", "address_city", "address_state", "address_zip",
      "dob", "credit_score_range", "ownership_pct", "ssn_last4", "home_address",
      "funding_amount_requested", "use_of_funds", "monthly_deposits", "existing_loans",
      "title", "iso", "fax", "website", "program_type", "lead_owner", "notes", "source",
    ];

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const field of allowedFields) {
      if (body[field] !== undefined) updates[field] = body[field];
    }

    if (Object.keys(updates).length <= 1) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ contact: data });
  } catch (error) {
    console.error("Contact PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update contact" },
      { status: 500 }
    );
  }
}
