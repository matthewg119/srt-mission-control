import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET /api/contacts — list/search contacts
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);
    const offset = parseInt(searchParams.get("offset") || "0");

    let dbQuery = supabaseAdmin
      .from("contacts")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (query) {
      dbQuery = dbQuery.or(
        `first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%,phone.ilike.%${query}%,business_name.ilike.%${query}%`
      );
    }

    const { data, count, error } = await dbQuery;
    if (error) throw error;

    return NextResponse.json({ contacts: data || [], total: count || 0 });
  } catch (error) {
    console.error("Contacts GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch contacts" },
      { status: 500 }
    );
  }
}

// POST /api/contacts — create a contact
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { first_name, last_name, email, phone, business_name, source, tags, ...rest } = body;

    if (!first_name) {
      return NextResponse.json({ error: "first_name is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("contacts")
      .insert({
        first_name,
        last_name: last_name || null,
        email: email || null,
        phone: phone || null,
        business_name: business_name || null,
        source: source || "Manual",
        tags: tags || [],
        ...rest,
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ contact: data }, { status: 201 });
  } catch (error) {
    console.error("Contacts POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create contact" },
      { status: 500 }
    );
  }
}
