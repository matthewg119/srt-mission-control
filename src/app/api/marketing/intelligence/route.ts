import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET: Fetch ad intelligence reports from system_logs
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("system_logs")
      .select("id, description, metadata, created_at")
      .eq("event_type", "ad_intelligence")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) throw error;

    return NextResponse.json({ reports: data || [] });
  } catch (error) {
    console.error("Intelligence fetch error:", error);
    return NextResponse.json({ reports: [] }, { status: 500 });
  }
}
