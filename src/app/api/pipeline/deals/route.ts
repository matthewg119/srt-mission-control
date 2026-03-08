import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// Lightweight endpoint to list pipeline deals for the AI planner
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("id, stage, pipeline, amount, assigned_to, contact_id, contacts(first_name, last_name, business_name)")
      .order("updated_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const deals = (data || []).map((d) => {
      const c = d.contacts as unknown as { first_name: string; last_name: string; business_name: string } | null;
      return {
        id: d.id,
        contact_name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : "Unknown",
        business_name: c?.business_name || "",
        stage: d.stage,
        amount: d.amount,
        assigned_to: d.assigned_to,
      };
    });

    return NextResponse.json({ deals });
  } catch (error) {
    console.error("Pipeline deals error:", error);
    return NextResponse.json({ deals: [] }, { status: 500 });
  }
}
