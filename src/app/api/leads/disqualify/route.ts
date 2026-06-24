export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getCorsHeaders } from "@/lib/lead-validation";
import { updateLead as zohoUpdateLead, addNoteToLead as zohoAddNote } from "@/lib/zoho";
import { postOrThreadLeadUpdate } from "@/lib/lead-thread";
import { sendEvent } from "@/lib/meta-capi";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";

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
      _fbc,
      _fbp,
    } = body as {
      contactId?: string;
      email?: string;
      monthlyRevenue?: number | string;
      amountNeeded?: string;
      reason?: string;
      source?: string;
      _fbc?: string;
      _fbp?: string;
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
          .select("id, email, first_name, last_name, zoho_lead_id, application_stage, phone, mobile_phone, fbc, fbp")
          .eq("id", contactId)
          .maybeSingle()
      : await supabaseAdmin
          .from("contacts")
          .select("id, email, first_name, last_name, zoho_lead_id, application_stage, phone, mobile_phone, fbc, fbp")
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
    //
    //    Zoho's Funding_Amount_Requested / Monthly_Revenue fields are typed
    //    as Currency and silently reject strings with "$" or commas AND
    //    reject the entire PUT when any one field is invalid. So we send
    //    Lead_Status in its own call (guaranteed to land) and put the
    //    funding/revenue context into a Note — same pattern the 25%+ block
    //    uses via buildLeadMagnetNote().
    //
    //    Parse amountNeeded into a plain integer so we can ALSO attempt the
    //    structured fields in a separate best-effort call.
    const parsedAmountNeeded =
      amountNeeded ? parseInt(String(amountNeeded).replace(/[^\d]/g, ""), 10) || null : null;

    if (contact.zoho_lead_id) {
      // 3a. Critical: flip Lead_Status to the terminal-declined picklist value.
      //     Try candidates in priority order — first that lands wins. Zoho's
      //     picklist values are configured per-org; "Dead Declined" matches
      //     TERMINAL_ZOHO_STATUSES in zoho-guardian and is the most likely
      //     valid value. "DNQ" is what the webhook reader checks for — keep
      //     it as a fallback in case that is configured too.
      const statusCandidates = ["Dead Declined", "DNQ", "Declined", "Dead"];
      let landedStatus: string | null = null;
      const attemptErrors: Array<{ status: string; error: string }> = [];
      for (const candidate of statusCandidates) {
        try {
          await zohoUpdateLead(contact.zoho_lead_id, { Lead_Status: candidate });
          landedStatus = candidate;
          break;
        } catch (err) {
          attemptErrors.push({ status: candidate, error: err instanceof Error ? err.message : String(err) });
        }
      }
      if (!landedStatus) {
        console.error("[disqualify] All Zoho Lead_Status candidates rejected:", JSON.stringify(attemptErrors));
        try {
          await supabaseAdmin.from("system_logs").insert({
            event_type: "lead_auto_dnq_error",
            description: `Zoho DNQ Lead_Status update failed for ${contactName} — all picklist candidates rejected`,
            metadata: { contactId: contact.id, zohoLeadId: contact.zoho_lead_id, reason, attempts: attemptErrors },
          });
        } catch { /* ignore */ }
      } else {
        console.log(`[disqualify] Zoho Lead_Status landed as "${landedStatus}" for ${contactName}`);
      }

      // 3b. Best-effort: try to populate the structured Currency fields
      //     using numbers (so Zoho doesn't reject). Failure here is fine —
      //     the Note below is the reliable record.
      try {
        const structuredUpdate: Record<string, unknown> = {};
        if (parsedRevenue) structuredUpdate.Monthly_Revenue = parsedRevenue;
        if (parsedAmountNeeded) structuredUpdate.Funding_Amount_Requested = parsedAmountNeeded;
        if (Object.keys(structuredUpdate).length > 0) {
          await zohoUpdateLead(contact.zoho_lead_id, structuredUpdate);
        }
      } catch (err) {
        console.warn("[disqualify] Zoho structured-field update skipped:", err instanceof Error ? err.message : err);
      }

      // 3c. Always attach a Note — this is what the sales team actually
      //     reads. Safe if any structured field write failed.
      try {
        const noteLines: string[] = ["Auto-DNQ — below revenue threshold"];
        if (parsedRevenue) noteLines.push(`Monthly Revenue: $${parsedRevenue.toLocaleString()}`);
        if (amountNeeded || parsedAmountNeeded) {
          noteLines.push(`Funding Requested: ${amountNeeded || "$" + parsedAmountNeeded!.toLocaleString()}`);
        }
        if (reason) noteLines.push(`Reason: ${reason}`);
        if (source) noteLines.push(`Source: ${source}`);
        await zohoAddNote(contact.zoho_lead_id, "Auto-DNQ", noteLines.join("\n"));
      } catch (err) {
        console.error("[disqualify] Zoho addNote failed:", err instanceof Error ? err.message : err);
      }
    } else {
      console.warn(`[disqualify] contact ${contact.id} has no zoho_lead_id — skipping Zoho update`);
      try {
        await supabaseAdmin.from("system_logs").insert({
          event_type: "lead_auto_dnq_error",
          description: `Zoho DNQ skipped for ${contactName} — contact has no zoho_lead_id`,
          metadata: { contactId: contact.id, reason },
        });
      } catch { /* ignore */ }
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

    // 6. Meta CAPI DNQ — fire directly (don't rely solely on the Zoho-webhook
    //    path, which silently drops the event whenever zoho_lead_id is missing,
    //    Lead_Status fails to land, or the webhook doesn't fire). Deterministic
    //    eventId `dnq_<contactId>` means the browser DNQ pixel, this CAPI fire,
    //    and the Zoho-webhook DNQ all dedup to a single Meta event — redundant
    //    paths, one count. Gated on attribution (body _fbc, or the contact's
    //    stored fbc), same as every other funnel event.
    const dnqFbc = _fbc || contact.fbc || undefined;
    const dnqFbp = _fbp || contact.fbp || undefined;
    if (hasMetaAttributionServer({ fbc: dnqFbc })) {
      try {
        const capiResult = await sendEvent({
          eventName: "DNQ",
          actionSource: "system_generated",
          eventId: `dnq_${contact.id}`,
          userData: {
            email: contact.email || undefined,
            phone: contact.mobile_phone || contact.phone || undefined,
            firstName: contact.first_name || undefined,
            lastName: contact.last_name || undefined,
            fbc: dnqFbc,
            fbp: dnqFbp,
            externalId: contact.id || undefined,
          },
          customData: { content_name: "Did Not Qualify" },
        });
        if (!capiResult.success) {
          console.error("[disqualify] Meta CAPI DNQ event failed:", capiResult.error);
        }
      } catch (err) {
        console.error("[disqualify] Meta CAPI DNQ event error:", err instanceof Error ? err.message : err);
      }
    }

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
