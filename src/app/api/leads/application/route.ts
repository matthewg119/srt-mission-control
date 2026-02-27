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
 * Receives progressive application data from the apply form.
 * Called multiple times as the applicant progresses through steps.
 * On final submission (applicationCompletionPct = 100), creates the full contact + opportunity.
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

    const completionPct = applicationCompletionPct || 0;
    const contactName = [firstName, lastName].filter(Boolean).join(" ") || businessName || "Unknown";

    // For early progress pings (< 100%), just log and return
    if (completionPct < 100) {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "application_progress",
        description: `Application progress: ${contactName} — ${completionPct}% (${applicationStage || "in progress"})`,
        metadata: { ...body, completionPct },
      });

      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%` },
        { headers: CORS_HEADERS }
      );
    }

    // Full submission (100%) — create contact + opportunity in GHL
    let contactId: string | null = null;

    // Build address string
    const fullAddress = [bizAddress, bizCity, bizState, bizZip].filter(Boolean).join(", ");

    // Create or find contact
    try {
      const contactData = await ghl.createContact({
        firstName: firstName || "",
        lastName: lastName || "",
        email: email || undefined,
        phone: mobilePhone || businessPhone || undefined,
        companyName: legalName || businessName || undefined,
        address1: bizAddress || undefined,
        city: bizCity || undefined,
        state: bizState || undefined,
        postalCode: bizZip || undefined,
        source: source || "Website - Application Form",
        tags: ["application", "website-lead"],
      });
      const contact = contactData.contact as Record<string, unknown> | undefined;
      contactId = (contact?.id as string) || (contactData.id as string) || null;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Contact creation error:", errMsg);
      // Try to find existing contact
      if (email) {
        const searchResult = await ghl.searchContacts(email);
        const contacts = (searchResult.contacts as Array<Record<string, unknown>>) || [];
        if (contacts.length > 0) {
          contactId = contacts[0].id as string;
        }
      }
    }

    if (!contactId) {
      return NextResponse.json(
        { error: "Failed to create contact" },
        { status: 500, headers: CORS_HEADERS }
      );
    }

    // Update contact with custom fields
    try {
      await ghl.updateContact(contactId, {
        customFields: [
          { key: "business_name", value: businessName || legalName || "" },
          { key: "dba", value: dba || "" },
          { key: "industry", value: industry || "" },
          { key: "business_address", value: fullAddress },
          { key: "business_phone", value: businessPhone || "" },
          { key: "ein", value: ein || "" },
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

    // Look up "New Lead" stage ID
    let stageId: string | null = null;
    try {
      const pipelinesResponse = await ghl.getPipelines();
      const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
      const newDealsPipeline = allPipelines.find(
        (p) => (p.id as string) === NEW_DEALS_PIPELINE.id
      );
      if (newDealsPipeline) {
        const stages = (newDealsPipeline.stages as Array<Record<string, unknown>>) || [];
        const newLeadStage = stages.find(
          (s) => (s.name as string).toLowerCase() === "new lead"
        );
        if (newLeadStage) stageId = newLeadStage.id as string;
      }
    } catch {
      console.error("Failed to look up pipeline stages");
    }

    // Create opportunity
    let opportunityId: string | null = null;
    if (stageId) {
      try {
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
      } catch (error) {
        console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
      }
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

    // Cache in pipeline
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

    return NextResponse.json(
      {
        success: true,
        message: "Application submitted successfully",
        contactId,
        opportunityId,
      },
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
