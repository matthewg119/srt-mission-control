import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET /api/deals — list deals with contact info
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const pipeline = searchParams.get("pipeline");
    const stage = searchParams.get("stage");
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 100);

    let query = supabaseAdmin
      .from("deals")
      .select("*, contacts(id, first_name, last_name, email, phone, business_name)")
      .order("updated_at", { ascending: false })
      .limit(limit);

    if (pipeline) query = query.eq("pipeline", pipeline);
    if (stage) query = query.eq("stage", stage);

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json({ deals: data || [] });
  } catch (error) {
    console.error("Deals GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch deals" },
      { status: 500 }
    );
  }
}

// POST /api/deals — create a deal
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contact_id, pipeline, stage, amount, product_type, source, assigned_to } = body;

    if (!contact_id) {
      return NextResponse.json({ error: "contact_id is required" }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("deals")
      .insert({
        contact_id,
        pipeline: pipeline || "New Deals",
        stage: stage || "Open - Not Contacted",
        amount: amount || 0,
        product_type: product_type || null,
        source: source || "Manual",
        assigned_to: assigned_to || null,
      })
      .select()
      .single();

    if (error) throw error;

    // Log deal creation
    await supabaseAdmin.from("deal_events").insert({
      deal_id: data.id,
      event_type: "created",
      description: `Deal created manually`,
    });

    return NextResponse.json({ deal: data }, { status: 201 });
  } catch (error) {
    console.error("Deals POST error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to create deal" },
      { status: 500 }
    );
  }
}
