import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";
import { NEW_DEALS_PIPELINE } from "@/config/pipeline";
import { sendEvent } from "@/lib/meta-capi";
import { validateLeadSubmission, checkRateLimit, getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { calculateLeadScore, resolveAdSource } from "@/lib/lead-score";
import { notifySlack, formatLeadCapture } from "@/lib/slack";

// Cache the "New Lead" stage ID across requests (same serverless instance)
let cachedNewLeadStageId: string | null = null;

async function getNewLeadStageId(): Promise<string | null> {
  if (cachedNewLeadStageId) return cachedNewLeadStageId;
  try {
    const pipelinesResponse = await ghl.getPipelines();
    const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
    const pipeline = allPipelines.find((p) => (p.id as string) === NEW_DEALS_PIPELINE.id);
    if (pipeline) {
      const stages = (pipeline.stages as Array<Record<string, unknown>>) || [];
      const stage = stages.find((s) => (s.name as string).toLowerCase() === "new lead");
      if (stage) {
        cachedNewLeadStageId = stage.id as string;
        return cachedNewLeadStageId;
      }
    }
  } catch (err) {
    console.error("Stage lookup failed:", err instanceof Error ? err.message : err);
  }
  return null;
}

// Preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientIp = getClientIp(request);
  const clientUserAgent = request.headers.get("user-agent") || undefined;

  try {
    // Rate limit check
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { name, email, phone, message, source, website, _fbc, _fbp, eventId, sourceUrl,
            utmCampaign, utmContent, utmMedium, utmSource, adId } = body;

    // Lead quality score + ad attribution
    const leadScore = calculateLeadScore({ email, phone, fbc: _fbc });
    const adSource = resolveAdSource(_fbc, source);

    // Validate required fields
    if (!name || (!email && !phone)) {
      return NextResponse.json(
        { error: "Name and either email or phone are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    // Split name into first/last
    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    // 1. Create or find contact in GHL (handles duplicates automatically)
    let contactId: string;
    try {
      const { contactId: id } = await ghl.createOrFindContact({
        firstName,
        lastName,
        email: email || undefined,
        phone: phone || undefined,
        source: source || "Website - srtagency.com",
        tags: ["website-lead"],
      });
      contactId = id;
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Contact creation error:", errMsg);
      await systemAlert(
        "GHL Contact Creation Failed",
        `Lead from ${name} (${email || phone}) could not be created in GHL: ${errMsg}`,
        "leads/capture"
      );
      return NextResponse.json(
        { error: "Failed to create contact", details: errMsg },
        { status: 500, headers: corsHeaders }
      );
    }

    // 2. Look up "New Lead" stage ID (cached across requests)
    const stageId = await getNewLeadStageId();
    const warnings: string[] = [];
    if (!stageId) {
      warnings.push("GHL stage lookup failed — lead saved locally only");
      console.error("CRITICAL: Could not resolve 'New Lead' stage ID for pipeline", NEW_DEALS_PIPELINE.id);
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
        // Log deal creation to activity feed
        if (opportunityId) {
          await supabaseAdmin.from("system_logs").insert({
            event_type: "pipeline_deal_created",
            description: `New deal: ${firstName} ${lastName} → New Deals / New Lead`,
            metadata: { contactId, opportunityId, pipeline: "New Deals", stage: "New Lead" },
          });
        }
      } catch (error) {
        console.error("Opportunity creation error:", error instanceof Error ? error.message : error);
        warnings.push("GHL opportunity creation failed — lead saved locally");
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

    // 5. Log to system_logs (now includes IP + User-Agent)
    const { error: logError } = await supabaseAdmin.from("system_logs").insert({
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
        clientIp,
        clientUserAgent,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
    });
    if (logError) console.error("system_logs write failed:", logError);

    // 6. ALWAYS cache in pipeline_cache — even if GHL failed, the dashboard must show this lead
    const pipelineCacheId = opportunityId || `local_${randomUUID()}`;
    let { error: cacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
      ghl_opportunity_id: pipelineCacheId,
      contact_name: `${firstName} ${lastName}`.trim(),
      business_name: null,
      stage: "New Lead",
      pipeline_name: "New Deals",
      amount: 0,
      ghl_contact_id: contactId,
      fbc: _fbc || null,
      fbp: _fbp || null,
      ad_source: adSource,
      lead_score: leadScore,
      utm_campaign: utmCampaign || null,
      utm_content: utmContent || null,
      utm_medium: utmMedium || null,
      ad_id: adId || utmContent || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "ghl_opportunity_id" });

    if (cacheError) {
      console.warn("pipeline_cache upsert failed, retrying without ghl_contact_id:", cacheError.message);
      ({ error: cacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
        ghl_opportunity_id: pipelineCacheId,
        contact_name: `${firstName} ${lastName}`.trim(),
        business_name: null,
        stage: "New Lead",
        pipeline_name: "New Deals",
        amount: 0,
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_opportunity_id" }));
      if (cacheError) console.error("pipeline_cache write FAILED completely:", cacheError);
    }

    // 7. Fire Meta CAPI Lead event (non-blocking)
    sendEvent({
      eventName: "Lead",
      eventId: eventId || undefined,
      eventSourceUrl: sourceUrl || "https://srtagency.com",
      actionSource: "website",
      userData: {
        email: email || undefined,
        phone: phone || undefined,
        firstName,
        lastName: lastName || undefined,
        fbc: _fbc || undefined,
        fbp: _fbp || undefined,
        clientIpAddress: clientIp !== "unknown" ? clientIp : undefined,
        clientUserAgent,
        externalId: contactId,
      },
    }).catch((err) => console.error("[Meta CAPI] Lead event error:", err));

    // 8. Slack notification (non-blocking)
    notifySlack(formatLeadCapture({ name, email, phone, message })).catch(() => {});

    // 9. Enroll in email sequences (non-blocking)
    if (email && contactId) {
      enrollContact("website-lead-nurture", contactId, email, `${firstName} ${lastName}`.trim())
        .catch((err) => console.error("[Sequence] website-lead-nurture enrollment error:", err));
      enrollContact("website-lead-to-application", contactId, email, `${firstName} ${lastName}`.trim())
        .catch((err) => console.error("[Sequence] website-lead-to-application enrollment error:", err));
    }

    return NextResponse.json(
      {
        success: true,
        message: warnings.length > 0 ? "Lead captured with warnings" : "Lead captured successfully",
        contactId,
        opportunityId: opportunityId || pipelineCacheId,
        warnings: warnings.length > 0 ? warnings : undefined,
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Lead capture error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Lead capture failed" },
      { status: 500, headers: corsHeaders }
    );
  }
}
