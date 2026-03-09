import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

// GET /api/deals/[id] — single deal with contact, events, and notes
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Get deal first to extract contact_id for notes query
    const dealResult = await supabaseAdmin
      .from("deals")
      .select("*, contacts(*)")
      .eq("id", id)
      .single();

    if (dealResult.error) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    const contactId = (dealResult.data as { contact_id?: string }).contact_id;

    const [eventsResult, notesResult] = await Promise.all([
      supabaseAdmin
        .from("deal_events")
        .select("*")
        .eq("deal_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("deal_notes")
        .select("*")
        .or(`deal_id.eq.${id}${contactId ? `,contact_id.eq.${contactId}` : ""}`)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

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

// PATCH /api/deals/[id] — update deal fields
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    const {
      stage, pipeline, amount, product_type, assigned_to,
      agreement_amount, repayment_amount, num_payments, payment_frequency, payment_method,
      buy_rate, sell_rate, underwriting_fee, bank_wire_fee, lender_origination_fee,
      ucc_filing_fee, selected_lender, bank_name, bank_account, routing_number,
    } = body;

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
    if (agreement_amount !== undefined) updates.agreement_amount = agreement_amount;
    if (repayment_amount !== undefined) updates.repayment_amount = repayment_amount;
    if (num_payments !== undefined) updates.num_payments = num_payments;
    if (payment_frequency !== undefined) updates.payment_frequency = payment_frequency;
    if (payment_method !== undefined) updates.payment_method = payment_method;
    if (buy_rate !== undefined) updates.buy_rate = buy_rate;
    if (sell_rate !== undefined) updates.sell_rate = sell_rate;
    if (underwriting_fee !== undefined) updates.underwriting_fee = underwriting_fee;
    if (bank_wire_fee !== undefined) updates.bank_wire_fee = bank_wire_fee;
    if (lender_origination_fee !== undefined) updates.lender_origination_fee = lender_origination_fee;
    if (ucc_filing_fee !== undefined) updates.ucc_filing_fee = ucc_filing_fee;
    if (selected_lender !== undefined) updates.selected_lender = selected_lender;
    if (bank_name !== undefined) updates.bank_name = bank_name;
    if (bank_account !== undefined) updates.bank_account = bank_account;
    if (routing_number !== undefined) updates.routing_number = routing_number;

    const { data, error } = await supabaseAdmin
      .from("deals")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;

    // Log stage change
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
