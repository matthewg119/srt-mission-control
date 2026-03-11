import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { generateApplicationPDF } from "@/lib/pdf-generator";
import { microsoft } from "@/lib/microsoft";
import { getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact, cancelByTag } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { slack } from "@/lib/slack-bot";
import { ghlUpsertContact, ghlCreateOpportunity } from "@/lib/ghl";
import { createLead as zohoCreateLead, searchLeads } from "@/lib/zoho";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientIp = getClientIp(request);
  const clientUserAgent = request.headers.get("user-agent") || undefined;

  try {
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
    let dealId: string | null = (body.opportunityId as string) || null;

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
        // Check for existing contact by email or phone
        let existing = null;
        if (email) {
          const { data } = await supabaseAdmin.from("contacts").select("id").eq("email", email).maybeSingle();
          existing = data;
        }
        if (!existing && (mobilePhone || businessPhone)) {
          const { data } = await supabaseAdmin.from("contacts").select("id").eq("phone", mobilePhone || businessPhone).maybeSingle();
          existing = data;
        }

        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact, error: insertErr } = await supabaseAdmin
            .from("contacts")
            .insert({
              first_name: firstName || "",
              last_name: lastName || "",
              email: email || null,
              phone: mobilePhone || businessPhone || null,
              business_name: businessName || null,
              source: source || "Website - Application Form",
              tags: ["application-started"],
              fbc: _fbc || null,
              fbp: _fbp || null,
              utm_campaign: utmCampaign || null,
              utm_content: utmContent || null,
              utm_medium: utmMedium || null,
              ad_id: adId || utmContent || null,
            })
            .select("id")
            .single();
          if (insertErr || !newContact) throw new Error(insertErr?.message || "Contact insert failed");
          contactId = newContact.id;
        }
        // Sync to Zoho (non-blocking, don't fail the request if Zoho is down)
        zohoCreateLead({
          firstName,
          lastName,
          businessName: businessName || legalName,
          email,
          phone: businessPhone,
          source: source || "Meta Ads",
          fundingAmount: amountNeeded,
          monthlyRevenue: monthlyDeposits,
          industry,
          creditScoreRange: creditScore,
        }).catch(err => console.error("Zoho sync failed:", err));
        // ── Sync to GHL ──
        const ghlContactId = await ghlUpsertContact({
          firstName, lastName, email,
          phone: mobilePhone || businessPhone,
          businessName, source,
          tags: ["application-started"],
        });
        if (ghlContactId) {
          const stageId = null; // ghlGetNewLeadStageId removed
          if (stageId) {
            const ghlOppId = await ghlCreateOpportunity({
              ghlContactId,
              name: `${contactName} — ${amountNeeded || "Amount TBD"}`,
              stageId,
              amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
              source: source || "Website - Application Form",
            });
            console.log("[GHL] Opportunity created:", ghlOppId);
          }
        }
      } catch (error) {
        console.error("Contact creation failed:", error instanceof Error ? error.message : error);
        systemAlert("Contact Creation Failed", `Application contact could not be created: ${error instanceof Error ? error.message : "Unknown error"}. Lead data saved locally.`, "leads/application").catch(() => {});
      }

      // Create deal
      if (contactId && !dealId) {
        try {
          const { data: deal, error: dealErr } = await supabaseAdmin
            .from("deals")
            .insert({
              contact_id: contactId,
              pipeline: "New Deals",
              stage: "Open - Not Contacted",
              amount: 0,
              source: source || "Website - Application",
            })
            .select("id")
            .single();
          if (dealErr) throw new Error(dealErr.message);
          dealId = deal!.id;

          await supabaseAdmin.from("deal_events").insert({
            deal_id: dealId,
            event_type: "created",
            description: `Application started (${completionPct}%)`,
          });

          await supabaseAdmin.from("system_logs").insert({
            event_type: "pipeline_deal_created",
            description: `New deal: ${contactName} → New Deals / Open - Not Contacted`,
            metadata: { contactId, dealId, pipeline: "New Deals", stage: "Open - Not Contacted", source: `application-${completionPct}%` },
          });
        } catch (error) {
          console.error("Deal creation error:", error instanceof Error ? error.message : error);
        }
      }

      // Log
      await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_capture",
        description: `Application started (${completionPct}%): ${contactName} (${email || businessPhone})`,
        metadata: { contactId, dealId, contactName, email, phone: businessPhone, completionPct, clientIp, clientUserAgent },
      });

      // Fire Meta CAPI Lead event at 25%
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

      // Pre-create OneDrive folder
      if (businessName) {
        const safeName = businessName.replace(/[<>:"/\\|?*]/g, "_");
        microsoft.createDriveFolder("Working Files")
          .then(() => microsoft.createDriveFolder(safeName, "Working Files"))
          .then(() => console.log(`[25%] OneDrive folder created: Working Files/${safeName}`))
          .catch((err) => console.warn("[25%] OneDrive folder pre-creation failed:", err instanceof Error ? err.message : err));
      }

      // Enroll in application-abandoned sequence
      if (email && contactId && completionPct < 100) {
        enrollContact("application-abandoned", contactId, email, contactName, { businessName })
          .catch((err) => console.error("[Sequence] application-abandoned enrollment error:", err));
      }

      if (completionPct < 100) {
        return NextResponse.json(
          { success: true, message: "Lead created", contactId, opportunityId: dealId },
          { headers: corsHeaders }
        );
      }
    }

    // ── 25-99% with existing contactId — enrich contact ──
    if (contactId && completionPct < 100) {
      const updates: Record<string, unknown> = {};
      if (businessName) updates.business_name = businessName;
      if (legalName) updates.legal_name = legalName;
      if (dba) updates.dba = dba;
      if (industry) updates.industry = industry;
      if (ein) updates.ein = ein;
      if (bizAddress) updates.address_street = bizAddress;
      if (bizCity) updates.address_city = bizCity;
      if (bizState) updates.address_state = bizState;
      if (bizZip) updates.address_zip = bizZip;
      if (mobilePhone) updates.mobile_phone = mobilePhone;
      if (incDate) updates.incorporation_date = incDate;
      else if (startMonth && startYear) updates.incorporation_date = `${startMonth} ${startYear}`;
      if (dob) updates.dob = dob;
      if (creditScore) updates.credit_score_range = creditScore;
      if (ownership) updates.ownership_pct = String(ownership);
      if (amountNeeded) updates.funding_amount_requested = amountNeeded;
      if (useOfFunds) updates.use_of_funds = useOfFunds;
      if (monthlyDeposits) updates.monthly_deposits = monthlyDeposits;
      if (existingLoans) updates.existing_loans = String(existingLoans).includes("Yes") ? "Yes" : "No";
      if (homeAddress) updates.home_address = homeAddress;
      if (ssn4) updates.ssn_last4 = ssn4;

      if (Object.keys(updates).length > 0) {
        updates.updated_at = new Date().toISOString();
        await supabaseAdmin.from("contacts").update(updates).eq("id", contactId).then(() => {});
      }

      await supabaseAdmin.from("system_logs").insert({
        event_type: "application_progress",
        description: `Application progress: ${contactName} — ${completionPct}% (${applicationStage || "in progress"})`,
        metadata: { contactId, dealId, completionPct, applicationStage, clientIp },
      });

      return NextResponse.json(
        { success: true, message: `Progress saved: ${completionPct}%`, contactId, opportunityId: dealId },
        { headers: corsHeaders }
      );
    }

    // ── 100% — Final submission ──
    // Create contact if none yet (edge case: jumped to 100%)
    if (!contactId) {
      try {
        let existing = null;
        if (email) {
          const { data } = await supabaseAdmin.from("contacts").select("id").eq("email", email).maybeSingle();
          existing = data;
        }
        if (existing) {
          contactId = existing.id;
        } else {
          const { data: newContact } = await supabaseAdmin
            .from("contacts")
            .insert({
              first_name: firstName || "", last_name: lastName || "",
              email: email || null, phone: mobilePhone || businessPhone || null,
              business_name: businessName || legalName || null,
              source: source || "Website - Application Form",
              tags: ["application-started"],
            })
            .select("id")
            .single();
          contactId = newContact?.id || null;
        }
      } catch (error) {
        console.error("[100%] Contact creation failed:", error instanceof Error ? error.message : error);
        systemAlert("Contact Creation Failed at 100%", `Could not create contact for ${contactName} (${email})`, "leads/application", "error").catch(() => {});
      }
    }

    const fullAddress = [bizAddress, bizCity, bizState, bizZip].filter(Boolean).join(", ");

    // Update contact with ALL fields
    if (contactId) {
      await supabaseAdmin.from("contacts").update({
        first_name: firstName || undefined,
        last_name: lastName || undefined,
        phone: mobilePhone || businessPhone || undefined,
        mobile_phone: mobilePhone || undefined,
        business_name: businessName || legalName || undefined,
        legal_name: legalName || undefined,
        dba: dba || undefined,
        industry: industry || undefined,
        ein: ein || undefined,
        incorporation_date: incDate || (startMonth && startYear ? `${startMonth} ${startYear}` : undefined),
        address_street: bizAddress || undefined,
        address_city: bizCity || undefined,
        address_state: bizState || undefined,
        address_zip: bizZip || undefined,
        credit_score_range: creditScore || undefined,
        ownership_pct: ownership ? String(ownership) : undefined,
        funding_amount_requested: amountNeeded || undefined,
        use_of_funds: useOfFunds || undefined,
        monthly_deposits: monthlyDeposits || undefined,
        existing_loans: existingLoans ? (String(existingLoans).includes("Yes") ? "Yes" : "No") : undefined,
        ssn_last4: ssn4 || undefined,
        dob: dob || undefined,
        home_address: homeAddress || undefined,
        signature_name: signatureName || undefined,
        updated_at: new Date().toISOString(),
      }).eq("id", contactId).then(() => {});
    }

    // Create deal if none yet
    if (!dealId && contactId) {
      try {
        const { data: deal } = await supabaseAdmin
          .from("deals")
          .insert({
            contact_id: contactId,
            pipeline: "New Deals",
            stage: "Open - Not Contacted",
            amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
            source: source || "Website - Application",
          })
          .select("id")
          .single();
        dealId = deal?.id || null;
        if (dealId) {
          await supabaseAdmin.from("deal_events").insert({
            deal_id: dealId,
            event_type: "created",
            description: `Application completed (100%)`,
          });
          await supabaseAdmin.from("system_logs").insert({
            event_type: "pipeline_deal_created",
            description: `New deal: ${contactName} → New Deals / Open - Not Contacted (100% application)`,
            metadata: { contactId, dealId, pipeline: "New Deals", stage: "Open - Not Contacted", source: "application-100%" },
          });
        }
      } catch (error) {
        console.error("Deal creation error at 100%:", error instanceof Error ? error.message : error);
      }
    } else if (dealId) {
      // Update deal amount
      await supabaseAdmin.from("deals").update({
        amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
        updated_at: new Date().toISOString(),
      }).eq("id", dealId);
    }

    // Log completion
    await supabaseAdmin.from("system_logs").insert({
      event_type: "lead_capture",
      description: `Application completed: ${contactName} — ${businessName || "N/A"} — ${amountNeeded || "N/A"}`,
      metadata: { contactId, dealId, contactName, businessName, email, amountNeeded, creditScore, clientIp, clientUserAgent, hasSignature: !!signature },
    });

    // Slack notification to #hot-leads
    const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (hotLeadsChannel) {
      const lines = [`🟢 *Application Completed: ${contactName}*`];
      if (businessName) lines.push(`Business: ${businessName}`);
      if (amountNeeded) lines.push(`Amount: ${amountNeeded}`);
      if (email) lines.push(`Email: ${email}`);
      if (mobilePhone || businessPhone) lines.push(`Phone: ${mobilePhone || businessPhone}`);
      lines.push("Source: Application (100%)");
      slack.postMessage(hotLeadsChannel, lines.join("\n")).catch(() => {});
    }

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

    // Tag "application-completed" + cancel abandonment sequences
    if (contactId) {
      // Add tag directly in contacts table
      try {
        const { data: existing } = await supabaseAdmin
          .from("contacts")
          .select("tags")
          .eq("id", contactId!)
          .single();
        const currentTags = (existing?.tags as string[]) || [];
        if (!currentTags.includes("application-completed")) {
          await supabaseAdmin
            .from("contacts")
            .update({ tags: [...currentTags, "application-completed"] })
            .eq("id", contactId!);
        }
      } catch { /* ignore tag errors */ }

      cancelByTag(contactId, "application-completed")
        .catch((err) => console.error("[Sequence] Cancel by tag error:", err));

      if (email) {
        enrollContact("application-completed-nurture", contactId, email, contactName, { businessName, amountNeeded })
          .catch((err) => console.error("[Sequence] application-completed-nurture enrollment error:", err));
      }
    }

    // ── PDF → OneDrive → Note → Confirmation email ──
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

      // Upload to OneDrive
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

        await supabaseAdmin.from("system_logs").insert({
          event_type: "application_pdf",
          description: `PDF uploaded: Working Files/${safeName}/Application - ${safeName}.pdf`,
          metadata: { contactId, businessName: safeName },
        });
      } catch (err) {
        console.error("[100%] OneDrive upload failed:", err instanceof Error ? err.message : err);
        systemAlert("OneDrive Upload Failed", `PDF upload failed for ${contactName} (${businessName}): ${err instanceof Error ? err.message : "Unknown error"}`, "leads/application", "error").catch(() => {});
      }

      // Add note
      if (contactId) {
        try {
          await supabaseAdmin.from("deal_notes").insert({
            contact_id: contactId,
            opportunity_id: dealId,
            body: `Application PDF uploaded to OneDrive: Working Files/${safeName}/Application - ${safeName}.pdf`,
            author: "System",
          });
        } catch { /* ignore */ }
      }

      // Send confirmation email with PDF
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
          console.error("[100%] Microsoft email failed:", errMsg);
          systemAlert("Email Delivery Failed", `Microsoft 365 could not send confirmation email to ${email}: ${errMsg.slice(0, 200)}`, "leads/application", "warning").catch(() => {});
        }
      }
    } catch (err) {
      console.error("[100%] Post-submission tasks failed:", err instanceof Error ? err.message : err);
      systemAlert("Application Post-Processing Failed", `PDF/OneDrive/Email failed for ${contactName}: ${err instanceof Error ? err.message : "Unknown error"}`, "leads/application", "error").catch(() => {});
    }

    return NextResponse.json(
      { success: true, message: "Application submitted successfully", contactId, opportunityId: dealId },
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

function buildApplicationSummaryEmail(data: { firstName?: string }): string {
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
      <p style="margin:0;font-size:14px;line-height:1.6">Please submit last 3 months of business bank statements to this email.</p>
      <p style="margin:8px 0 0;font-size:14px;line-height:1.6">Or <a href="https://api.whatsapp.com/send/?phone=7862822937" style="color:#25D366;font-weight:600">Send via WhatsApp</a></p>
    </div>
    <p style="font-size:14px;line-height:1.6">Let me know if you have any other questions!</p>
    <p style="font-size:14px;line-height:1.6;margin:0">Kind regards,</p>
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
