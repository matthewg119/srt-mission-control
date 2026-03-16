import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { generateApplicationPDF } from "@/lib/pdf-generator";
import { microsoft } from "@/lib/microsoft";
import { getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact, cancelByTag } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { slack } from "@/lib/slack-bot";

import {
        createLead as zohoCreateLead,
        updateLead as zohoUpdateLead,
        searchLeads as zohoSearchLeads,
        attachPDFToLead as zohoAttachPDF,
} from "@/lib/zoho";

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
                        incDate, startMonth, startYear, mobilePhone, dob, creditScore,
                        ownership, amountNeeded, useOfFunds, monthlyDeposits, existingLoans,
                        notes, ssn4, homeAddress, applicationCompletionPct, applicationStage,
                        source, _fbc, _fbp, eventId, sourceUrl, signature, signatureName,
                        utmCampaign, utmContent, utmMedium, adId,
            } = body;

          // ── 25%+ block: contact upsert, Zoho new-lead, Slack new-lead ──
          if (applicationCompletionPct >= 25) {
                      let contactId: string | null = null;
                      let dealId: string | null = null;

              const contactName = [firstName, lastName].filter(Boolean).join(" ") || businessName || email || "Unknown";

              // Look up existing contact by email or phone
              try {
                            const { data: existingContact } = await supabaseAdmin
                              .from("contacts")
                              .select("id")
                              .or(`email.eq.${email},phone.eq.${businessPhone}`)
                              .maybeSingle();

                        if (existingContact) {
                                        contactId = existingContact.id;
                                        // Update contact fields
                              await supabaseAdmin.from("contacts").update({
                                                first_name: firstName,
                                                last_name: lastName,
                                                business_name: businessName || legalName,
                                                industry,
                                                amount_needed: amountNeeded,
                                                source: source || "Meta Ads",
                                                updated_at: new Date().toISOString(),
                              }).eq("id", contactId!);
                        } else {
                                        // Insert new contact
                              const { data: newContact, error: insertErr } = await supabaseAdmin
                                          .from("contacts")
                                          .insert({
                                                              first_name: firstName,
                                                              last_name: lastName,
                                                              email,
                                                              phone: businessPhone,
                                                              mobile_phone: mobilePhone,
                                                              business_name: businessName || legalName,
                                                              legal_name: legalName,
                                                              dba,
                                                              industry,
                                                              biz_address: bizAddress,
                                                              biz_city: bizCity,
                                                              biz_state: bizState,
                                                              biz_zip: bizZip,
                                                              ein,
                                                              inc_date: incDate,
                                                              start_month: startMonth,
                                                              start_year: startYear,
                                                              dob,
                                                              credit_score: creditScore,
                                                              ownership,
                                                              amount_needed: amountNeeded,
                                                              use_of_funds: useOfFunds,
                                                              monthly_deposits: monthlyDeposits,
                                                              existing_loans: existingLoans,
                                                              notes,
                                                              ssn4,
                                                              home_address: homeAddress,
                                                              source: source || "Meta Ads",
                                                              utm_campaign: utmCampaign || null,
                                                              utm_content: utmContent || null,
                                                              utm_medium: utmMedium || null,
                                                              ad_id: adId || utmContent || null,
                                          })
                                          .select("id")
                                          .single();

                              if (insertErr || !newContact) throw new Error(insertErr?.message || "Contact insert failed");
                              contactId = newContact.id;

                              // Log new lead to system_logs so it shows in Recent Activity
                              await supabaseAdmin.from("system_logs").insert({
                                event_type: "lead_capture",
                                description: `New lead captured: ${contactName} — ${businessName || "N/A"} — ${email || "N/A"}`,
                                metadata: { contactId, contactName, businessName, email, source: source || "Meta Ads", applicationStage: "25%" },
                              });
                              // fire-and-forget, don't block on system_log insert

                              // Sync NEW contact to Zoho (non-blocking)
                              const timeInBiz = (startMonth && startYear) ? `${startMonth} ${startYear}` : undefined;
                              zohoCreateLead({
                                firstName, lastName,
                                businessName: businessName || legalName, legalName, dba,
                                email, phone: mobilePhone || businessPhone,
                                source: source || "Meta Ads", Lead_Status: "New",
                                industry, ein, bizAddress, bizCity, bizState, bizZip,
                                timeInBusiness: timeInBiz, creditScoreRange: creditScore,
                                ownership: ownership ? String(ownership) : undefined,
                              }).catch(err => console.error("[Zoho 25%] create failed:", err instanceof Error ? err.message : err));

                              // Slack: new lead captured — with dedup check
                              if (applicationCompletionPct >= 25 && applicationCompletionPct <= 35) {
                                const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
                                if (hotLeadsChannel) {
                                  const { data: recentSlack } = await supabaseAdmin
                                    .from("system_logs").select("id")
                                    .eq("event_type", "slack_new_lead")
                                    .like("description", `%${email}%`)
                                    .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
                                    .limit(1);

                                  if (!recentSlack || recentSlack.length === 0) {
                                    slack.postMessage(hotLeadsChannel, [
                                      "📥 *New Lead Captured*", "",
                                      `*Name:* ${[firstName, lastName].filter(Boolean).join(" ")}`,
                                      `*Business:* ${businessName || legalName || "–"}`,
                                      `*Industry:* ${industry || "–"}`,
                                      `*Phone:* ${mobilePhone || businessPhone || "–"}`,
                                      `*Email:* ${email || "–"}`,
                                      `*Source:* ${source || "Meta Ads"}`,
                                    ].join("\n")).catch(err => console.error("[Slack] postMessage failed:", err instanceof Error ? err.message : err));

                                    try {
                                      await supabaseAdmin.from("system_logs").insert({
                                        event_type: "slack_new_lead",
                                        description: `Slack notification sent for new lead: ${contactName} (${email})`,
                                        metadata: { email, contactId },
                                      });
                                    } catch { /* ignore */ }
                                  }
                                }
                              }
                        }

              } catch (error) {
                            console.error("[25%] Contact creation failed:", error instanceof Error ? error.message : error);
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
                                                                  amount: parseFloat((amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0,
                                                                  source: source || "Website - Application",
                                              })
                                              .select("id")
                                              .maybeSingle();
                                            if (!dealErr && deal) {
                                              dealId = deal.id;
                                              try {
                                                await supabaseAdmin.from("system_logs").insert({
                                                  event_type: "pipeline_deal_created",
                                                  description: `New deal: ${contactName} → New Deals / Open - Not Contacted`,
                                                  metadata: { contactId, dealId, pipeline: "New Deals", stage: "Open - Not Contacted", source: "application-25%" },
                                                });
                                              } catch { /* ignore */ }
                                            }
                            } catch { /* ignore deal creation errors */ }
              }

              // Send lead capture event to Meta CAPI
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
              }).catch((err) => console.error("[Meta CAPI] Lead event error:", err));

              return NextResponse.json(
                    { success: true, message: "Lead captured", contactId },
                    { headers: corsHeaders }
                          );
          }

          // ── 100% block ──
          if (applicationCompletionPct >= 100) {
                      const contactName = [firstName, lastName].filter(Boolean).join(" ") || businessName || email || "Unknown";

              // Get or create contactId
              let contactId: string | null = null;
                      let dealId: string | null = null;

              try {
                            const { data: existingContact } = await supabaseAdmin
                              .from("contacts")
                              .select("id")
                              .or(`email.eq.${email},phone.eq.${businessPhone}`)
                              .maybeSingle();
                            contactId = existingContact?.id || null;
              } catch { /* ignore */ }

              // Update contact with final fields
              if (contactId) {
                            try {
                                            await supabaseAdmin.from("contacts").update({
                                                              first_name: firstName,
                                                              last_name: lastName,
                                                              business_name: businessName || legalName,
                                                              legal_name: legalName,
                                                              dba,
                                                              industry,
                                                              biz_address: bizAddress,
                                                              biz_city: bizCity,
                                                              biz_state: bizState,
                                                              biz_zip: bizZip,
                                                              ein,
                                                              inc_date: incDate,
                                                              start_month: startMonth,
                                                              start_year: startYear,
                                                              dob,
                                                              credit_score: creditScore,
                                                              ownership,
                                                              amount_needed: amountNeeded,
                                                              use_of_funds: useOfFunds,
                                                              monthly_deposits: monthlyDeposits,
                                                              existing_loans: existingLoans,
                                                              notes,
                                                              ssn4,
                                                              home_address: homeAddress,
                                                              signature: signature || null,
                                                              signature_name: signatureName || null,
                                                              updated_at: new Date().toISOString(),
                                            }).eq("id", contactId);
                            } catch (err) {
                                            console.error("[100%] Contact update error:", err instanceof Error ? err.message : err);
                            }
              }

              // Get deal ID
              if (contactId) {
                            try {
                                            const { data: deal } = await supabaseAdmin
                                              .from("deals")
                                              .select("id")
                                              .eq("contact_id", contactId)
                                              .order("created_at", { ascending: false })
                                              .limit(1)
                                              .maybeSingle();
                                            dealId = deal?.id || null;
                            } catch { /* ignore */ }
              }

              // Create deal if missing
              if (contactId && !dealId) {
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
                                            console.error("[100%] Deal creation error:", error instanceof Error ? error.message : error);
                            }
              } else if (dealId) {
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

              // ── Zoho: upsert at 100% with full fields ──
              // Build Description block for financial/owner details (not yet custom fields in Zoho)
              const timeInBiz100 = incDate || ((startMonth && startYear) ? `${startMonth} ${startYear}` : undefined);
                      const descParts: string[] = [];
                      if (amountNeeded) descParts.push(`Funding Requested: ${amountNeeded}`);
                      if (monthlyDeposits) descParts.push(`Monthly Deposits: ${monthlyDeposits}`);
                      if (creditScore) descParts.push(`Credit Score Range: ${creditScore}`);
                      if (ownership) descParts.push(`Ownership %: ${ownership}`);
                      if (useOfFunds) descParts.push(`Use of Funds: ${useOfFunds}`);
                      if (existingLoans) descParts.push(`Existing Loans: ${existingLoans}`);
                      if (dob) descParts.push(`Date of Birth: ${dob}`);
                      const zohoDescription = descParts.length > 0 ? descParts.join(" | ") : undefined;

              const zohoFullData = {
                            firstName,
                            lastName,
                            businessName: businessName || legalName,
                            legalName,
                            dba,
                            email,
                            phone: mobilePhone || businessPhone,
                            source: source || "Meta Ads",
                            Lead_Status: "Application Complete",
                            industry,
                            ein,
                            bizAddress,
                            bizCity,
                            bizState,
                            bizZip,
                            timeInBusiness: timeInBiz100,
                            creditScoreRange: creditScore,
                            ownership: ownership ? String(ownership) : undefined,
                            fundingAmount: amountNeeded,
                            monthlyDeposits,
                            useOfFunds,
                            existingLoans: existingLoans ? (String(existingLoans).includes("Yes") ? "Yes" : "No") : undefined,
                            dob,
                            ssn4,
                            homeAddress,
                            signatureName: signatureName || undefined,
                            incDate: incDate || undefined,
              };

              // Store zoho lead ID so we can attach PDF later
              let zohoLeadId: string | null = null;

              // Awaitable Zoho upsert: search first, update or create
              const zohoUpsertPromise = (async () => {
                            try {
                                            const existingLeads = email ? await zohoSearchLeads({ email }) : [];
                                            const existingZohoLead = existingLeads.find((l: { Email?: string }) => l.Email === email);

                              if (existingZohoLead && existingZohoLead.id) {
                                                // Update existing Zoho lead with all fields including custom
                                              await zohoUpdateLead(existingZohoLead.id as string, {
                                                                  First_Name: firstName,
                                                                  Last_Name: lastName || businessName || legalName,
                                                                  Company: businessName || legalName,
                                                                  Email: email,
                                                                  Phone: mobilePhone || businessPhone,
                                                                  Lead_Source: source || "Meta Ads",
                                                                  Lead_Status: "Application Complete",
                                                                  Industry: industry,
                                                                  EIN: ein,
                                                                  DBA: dba,
                                                                  Street: bizAddress,
                                                                  City: bizCity,
                                                                  State: bizState,
                                                                  Zip_Code: bizZip,
                                                                  Time_in_Business: timeInBiz100,
                                                                  Legal_Name: legalName,
                                                                  Funding_Amount_Requested: amountNeeded,
                                                                  Monthly_Deposits: monthlyDeposits,
                                                                  Credit_Score_Range: creditScore,
                                                                  Use_of_Funds: useOfFunds,
                                                                  Existing_Loans: existingLoans ? (String(existingLoans).includes("Yes") ? "Yes" : "No") : undefined,
                                                                  Ownership_Percentage: ownership,
                                                                  Date_of_Birth: dob,
                                                                  SSN_Last_4: ssn4,
                                                                  Home_Address: homeAddress,
                                                                  Incorporation_Date: timeInBiz100,
                                                                  Signature_Name: signatureName,
                                                                  Description: zohoDescription,
                                              });
                                                zohoLeadId = existingZohoLead.id as string;
                                                console.log("[Zoho 100%] Lead updated:", zohoLeadId);
                              } else {
                                                // Create new Zoho lead with all fields
                                              const newId = await zohoCreateLead(zohoFullData);
                                                zohoLeadId = newId;
                                                console.log("[Zoho 100%] Lead created:", zohoLeadId);
                              }
                            } catch (err) {
                                            console.error("[Zoho 100%] sync failed:", err instanceof Error ? err.message : err);
                            }
              })();

              // ── Slack: Application Completed — with dedup ──
              const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
              if (hotLeadsChannel) {
                const { data: recentComplete } = await supabaseAdmin
                  .from("system_logs").select("id")
                  .eq("event_type", "slack_app_complete")
                  .like("description", `%${email}%`)
                  .gte("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
                  .limit(1);

                if (!recentComplete || recentComplete.length === 0) {
                  const completedLines = [
                    `✅ *Application Completed: ${contactName}*`, "",
                    `*Business:* ${businessName || legalName || "—"}`,
                    `*Industry:* ${industry || "—"}`,
                    `*Funding Requested:* ${amountNeeded ? `$${amountNeeded}` : "—"}`,
                    `*Monthly Revenue / Deposits:* ${monthlyDeposits || "—"}`,
                    `*Email:* ${email || "—"}`,
                    `*Phone:* ${mobilePhone || businessPhone || "—"}`,
                  ];
                  slack.postMessage(hotLeadsChannel, completedLines.join("\n"))
                    .catch(err => console.error("[Slack 100%] postMessage failed:", err instanceof Error ? err.message : err));

                  try {
                    await supabaseAdmin.from("system_logs").insert({
                      event_type: "slack_app_complete",
                      description: `Slack notification sent for completed application: ${contactName} (${email})`,
                      metadata: { email, contactId },
                    });
                  } catch { /* ignore */ }
                }
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
                            try {
                                            const { data: existingContact } = await supabaseAdmin
                                              .from("contacts")
                                              .select("tags")
                                              .eq("id", contactId!)
                                              .single();
                                            const currentTags = (existingContact?.tags as string[]) || [];
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

              // ── PDF generation → OneDrive upload → Zoho attachment → Confirmation email ──
              const safeName = (businessName || legalName || "Unknown").replace(/[<>:"/\\|?*]/g, "_");

              try {
                            let pdfBuffer: Buffer | undefined;

                        try {
                                        pdfBuffer = generateApplicationPDF({
                                                          firstName, lastName, email, businessPhone, mobilePhone,
                                                          businessName, legalName, dba, industry, ein,
                                                          bizAddress, bizCity, bizState, bizZip, incDate, dob,
                                                          creditScore, ownership, amountNeeded, useOfFunds,
                                                          monthlyDeposits, existingLoans, notes,
                                                          signature: signature || undefined,
                                                          signatureName: signatureName || contactName,
                                        });
                                        console.log("[100%] PDF generated, size:", pdfBuffer.length, "bytes");
                        } catch (pdfErr) {
                                        throw new Error(`PDF generation failed: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`);
                        }

                        // Upload to OneDrive
                        let oneDriveUrl: string | undefined;
                            try {
                                            await microsoft.createDriveFolder("Working Files");
                                            await microsoft.createDriveFolder(safeName, "Working Files");
                                            const uploadResult = await microsoft.uploadDriveFile(
                                                              `Working Files/${safeName}`,
                                                              `Application - ${safeName}.pdf`,
                                                              pdfBuffer,
                                                              "application/pdf"
                                                            );
                                            oneDriveUrl = uploadResult.webUrl;
                                            console.log(`[100%] PDF uploaded to OneDrive: Working Files/${safeName}/Application - ${safeName}.pdf`);

                              await supabaseAdmin.from("system_logs").insert({
                                                event_type: "application_pdf",
                                                description: `PDF uploaded: Working Files/${safeName}/Application - ${safeName}.pdf`,
                                                metadata: { contactId, businessName: safeName, webUrl: oneDriveUrl },
                              });
                            } catch (odErr) {
                                            const odMsg = odErr instanceof Error ? odErr.message : String(odErr);
                                            console.error("[OneDrive] error:", odMsg);
                                            try {
                                              await supabaseAdmin.from("system_logs").insert({
                                                event_type: "onedrive_error",
                                                description: `OneDrive upload failed for ${contactName}: ${odMsg.slice(0, 300)}`,
                                                metadata: { contactId, businessName: safeName, error: odMsg },
                                              });
                                            } catch { /* ignore */ }
                                            systemAlert("OneDrive Upload Failed", `PDF upload failed for ${contactName} (${businessName}): ${odMsg}`, "leads/application", "error").catch(() => {});
                            }

                        // Add note
                        if (contactId) {
                                        try {
                                                          await supabaseAdmin.from("deal_notes").insert({
                                                                              contact_id: contactId,
                                                                              opportunity_id: dealId,
                                                                              body: `Application PDF uploaded to OneDrive: Working Files/${safeName}/Application - ${safeName}.pdf${oneDriveUrl ? ` — ${oneDriveUrl}` : ""}`,
                                                                              author: "System",
                                                          });
                                        } catch { /* ignore */ }
                        }

                        // Attach PDF to Zoho lead — await the upsert promise first to ensure zohoLeadId is set
                        if (pdfBuffer) {
                                        await zohoUpsertPromise;
                                        if (zohoLeadId) {
                                                          try {
                                                                              await zohoAttachPDF(zohoLeadId, `Application - ${safeName}.pdf`, pdfBuffer);
                                                                              console.log(`[100%] PDF attached to Zoho lead ${zohoLeadId}`);
                                                          } catch (attachErr) {
                                                                              console.error("[100%] Zoho PDF attachment failed:", attachErr instanceof Error ? attachErr.message : attachErr);
                                                          }
                                        } else {
                                                          console.warn("[100%] zohoLeadId not available — skipping Zoho PDF attachment");
                                        }
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
                                                                                                    contentBytes: pdfBuffer!.toString("base64"),
                                                                              }],
                                                          });
                                                          console.log("[100%] Confirmation email with PDF sent to", email);
                                        } catch (emailErr) {
                                                          const errMsg = emailErr instanceof Error ? emailErr.message : String(emailErr);
                                                          console.error("[100%] Microsoft email failed:", errMsg);
                                                          try {
                                                            await supabaseAdmin.from("system_logs").insert({
                                                              event_type: "email_send_error",
                                                              description: `Confirmation email to ${email} failed: ${errMsg.slice(0, 200)}`,
                                                              metadata: { contactId, email, error: errMsg },
                                                            });
                                                          } catch { /* ignore */ }
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
          }

          // Default response for other completion percentages
          return NextResponse.json(
                { success: true, message: "Progress saved" },
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
                                                                                                                                                        <td style="vertical-align:bottom;padding-right:3px"><div style="width:5px;height:10px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
                                                                                                                                                                                        <td style="vertical-align:bottom;padding-right:10px"><div style="width:5px;height:16px;background:#2ee6a8;border-radius:1px;display:inline-block"></div></td>
                                                                                                                                                                                                                        <td style="vertical-align:bottom"><span style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span></td>
                                                                                                                                                                                                                                              </tr>
                                                                                                                                                                                                                                                            </table>
                                                                                                                                                                                                                                                                    </div>
                                                                                                                                                                                                                                                                            <div style="padding:32px 24px">
                                                                                                                                                                                                                                                                                          <h2 style="color:#0d1b2a;margin:0 0 16px">Application Received</h2>
                                                                                                                                                                                                                                                                                                        <p style="margin:0 0 16px">Hi ${data.firstName || "there"},</p>
                                                                                                                                                                                                                                                                                                                      <p style="margin:0 0 16px">Thank you for submitting your business funding application with SRT Agency. We have received your information and our team will review it shortly.</p>
                                                                                                                                                                                                                                                                                                                                    <p style="margin:0 0 16px">A copy of your completed application is attached to this email for your records.</p>
                                                                                                                                                                                                                                                                                                                                                  <p style="margin:0 0 16px">If you have any questions, feel free to reply to this email or contact us directly.</p>
                                                                                                                                                                                                                                                                                                                                                                <p style="margin:0">Best regards,<br><strong>The SRT Agency Team</strong></p>
                                                                                                                                                                                                                                                                                                                                                                        </div>
                                                                                                                                                                                                                                                                                                                                                                                <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
                                                                                                                                                                                                                                                                                                                                                                                              <p style="margin:0">SRT Agency — Business Funding Solutions</p>
                                                                                                                                                                                                                                                                                                                                                                                                      </div>
                                                                                                                                                                                                                                                                                                                                                                                                          </div>
                                                                                                                                                                                                                                                                                                                                                                                                            `;
}
