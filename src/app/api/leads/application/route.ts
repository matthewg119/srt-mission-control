import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";
import { NEW_DEALS_PIPELINE } from "@/config/pipeline";
import { sendEvent } from "@/lib/meta-capi";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      firstName, lastName, email, businessPhone, businessName, legalName,
      dba, industry, bizAddress, bizCity, bizState, bizZip, ein,
      incDate, startMonth, startYear, mobilePhone, dob, creditScore, ownership,
      amountNeeded, useOfFunds, monthlyDeposits, existingLoans, notes,
      applicationCompletionPct, applicationStage, source,
      _fbc, _fbp, eventId, sourceUrl,
    } = body;

    let contactId: string | null = (body.contactId as string) || null;
    let opportunityId: string | null = (body.opportunityId as string) || null;

    const completionPct = applicationCompletionPct || 0;
    const contactName = [firstName, lastName].filter(Boolean).join(" ") || businessName || "Unknown";

    // ── Under 25% — just log ──
    if (completionPct < 25) {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "application_progress",
        description: `Application started: ${completionPct}% (${applicationStage || "qualifying"})`,
        metadata: { completionPct },
      });
      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%` },
        { headers: CORS_HEADERS }
      );
    }

    // ── 25%+ and no contactId — create the lead ──
    if (!contactId && (email || businessPhone)) {
      try {
        const result = await ghl.createOrFindContact({
          firstName: firstName || "",
          lastName: lastName || "",
          email: email || undefined,
          phone: mobilePhone || businessPhone || undefined,
          companyName: businessName || undefined,
          source: source || "Website - Application Form",
          tags: ["application", "website-lead"],
        });
        contactId = result.contactId;
      } catch (error) {
        console.error("Contact creation failed:", error instanceof Error ? error.message : error);
        return NextResponse.json(
          { error: "Failed to create contact", details: error instanceof Error ? error.message : "Unknown error" },
          { status: 500, headers: CORS_HEADERS }
        );
      }

      // Create opportunity — "Application Started"
      const ghlWarnings: string[] = [];
      try {
        const stageId = await lookupNewLeadStageId();
        if (stageId) {
          const oppData = await ghl.createOpportunity({
            pipelineId: NEW_DEALS_PIPELINE.id,
            pipelineStageId: stageId,
            contactId,
            name: `${contactName} - Application Started`.trim(),
            status: "open",
            source: source || "Website - Application",
          });
          const opp = oppData.opportunity as Record<string, unknown> | undefined;
          opportunityId = (opp?.id as string) || (oppData.id as string) || null;
        } else {
          ghlWarnings.push("GHL stage lookup failed — lead saved locally only");
          console.error("CRITICAL: Could not resolve 'New Lead' stage ID");
        }
      } catch (error) {
        console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
        ghlWarnings.push("GHL opportunity creation failed — lead saved locally");
      }

      // ALWAYS cache in pipeline — even if GHL failed, dashboard must show this lead
      const pipelineCacheId = opportunityId || `local_${randomUUID()}`;
      let { error: cacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
        ghl_opportunity_id: pipelineCacheId,
        contact_name: contactName,
        business_name: businessName || null,
        stage: "New Lead",
        pipeline_name: "New Deals",
        amount: 0,
        ghl_contact_id: contactId,
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_opportunity_id" });

      // Fallback: retry without optional columns if schema doesn't have them
      if (cacheError) {
        console.warn("pipeline_cache upsert failed, retrying without ghl_contact_id:", cacheError.message);
        ({ error: cacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
          ghl_opportunity_id: pipelineCacheId,
          contact_name: contactName,
          business_name: businessName || null,
          stage: "New Lead",
          pipeline_name: "New Deals",
          amount: 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: "ghl_opportunity_id" }));
        if (cacheError) console.error("pipeline_cache write FAILED completely:", cacheError);
      }

      const { error: logError } = await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_capture",
        description: `Application started (${completionPct}%): ${contactName} (${email || businessPhone})`,
        metadata: { contactId, opportunityId: opportunityId || pipelineCacheId, contactName, email, phone: businessPhone, completionPct, warnings: ghlWarnings.length > 0 ? ghlWarnings : undefined },
      });
      if (logError) console.error("system_logs write failed:", logError);

      // Fire Meta CAPI Lead event at 25% (contact info captured)
      sendEvent({
        eventName: "Lead",
        eventId: eventId || undefined,
        eventSourceUrl: sourceUrl || "https://srtagency.com/apply",
        actionSource: "website",
        userData: {
          email: email || undefined,
          phone: mobilePhone || businessPhone || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          fbc: _fbc || undefined,
          fbp: _fbp || undefined,
          clientIpAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
          clientUserAgent: request.headers.get("user-agent") || undefined,
          externalId: contactId || undefined,
        },
      }).catch((err) => console.error("[Meta CAPI] Application Lead error:", err));

      return NextResponse.json(
        { success: true, message: ghlWarnings.length > 0 ? "Lead created with warnings" : "Lead created", contactId, opportunityId: opportunityId || pipelineCacheId, warnings: ghlWarnings.length > 0 ? ghlWarnings : undefined },
        { headers: CORS_HEADERS }
      );
    }

    // ── 25-99% with existing contactId — enrich contact ──
    if (contactId && completionPct < 100) {
      const updates = buildCustomFieldUpdates(body);
      if (updates.length > 0) {
        try { await ghl.updateContact(contactId, { customFields: updates }); } catch { /* non-critical */ }
      }
      // Update core contact fields
      try {
        const core: Record<string, unknown> = {};
        if (mobilePhone) core.phone = mobilePhone;
        if (legalName || businessName) core.companyName = legalName || businessName;
        if (bizAddress) core.address1 = bizAddress;
        if (bizCity) core.city = bizCity;
        if (bizState) core.state = bizState;
        if (bizZip) core.postalCode = bizZip;
        if (Object.keys(core).length > 0) await ghl.updateContact(contactId, core);
      } catch { /* non-critical */ }

      const { error: progressLogError } = await supabaseAdmin.from("system_logs").insert({
        event_type: "application_progress",
        description: `Application progress: ${contactName} — ${completionPct}% (${applicationStage || "in progress"})`,
        metadata: { contactId, opportunityId, completionPct, applicationStage },
      });
      if (progressLogError) console.error("system_logs progress write failed:", progressLogError);

      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%`, contactId, opportunityId },
        { headers: CORS_HEADERS }
      );
    }

    // ── 100% — Final submission ──
    if (!contactId) {
      try {
        const result = await ghl.createOrFindContact({
          firstName: firstName || "", lastName: lastName || "",
          email: email || undefined, phone: mobilePhone || businessPhone || undefined,
          companyName: legalName || businessName || undefined,
          source: source || "Website - Application Form",
          tags: ["application", "website-lead"],
        });
        contactId = result.contactId;
      } catch {
        return NextResponse.json(
          { error: "Failed to create contact" },
          { status: 500, headers: CORS_HEADERS }
        );
      }
    }

    const fullAddress = [bizAddress, bizCity, bizState, bizZip].filter(Boolean).join(", ");

    // Update contact with ALL fields
    try {
      await ghl.updateContact(contactId, {
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
          { key: "business_start_date", value: incDate || (startMonth && startYear ? `${startMonth} ${startYear}` : "") },
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
    } catch { /* non-critical */ }

    // Create opportunity if none yet
    const completionWarnings: string[] = [];
    if (!opportunityId) {
      try {
        const stageId = await lookupNewLeadStageId();
        if (stageId) {
          const oppData = await ghl.createOpportunity({
            pipelineId: NEW_DEALS_PIPELINE.id,
            pipelineStageId: stageId,
            contactId,
            name: `${contactName} - Application Started`.trim(),
            status: "open",
            source: source || "Website - Application",
            monetaryValue: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
          });
          const opp = oppData.opportunity as Record<string, unknown> | undefined;
          opportunityId = (opp?.id as string) || (oppData.id as string) || null;
        } else {
          completionWarnings.push("GHL stage lookup failed at 100% — lead saved locally only");
          console.error("CRITICAL: Could not resolve 'New Lead' stage ID at 100% completion");
        }
      } catch (error) {
        console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
        completionWarnings.push("GHL opportunity creation failed at 100% — lead saved locally");
      }
    }

    // ALWAYS update pipeline cache with full data + amount — even if GHL failed
    const finalCacheId = opportunityId || `local_${randomUUID()}`;
    let { error: finalCacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
      ghl_opportunity_id: finalCacheId,
      contact_name: contactName,
      business_name: businessName || legalName || null,
      stage: "New Lead",
      pipeline_name: "New Deals",
      amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
      ghl_contact_id: contactId,
      updated_at: new Date().toISOString(),
    }, { onConflict: "ghl_opportunity_id" });

    if (finalCacheError) {
      console.warn("pipeline_cache 100% upsert failed, retrying without ghl_contact_id:", finalCacheError.message);
      ({ error: finalCacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
        ghl_opportunity_id: finalCacheId,
        contact_name: contactName,
        business_name: businessName || legalName || null,
        stage: "New Lead",
        pipeline_name: "New Deals",
        amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_opportunity_id" }));
      if (finalCacheError) console.error("pipeline_cache 100% write FAILED completely:", finalCacheError);
    }

    const { error: completionLogError } = await supabaseAdmin.from("system_logs").insert({
      event_type: "lead_capture",
      description: `Application completed: ${contactName} — ${businessName || "N/A"} — ${amountNeeded || "N/A"}`,
      metadata: { contactId, opportunityId: opportunityId || finalCacheId, contactName, businessName, email, amountNeeded, creditScore, warnings: completionWarnings.length > 0 ? completionWarnings : undefined },
    });
    if (completionLogError) console.error("system_logs 100% write failed:", completionLogError);

    // Fire Meta CAPI CompleteRegistration at 100%
    sendEvent({
      eventName: "CompleteRegistration",
      eventId: eventId || undefined,
      eventSourceUrl: sourceUrl || "https://srtagency.com/apply",
      actionSource: "website",
      userData: {
        email: email || undefined,
        phone: mobilePhone || businessPhone || undefined,
        firstName: firstName || undefined,
        lastName: lastName || undefined,
        city: bizCity || undefined,
        state: bizState || undefined,
        zip: bizZip || undefined,
        fbc: _fbc || undefined,
        fbp: _fbp || undefined,
        clientIpAddress: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || undefined,
        clientUserAgent: request.headers.get("user-agent") || undefined,
        externalId: contactId || undefined,
      },
      customData: {
        content_name: "Business Funding Application",
        value: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || undefined,
        currency: "USD",
      },
    }).catch((err) => console.error("[Meta CAPI] CompleteRegistration error:", err));

    return NextResponse.json(
      { success: true, message: completionWarnings.length > 0 ? "Application submitted with warnings" : "Application submitted successfully", contactId, opportunityId: opportunityId || finalCacheId, warnings: completionWarnings.length > 0 ? completionWarnings : undefined },
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

// Cache stage ID across requests (same serverless instance)
let cachedNewLeadStageId: string | null = null;

async function lookupNewLeadStageId(): Promise<string | null> {
  if (cachedNewLeadStageId) return cachedNewLeadStageId;
  try {
    const pipelinesResponse = await ghl.getPipelines();
    const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
    const pipeline = allPipelines.find((p) => (p.id as string) === NEW_DEALS_PIPELINE.id);
    if (!pipeline) return null;
    const stages = (pipeline.stages as Array<Record<string, unknown>>) || [];
    const stage = stages.find((s) => (s.name as string).toLowerCase() === "new lead");
    if (stage) {
      cachedNewLeadStageId = stage.id as string;
      return cachedNewLeadStageId;
    }
  } catch (err) {
    console.error("Stage lookup failed:", err instanceof Error ? err.message : err);
  }
  return null;
}

function buildCustomFieldUpdates(body: Record<string, unknown>): Array<{ key: string; value: string }> {
  const fields: Array<{ key: string; value: string }> = [];
  const add = (key: string, val: unknown) => {
    if (val && String(val).trim()) fields.push({ key, value: String(val) });
  };
  add("business_name", body.businessName || body.legalName);
  add("dba", body.dba);
  add("industry", body.industry);
  add("business_phone", body.businessPhone);
  add("ein", body.ein);
  if (body.bizAddress) add("business_address", [body.bizAddress, body.bizCity, body.bizState, body.bizZip].filter(Boolean).join(", "));
  if (body.incDate) add("business_start_date", String(body.incDate));
  else if (body.startMonth && body.startYear) add("business_start_date", `${body.startMonth} ${body.startYear}`);
  add("credit_score_range", body.creditScore);
  add("ownership_percentage", body.ownership);
  add("funding_amount_requested", body.amountNeeded);
  add("use_of_funds", body.useOfFunds);
  add("avg_monthly_bank_balance", body.monthlyDeposits);
  if (body.existingLoans) add("existing_loans", String(body.existingLoans).includes("Yes") ? "Yes" : "No");
  return fields;
}
