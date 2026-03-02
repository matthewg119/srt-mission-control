import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// Lightweight endpoint to list pipeline deals for the AI planner
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("pipeline_cache")
      .select("id, contact_name, business_name, stage, amount, assigned_to")
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return NextResponse.json({ deals: data || [] });
  } catch (error) {
    console.error("Pipeline deals error:", error);
    return NextResponse.json({ deals: [] }, { status: 500 });
  }
}
