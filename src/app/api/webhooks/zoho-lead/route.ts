export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { fireSpeedToLead } from "@/lib/speed-to-lead";
import { sendEvent } from "@/lib/meta-capi";
import { getLead } from "@/lib/zoho";
import { supabaseAdmin } from "@/lib/db";

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

    // ── Silent sources: cold-scrape prospects must NOT trigger Speed-to-Lead /
    // #hot-leads / DNQ. These are inserted with trigger:[] so this webhook should
    // never fire for them, but guard here too in case a Zoho rule ever runs. ──
    const SILENT_SOURCES = new Set(
      (process.env.PROSPECT_ZOHO_LEAD_SOURCE || "Pest Control Scrape")
        .split(",")
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean)
    );
    if (SILENT_SOURCES.has(String(leadSource).trim().toLowerCase())) {
      console.log("[Zoho Webhook] Skipping — silent scrape source:", leadSource);
      return NextResponse.json({ success: true, skipped: true, reason: "scrape_source" });
    }
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

    // ── CRM mirror ──
    // Additive: keeps contacts.application_stage, lead_status_history and the
    // lead_activities timeline current so Mission Control stops depending on
    // Zoho for "what stage is this and when did it change".
    //
    // Sits BEFORE the DNQ branch below because that branch returns early, and a
    // DNQ is exactly the status transition we most want recorded.
    //
    // applyZohoStatus() owns the echo guard: when this webhook is Zoho echoing
    // back a status Mission Control itself just wrote, it is dropped rather
    // than re-applied. Fully wrapped — a mirror failure must never cost us the
    // Speed-to-Lead call or the Meta CAPI event underneath.
    if (leadId && leadStatus) {
      try {
        const { applyZohoStatus } = await import("@/lib/crm");
        const result = await applyZohoStatus({
          zohoLeadId: String(leadId),
          status: String(leadStatus).trim(),
          zohoModifiedTime: lead.Modified_Time || undefined,
        });
        console.log(`[Zoho Webhook] CRM mirror: ${result.reason}`);
      } catch (mirrorErr) {
        console.error(
          "[Zoho Webhook] CRM mirror failed (non-fatal):",
          mirrorErr instanceof Error ? mirrorErr.message : mirrorErr
        );
      }
    }

    const normalizedStatus = leadStatus.trim().toLowerCase();

    // ── DNQ: direct Zoho → Meta CAPI, no database lookup ──
    // Fires for all terminal-declined statuses. No attribution gate — purpose is
    // negative audience training (Meta excludes these people from future ad targeting).
    const dnqStatuses = new Set(["dnq", "dead declined", "declined", "dead", "take off list", "not interested"]);
    if (dnqStatuses.has(normalizedStatus)) {
      stage = "dnq_send_event";
      if (!email && !phone) {
        console.log(`[Zoho Webhook] Skipped DNQ — no email or phone for ${leadName}`);
        return NextResponse.json({ success: true, skipped: "no_user_data" });
      }
      // Pull the click-id back off the contact so Meta can attribute the DNQ to
      // the originating ad. fbc/fbp were captured at lead-capture time but are
      // gone from this webhook payload — without them Meta can't bind the event
      // to a specific ad and the per-ad DNQ column stays empty. Look up by email
      // first (normalized lowercase in Supabase), fall back to phone. The
      // deterministic event_id (`dnq_<contactId>`) matches the browser pixel's so
      // Meta dedups the two DNQ signals. No attribution gate — manual Zoho DNQs
      // without fbc still fire (just unattributed), for negative-audience training.
      type DnqContact = { id: string; fbc: string | null; fbp: string | null };
      let dnqContact: DnqContact | null = null;
      try {
        if (email) {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("id, fbc, fbp")
            .ilike("email", email.trim().toLowerCase())
            .limit(1)
            .maybeSingle();
          dnqContact = (data as DnqContact | null) ?? null;
        }
        if (!dnqContact && phone) {
          const { data } = await supabaseAdmin
            .from("contacts")
            .select("id, fbc, fbp")
            .eq("phone", phone)
            .limit(1)
            .maybeSingle();
          dnqContact = (data as DnqContact | null) ?? null;
        }
      } catch (lookupErr) {
        console.error("[Zoho Webhook] DNQ contact lookup failed:",
          lookupErr instanceof Error ? lookupErr.message : lookupErr);
      }
      await sendEvent({
        eventName: "DNQ",
        actionSource: "system_generated",
        eventId: dnqContact?.id ? `dnq_${dnqContact.id}` : undefined,
        userData: {
          email: email || undefined,
          phone: phone || undefined,
          firstName: firstName || undefined,
          lastName: lastName || undefined,
          fbc: dnqContact?.fbc ?? undefined,
          fbp: dnqContact?.fbp ?? undefined,
          externalId: dnqContact?.id ?? undefined,
        },
        customData: { content_name: "Did Not Qualify" },
      });
      console.log(`[Zoho Webhook] DNQ Meta event fired for ${leadName} (${email || phone}) fbc=${dnqContact?.fbc ? "yes" : "no"}`);
      return NextResponse.json({ success: true, event: "DNQ" });
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
    // Fire-and-forget — respond to Zoho immediately so it doesn't retry.
    // triggerSpeedToLead polls RingCentral for up to 60s, which blows the
    // Vercel timeout. fireSpeedToLead posts to /api/speed-to-lead (its own
    // serverless invocation) and returns in milliseconds.
    fireSpeedToLead({
      leadId,
      leadPhone: phone,
      leadName,
      leadSource,
    });

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
