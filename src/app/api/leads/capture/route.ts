export const dynamic = "force-dynamic";
import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { validateLeadSubmission, checkRateLimit, getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { calculateLeadScore, resolveAdSource } from "@/lib/lead-score";
import { slack } from "@/lib/slack-bot";
import { fireSpeedToLead } from "@/lib/speed-to-lead";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";
import { normalizePhone } from "@/lib/phone";
import { ensureSmsChannel } from "@/lib/sms-channel";
import { suggestIntroText } from "@/lib/intro-suggestion";
import { normalizeLeadPhone } from "@/lib/phone";

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

export async function POST(request: NextRequest) {
  const corsHeaders = getCorsHeaders(request);
  const clientIp = getClientIp(request);
  const clientUserAgent = request.headers.get("user-agent") || undefined;

  try {
    if (!checkRateLimit(clientIp)) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: corsHeaders }
      );
    }

    const body = await request.json();
    const { name, email, phone: phoneRaw, message, source, website, _fbc, _fbp, eventId, sourceUrl,
            utmCampaign, utmContent, utmMedium, utmSource, adId } = body;
    const serverEventId = eventId || randomUUID();

    // E.164 before anything reads it. This route stored the raw body value and then
    // deduped on it with .eq(), so the same person filling the form from their phone and
    // then from a laptop became two contacts, two Zoho leads and two Slack threads.
    const phone = normalizeLeadPhone(phoneRaw);

    const leadScore = calculateLeadScore({ email, phone, fbc: _fbc });
    const adSource = resolveAdSource(_fbc, source);

    if (!name || (!email && !phone)) {
      return NextResponse.json(
        { error: "Name and either email or phone are required" },
        { status: 400, headers: corsHeaders }
      );
    }

    const nameParts = name.trim().split(" ");
    const firstName = nameParts[0];
    const lastName = nameParts.slice(1).join(" ") || "";

    // 1. Upsert contact (deduplicate by email or phone)
    let contactId: string;
    try {
      // Check for existing contact
      let existing = null;
      if (email) {
        const { data } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("email", email)
          .maybeSingle();
        existing = data;
      }
      if (!existing && phone) {
        // Matched on the last ten digits, not on the string. phone_last10 and
        // mobile_last10 are generated columns (docs/2026-06-04-contacts-phone-last10.sql)
        // and five other lookups in this app already use them. An .eq() on the raw text
        // only ever finds a row stored in the identical shape, which is the whole bug.
        const last10 = phone.replace(/\D/g, "").slice(-10);
        const { data } = last10.length === 10
          ? await supabaseAdmin
              .from("contacts")
              .select("id")
              .or(`phone_last10.eq.${last10},mobile_last10.eq.${last10}`)
              .limit(1)
              .maybeSingle()
          : { data: null };
        existing = data;
      }

      if (existing) {
        contactId = existing.id;
        // Update with latest info
        await supabaseAdmin.from("contacts").update({
          first_name: firstName,
          last_name: lastName,
          ...(email && { email }),
          ...(phone && { phone }),
          source: source || "Website - Contact Form",
          lead_score: leadScore,
          fbc: _fbc || null,
          fbp: _fbp || null,
          utm_campaign: utmCampaign || null,
          utm_content: utmContent || null,
          utm_medium: utmMedium || null,
          ad_id: adId || utmContent || null,
          ad_source: adSource,
          updated_at: new Date().toISOString(),
        }).eq("id", contactId);
      } else {
        const { data: newContact, error: insertErr } = await supabaseAdmin
          .from("contacts")
          .insert({
            first_name: firstName,
            last_name: lastName,
            email: email || null,
            phone: phone || null,
            source: source || "Website - Contact Form",
            tags: ["website-lead"],
            lead_score: leadScore,
            fbc: _fbc || null,
            fbp: _fbp || null,
            utm_campaign: utmCampaign || null,
            utm_content: utmContent || null,
            utm_medium: utmMedium || null,
            ad_id: adId || utmContent || null,
            ad_source: adSource,
            notes: message || null,
          })
          .select("id")
          .single();
        if (insertErr || !newContact) throw new Error(insertErr?.message || "Contact insert failed");
        contactId = newContact.id;
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error("Contact creation error:", errMsg);
      await systemAlert("Contact Creation Failed", `Lead from ${name} (${email || phone}) could not be created: ${errMsg}`, "leads/capture");
      return NextResponse.json({ error: "Failed to create contact", details: errMsg }, { status: 500, headers: corsHeaders });
    }

    // The `deals` table went with the funding business. A lead's stage now
    // lives on contacts.application_stage, so there is nothing to create here.
    // `opportunityId` stays in the response, always null, because the website
    // form posts to this route and we are not redeploying it in this change.

    // 3. Log to system_logs
    try {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_capture",
        description: `New lead from website: ${firstName} ${lastName} (${email || phone})`,
        metadata: { contactId, name, email, phone, message, source: source || "Website - Contact Form", clientIp, clientUserAgent },
      });
    } catch (logErr) {
      console.error("system_logs write failed:", logErr);
    }

    // 4. Fire Meta CAPI Lead event — only if the lead came from a Meta ad click.
    // Without this guard, WhatsApp/cold-call/direct leads get counted as Meta conversions.
    if (hasMetaAttributionServer({ fbc: _fbc })) {
      try {
        const capiResult = await sendEvent({
          eventName: "Lead",
          eventId: serverEventId,
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

    // 5. Slack notification to #hot-leads
    const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (hotLeadsChannel) {
      const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://mission.srtagency.com";
      const lines = [`:large_green_circle: *New Lead: ${firstName} ${lastName}*`];
      if (email) lines.push(`Email: ${email}`);
      if (phone) lines.push(`Phone: ${phone}`);
      if (message) lines.push(`Message: ${message.slice(0, 200)}`);
      lines.push(`Source: Contact Form`);
      lines.push(`📱 *<${appUrl}/api/vcard/${contactId}|Save to iPhone Contacts>* · <${appUrl}/contacts/${contactId}|Open contact card>`);
      slack.postMessage(hotLeadsChannel, lines.join("\n")).catch(() => {});
    }

    // 6. Speed to Lead instant callback
    if (phone) {
      fireSpeedToLead({
        leadId: contactId,
        leadPhone: phone,
        leadName: `${firstName} ${lastName}`.trim(),
        leadSource: "website",
      });
    }

    // 7. Enroll in email sequences
    if (email && contactId) {
      enrollContact("website-lead-nurture", contactId, email, `${firstName} ${lastName}`.trim())
        .catch((err) => console.error("[Sequence] website-lead-nurture enrollment error:", err));
      enrollContact("website-lead-to-application", contactId, email, `${firstName} ${lastName}`.trim())
        .catch((err) => console.error("[Sequence] website-lead-to-application enrollment error:", err));
    }

    // 8. For /bfunding leads with a phone: create SMS conversation + Slack channel now.
    // The text is NOT sent yet — it fires 30s after the lead leaves the portal
    // (portal calls /api/portal/exit which sets first_sms_scheduled_at).
    const isBfundingSource =
      source === "bfunding" ||
      utmSource === "bfunding" ||
      (typeof sourceUrl === "string" && sourceUrl.includes("/bfunding"));

    if (phone && isBfundingSource) {
      const normalizedPhone = normalizePhone(phone);
      if (normalizedPhone) {
        try {
          const portalToken = randomUUID();
          const displayName = `${firstName} ${lastName}`.trim() || firstName;

          const { data: conv } = await supabaseAdmin
            .from("sms_conversations")
            .upsert(
              {
                contact_id: contactId,
                phone: normalizedPhone,
                portal_token: portalToken,
                first_sms_template: "bfunding-lead",
                first_sms_sent: false,
                first_sms_scheduled_at: null,
                outcome: "open",
              },
              { onConflict: "phone" }
            )
            .select("id")
            .single();

          if (conv?.id) {
            ensureSmsChannel({
              conversationId: conv.id as string,
              phone: normalizedPhone,
              displayName,
              contactId,
              zohoLeadId: null,
            }).catch((err) => console.error("[leads/capture] ensureSmsChannel error:", err));
          }
        } catch (err) {
          console.error("[leads/capture] SMS channel setup error:", (err as Error).message);
        }
      }
    } else if (phone) {
      // 8b. Non-bfunding lead with a phone: draft a first-touch intro text and post
      // it to the lead's SMS Slack channel with a ✅ Send button (suggestion-only,
      // no auto-send). Best-effort — never block the capture response.
      suggestIntroText({
        contactId,
        phone,
        displayName: `${firstName} ${lastName}`.trim() || firstName,
      }).catch((err) => console.error("[leads/capture] suggestIntroText error:", (err as Error).message));
    }

    return NextResponse.json(
      { success: true, message: "Lead captured successfully", contactId, opportunityId: null },
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
