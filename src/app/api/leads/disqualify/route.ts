import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getCorsHeaders } from "@/lib/lead-validation";
import { updateLead as zohoUpdateLead } from "@/lib/zoho";
import { postOrThreadLeadUpdate } from "@/lib/lead-thread";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

// POST /api/leads/disqualify
//
// Called from gated funnels (e.g. /bfunding v4) when an applicant fails a
// pre-qualification check AFTER their initial Lead has been captured. Marks
// the lead as DNQ and lets the existing Zoho-webhook → Meta CAPI pathway fire
// the DNQ event. We deliberately do NOT call sendEvent() here — single-path
// firing keeps us consistent with the manual-DNQ flow in Zoho and avoids
// double-counting in Meta.
//
// Body: { contactId?, email?, monthlyRevenue, amountNeeded?, reason, source,
//         _fbc?, _fbp?, fbclid? }
// Returns: { success: true, disqualified: true }
export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);

  try {
    const body = await request.json();
    const {
      contactId,
      email,
      monthlyRevenue,
      amountNeeded,
      reason,
      source,
    } = body as {
      contactId?: string;
      email?: string;
      monthlyRevenue?: number | string;
      amountNeeded?: string;
      reason?: string;
      source?: string;
    };

    if (!contactId && !email) {
      return NextResponse.json(
        { error: "contactId or email required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Look up the contact
    const lookup = contactId
      ? await supabaseAdmin
          .from("contacts")
          .select("id, email, first_name, last_name, zoho_lead_id, application_stage")
          .eq("id", contactId)
          .maybeSingle()
      : await supabaseAdmin
          .from("contacts")
          .select("id, email, first_name, last_name, zoho_lead_id, application_stage")
          .ilike("email", (email as string).trim())
          .limit(1)
          .maybeSingle();

    const contact = lookup.data;
    if (!contact) {
      return NextResponse.json(
        { error: "contact_not_found" },
        { status: 404, headers: corsHeaders }
      );
    }

    const parsedRevenue =
      typeof monthlyRevenue === "number"
        ? monthlyRevenue
        : parseInt(String(monthlyRevenue || "").replace(/[^\d]/g, ""), 10) || null;

    const contactName =
      [contact.first_name, contact.last_name].filter(Boolean).join(" ") ||
      contact.email ||
      "Unknown";

    // 1. Mark the contact as DNQ in Supabase. application_stage maps to
    //    Zoho Lead_Status via field-map.ts, so this mirrors the Zoho write.
    try {
      await supabaseAdmin
        .from("contacts")
        .update({
          ...(parsedRevenue ? { monthly_revenue: parsedRevenue } : {}),
          ...(amountNeeded ? { amount_needed: amountNeeded } : {}),
          application_stage: "DNQ",
          dnq_reason: reason || "auto_dnq",
        })
        .eq("id", contact.id);
    } catch (err) {
      console.error("[disqualify] contact update failed:", err instanceof Error ? err.message : err);
    }

    // 2. Move the lead's deal (if any) directly into "Dead Declined".
    //    Writing to Supabase directly (not via PATCH /api/deals/[id]) so the
    //    existing deal-stage-change Meta CAPI firing does NOT trigger — we
    //    want the Zoho webhook path to be the single source of Meta DNQ.
    try {
      const { data: deal } = await supabaseAdmin
        .from("deals")
        .select("id, stage, pipeline")
        .eq("contact_id", contact.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (deal && deal.stage !== "Dead Declined") {
        await supabaseAdmin
          .from("deals")
          .update({
            stage: "Dead Declined",
            pipeline: "Active Deals",
            updated_at: new Date().toISOString(),
          })
          .eq("id", deal.id);

        await supabaseAdmin.from("deal_events").insert({
          deal_id: deal.id,
          event_type: "stage_change",
          description: `Auto-DNQ — ${reason || "below revenue threshold"}`,
          metadata: {
            old_stage: deal.stage,
            new_stage: "Dead Declined",
            pipeline: "Active Deals",
            reason,
            monthlyRevenue: parsedRevenue,
            source,
            auto: true,
          },
        });
      }
    } catch (err) {
      console.error("[disqualify] deal update failed:", err instanceof Error ? err.message : err);
    }

    // 3. Push Lead_Status="DNQ" to Zoho. This is what triggers the Zoho
    //    workflow → /api/webhooks/zoho-lead → Meta CAPI DNQ event (gated by
    //    attribution inside the webhook). If Zoho update fails, Meta won't
    //    see the DNQ — log loudly.
    if (contact.zoho_lead_id) {
      try {
        await zohoUpdateLead(contact.zoho_lead_id, {
          Lead_Status: "DNQ",
          ...(parsedRevenue ? { Monthly_Revenue: parsedRevenue } : {}),
          ...(amountNeeded ? { Funding_Amount_Requested: amountNeeded } : {}),
        });
      } catch (err) {
        console.error("[disqualify] Zoho updateLead failed:", err instanceof Error ? err.message : err);
        try {
          await supabaseAdmin.from("system_logs").insert({
            event_type: "lead_auto_dnq_error",
            description: `Zoho DNQ update failed for ${contactName}`,
            metadata: { contactId: contact.id, reason, error: err instanceof Error ? err.message : String(err) },
          });
        } catch { /* ignore */ }
      }
    }

    // 4. Audit trail
    try {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_auto_dnq",
        description: `${contactName} auto-DNQ'd (${reason || "unspecified"}) — revenue $${parsedRevenue ?? "?"}`,
        metadata: {
          contactId: contact.id,
          email: contact.email,
          reason,
          monthlyRevenue: parsedRevenue,
          source,
        },
      });
    } catch { /* ignore */ }

    // 5. Slack thread reply — piggyback on the existing lead thread.
    postOrThreadLeadUpdate({ contactId: contact.id, action: "auto_dnq" })
      .catch(err => console.error("[disqualify] slack thread reply failed:", err instanceof Error ? err.message : err));

    return NextResponse.json(
      { success: true, disqualified: true },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("[disqualify] unexpected error:", error instanceof Error ? error.message : error);
    return NextResponse.json(
      { error: "internal_error" },
      { status: 500, headers: corsHeaders }
    );
  }
}
