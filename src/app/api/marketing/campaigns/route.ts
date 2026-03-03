import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET: Fetch approved ad campaigns from system_logs
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("system_logs")
      .select("id, description, metadata, created_at")
      .eq("event_type", "ad_approved")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) throw error;

    return NextResponse.json({ campaigns: data || [] });
  } catch (error) {
    console.error("Campaigns fetch error:", error);
    return NextResponse.json({ campaigns: [] }, { status: 500 });
  }
}

// POST: Save an approved ad campaign
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { hook, primaryText, headline, description, visualConcept, cta, buyingBelief, angle, vertical, layer } = body;

    const { error } = await supabaseAdmin.from("system_logs").insert({
      event_type: "ad_approved",
      description: `Approved ad: ${hook} [${vertical} / ${layer}]`,
      metadata: {
        hook,
        primaryText,
        headline,
        description,
        visualConcept,
        cta,
        buyingBelief,
        angle,
        vertical,
        layer,
        approved_at: new Date().toISOString(),
      },
    });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Campaign save error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save campaign" },
      { status: 500 }
    );
  }
}
