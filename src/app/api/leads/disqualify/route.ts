export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { getCorsHeaders } from "@/lib/lead-validation";
import { setLeadStatus, addNote } from "@/lib/crm";
import { STAGE_CLOSED } from "@/config/stage-display";
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
// the lead as DNQ, writes the reason onto the timeline and fires the Meta CAPI
// DNQ event. The deterministic eventId keeps the browser pixel and this fire
// deduped to a single Meta event.
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
          .select("id, email, first_name, last_name, application_stage, phone, mobile_phone, fbc, fbp")
          .eq("id", contactId)
          .maybeSingle()
      : await supabaseAdmin
          .from("contacts")
          .select("id, email, first_name, last_name, application_stage, phone, mobile_phone, fbc, fbp")
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

    // 1. Mark the contact as DNQ in Supabase.
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

    // 2. Close the lead out.
    //    The `deals` table went with the funding business, so the DNQ lands on
    //    contacts.application_stage instead. Written through setLeadStatus so
    //    it leaves a lead_status_history row and a status_change activity.
    try {
      await setLeadStatus({
        contactId: contact.id,
        status: STAGE_CLOSED,
        reason: `Auto-DNQ - ${reason || "below revenue threshold"}`,
        origin: "webhook",
        actor: "leads/disqualify",
      });
    } catch (e) {
      console.error("[leads/disqualify] status write failed:", (e as Error).message);
    }

    // 3. Close the lead out and record why.
    const parsedAmountNeeded =
      amountNeeded ? parseInt(String(amountNeeded).replace(/[^\d]/g, ""), 10) || null : null;

    // 3a. Flip the stage to the terminal-declined value and record why.
    const statusRes = await setLeadStatus({
      contactId: contact.id as string,
      status: "Dead Declined",
      reason,
      origin: "mission_control",
    });
    if (!statusRes.ok) {
      console.error("[disqualify] status write failed:", statusRes.error);
      try {
        await supabaseAdmin.from("system_logs").insert({
          event_type: "lead_auto_dnq_error",
          description: `DNQ status write failed for ${contactName}`,
          metadata: { contactId: contact.id, reason, error: statusRes.error },
        });
      } catch { /* ignore */ }
    }

    // 3b. The note is what the sales team actually reads.
    const noteLines: string[] = ["Auto-DNQ — below revenue threshold"];
    if (parsedRevenue) noteLines.push(`Monthly Revenue: $${parsedRevenue.toLocaleString()}`);
    if (amountNeeded || parsedAmountNeeded) {
      noteLines.push(`Requested: ${amountNeeded || "$" + parsedAmountNeeded!.toLocaleString()}`);
    }
    if (reason) noteLines.push(`Reason: ${reason}`);
    if (source) noteLines.push(`Source: ${source}`);
    await addNote({
      contactId: contact.id as string,
      title: "Auto-DNQ",
      content: noteLines.join("\n"),
      origin: "webhook",
      actor: "disqualify",
    });

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

    // 6. Meta CAPI DNQ. Deterministic eventId `dnq_<contactId>` means the
    //    browser DNQ pixel and this CAPI fire dedup to a single Meta event —
    //    redundant paths, one count. Gated on attribution (body _fbc, or the
    //    contact's stored fbc), same as every other funnel event.
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
