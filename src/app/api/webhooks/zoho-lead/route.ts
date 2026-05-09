import { NextRequest, NextResponse } from "next/server";
import { triggerSpeedToLead } from "@/lib/speed-to-lead";
import { sendEvent } from "@/lib/meta-capi";
import { supabaseAdmin } from "@/lib/db";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";
import { getLead } from "@/lib/zoho";

// Allow up to 60s for RingOut polling on Vercel
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.ZOHO_WEBHOOK_SECRET;
  let stage = "parse_body";

  // Parse body once so we can also look for the secret inside it
  // (Zoho CRM Standard plan doesn't expose custom headers — falls back to
  // query param or body field.)
  // Read as text first so we can log what Zoho actually sent and fall back
  // to form-encoded parsing if JSON.parse fails.
  const contentType = request.headers.get("content-type") || "";
  let rawText = "";
  try {
    rawText = await request.text();
  } catch {
    rawText = "";
  }
  console.log(
    `[Zoho Webhook] Incoming content-type="${contentType}" bytes=${rawText.length}`
  );

  let body: Record<string, unknown> = {};
  if (rawText.trim()) {
    try {
      body = JSON.parse(rawText);
    } catch {
      try {
        body = Object.fromEntries(new URLSearchParams(rawText));
      } catch {
        body = {};
      }
    }
  }

  stage = "check_secret";
  const secret =
    request.headers.get("x-zoho-webhook-secret") ||
    request.nextUrl.searchParams.get("x-zoho-webhook-secret") ||
    request.nextUrl.searchParams.get("secret") ||
    (body["x-zoho-webhook-secret"] as string | undefined) ||
    (body.secret as string | undefined) ||
    "";

  if (!expectedSecret || secret !== expectedSecret) {
    const safe = (s: string | undefined | null) =>
      !s ? "<empty>" : `len=${s.length} prefix=${s.slice(0, 6)} suffix=${s.slice(-4)}`;
    console.error(
      `[Zoho Webhook] Unauthorized — received[${safe(secret)}] expected[${safe(expectedSecret)}] env_set=${!!expectedSecret}`
    );
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    stage = "extract_fields";
    console.log("[Zoho Webhook] Received:", JSON.stringify(body).slice(0, 500));

    // Zoho Workflow webhooks send lead data in various shapes.
    // Support both flat payload and nested "data" array (Zoho Notifications API).
    // Zoho's payload shape is dynamic — treat as any for field access ergonomics.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawBody = body as any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lead: any = rawBody.data?.[0] || rawBody;

    // Extract phone — Zoho field names: Phone, Mobile, or phone/mobile
    const phone = lead.Phone || lead.Mobile || lead.phone || lead.mobile || "";

    // Extract lead name
    const firstName = lead.First_Name || lead.first_name || "";
    const lastName = lead.Last_Name || lead.last_name || "";
    const fullName = lead.Full_Name || lead.full_name || "";
    const leadName = fullName || [firstName, lastName].filter(Boolean).join(" ") || "Zoho Lead";

    // Extract source, ID, email, and status
    const leadSource = lead.Lead_Source || lead.lead_source || "Zoho CRM";
    const leadId = lead.id || lead.Id || undefined;
    let email = lead.Email || lead.email || "";
    let leadStatus = lead.Lead_Status || lead.lead_status || "";

    // Zoho sometimes sends an empty body (bytes=0) when the webhook body config breaks.
    // If we have the lead ID but are missing status or email, fetch them from the Zoho API.
    if (leadId && (!leadStatus || !email)) {
      try {
        const zohoLead = await getLead(leadId);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const zl = zohoLead as any;
        if (!leadStatus) leadStatus = zl.Lead_Status || "";
        if (!email) email = zl.Email || "";
        console.log(`[Zoho Webhook] Fetched from Zoho API: status=${leadStatus} email=${email}`);
      } catch (fetchErr) {
        console.error("[Zoho Webhook] getLead fallback failed:",
          fetchErr instanceof Error ? fetchErr.message : fetchErr);
      }
    }

    console.log(`[Zoho Webhook] Lead: ${leadName}, Phone: ${phone}, Source: ${leadSource}, Status: ${leadStatus}`);

    // Normalize once for case-insensitive set lookups (Zoho picklist values
    // vary in casing across environments, e.g. "Not interested" vs "Not Interested").
    const normalizedStatus = leadStatus.trim().toLowerCase();

    // ── DNQ: fire Meta CAPI event when lead is marked as terminal-declined in Zoho ──
    // Only if the originating contact came from a real Meta ad click.
    // Match whichever picklist value actually lives in Zoho — /api/leads/disqualify
    // tries "Dead Declined" first, "DNQ" next, etc. The webhook must accept all.
    const dnqStatuses = new Set(["dnq", "dead declined", "declined", "dead", "take off list", "not interested"]);
    if (dnqStatuses.has(normalizedStatus)) {
      stage = "dnq_lookup";
      // Look up contact in Supabase for enriched user data
      let contact: Record<string, unknown> | null = null;
      if (email) {
        try {
          const { data, error: dbError } = await supabaseAdmin
            .from("contacts")
            .select("id, email, phone, mobile_phone, first_name, last_name, fbc, fbp")
            .ilike("email", email)
            .limit(1)
            .maybeSingle();
          if (dbError) {
            console.error("[Zoho Webhook] Supabase contact lookup error:", dbError);
          }
          contact = data;
        } catch (dbThrown) {
          console.error(
            "[Zoho Webhook] Supabase contact lookup threw:",
            dbThrown instanceof Error ? dbThrown.stack || dbThrown.message : dbThrown
          );
          return NextResponse.json({ success: false, skipped: "db_error" });
        }
      }

      if (!contact || !hasMetaAttributionServer({ fbc: contact.fbc as string | null | undefined })) {
        console.log(`[Zoho Webhook] Skipped DNQ Meta event for ${leadName} — no Meta attribution on contact`);
        return NextResponse.json({ success: true, skipped: "no_meta_attribution" });
      }

      stage = "dnq_send_event";
      const contactPhone = (contact?.phone || contact?.mobile_phone || phone) as string;
      const contactEmail = (contact?.email as string) || email;

      await sendEvent({
        eventName: "DNQ",
        actionSource: "system_generated",
        userData: {
          email: contactEmail || undefined,
          phone: contactPhone || undefined,
          firstName: (contact?.first_name as string) || firstName || undefined,
          lastName: (contact?.last_name as string) || lastName || undefined,
          externalId: (contact?.id as string) || undefined,
          fbc: (contact?.fbc as string) || undefined,
          fbp: (contact?.fbp as string) || undefined,
        },
        customData: { content_name: "Did Not Qualify" },
      });
      console.log(`[Zoho Webhook] DNQ Meta event fired for ${leadName}`);
      return NextResponse.json({ success: true, event: "DNQ" });
    }

    // ── Interested: fire Meta CAPI Lead event for Working / Hot Lead / Converted ──
    // These fire when a cold-call lead picks up or shows intent, or when a lead
    // is manually converted to a deal in Zoho (not via the online application).
    const interestedStatuses = new Set([
      "working",
      "working - contacted",
      "working - application out",
      "hot lead",
      "converted",
    ]);
    if (interestedStatuses.has(normalizedStatus)) {
      stage = "interested_lookup";
      let intContact: Record<string, unknown> | null = null;
      if (email) {
        try {
          const { data, error: dbError } = await supabaseAdmin
            .from("contacts")
            .select("id, email, phone, mobile_phone, first_name, last_name, fbc, fbp")
            .ilike("email", email)
            .limit(1)
            .maybeSingle();
          if (dbError) console.error("[Zoho Webhook] Supabase lookup error (interested):", dbError);
          intContact = data;
        } catch (dbThrown) {
          console.error("[Zoho Webhook] Supabase lookup threw (interested):",
            dbThrown instanceof Error ? dbThrown.message : dbThrown);
          return NextResponse.json({ success: true, skipped: "db_error_interested" });
        }
      }

      if (!intContact || !hasMetaAttributionServer({ fbc: intContact.fbc as string | null | undefined })) {
        console.log(`[Zoho Webhook] Skipped interested Meta event for ${leadName} — no Meta attribution`);
        return NextResponse.json({ success: true, skipped: "no_meta_attribution" });
      }

      stage = "interested_send_event";
      await sendEvent({
        eventName: "Lead",
        actionSource: "system_generated",
        userData: {
          email: (intContact.email as string) || email || undefined,
          phone: (intContact.phone as string) || (intContact.mobile_phone as string) || phone || undefined,
          firstName: (intContact.first_name as string) || firstName || undefined,
          lastName: (intContact.last_name as string) || lastName || undefined,
          externalId: (intContact.id as string) || undefined,
          fbc: (intContact.fbc as string) || undefined,
          fbp: (intContact.fbp as string) || undefined,
        },
        customData: { content_name: leadStatus },
      });
      console.log(`[Zoho Webhook] Lead Meta event fired for ${leadName} (status: ${leadStatus})`);
      return NextResponse.json({ success: true, event: "Lead", status: leadStatus });
    }

    // ── Speed to Lead: instant callback for new leads with phone ──
    if (!phone) {
      console.log("[Zoho Webhook] No phone number in payload — skipping Speed to Lead");
      return NextResponse.json({ success: true, skipped: true, reason: "no_phone" });
    }

    // Fire Speed to Lead — wrap separately so a RingCentral/downstream failure
    // can't crash the webhook response and trigger Zoho retries. We always
    // return 200 to Zoho; failures are logged for Vercel log triage.
    stage = "speed_to_lead";
    try {
      await triggerSpeedToLead({
        leadId,
        leadPhone: phone,
        leadName,
        leadSource,
      });
    } catch (stlError) {
      console.error(
        "[Zoho Webhook] triggerSpeedToLead failed:",
        stlError instanceof Error ? stlError.stack || stlError.message : stlError
      );
      return NextResponse.json({ success: true, skipped: true, reason: "speed_to_lead_error" });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    // Log full stack + which stage we were in so we can pinpoint the failure.
    console.error(
      `[Zoho Webhook] Error at stage=${stage}:`,
      error instanceof Error ? error.stack || error.message : error
    );
    // Return 200 anyway so Zoho doesn't retry-hammer a broken path. The error
    // lives in Vercel logs for us to triage; nothing about Zoho retry helps us.
    return NextResponse.json({ success: false, error: "logged", retry: false }, { status: 200 });
  }
}
