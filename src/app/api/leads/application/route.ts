import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";
import { NEW_DEALS_PIPELINE } from "@/config/pipeline";
import { sendEvent } from "@/lib/meta-capi";
import { generateApplicationPDF } from "@/lib/pdf-generator";
import { microsoft } from "@/lib/microsoft";
import { validateLeadSubmission, checkRateLimit, getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact, cancelByTag } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { notifySlack, formatApplicationComplete } from "@/lib/slack";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientIp = getClientIp(request);
  const clientUserAgent = request.headers.get("user-agent") || undefined;

  try {
    // Rate limit disabled — progressive form sends 6+ requests per application

    const body = await request.json();
    const {
      firstName, lastName, email, businessPhone, businessName, legalName,
      dba, industry, bizAddress, bizCity, bizState, bizZip, ein,
      incDate, startMonth, startYear, mobilePhone, dob, creditScore, ownership,
      amountNeeded, useOfFunds, monthlyDeposits, existingLoans, notes,
      ssn4, homeAddress,
      applicationCompletionPct, applicationStage, source,
      _fbc, _fbp, eventId, sourceUrl,
      signature, signatureName, website,
      utmCampaign, utmContent, utmMedium, adId,
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
        metadata: { completionPct, clientIp, clientUserAgent },
      });
      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%` },
        { headers: corsHeaders }
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
          tags: ["application-started"],
        });
        contactId = result.contactId;
      } catch (error) {
        console.error("Contact creation failed:", error instanceof Error ? error.message : error);
        systemAlert(
          "GHL Contact Creation Failed",
          `Application contact could not be created in GHL: ${error instanceof Error ? error.message : "Unknown error"}. Lead data saved locally.`,
          "leads/application"
        ).catch(() => {});
        // Don't return 500 — save the lead locally instead of losing it completely
      }

      // Create opportunity — "Application Started"
      const ghlWarnings: string[] = [];
      if (!contactId) ghlWarnings.push("GHL contact creation failed — lead saved locally only");
      if (contactId) {
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
        fbc: _fbc || null,
        fbp: _fbp || null,
        utm_campaign: utmCampaign || null,
        utm_content: utmContent || null,
        utm_medium: utmMedium || null,
        ad_id: adId || utmContent || null,
        updated_at: new Date().toISOString(),
      }, { onConflict: "ghl_opportunity_id" });

      if (cacheError) {
        console.warn("pipeline_cache upsert failed, retrying with core fields only:", cacheError.message);
        ({ error: cacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
          ghl_opportunity_id: pipelineCacheId,
          contact_name: contactName,
          business_name: businessName || null,
          stage: "New Lead",
          pipeline_name: "New Deals",
          amount: 0,
        }, { onConflict: "ghl_opportunity_id" }));
        if (cacheError) console.error("pipeline_cache write FAILED completely:", cacheError.message);
      }

      const { error: logError } = await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_capture",
        description: `Application started (${completionPct}%): ${contactName} (${email || businessPhone})${ghlWarnings.length > 0 ? ` [${ghlWarnings.join(", ")}]` : ""}`,
        metadata: { contactId, opportunityId: opportunityId || pipelineCacheId, contactName, email, phone: businessPhone, completionPct, clientIp, clientUserAgent, warnings: ghlWarnings.length > 0 ? ghlWarnings : undefined },
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
          clientIpAddress: clientIp !== "unknown" ? clientIp : undefined,
          clientUserAgent,
          externalId: contactId || undefined,
        },
      }).catch((err) => console.error("[Meta CAPI] Application Lead error:", err));

      // Pre-create OneDrive folder — only when business name is provided
      if (businessName) {
        const safeName = businessName.replace(/[<>:"/\\|?*]/g, "_");
        microsoft.createDriveFolder("Working Files")
          .then(() => microsoft.createDriveFolder(safeName, "Working Files"))
          .then(() => console.log(`[25%] OneDrive folder created: Working Files/${safeName}`))
          .catch((err) => console.warn("[25%] OneDrive folder pre-creation failed (non-blocking):", err instanceof Error ? err.message : err));
      }

      // Enroll in application-abandoned sequence (3-min first email)
      if (email && contactId && completionPct < 100) {
        enrollContact("application-abandoned", contactId, email, contactName, { businessName })
          .catch((err) => console.error("[Sequence] application-abandoned enrollment error:", err));
      }

      // For sub-100% requests, return now. For 100%, fall through to final submission block.
      if (completionPct < 100) {
        return NextResponse.json(
          { success: true, message: ghlWarnings.length > 0 ? "Lead created with warnings" : "Lead created", contactId, opportunityId: opportunityId || pipelineCacheId, warnings: ghlWarnings.length > 0 ? ghlWarnings : undefined },
          { headers: corsHeaders }
        );
      }
      // 100% continues below — PDF/OneDrive/email must run even if GHL failed
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
        metadata: { contactId, opportunityId, completionPct, applicationStage, clientIp },
      });
      if (progressLogError) console.error("system_logs progress write failed:", progressLogError);

      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%`, contactId, opportunityId },
        { headers: corsHeaders }
      );
    }

    // ── 100% — Final submission ──
    const completionWarnings: string[] = [];
    if (!contactId) {
      try {
        const result = await ghl.createOrFindContact({
          firstName: firstName || "", lastName: lastName || "",
          email: email || undefined, phone: mobilePhone || businessPhone || undefined,
          companyName: legalName || businessName || undefined,
          source: source || "Website - Application Form",
          tags: ["application-started"],
        });
        contactId = result.contactId;
      } catch (error) {
        // Non-blocking — PDF/OneDrive/email don't need a GHL contact
        console.error("[100%] GHL contact creation failed:", error instanceof Error ? error.message : error);
        completionWarnings.push("GHL contact creation failed at 100%");
        systemAlert(
          "GHL Contact Creation Failed at 100%",
          `Could not create GHL contact for ${contactName} (${email}): ${error instanceof Error ? error.message : "Unknown error"}. PDF/email will still be generated.`,
          "leads/application",
          "error"
        ).catch(() => {});
      }
    }

    const fullAddress = [bizAddress, bizCity, bizState, bizZip].filter(Boolean).join(", ");

    // Update contact with ALL fields (skip if no GHL contact)
    if (contactId) try {
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
          { key: "owner_ssn_last4", value: ssn4 || "" },
          { key: "owner_dob", value: dob || "" },
          { key: "owner_home_address", value: homeAddress || "" },
          { key: "application_source", value: source || "Website - Application Form" },
          { key: "submission_date", value: new Date().toISOString().split("T")[0] },
        ].filter((f) => f.value),
      });
    } catch { /* non-critical */ }

    // Create opportunity if none yet
    if (!opportunityId && contactId) {
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
      fbc: _fbc || null,
      fbp: _fbp || null,
      utm_campaign: utmCampaign || null,
      utm_content: utmContent || null,
      utm_medium: utmMedium || null,
      ad_id: adId || utmContent || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "ghl_opportunity_id" });

    if (finalCacheError) {
      console.warn("pipeline_cache 100% upsert failed, retrying with core fields only:", finalCacheError.message);
      ({ error: finalCacheError } = await supabaseAdmin.from("pipeline_cache").upsert({
        ghl_opportunity_id: finalCacheId,
        contact_name: contactName,
        business_name: businessName || legalName || null,
        stage: "New Lead",
        pipeline_name: "New Deals",
        amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
      }, { onConflict: "ghl_opportunity_id" }));
      if (finalCacheError) console.error("pipeline_cache 100% write FAILED completely:", finalCacheError.message);
    }

    const { error: completionLogError } = await supabaseAdmin.from("system_logs").insert({
      event_type: "lead_capture",
      description: `Application completed: ${contactName} — ${businessName || "N/A"} — ${amountNeeded || "N/A"}`,
      metadata: { contactId, opportunityId: opportunityId || finalCacheId, contactName, businessName, email, amountNeeded, creditScore, clientIp, clientUserAgent, hasSignature: !!signature, warnings: completionWarnings.length > 0 ? completionWarnings : undefined },
    });
    if (completionLogError) console.error("system_logs 100% write failed:", completionLogError);

    // Slack notification (non-blocking)
    notifySlack(formatApplicationComplete({
      name: contactName,
      businessName: businessName || legalName,
      amountNeeded,
      email,
      phone: mobilePhone || businessPhone,
    })).catch(() => {});

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
        clientIpAddress: clientIp !== "unknown" ? clientIp : undefined,
        clientUserAgent,
        externalId: contactId || undefined,
      },
      customData: {
        content_name: "Business Funding Application",
        value: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || undefined,
        currency: "USD",
      },
    }).catch((err) => console.error("[Meta CAPI] CompleteRegistration error:", err));

    // ── Tag "application" at 100% + cancel abandonment sequences ──
    if (contactId) {
      try {
        await ghl.addContactTag(contactId, "application-completed");
        console.log("[100%] Tag 'application-completed' added via addContactTag");
      } catch (err) {
        console.error("[100%] addContactTag failed, trying updateContact:", err instanceof Error ? err.message : err);
        // Fallback: use updateContact to set tags directly
        try {
          await ghl.updateContact(contactId, { tags: ["application-started", "application-completed"] });
          console.log("[100%] Tag 'application-completed' added via updateContact fallback");
        } catch (err2) {
          console.error("[100%] updateContact tag fallback also failed:", err2 instanceof Error ? err2.message : err2);
        }
      }

      // Cancel the abandonment sequence now that they completed
      cancelByTag(contactId, "application-completed")
        .catch((err) => console.error("[Sequence] Cancel by tag error:", err));

      // Enroll in the completed application nurture sequence
      if (email) {
        enrollContact("application-completed-nurture", contactId, email, contactName, { businessName, amountNeeded })
          .catch((err) => console.error("[Sequence] application-completed-nurture enrollment error:", err));
      }
    }

    // ── PDF → OneDrive → GHL note → Confirmation email ──
    // Must run BEFORE returning response — Vercel kills serverless functions after response
    const safeName = (businessName || legalName || "Unknown").replace(/[<>:"/\\|?*]/g, "_");
    try {
      const pdfBuffer = generateApplicationPDF({
        firstName, lastName, email, businessPhone, mobilePhone,
        businessName, legalName, dba, industry, ein,
        bizAddress, bizCity, bizState, bizZip,
        incDate, dob, creditScore, ownership,
        amountNeeded, useOfFunds, monthlyDeposits, existingLoans, notes,
        signature: signature || undefined,
        signatureName: signatureName || contactName,
      });

      // Create OneDrive folder + upload PDF
      try {
        await microsoft.createDriveFolder("Working Files");
        await microsoft.createDriveFolder(safeName, "Working Files");
        await microsoft.uploadDriveFile(
          `Working Files/${safeName}`,
          `Application - ${safeName}.pdf`,
          pdfBuffer,
          "application/pdf"
        );
        console.log(`[100%] PDF uploaded to OneDrive: Working Files/${safeName}`);

        // Log success to system_logs (system_alerts has schema cache issues)
        await supabaseAdmin.from("system_logs").insert({
          event_type: "application_pdf",
          description: `PDF uploaded: Working Files/${safeName}/Application - ${safeName}.pdf`,
          metadata: { contactId, businessName: safeName },
        });
      } catch (err) {
        console.error("[100%] OneDrive upload failed:", err instanceof Error ? err.message : err);
        await supabaseAdmin.from("system_logs").insert({
          event_type: "application_error",
          description: `[100%] OneDrive upload failed for ${contactName}: ${err instanceof Error ? err.message : "Unknown"}`,
          metadata: { contactId, error: err instanceof Error ? err.message : String(err) },
        });
        systemAlert(
          "OneDrive Upload Failed",
          `PDF upload failed for ${contactName} (${businessName}): ${err instanceof Error ? err.message : "Unknown error"}`,
          "leads/application",
          "error"
        ).catch(() => {});
      }

      // Add GHL note with OneDrive link
      if (contactId) {
        await ghl.addNote(contactId, `Application PDF uploaded to OneDrive: Working Files/${safeName}/Application - ${safeName}.pdf`).catch(() => {});
      }

      // Send applicant confirmation email with PDF copy attached
      if (email) {
        try {
          const summaryHtml = buildApplicationSummaryEmail({ firstName });
          await microsoft.sendMail({
            to: email,
            subject: "Your SRT Agency Application — Received",
            body: summaryHtml,
            isHtml: true,
            attachments: [{
              name: `Application - ${safeName}.pdf`,
              contentType: "application/pdf",
              contentBytes: pdfBuffer.toString("base64"),
            }],
          });
          console.log("[100%] Confirmation email with PDF sent to", email);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          console.error("[100%] Microsoft email failed, falling back to GHL:", errMsg);
          systemAlert(
            "Email Delivery Failed",
            `Microsoft 365 could not send confirmation email to ${email}: ${errMsg.slice(0, 200)}`,
            "leads/application",
            "warning"
          ).catch(() => {});
          // Fallback to GHL email (no attachment)
          if (contactId) {
            await ghl.sendEmail(
              contactId,
              "Your SRT Agency Application — Received",
              buildApplicationSummaryEmail({ firstName })
            ).catch(err2 => console.error("[100%] GHL email fallback also failed:", err2));
          }
        }
      }
    } catch (err) {
      console.error("[100%] Post-submission tasks failed:", err instanceof Error ? err.message : err);
      await supabaseAdmin.from("system_logs").insert({
        event_type: "application_error",
        description: `[100%] Post-processing failed for ${contactName}: ${err instanceof Error ? err.message : "Unknown"}`,
        metadata: { contactId, error: err instanceof Error ? err.message : String(err) },
      });
      systemAlert(
        "Application Post-Processing Failed",
        `PDF/OneDrive/Email failed for ${contactName}: ${err instanceof Error ? err.message : "Unknown error"}`,
        "leads/application",
        "error"
      ).catch(() => {});
    }

    return NextResponse.json(
      { success: true, message: completionWarnings.length > 0 ? "Application submitted with warnings" : "Application submitted successfully", contactId, opportunityId: opportunityId || finalCacheId, warnings: completionWarnings.length > 0 ? completionWarnings : undefined },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error("Application capture error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Application capture failed" },
      { status: 500, headers: corsHeaders }
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

function buildApplicationSummaryEmail(data: {
  firstName?: string;
}): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0d1b2a;padding:28px 24px;text-align:center">
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
      <tr>
        <td style="vertical-align:bottom;padding-right:3px"><div style="width:5px;height:14px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
        <td style="vertical-align:bottom;padding-right:3px"><div style="width:5px;height:20px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
        <td style="vertical-align:bottom;padding-right:8px"><div style="width:5px;height:26px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
        <td style="vertical-align:bottom"><span style="font-size:20px;font-weight:700;color:#ffffff;line-height:1">Scaling Revenue Together</span></td>
      </tr>
    </table>
    <p style="color:#a0c0b0;margin:6px 0 0;font-size:13px">Business Funding Solutions</p>
  </div>
  <div style="padding:28px 24px">
    <p style="font-size:15px">Hi ${data.firstName || "there"},</p>
    <p style="font-size:14px;line-height:1.6">Thank you for completing your application! We've received everything and your dedicated underwriter is already reviewing it.</p>
    <p style="font-size:14px;line-height:1.6"><strong>A copy of your application is attached to this email as a PDF.</strong></p>
    <div style="background:#f8f9fa;border-left:4px solid #e8792b;padding:16px;margin:24px 0;border-radius:4px">
      <h3 style="margin:0 0 8px;font-size:15px;color:#e8792b">Next Step: Bank Statements Needed</h3>
      <p style="margin:0;font-size:14px;line-height:1.6">To move forward with your funding, please send us your <strong>last 3 months of business bank statements</strong>. You can:</p>
      <ul style="font-size:14px;padding-left:20px;line-height:1.8">
        <li>Reply to this email with your statements attached</li>
        <li><a href="https://api.whatsapp.com/send/?phone=7862822937" style="color:#25D366;font-weight:600">Send via WhatsApp</a></li>
      </ul>
    </div>
    <p style="font-size:14px;color:#666;line-height:1.6">Questions? Reply to this email or call us directly. We're here to help you get funded.</p>
  </div>
  <div style="padding:0 24px 24px">
    <table cellpadding="0" cellspacing="0" border="0" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;color:#333333">
      <tr><td style="padding-bottom:10px">
        <table cellpadding="0" cellspacing="0" border="0"><tr>
          <td style="vertical-align:bottom;padding-right:3px"><div style="width:5px;height:14px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
          <td style="vertical-align:bottom;padding-right:3px"><div style="width:5px;height:20px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
          <td style="vertical-align:bottom;padding-right:8px"><div style="width:5px;height:26px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
          <td style="vertical-align:bottom"><span style="font-size:16px;font-weight:700;color:#0d1b2a;line-height:1">SRT Agency</span></td>
        </tr></table>
      </td></tr>
      <tr><td style="padding-bottom:2px"><span style="font-size:16px;font-weight:700;color:#e8792b">Matthew Garcia</span></td></tr>
      <tr><td style="padding-bottom:8px"><span style="font-size:12px;color:#666666">Senior Capital Specialist</span></td></tr>
      <tr><td style="padding-bottom:4px">
        <span style="font-size:12px;color:#666666">T: </span><a href="tel:+17862822937" style="font-size:12px;color:#333333;text-decoration:none">(786) 282-2937</a>
        <span style="font-size:12px;color:#cccccc"> | </span>
        <span style="font-size:12px;color:#666666">F: </span><span style="font-size:12px;color:#333333">(252) 556-1444</span>
      </td></tr>
      <tr><td style="padding-top:10px;padding-bottom:12px"><span style="font-size:11px;font-weight:700;color:#0d1b2a;text-transform:uppercase;letter-spacing:2px">Scaling Revenue Together</span></td></tr>
      <tr><td style="padding-bottom:14px">
        <table cellpadding="0" cellspacing="0" border="0"><tr><td style="background:#2ee6a8;border-radius:5px;padding:10px 24px">
          <a href="https://srtagency.com/apply" style="color:#0d1b2a;text-decoration:none;font-size:13px;font-weight:700;letter-spacing:1px">Apply Now &#8594;</a>
        </td></tr></table>
      </td></tr>
    </table>
  </div>
  <div style="padding:16px 24px;border-top:1px solid #eee">
    <p style="font-size:8px;color:#aaaaaa;line-height:1.4;margin:0;max-width:500px"><span style="font-weight:700;color:#888888">CONFIDENTIALITY NOTICE:</span> This e-mail and any files or previous e-mail messages attached to it, may contain proprietary and confidential information. If you are not an intended recipient, you are hereby notified that any disclosure or use of this information obtained is STRICTLY PROHIBITED. If you have received this email in error, please notify us by replying to the sender of the e-mail and destroy the original transmission and its attachments without reading them or saving them. Thank you.</p>
  </div>
</div>`.trim();
}
