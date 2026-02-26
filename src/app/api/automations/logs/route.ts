import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("automation_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    return NextResponse.json({ logs: data || [] });
  } catch (error) {
    console.error("Automation logs error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch logs" },
      { status: 500 }
    );
  }
}
