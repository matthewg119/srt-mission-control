import { NextRequest, NextResponse } from "next/server";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";
import { NEW_DEALS_PIPELINE } from "@/config/pipeline";

// CORS headers — allow srtagency.com to POST leads
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

// Preflight
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, email, phone, message, source } = body;

    // Validate required fields
    if (!name || (!email && !phone)) {
      return NextResponse.json(
        { error: "Name and either email or phone are required" },
        { status: 400, headers: CORS_HEADERS }
      );
    }

    // Split name into first/last
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    // 1. Create or find contact in GHL
    let contactId: string;
    try {
      const contactData = await ghl.createContact({
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        source: source || "Website - srtagency.com",
        tags: ["website-lead"],
      });

      const contact = contactData.contact as Record<string, unknown> | undefined;
      contactId = (contact?.id as string) || (contactData.id as string);

      // GHL returns existing contact if duplicate — that's fine
      if (!contactId && contactData.meta) {
        // Duplicate contact — GHL returns the existing one
        contactId = ((contactData.meta as Record<string, unknown>).id as string) || "";
      }
    } catch (error) {
      // If contact already exists, GHL throws a 422 with the existing contact ID
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Contact creation error:", errMsg);

      // Try to search for existing contact
      if (email) {
        const searchResult = await ghl.searchContacts(email);
        const contacts = (searchResult.contacts as Array<Record<string, unknown>>) || [];
        if (contacts.length > 0) {
          contactId = contacts[0].id as string;
        } else {
          return NextResponse.json(
            { error: "Failed to create contact", details: errMsg },
            { status: 500, headers: CORS_HEADERS }
          );
        }
      } else {
        return NextResponse.json(
          { error: "Failed to create contact", details: errMsg },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    // 2. Look up "New Lead" stage ID from GHL
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
        if (newLeadStage) {
          stageId = newLeadStage.id as string;
        }
      }
    } catch {
      console.error("Failed to look up pipeline stages");
    }

    // 3. Create opportunity in New Deals pipeline
    let opportunityId: string | null = null;
    if (stageId) {
      try {
        const oppData = await ghl.createOpportunity({
          pipelineId: NEW_DEALS_PIPELINE.id,
          pipelineStageId: stageId,
          contactId,
          name: `${firstName} ${lastName} - Website Lead`.trim(),
          status: "open",
          source: source || "Website",
        });
        const opp = oppData.opportunity as Record<string, unknown> | undefined;
        opportunityId = (opp?.id as string) || (oppData.id as string) || null;
      } catch (error) {
        console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
      }
    }

    // 4. Add note to contact if they left a message
    if (message && contactId) {
      try {
        await ghl.updateContact(contactId, {
          customFields: [
            { key: "application_source", value: source || "Website - srtagency.com" },
          ],
        });
      } catch {
        // Non-critical
      }
    }

    // 5. Log to system_logs
    await supabaseAdmin.from("system_logs").insert({
      event_type: "lead_capture",
      description: `New lead from website: ${firstName} ${lastName} (${email || phone})`,
      metadata: {
        contactId,
        opportunityId,
        name,
        email,
        phone,
        message,
        source: source || "Website - srtagency.com",
      },
    });

    // 6. Also cache in pipeline_cache for instant visibility
    if (opportunityId) {
      await supabaseAdmin.from("pipeline_cache").upsert({
        ghl_opportunity_id: opportunityId,
        contact_name: `${firstName} ${lastName}`.trim(),
        business_name: null,
        stage: "New Lead",
        pipeline_name: "New Deals",
        amount: 0,
        ghl_contact_id: contactId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_opportunity_id" });
    }

    return NextResponse.json(
      {
        success: true,
        message: "Lead captured successfully",
        contactId,
        opportunityId,
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    console.error("Lead capture error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead capture failed" },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
