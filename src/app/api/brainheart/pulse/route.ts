import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const dynamic = "force-dynamic";

// GET /api/brainheart/pulse — get latest pulse
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("brainheart_pulses")
      .select("id, pulse_type, summary, metrics, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ pulse: null });
    }

    return NextResponse.json({ pulse: data });
  } catch {
    return NextResponse.json({ pulse: null });
  }
}
