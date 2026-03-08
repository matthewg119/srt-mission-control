import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET /api/deals/[id] — single deal with contact, events, and notes
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const [dealResult, eventsResult, notesResult] = await Promise.all([
      supabaseAdmin
        .from("deals")
        .select("*, contacts(*)")
        .eq("id", id)
        .single(),
      supabaseAdmin
        .from("deal_events")
        .select("*")
        .eq("deal_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("deal_notes")
        .select("*")
        .eq("contact_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    if (dealResult.error) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    return NextResponse.json({
      deal: dealResult.data,
      events: eventsResult.data || [],
      notes: notesResult.data || [],
    });
  } catch (error) {
    console.error("Deal GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch deal" },
      { status: 500 }
    );
  }
}

// PATCH /api/deals/[id] — update deal (stage, amount, etc.)
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { stage, pipeline, amount, product_type, assigned_to } = body;

    // Get current deal for logging
    const { data: currentDeal } = await supabaseAdmin
      .from("deals")
      .select("stage, pipeline")
      .eq("id", id)
      .single();

    if (!currentDeal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (stage !== undefined) updates.stage = stage;
    if (pipeline !== undefined) updates.pipeline = pipeline;
    if (amount !== undefined) updates.amount = amount;
    if (product_type !== undefined) updates.product_type = product_type;
    if (assigned_to !== undefined) updates.assigned_to = assigned_to;

    const { data, error } = await supabaseAdmin
      .from("deals")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Log stage change if stage was updated
    if (stage && stage !== currentDeal.stage) {
      await supabaseAdmin.from("deal_events").insert({
        deal_id: id,
        event_type: "stage_change",
        description: `Moved from "${currentDeal.stage}" to "${stage}"`,
        metadata: { old_stage: currentDeal.stage, new_stage: stage, pipeline: pipeline || currentDeal.pipeline },
      });
    }

    return NextResponse.json({ deal: data });
  } catch (error) {
    console.error("Deal PATCH error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update deal" },
      { status: 500 }
    );
  }
}
