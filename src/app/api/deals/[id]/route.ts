import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";
import { updateLead as updateZohoLead } from "@/lib/zoho";
import { onPreApproved } from "@/lib/ai-intel/pre-approved-handler";

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

    // Get current deal for logging + Zoho forward
    const { data: currentDeal } = await supabaseAdmin
      .from("deals")
      .select("stage, pipeline, zoho_stage, contact_id, contacts(zoho_lead_id)")
      .eq("id", id)
      .single();

    if (!currentDeal) {
      return NextResponse.json({ error: "Deal not found" }, { status: 404 });
    }

    // Only sync terminal/key lead stages to Zoho — keeps outbound webhook count well under
    // the 100/day org limit. Intermediate deal stages (Contracts Out, Pending Stips, etc.)
    // are Supabase-only and never need to appear in the CRM lead record.
    const ZOHO_SYNC_STAGES = new Set([
      "Working - Contacted",
      "Working - Application Out",
      "Dead Declined",
      "Closed - Not Converted",
      "Converted",
    ]);
    if (stage !== undefined && stage !== currentDeal.stage && ZOHO_SYNC_STAGES.has(stage)) {
      const contactRef = (currentDeal as unknown as { contacts?: { zoho_lead_id?: string | null } }).contacts;
      const zohoLeadId = contactRef?.zoho_lead_id ?? null;
      if (zohoLeadId) {
        try {
          await updateZohoLead(zohoLeadId, { Lead_Status: stage });
        } catch (e) {
          console.error("[deals PATCH] Zoho stage forward failed:", (e as Error).message);
          // Non-fatal — Supabase update below still runs so the user isn't stuck.
        }
      }
    }

    // Pre-Approved no longer syncs to Zoho (saves a webhook), so call the handler directly.
    if (stage === "Pre-Approved" && stage !== currentDeal.stage) {
      onPreApproved(id).catch((e: Error) =>
        console.error("[deals PATCH] onPreApproved failed:", e.message)
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (stage !== undefined) {
      updates.stage = stage;        // legacy column — will be dropped once Meta CAPI
      updates.zoho_stage = stage;   // block is moved behind the Zoho webhook
    }
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

      // Fire Meta CAPI events for three stage types only — requires real Meta ad attribution.
      // Working = application out (high-intent signal); DNQ = disqualified; Converted = funded/won.
      const fireWorking = stage === "Working - Application Out";
      const fireDnq = stage === "Dead Declined";
      const fireConverted = stage === "Converted";
      if (fireWorking || fireDnq || fireConverted) {
        const contactId = (data as { contact_id?: string }).contact_id;
        if (contactId) {
          const { data: contact } = await supabaseAdmin
            .from("contacts")
            .select("id, email, phone, mobile_phone, first_name, last_name, fbc, fbp")
            .eq("id", contactId)
            .maybeSingle();

          if (contact && hasMetaAttributionServer({ fbc: contact.fbc })) {
            const baseUserData = {
              email: contact.email || undefined,
              phone: contact.phone || contact.mobile_phone || undefined,
              firstName: contact.first_name || undefined,
              lastName: contact.last_name || undefined,
              externalId: contact.id,
              fbc: contact.fbc || undefined,
              fbp: contact.fbp || undefined,
            };

            if (fireWorking) {
              await sendEvent({
                eventName: "Lead",
                actionSource: "system_generated",
                userData: baseUserData,
                customData: { content_name: "Application Out" },
              });
              console.log(`[Meta CAPI] Lead (Working) event fired for deal ${id}`);
            } else if (fireDnq) {
              await sendEvent({
                eventName: "DNQ",
                actionSource: "system_generated",
                userData: baseUserData,
                customData: { content_name: "Did Not Qualify", source: "deal_stage_change" },
              });
              console.log(`[Meta CAPI] DNQ event fired for deal ${id}`);
            } else if (fireConverted) {
              const dealAmount = (data as { agreement_amount?: number; amount?: number }).agreement_amount
                || (data as { agreement_amount?: number; amount?: number }).amount;
              await sendEvent({
                eventName: "Purchase",
                actionSource: "system_generated",
                userData: baseUserData,
                customData: { value: dealAmount, currency: "USD", content_name: "Business Funding" },
              });
              console.log(`[Meta CAPI] Purchase (Converted) event fired for deal ${id}, amount: ${dealAmount}`);
            }
          } else if (contact) {
            const label = fireWorking ? "Lead/Working" : fireDnq ? "DNQ" : "Purchase/Converted";
            console.log(`[Meta CAPI] Skipped ${label} for deal ${id} — contact has no Meta attribution`);
          }
        }
      }
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
