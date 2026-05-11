export const dynamic = "force-dynamic";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { generateApplicationPDF } from "@/lib/pdf-generator";
import { formatSSN, isValidSSN, lastFourOfSSN } from "@/lib/ssn";
import { microsoft } from "@/lib/microsoft";
import { getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact, cancelByTag } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { slack } from "@/lib/slack-bot";
import { fireSpeedToLead } from "@/lib/speed-to-lead";
import { postOrThreadLeadUpdate } from "@/lib/lead-thread";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";

import {
        createLead as zohoCreateLead,
        updateLead as zohoUpdateLead,
        searchLeads as zohoSearchLeads,
        attachPDFToLead as zohoAttachPDF,
        addNoteToLead as zohoAddNote,
        convertLeadToDeal as zohoConvertLeadToDeal,
} from "@/lib/zoho";

// Build a human-readable summary of the lead-magnet data we capture at the
// 25% step. We dump this into a Zoho Note because the corresponding structured
// fields (Funding_Amount_Requested, Credit_Score_Range, Monthly_Revenue) may
// reject string ranges like "$100K - $250K" or "750+" depending on field type.
function buildLeadMagnetNote(data: {
  creditScore?: string;
  amountNeeded?: string;
  monthlyRevenue?: string;
  monthlyDeposits?: string;
  useOfFunds?: string;
  existingLoans?: string;
  industry?: string;
  source?: string;
}): string {
  const lines: string[] = [];
  if (data.creditScore) lines.push(`Credit: ${data.creditScore}`);
  if (data.amountNeeded) lines.push(`Funding Requested: ${data.amountNeeded}`);
  if (data.monthlyRevenue) lines.push(`Monthly Revenue: ${data.monthlyRevenue}`);
  if (data.monthlyDeposits) lines.push(`Monthly Deposits: ${data.monthlyDeposits}`);
  if (data.useOfFunds) lines.push(`Use of Funds: ${data.useOfFunds}`);
  if (data.existingLoans) lines.push(`Existing Loans: ${data.existingLoans}`);
  if (data.industry) lines.push(`Industry: ${data.industry}`);
  if (data.source) lines.push(`Source: ${data.source}`);
  return lines.join("\n");
}

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
                        incDate: incDateRaw, incorporatedDate, startMonth, startYear, mobilePhone, dob, creditScore,
                        ownership, amountNeeded, useOfFunds, monthlyDeposits, existingLoans,
                        monthlyRevenue, checkingAccount, hasBusinessChecking,
                        notes, ssn4: ssn4Raw, ssnFull: ssnFullRaw, homeAddress, applicationCompletionPct, applicationStage,
                        source, _fbc, _fbp, eventId, sourceUrl, signature, signatureName,
                        utmCampaign, utmContent, utmMedium, adId,
                        businessStartDate, hasCheckingAccount,
            } = body;

          // Accept incDate, incorporatedDate, or businessStartDate (v6 sends businessStartDate as "YYYY-MM")
          const incDate = incDateRaw || incorporatedDate || businessStartDate || ((startMonth && startYear) ? `${startMonth} ${startYear}` : undefined);

          // Accept hasCheckingAccount (v6 sends "Yes"/"No") as alias for hasBusinessChecking
          const hasBusinessCheckingResolved = hasBusinessChecking !== undefined ? hasBusinessChecking : hasCheckingAccount;

          // SSN normalization: prefer full SSN when provided. Always keep ssn4
          // populated (derived from last 4 of ssn_full) so downstream readers
          // (Zoho SSN_Last_4, PDF, admin views) keep working.
          const ssnFull: string | undefined = isValidSSN(ssnFullRaw) ? formatSSN(ssnFullRaw) : undefined;
          const ssn4: string | undefined = ssnFull ? lastFourOfSSN(ssnFull) : (ssn4Raw || undefined);

          const serverEventId = eventId || randomUUID();

          // Normalize email for consistent lookups
          const normalizedEmail = email ? email.trim().toLowerCase() : email;

          // ── 10% block: create minimal contact on email capture ──
          if (applicationCompletionPct < 25 && applicationCompletionPct >= 10 && email) {
            try {
              // Try insert first — won't overwrite existing data
              const lookupPhone10 = mobilePhone || businessPhone;
              const { data: inserted, error: insertErr10 } = await supabaseAdmin
                .from("contacts")
                .insert({
                  email: normalizedEmail,
                  ...(firstName ? { first_name: firstName } : {}),
                  ...(lastName ? { last_name: lastName } : {}),
                  ...(businessName ? { business_name: businessName } : {}),
                  ...(lookupPhone10 ? { phone: lookupPhone10, mobile_phone: lookupPhone10 } : {}),
                  ...(source ? { source } : {}),
                  ...(amountNeeded ? { amount_needed: amountNeeded } : {}),
                  application_stage: applicationStage || "Email Captured",
                  application_completion_pct: applicationCompletionPct,
                })
                .select("id")
                .maybeSingle();
              const upserted = inserted || (insertErr10 ? (
                // Email exists — just fetch the existing contact
                await supabaseAdmin.from("contacts").select("id, zoho_lead_id").ilike("email", normalizedEmail).limit(1).maybeSingle()
              ).data : null);
              if (upserted) {
                // If contact already existed and had phone missing, update it
                if (!inserted && lookupPhone10) {
                  await supabaseAdmin.from("contacts").update({
                    phone: lookupPhone10, mobile_phone: lookupPhone10,
                    ...(firstName ? { first_name: firstName } : {}),
                    ...(lastName ? { last_name: lastName } : {}),
                    ...(businessName ? { business_name: businessName } : {}),
                    ...(amountNeeded ? { amount_needed: amountNeeded } : {}),
                  }).eq("id", upserted.id);
                }

                // Zoho: create lead — AWAIT so zoho_lead_id is saved before Step 2 can run
                const existingZohoId = (upserted as any).zoho_lead_id;
                if (!existingZohoId) {
                  try {
                    const zohoId = await zohoCreateLead({
                      email: normalizedEmail,
                      firstName: firstName || undefined,
                      lastName: lastName || undefined,
                      businessName: businessName || undefined,
                      phone: lookupPhone10 || undefined,
                      source: source || "lead magnet",
                      Lead_Status: "New Lead",
                      fundingAmount: amountNeeded || undefined,
                    });
                    if (zohoId) {
                      await supabaseAdmin.from("contacts").update({ zoho_lead_id: zohoId }).eq("id", upserted.id);
                      console.log("[Zoho 10%] Lead created:", zohoId, normalizedEmail);
                    }
                  } catch (err) {
                    console.error("[Zoho 10%] create failed:", err instanceof Error ? err.message : err);
                  }
                }

                // Slack: post or thread-reply to the lead's Slack thread.
                // First touch creates a top-level message with all known fields;
                // subsequent calls thread-reply with the diff.
                postOrThreadLeadUpdate({ contactId: upserted.id, action: "create" })
                  .catch(err => console.error("[lead-thread 10%] failed:", err instanceof Error ? err.message : err));

                // Log to system_logs for dedup and activity feed
                await supabaseAdmin.from("system_logs").insert({
                  event_type: "lead_capture",
                  description: `New visitor captured: ${normalizedEmail} — ${businessName || "N/A"}`,
                  metadata: { contactId: upserted.id, email: normalizedEmail, businessName, source: source || "lead magnet", applicationStage: "10%" },
                });

                // Meta CAPI: fire Lead event only when the visitor came from a Meta ad click.
                if (hasMetaAttributionServer({ fbc: _fbc })) {
                  try {
                    const capiResult = await sendEvent({
                      eventName: "Lead",
                      eventId: serverEventId,
                      eventSourceUrl: sourceUrl || "https://srtagency.com/freeguide-general",
                      actionSource: "website",
                      userData: {
                        email: normalizedEmail || undefined,
                        phone: lookupPhone10 || undefined,
                        firstName: firstName || undefined,
                        lastName: lastName || undefined,
                        fbc: _fbc || undefined,
                        fbp: _fbp || undefined,
                        clientIpAddress: clientIp !== "unknown" ? clientIp : undefined,
                        clientUserAgent,
                        externalId: upserted.id || undefined,
                      },
                      customData: {
                        content_name: "Free Business Funding Guide",
                        currency: "USD",
                      },
                    });
                    if (!capiResult.success) {
                      console.error("[Meta CAPI 10%] Lead event failed:", capiResult.error);
                      try {
                        await supabaseAdmin.from("system_logs").insert({
                          event_type: "meta_capi_error",
                          description: `Meta CAPI Lead event failed (10%): ${capiResult.error}`,
                          metadata: { email: normalizedEmail, eventName: "Lead", stage: "10%" },
                        });
                      } catch { /* ignore */ }
                    }
                  } catch (err) {
                    console.error("[Meta CAPI 10%] Lead event error:", err);
                  }
                }

                return NextResponse.json(
                  { success: true, contactId: upserted.id, message: "Contact captured" },
                  { headers: corsHeaders }
                );
              }
            } catch (e) {
              console.warn("[Application] 10% upsert error:", e instanceof Error ? e.message : e);
            }
            return NextResponse.json({ success: true, message: "Progress saved" }, { headers: corsHeaders });
          }

          // ── 25%+ block: contact upsert, Zoho new-lead, Slack new-lead ──
          if (applicationCompletionPct >= 25 && applicationCompletionPct < 100) {
                      let contactId: string | null = null;
                      let dealId: string | null = null;

              const contactName = [firstName, lastName].filter(Boolean).join(" ") || businessName || email || "Unknown";

              // Look up existing contact by email (primary) or phone (fallback)
              try {
                            const lookupPhone = businessPhone || mobilePhone;
                            const orFilter = lookupPhone
                              ? `email.ilike.${normalizedEmail},phone.eq.${lookupPhone},mobile_phone.eq.${lookupPhone}`
                              : `email.ilike.${normalizedEmail}`;
                            const { data: existingContact } = await supabaseAdmin
                              .from("contacts")
                              .select("id")
                              .or(orFilter)
                              .order("created_at", { ascending: false })
                              .limit(1)
                              .maybeSingle();

                        if (existingContact) {
                                        contactId = existingContact.id;
                                        // Update contact fields (merge in any qualifying data if present)
                              await supabaseAdmin.from("contacts").update({
                                                first_name: firstName,
                                                last_name: lastName,
                                                business_name: businessName || legalName,
                                                industry,
                                                amount_needed: amountNeeded,
                                                source: source || "Meta Ads",
                                                ...(monthlyRevenue ? { monthly_revenue: monthlyRevenue } : {}),
                                                ...(checkingAccount ? { checking_account: checkingAccount } : {}),
                                                ...(useOfFunds ? { use_of_funds: useOfFunds } : {}),
                                                ...(creditScore ? { credit_score: creditScore, portal_credit_score: creditScore } : {}),
                                                ...(mobilePhone ? { phone: mobilePhone, mobile_phone: mobilePhone } : {}),
                                                ...(hasBusinessCheckingResolved !== undefined ? { has_business_checking: hasBusinessCheckingResolved, portal_has_checking: hasBusinessCheckingResolved } : {}),
                                                ...(incDate ? { inc_date: incDate } : {}),
                                                ...(startMonth ? { start_month: startMonth } : {}),
                                                ...(startYear ? { start_year: startYear } : {}),
                                                updated_at: new Date().toISOString(),
                              }).eq("id", contactId!);

                              // Zoho: update existing lead or search-then-create (no duplicates)
                              if (applicationCompletionPct >= 25) {
                                const { data: fullContact } = await supabaseAdmin.from("contacts").select("zoho_lead_id").eq("id", contactId!).single();
                                const timeInBiz = incDate || ((startMonth && startYear) ? `${startMonth} ${startYear}` : undefined);

                                const zohoUpdateData = {
                                    First_Name: firstName,
                                    Last_Name: lastName || businessName || legalName,
                                    Company: businessName || legalName,
                                    Phone: mobilePhone || businessPhone,
                                    Lead_Status: "New Lead",
                                    Industry: industry,
                                    EIN: ein,
                                    DBA: dba,
                                    Street: bizAddress,
                                    City: bizCity,
                                    State: bizState,
                                    Zip_Code: bizZip,
                                    Time_in_Business: timeInBiz,
                                    Credit_Score_Range: creditScore,
                                    Funding_Amount_Requested: amountNeeded,
                                    Monthly_Revenue: monthlyRevenue,
                                    Ownership_Percentage: ownership,
                                };

                                // Resolve the Zoho lead ID we want to write to:
                                // 1) the one stored on the contact (created at 10%), or
                                // 2) the result of a fresh email search (in case 10% never ran), or
                                // 3) a new lead we create here.
                                // We AWAIT every Zoho call so the serverless function isn't torn
                                // down before the request completes — past fire-and-forget calls
                                // were silently dropping on Vercel.
                                let targetZohoId: string | null = fullContact?.zoho_lead_id || null;

                                if (!targetZohoId) {
                                  try {
                                    const searchResults = await zohoSearchLeads({ email: normalizedEmail });
                                    if (searchResults && searchResults.length > 0) {
                                      targetZohoId = searchResults[0].id as string;
                                      console.log("[Zoho 25%] Found existing lead by email search:", targetZohoId, email);
                                    }
                                  } catch (err) {
                                    console.error("[Zoho 25%] search failed:", err instanceof Error ? err.message : err);
                                  }
                                }

                                if (targetZohoId) {
                                  try {
                                    await zohoUpdateLead(targetZohoId, zohoUpdateData);
                                    console.log("[Zoho 25%] Lead updated:", targetZohoId, email);
                                    if (targetZohoId !== fullContact?.zoho_lead_id) {
                                      await supabaseAdmin.from("contacts").update({ zoho_lead_id: targetZohoId }).eq("id", contactId!);
                                    }
                                  } catch (err) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    console.error("[Zoho 25%] update failed:", msg);
                                    await supabaseAdmin.from("system_logs").insert({
                                      event_type: "zoho_sync_error",
                                      description: `Zoho lead update failed at 25% for ${normalizedEmail}: ${msg.slice(0, 300)}`,
                                      metadata: { contactId, zohoLeadId: targetZohoId, email: normalizedEmail, stage: "25%" },
                                    });
                                  }
                                } else {
                                  // Truly missing — create now (awaited)
                                  try {
                                    const newId = await zohoCreateLead({
                                      firstName, lastName,
                                      businessName: businessName || legalName, legalName, dba,
                                      email, phone: mobilePhone || businessPhone,
                                      source: source || "lead magnet", Lead_Status: "New Lead",
                                      industry, ein, bizAddress, bizCity, bizState, bizZip,
                                      timeInBusiness: timeInBiz, creditScoreRange: creditScore,
                                      fundingAmount: amountNeeded,
                                      monthlyRevenue,
                                      monthlyDeposits,
                                      ownership: ownership ? String(ownership) : undefined,
                                    });
                                    if (newId) {
                                      targetZohoId = newId;
                                      await supabaseAdmin.from("contacts").update({ zoho_lead_id: newId }).eq("id", contactId!);
                                      console.log("[Zoho 25%] Lead created for existing contact (fallback):", newId, email);
                                    }
                                  } catch (err) {
                                    const msg = err instanceof Error ? err.message : String(err);
                                    console.error("[Zoho 25%] create for existing failed:", msg);
                                    await supabaseAdmin.from("system_logs").insert({
                                      event_type: "zoho_sync_error",
                                      description: `Zoho lead create failed at 25% for ${normalizedEmail}: ${msg.slice(0, 300)}`,
                                      metadata: { contactId, email: normalizedEmail, stage: "25%" },
                                    });
                                  }
                                }

                                // Add a Note with the lead-magnet capture data, in case the
                                // structured fields above were rejected by Zoho field types.
                                if (targetZohoId) {
                                  const noteBody = buildLeadMagnetNote({
                                    creditScore, amountNeeded, monthlyRevenue, monthlyDeposits,
                                    useOfFunds, existingLoans, industry,
                                    source: source || "lead magnet",
                                  });
                                  if (noteBody) {
                                    try {
                                      await zohoAddNote(targetZohoId, "Lead Magnet Capture", noteBody);
                                      console.log("[Zoho 25%] Lead-magnet note added to:", targetZohoId);
                                    } catch (err) {
                                      console.error("[Zoho 25%] addNote failed:", err instanceof Error ? err.message : err);
                                    }
                                  }
                                }

                                // Slack: only fire milestone notifications at 50% and 80%
                                // (per user request — 25% updates are quietly synced to
                                // Supabase + Zoho but don't post to the lead thread).
                                if (contactId) {
                                  let milestoneAction: "milestone_50" | "milestone_80" | null = null;
                                  if (applicationCompletionPct >= 80) milestoneAction = "milestone_80";
                                  else if (applicationCompletionPct >= 50) milestoneAction = "milestone_50";
                                  if (milestoneAction) {
                                    postOrThreadLeadUpdate({ contactId, action: milestoneAction })
                                      .catch(err => console.error("[lead-thread milestone existing] failed:", err instanceof Error ? err.message : err));
                                  }
                                }

                                // Speed to Lead instant callback (existing contact, 25%+)
                                const stlPhone25Existing = mobilePhone || businessPhone;
                                if (stlPhone25Existing && contactId) {
                                  fireSpeedToLead({
                                    leadId: contactId,
                                    leadPhone: stlPhone25Existing,
                                    leadName: [firstName, lastName].filter(Boolean).join(" "),
                                    leadSource: "application-25%",
                                  });

                                  // Schedule first SMS 3 minutes after signup
                                  scheduleFirstSms(stlPhone25Existing, contactId, "new-lead").catch(
                                    (e) => console.error("[sms-schedule] failed:", (e as Error).message)
                                  );
                                }
                              }
                        } else {
                                        // Insert new contact
                              const { data: newContact, error: insertErr } = await supabaseAdmin
                                          .from("contacts")
                                          .insert({
                                                              first_name: firstName,
                                                              last_name: lastName,
                                                              email: normalizedEmail,
                                                              phone: businessPhone || mobilePhone,
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
                                                              monthly_revenue: monthlyRevenue || null,
                                                              checking_account: checkingAccount || null,
                                                              has_business_checking: hasBusinessCheckingResolved !== undefined ? hasBusinessCheckingResolved : null,
                                                              portal_has_checking: hasBusinessCheckingResolved !== undefined ? hasBusinessCheckingResolved : null,
                                                              existing_loans: existingLoans,
                                                              notes,
                                                              ssn4,
                                                              ssn_full: ssnFull,
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

                              // Sync NEW contact to Zoho — AWAITED so the serverless function
                              // doesn't tear down before the request completes.
                              const timeInBiz = (startMonth && startYear) ? `${startMonth} ${startYear}` : undefined;
                              let newZohoLeadId: string | null = null;
                              try {
                                newZohoLeadId = await zohoCreateLead({
                                  firstName, lastName,
                                  businessName: businessName || legalName, legalName, dba,
                                  email, phone: mobilePhone || businessPhone,
                                  source: source || "Meta Ads", Lead_Status: "New Lead",
                                  industry, ein, bizAddress, bizCity, bizState, bizZip,
                                  timeInBusiness: timeInBiz, creditScoreRange: creditScore,
                                  fundingAmount: amountNeeded,
                                  monthlyRevenue,
                                  monthlyDeposits,
                                  ownership: ownership ? String(ownership) : undefined,
                                });
                                if (newZohoLeadId) {
                                  await supabaseAdmin.from("contacts").update({ zoho_lead_id: newZohoLeadId }).eq("id", contactId!);
                                  console.log("[Zoho 25%] Lead created for new contact:", newZohoLeadId, email);
                                }
                              } catch (err) {
                                const msg = err instanceof Error ? err.message : String(err);
                                console.error("[Zoho 25%] create failed:", msg);
                                await supabaseAdmin.from("system_logs").insert({
                                  event_type: "zoho_sync_error",
                                  description: `Zoho lead create failed at 25% (new contact) for ${normalizedEmail}: ${msg.slice(0, 300)}`,
                                  metadata: { contactId, email: normalizedEmail, stage: "25%-new" },
                                });
                              }

                              // Add lead-magnet capture data as a Zoho Note (in case
                              // structured fields were rejected by Zoho field types).
                              if (newZohoLeadId) {
                                const noteBody = buildLeadMagnetNote({
                                  creditScore, amountNeeded, monthlyRevenue, monthlyDeposits,
                                  useOfFunds, existingLoans, industry,
                                  source: source || "Meta Ads",
                                });
                                if (noteBody) {
                                  try {
                                    await zohoAddNote(newZohoLeadId, "Lead Magnet Capture", noteBody);
                                    console.log("[Zoho 25%] Lead-magnet note added to:", newZohoLeadId);
                                  } catch (err) {
                                    console.error("[Zoho 25%] addNote failed:", err instanceof Error ? err.message : err);
                                  }
                                }
                              }

                              // Slack: brand-new contact — fire `create` so the top-level
                              // thread message is posted. If we entered the 25%+ block at a
                              // higher milestone (e.g. 50% or 80%), also fire the milestone
                              // reply so progress notifications stay consistent.
                              if (contactId) {
                                postOrThreadLeadUpdate({ contactId, action: "create" })
                                  .catch(err => console.error("[lead-thread 25% new] failed:", err instanceof Error ? err.message : err));

                                let milestoneActionNew: "milestone_50" | "milestone_80" | null = null;
                                if (applicationCompletionPct >= 80) milestoneActionNew = "milestone_80";
                                else if (applicationCompletionPct >= 50) milestoneActionNew = "milestone_50";
                                if (milestoneActionNew) {
                                  postOrThreadLeadUpdate({ contactId, action: milestoneActionNew })
                                    .catch(err => console.error("[lead-thread milestone new] failed:", err instanceof Error ? err.message : err));
                                }
                              }

                              // Speed to Lead instant callback (new contact, 25%+)
                              const stlPhone25New = mobilePhone || businessPhone;
                              if (stlPhone25New && contactId) {
                                fireSpeedToLead({
                                  leadId: contactId,
                                  leadPhone: stlPhone25New,
                                  leadName: contactName,
                                  leadSource: "application-25%",
                                });

                                // Schedule first SMS 3 minutes after signup
                                scheduleFirstSms(stlPhone25New, contactId, "new-lead").catch(
                                  (e) => console.error("[sms-schedule] failed:", (e as Error).message)
                                );
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

              // Send lead capture event to Meta CAPI — only for real Meta ad clicks.
              if (hasMetaAttributionServer({ fbc: _fbc })) {
                try {
                  const capiResult = await sendEvent({
                    eventName: "Lead",
                    eventId: serverEventId,
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
                  });
                  if (!capiResult.success) {
                    console.error("[Meta CAPI] Lead event failed:", capiResult.error);
                    try {
                      await supabaseAdmin.from("system_logs").insert({
                        event_type: "meta_capi_error",
                        description: `Meta CAPI Lead event failed: ${capiResult.error}`,
                        metadata: { email, eventName: "Lead" },
                      });
                    } catch { /* ignore */ }
                  }
                } catch (err) {
                  console.error("[Meta CAPI] Lead event error:", err);
                }
              }

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
                            const lp100 = businessPhone || mobilePhone;
                            const of100 = lp100
                              ? `email.ilike.${normalizedEmail},phone.eq.${lp100},mobile_phone.eq.${lp100}`
                              : `email.ilike.${normalizedEmail}`;
                            const { data: existingContact } = await supabaseAdmin
                              .from("contacts")
                              .select("id")
                              .or(of100)
                              .order("created_at", { ascending: false })
                              .limit(1)
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
                                                              monthly_revenue: monthlyRevenue || null,
                                                              checking_account: checkingAccount || null,
                                                              existing_loans: existingLoans,
                                                              notes,
                                                              ssn4,
                                                              ssn_full: ssnFull,
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
                            ssnFull,
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
                                                                  SSN: ssnFull,
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

              // ── Slack: post or thread-reply Application Completed event ──
              // Awaited so we can read slack_thread_ts afterwards for the PDF upload.
              const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
              let slackTs: string | undefined;
              if (contactId) {
                try {
                  await postOrThreadLeadUpdate({ contactId, action: "complete" });
                  const { data: refreshed } = await supabaseAdmin
                    .from("contacts")
                    .select("slack_thread_ts")
                    .eq("id", contactId)
                    .single();
                  slackTs = refreshed?.slack_thread_ts || undefined;
                } catch (err) {
                  console.error("[lead-thread 100%] failed:", err instanceof Error ? err.message : err);
                }
              }

              // Speed to Lead instant callback (100% complete)
              const stlPhone100 = mobilePhone || businessPhone;
              if (stlPhone100 && contactId) {
                fireSpeedToLead({
                  leadId: contactId,
                  leadPhone: stlPhone100,
                  leadName: contactName,
                  leadSource: "application-100%",
                });
              }

              // Fire Meta CAPI CompleteRegistration at 100% — only for real Meta ad clicks.
              if (hasMetaAttributionServer({ fbc: _fbc })) {
                try {
                  const capiResult = await sendEvent({
                    eventName: "CompleteRegistration",
                    eventId: serverEventId,
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
                  });
                  if (!capiResult.success) {
                    console.error("[Meta CAPI] CompleteRegistration failed:", capiResult.error);
                    try {
                      await supabaseAdmin.from("system_logs").insert({
                        event_type: "meta_capi_error",
                        description: `Meta CAPI CompleteRegistration failed: ${capiResult.error}`,
                        metadata: { email, eventName: "CompleteRegistration" },
                      });
                    } catch { /* ignore */ }
                  }
                } catch (err) {
                  console.error("[Meta CAPI] CompleteRegistration error:", err);
                }
              }

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
                            let lenderPdfBuffer: Buffer | undefined;
                            // Strip internal tracking (funnel variant) from notes before rendering PDF.
                            // Full notes still flow to Supabase/Zoho for CRM tracking.
                            const pdfNotes = notes
                                                          ? notes.replace(/\s*\|?\s*Funnel variant:[^|]*/i, "").trim().replace(/\|\s*$/, "").trim() || undefined
                                                          : undefined;
                            const pdfData = {
                                                          firstName, lastName, email, businessPhone, mobilePhone,
                                                          businessName, legalName, dba, industry, ein,
                                                          bizAddress, bizCity, bizState, bizZip, incDate, dob,
                                                          creditScore, ownership, amountNeeded, useOfFunds,
                                                          monthlyDeposits, existingLoans, notes: pdfNotes,
                                                          ssn4, ssnFull,
                                                          signature: signature || undefined,
                                                          signatureName: signatureName || contactName,
                            };

                        try {
                                        pdfBuffer = generateApplicationPDF(pdfData);
                                        // Lender copy: identical layout but no phone number — sent to outside funders.
                                        lenderPdfBuffer = generateApplicationPDF({ ...pdfData, hidePhone: true });
                                        console.log("[100%] PDFs generated — full:", pdfBuffer.length, "lender:", lenderPdfBuffer.length);
                        } catch (pdfErr) {
                                        throw new Error(`PDF generation failed: ${pdfErr instanceof Error ? pdfErr.message : String(pdfErr)}`);
                        }

                        // Upload BOTH PDFs to OneDrive: full (with phone) and lender copy (no phone).
                        let oneDriveUrl: string | undefined;
                        let lenderOneDriveUrl: string | undefined;
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

                                            const lenderUploadResult = await microsoft.uploadDriveFile(
                                                              `Working Files/${safeName}`,
                                                              `Application - ${safeName} (Lender Copy).pdf`,
                                                              lenderPdfBuffer,
                                                              "application/pdf"
                                                            );
                                            lenderOneDriveUrl = lenderUploadResult.webUrl;
                                            console.log(`[100%] Lender PDF uploaded to OneDrive: Working Files/${safeName}/Application - ${safeName} (Lender Copy).pdf`);

                              await supabaseAdmin.from("system_logs").insert({
                                                event_type: "application_pdf",
                                                description: `PDFs uploaded: Working Files/${safeName}/ (full + lender copy)`,
                                                metadata: { contactId, businessName: safeName, webUrl: oneDriveUrl, lenderWebUrl: lenderOneDriveUrl },
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

                        // Upload PDF to Slack as thread reply on the notification message
                        if (hotLeadsChannel && pdfBuffer) {
                                        slack.uploadFilePDF(hotLeadsChannel, `Application - ${safeName}.pdf`, pdfBuffer, slackTs)
                                          .catch(err => console.error("[Slack 100%] PDF upload failed:", err instanceof Error ? err.message : err));
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
                                                                              const attachMsg = attachErr instanceof Error ? attachErr.message : String(attachErr);
                                                                              console.error("[100%] Zoho PDF attachment failed:", attachMsg);
                                                                              try {
                                                                                await supabaseAdmin.from("system_logs").insert({
                                                                                  event_type: "zoho_attachment_error",
                                                                                  description: `Zoho PDF attachment failed for ${contactName}: ${attachMsg.slice(0, 300)}`,
                                                                                  metadata: { contactId, zohoLeadId, error: attachMsg },
                                                                                });
                                                                              } catch { /* ignore */ }
                                                          }

                                                          // Convert the Zoho Lead → Account / Contact / Deal.
                                                          // 100% = full registration, so the lead becomes a real
                                                          // pipeline deal in Zoho. Skipped silently if the lead
                                                          // was already converted (Zoho returns an error in that case).
                                                          try {
                                                                              const dealAmount = parseFloat(String(amountNeeded || "0").replace(/[^0-9.]/g, "")) || 0;
                                                                              const conv = await zohoConvertLeadToDeal(zohoLeadId, {
                                                                                dealName: `${businessName || legalName || contactName} — Application`,
                                                                                amount: dealAmount,
                                                                                stage: "Qualification",
                                                                              });
                                                                              if (conv?.dealId) {
                                                                                console.log(`[100%] Zoho lead converted → deal ${conv.dealId}`);
                                                                                if (contactId) {
                                                                                  await supabaseAdmin.from("contacts").update({ zoho_deal_id: conv.dealId }).eq("id", contactId);
                                                                                }
                                                                                await supabaseAdmin.from("system_logs").insert({
                                                                                  event_type: "zoho_lead_converted",
                                                                                  description: `Zoho lead converted to deal for ${contactName}`,
                                                                                  metadata: { contactId, zohoLeadId, zohoDealId: conv.dealId, accountId: conv.accountId, contactZohoId: conv.contactId },
                                                                                });
                                                                              }
                                                          } catch (convErr) {
                                                                              const cMsg = convErr instanceof Error ? convErr.message : String(convErr);
                                                                              console.error("[100%] Zoho convertLeadToDeal failed:", cMsg);
                                                                              try {
                                                                                await supabaseAdmin.from("system_logs").insert({
                                                                                  event_type: "zoho_convert_error",
                                                                                  description: `Zoho lead conversion failed for ${contactName}: ${cMsg.slice(0, 300)}`,
                                                                                  metadata: { contactId, zohoLeadId, error: cMsg },
                                                                                });
                                                                              } catch { /* ignore */ }
                                                          }
                                        } else {
                                                          console.warn("[100%] zohoLeadId not available — skipping Zoho PDF attachment + conversion");
                                        }
                        }

                        // Send confirmation email with PDF — reuses the lender copy
                        // already generated above (avoids regenerating jsPDF twice).
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

                                                          // Internal copy to submissions with both PDFs (full + lender-safe)
                                                          await microsoft.sendMail({
                                                                              to: "submissions@srtagency.com",
                                                                              subject: `New Application — ${safeName}`,
                                                                              body: summaryHtml,
                                                                              isHtml: true,
                                                                              attachments: [
                                                                                {
                                                                                  name: `Application - ${safeName}.pdf`,
                                                                                  contentType: "application/pdf",
                                                                                  contentBytes: pdfBuffer!.toString("base64"),
                                                                                },
                                                                                {
                                                                                  name: `Application - ${safeName} (Lender Copy).pdf`,
                                                                                  contentType: "application/pdf",
                                                                                  contentBytes: lenderPdfBuffer!.toString("base64"),
                                                                                },
                                                                              ],
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

// Schedule a first SMS to be sent 3 minutes after the lead signs up.
// Stored in DB; picked up by /api/cron/sms-delayed-sends (runs every 5 min).
async function scheduleFirstSms(phone: string, contactId: string, template: string): Promise<void> {
  const { normalizePhone } = await import("@/lib/loopmessage");
  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return;

  const sendAt = new Date(Date.now() + 3 * 60 * 1000).toISOString();

  await supabaseAdmin.from("sms_conversations").upsert(
    {
      phone: normalizedPhone,
      contact_id: contactId,
      first_sms_scheduled_at: sendAt,
      first_sms_template: template,
      first_sms_sent: false,
      outcome: "open",
    },
    { onConflict: "phone", ignoreDuplicates: true }
  );
}


function buildApplicationSummaryEmail(data: { firstName?: string }): string {
  return `
<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#333333">
  <div style="background:#0d1b2a;padding:28px 24px;text-align:center">
    <img src="https://srtagency.com/srt-logo.png" alt="SRT Agency" style="height:48px;width:auto" onerror="this.style.display='none';this.nextElementSibling.style.display='inline'" />
    <span style="display:none;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:0.5px">SRT Agency</span>
  </div>
  <div style="padding:32px 24px">
    <h2 style="color:#0d1b2a;margin:0 0 16px">Application Received</h2>
    <p style="margin:0 0 16px">Hi ${data.firstName || "there"},</p>
    <p style="margin:0 0 16px">Thank you for submitting your business funding application with SRT Agency. We have received your information and our team will review it shortly.</p>
    <p style="margin:0 0 16px">A copy of your completed application is attached to this email for your records.</p>
    <div style="background:#f0faf7;border-left:4px solid #2ee6a8;padding:16px 20px;margin:0 0 16px;border-radius:4px">
      <p style="margin:0 0 8px;font-weight:600;color:#0d1b2a">Next Step</p>
      <p style="margin:0">To begin working on your funding application, please reply to this email with your <strong>last 3 months of business bank statements</strong> (PDF format preferred).</p>
    </div>
    <p style="margin:0 0 16px">If you have any questions, feel free to reply to this email or contact us directly.</p>
    <p style="margin:0">Best regards,<br><strong>The SRT Agency Team</strong></p>
  </div>
  <div style="background:#f5f5f5;padding:16px 24px;text-align:center;font-size:12px;color:#888888">
    <p style="margin:0">SRT Agency &mdash; Business Funding Solutions</p>
  </div>
</div>
  `;
}
