import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";
import { NEW_DEALS_PIPELINE } from "@/config/pipeline";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * Progressive application capture.
 * - At 25% (Contact Info): Creates GHL contact + opportunity. Returns IDs.
 * - 25-99%: Updates existing contact with new fields as they come in.
 * - At 100%: Final enrichment with all custom fields + pipeline cache.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      firstName,
      lastName,
      email,
      businessPhone,
      businessName,
      legalName,
      dba,
      industry,
      bizAddress,
      bizCity,
      bizState,
      bizZip,
      ein,
      startMonth,
      startYear,
      mobilePhone,
      dob,
      creditScore,
      ownership,
      amountNeeded,
      useOfFunds,
      monthlyDeposits,
      existingLoans,
      notes,
      applicationCompletionPct,
      applicationStage,
      source,
    } = body;

    // IDs passed from frontend (cached after first creation)
    let contactId: string | null = (body.contactId as string) || null;
    let opportunityId: string | null = (body.opportunityId as string) || null;

    const completionPct = applicationCompletionPct || 0;
    const contactName = [firstName, lastName].filter(Boolean).join(" ") || businessName || "Unknown";

    // ── Early progress (under 25%) — just log ──
    if (completionPct < 25) {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "application_progress",
        description: `Application started: ${completionPct}% (${applicationStage || "qualifying"})`,
        metadata: { ...body, completionPct },
      });

      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%` },
        { headers: CORS_HEADERS }
      );
    }

    // ── 25%+ and no contactId yet — create the lead ──
    if (!contactId && (email || businessPhone)) {
      // Create contact in GHL
      try {
        const contactData = await ghl.createContact({
          firstName: firstName || "",
          lastName: lastName || "",
          email: email || undefined,
          phone: mobilePhone || businessPhone || undefined,
          companyName: businessName || undefined,
          source: source || "Website - Application Form",
          tags: ["application", "website-lead"],
        });
        const contact = contactData.contact as Record<string, unknown> | undefined;
        contactId = (contact?.id as string) || (contactData.id as string) || null;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error("Contact creation error:", errMsg);
        // Try to find existing contact by email
        if (email) {
          const searchResult = await ghl.searchContacts(email);
          const contacts = (searchResult.contacts as Array<Record<string, unknown>>) || [];
          if (contacts.length > 0) {
            contactId = contacts[0].id as string;
          }
        }
      }

      // Create opportunity in New Deals pipeline
      if (contactId) {
        try {
          const stageId = await lookupNewLeadStageId();
          if (stageId) {
            const oppData = await ghl.createOpportunity({
              pipelineId: NEW_DEALS_PIPELINE.id,
              pipelineStageId: stageId,
              contactId,
              name: `${contactName} - ${businessName || "Application"}`.trim(),
              status: "open",
              source: source || "Website - Application",
            });
            const opp = oppData.opportunity as Record<string, unknown> | undefined;
            opportunityId = (opp?.id as string) || (oppData.id as string) || null;
          }
        } catch (error) {
          console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
        }

        // Cache in pipeline for instant visibility
        if (opportunityId) {
          await supabaseAdmin.from("pipeline_cache").upsert({
            ghl_opportunity_id: opportunityId,
            contact_name: contactName,
            business_name: businessName || null,
            stage: "New Lead",
            pipeline_name: "New Deals",
            amount: 0,
            ghl_contact_id: contactId,
            updated_at: new Date().toISOString(),
          }, { onConflict: "ghl_opportunity_id" });
        }
      }

      // Log lead creation
      await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_capture",
        description: `Lead captured at ${completionPct}%: ${contactName} (${email || businessPhone})`,
        metadata: { contactId, opportunityId, contactName, email, phone: businessPhone, completionPct },
      });

      return NextResponse.json(
        { success: true, message: "Lead created", contactId, opportunityId },
        { headers: CORS_HEADERS }
      );
    }

    // ── 25-99% with existing contactId — update contact with new data ──
    if (contactId && completionPct < 100) {
      const updates = buildCustomFieldUpdates(body, completionPct);
      if (updates.length > 0) {
        try {
          await ghl.updateContact(contactId, { customFields: updates });
        } catch {
          console.error("Failed to update contact fields — non-critical");
        }
      }

      // Update contact name/company if we have more info now
      try {
        const contactUpdates: Record<string, unknown> = {};
        if (firstName) contactUpdates.firstName = firstName;
        if (lastName) contactUpdates.lastName = lastName;
        if (mobilePhone) contactUpdates.phone = mobilePhone;
        if (legalName || businessName) contactUpdates.companyName = legalName || businessName;
        if (bizAddress) contactUpdates.address1 = bizAddress;
        if (bizCity) contactUpdates.city = bizCity;
        if (bizState) contactUpdates.state = bizState;
        if (bizZip) contactUpdates.postalCode = bizZip;
        if (Object.keys(contactUpdates).length > 0) {
          await ghl.updateContact(contactId, contactUpdates);
        }
      } catch {
        // Non-critical
      }

      await supabaseAdmin.from("system_logs").insert({
        event_type: "application_progress",
        description: `Application progress: ${contactName} — ${completionPct}% (${applicationStage || "in progress"})`,
        metadata: { contactId, opportunityId, completionPct, applicationStage },
      });

      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%`, contactId, opportunityId },
        { headers: CORS_HEADERS }
      );
    }

    // ── 100% — Final submission — full enrichment ──
    // If somehow we still don't have a contactId, create now
    if (!contactId) {
      try {
        const contactData = await ghl.createContact({
          firstName: firstName || "",
          lastName: lastName || "",
          email: email || undefined,
          phone: mobilePhone || businessPhone || undefined,
          companyName: legalName || businessName || undefined,
          source: source || "Website - Application Form",
          tags: ["application", "website-lead"],
        });
        const contact = contactData.contact as Record<string, unknown> | undefined;
        contactId = (contact?.id as string) || (contactData.id as string) || null;
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (email) {
          const searchResult = await ghl.searchContacts(email);
          const contacts = (searchResult.contacts as Array<Record<string, unknown>>) || [];
          if (contacts.length > 0) contactId = contacts[0].id as string;
        }
        if (!contactId) {
          return NextResponse.json(
            { error: "Failed to create contact", details: errMsg },
            { status: 500, headers: CORS_HEADERS }
          );
        }
      }
    }

    // Full address
    const fullAddress = [bizAddress, bizCity, bizState, bizZip].filter(Boolean).join(", ");

    // Update contact with ALL fields
    try {
      await ghl.updateContact(contactId!, {
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        phone: mobilePhone || businessPhone || undefined,
        companyName: legalName || businessName || undefined,
        address1: bizAddress || undefined,
        city: bizCity || undefined,
        state: bizState || undefined,
        postalCode: bizZip || undefined,
        customFields: [
          { key: "business_name", value: businessName || legalName || "" },
          { key: "dba", value: dba || "" },
          { key: "industry", value: industry || "" },
          { key: "business_address", value: fullAddress },
          { key: "business_phone", value: businessPhone || "" },
          { key: "ein", value: ein || "" },
          { key: "business_start_date", value: startMonth && startYear ? `${startMonth} ${startYear}` : "" },
          { key: "credit_score_range", value: creditScore || "" },
          { key: "ownership_percentage", value: String(ownership || "") },
          { key: "funding_amount_requested", value: amountNeeded || "" },
          { key: "use_of_funds", value: useOfFunds || "" },
          { key: "avg_monthly_bank_balance", value: monthlyDeposits || "" },
          { key: "existing_loans", value: existingLoans?.includes("Yes") ? "Yes" : "No" },
          { key: "application_source", value: source || "Website - Application Form" },
          { key: "submission_date", value: new Date().toISOString().split("T")[0] },
        ].filter((f) => f.value),
      });
    } catch {
      console.error("Failed to update custom fields — non-critical");
    }

    // Create opportunity if we don't have one yet
    if (!opportunityId) {
      try {
        const stageId = await lookupNewLeadStageId();
        if (stageId) {
          const oppData = await ghl.createOpportunity({
            pipelineId: NEW_DEALS_PIPELINE.id,
            pipelineStageId: stageId,
            contactId,
            name: `${contactName} - ${businessName || "Application"}`.trim(),
            status: "open",
            source: source || "Website - Application",
            monetaryValue: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
          });
          const opp = oppData.opportunity as Record<string, unknown> | undefined;
          opportunityId = (opp?.id as string) || (oppData.id as string) || null;
        }
      } catch (error) {
        console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
      }
    }

    // Update pipeline cache with full data
    if (opportunityId) {
      await supabaseAdmin.from("pipeline_cache").upsert({
        ghl_opportunity_id: opportunityId,
        contact_name: contactName,
        business_name: businessName || legalName || null,
        stage: "New Lead",
        pipeline_name: "New Deals",
        amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
        ghl_contact_id: contactId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_opportunity_id" });
    }

    // Log
    await supabaseAdmin.from("system_logs").insert({
      event_type: "lead_capture",
      description: `Full application submitted: ${contactName} — ${businessName || "N/A"} — ${amountNeeded || "N/A"}`,
      metadata: {
        contactId,
        opportunityId,
        contactName,
        businessName,
        email,
        phone: mobilePhone || businessPhone,
        amountNeeded,
        creditScore,
        source: source || "Website - Application Form",
      },
    });

    return NextResponse.json(
      { success: true, message: "Application submitted successfully", contactId, opportunityId },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Application capture error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Application capture failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}

// Helper: look up the "New Lead" stage ID from GHL
async function lookupNewLeadStageId(): Promise<string | null> {
  const pipelinesResponse = await ghl.getPipelines();
  const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
  const newDealsPipeline = allPipelines.find(
    (p) => (p.id as string) === NEW_DEALS_PIPELINE.id
  );
  if (!newDealsPipeline) return null;
  const stages = (newDealsPipeline.stages as Array<Record<string, unknown>>) || [];
  const newLeadStage = stages.find(
    (s) => (s.name as string).toLowerCase() === "new lead"
  );
  return newLeadStage ? (newLeadStage.id as string) : null;
}

// Helper: build custom field updates based on what data is available at each milestone
function buildCustomFieldUpdates(
  body: Record<string, unknown>,
  _pct: number
): Array<{ key: string; value: string }> {
  const fields: Array<{ key: string; value: string }> = [];
  const add = (key: string, val: unknown) => {
    if (val && String(val).trim()) fields.push({ key, value: String(val) });
  };

  add("business_name", body.businessName || body.legalName);
  add("dba", body.dba);
  add("industry", body.industry);
  add("business_phone", body.businessPhone);
  add("ein", body.ein);
  if (body.bizAddress) {
    add("business_address", [body.bizAddress, body.bizCity, body.bizState, body.bizZip].filter(Boolean).join(", "));
  }
  if (body.startMonth && body.startYear) {
    add("business_start_date", `${body.startMonth} ${body.startYear}`);
  }
  add("credit_score_range", body.creditScore);
  add("ownership_percentage", body.ownership);
  add("funding_amount_requested", body.amountNeeded);
  add("use_of_funds", body.useOfFunds);
  add("avg_monthly_bank_balance", body.monthlyDeposits);
  if (body.existingLoans) {
    add("existing_loans", String(body.existingLoans).includes("Yes") ? "Yes" : "No");
  }

  return fields;
}
