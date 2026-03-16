import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { sendEvent } from "@/lib/meta-capi";
import { validateLeadSubmission, checkRateLimit, getClientIp, getCorsHeaders } from "@/lib/lead-validation";
import { enrollContact } from "@/lib/sequence-engine";
import { systemAlert } from "@/lib/notify";
import { calculateLeadScore, resolveAdSource } from "@/lib/lead-score";
import { slack } from "@/lib/slack-bot";

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
    const { name, email, phone, message, source, website, _fbc, _fbp, eventId, sourceUrl,
            utmCampaign, utmContent, utmMedium, utmSource, adId } = body;
    const serverEventId = eventId || randomUUID();

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
        const { data } = await supabaseAdmin
          .from("contacts")
          .select("id")
          .eq("phone", phone)
          .maybeSingle();
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

    // 2. Create deal in New Deals pipeline
    let dealId: string | null = null;
    try {
      const { data: deal, error: dealErr } = await supabaseAdmin
        .from("deals")
        .insert({
          contact_id: contactId,
          pipeline: "New Deals",
          stage: "Open - Not Contacted",
          amount: 0,
          source: source || "Website - Contact Form",
        })
        .select("id")
        .single();
      if (dealErr) throw new Error(dealErr.message);
      dealId = deal!.id;

      // Log deal creation
      await supabaseAdmin.from("deal_events").insert({
        deal_id: dealId,
        event_type: "created",
        description: `New lead from website contact form`,
      });
    } catch (error) {
      console.error("Deal creation error:", error instanceof Error ? error.message : error);
    }

    // 3. Log to system_logs
    try {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "lead_capture",
        description: `New lead from website: ${firstName} ${lastName} (${email || phone})`,
        metadata: { contactId, dealId, name, email, phone, message, source: source || "Website - Contact Form", clientIp, clientUserAgent },
      });
    } catch (logErr) {
      console.error("system_logs write failed:", logErr);
    }

    // 4. Fire Meta CAPI Lead event
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

    // 5. Slack notification to #hot-leads
    const hotLeadsChannel = process.env.SLACK_HOT_LEADS_CHANNEL || "";
    if (hotLeadsChannel) {
      const lines = [`🟢 *New Lead: ${firstName} ${lastName}*`];
      if (email) lines.push(`Email: ${email}`);
      if (phone) lines.push(`Phone: ${phone}`);
      if (message) lines.push(`Message: ${message.slice(0, 200)}`);
      lines.push("Source: Contact Form");
      slack.postMessage(hotLeadsChannel, lines.join("\n")).catch(() => {});
    }

    // 6. Enroll in email sequences
    if (email && contactId) {
      enrollContact("website-lead-nurture", contactId, email, `${firstName} ${lastName}`.trim())
        .catch((err) => console.error("[Sequence] website-lead-nurture enrollment error:", err));
      enrollContact("website-lead-to-application", contactId, email, `${firstName} ${lastName}`.trim())
        .catch((err) => console.error("[Sequence] website-lead-to-application enrollment error:", err));
    }

    return NextResponse.json(
      { success: true, message: "Lead captured successfully", contactId, opportunityId: dealId },
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
