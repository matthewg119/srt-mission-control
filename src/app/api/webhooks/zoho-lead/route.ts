import { NextRequest, NextResponse } from "next/server";
import { triggerSpeedToLead } from "@/lib/speed-to-lead";
import { sendEvent } from "@/lib/meta-capi";
import { supabaseAdmin } from "@/lib/db";
import { hasMetaAttributionServer } from "@/lib/metaAttribution";

// Allow up to 60s for RingOut polling on Vercel
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const expectedSecret = process.env.ZOHO_WEBHOOK_SECRET;

  // Parse body once so we can also look for the secret inside it
  // (Zoho CRM Standard plan doesn't expose custom headers — falls back to
  // query param or body field.)
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

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
    const email = lead.Email || lead.email || "";
    const leadStatus = lead.Lead_Status || lead.lead_status || "";

    console.log(`[Zoho Webhook] Lead: ${leadName}, Phone: ${phone}, Source: ${leadSource}, Status: ${leadStatus}`);

    // ── DNQ: fire Meta CAPI event when lead is marked as terminal-declined in Zoho ──
    // Only if the originating contact came from a real Meta ad click.
    // Match whichever picklist value actually lives in Zoho — /api/leads/disqualify
    // tries "Dead Declined" first, "DNQ" next, etc. The webhook must accept all.
    const dnqStatuses = new Set(["DNQ", "Dead Declined", "Declined", "Dead", "Take Off List"]);
    if (dnqStatuses.has(leadStatus)) {
      // Look up contact in Supabase for enriched user data
      let contact: Record<string, unknown> | null = null;
      if (email) {
        const { data } = await supabaseAdmin
          .from("contacts")
          .select("id, email, phone, mobile_phone, first_name, last_name, fbc, fbp")
          .ilike("email", email)
          .limit(1)
          .maybeSingle();
        contact = data;
      }

      if (!contact || !hasMetaAttributionServer({ fbc: contact.fbc as string | null | undefined })) {
        console.log(`[Zoho Webhook] Skipped DNQ Meta event for ${leadName} — no Meta attribution on contact`);
        return NextResponse.json({ success: true, skipped: "no_meta_attribution" });
      }

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

    // ── Speed to Lead: instant callback for new leads with phone ──
    if (!phone) {
      console.log("[Zoho Webhook] No phone number in payload — skipping Speed to Lead");
      return NextResponse.json({ success: true, skipped: true, reason: "no_phone" });
    }

    // Fire Speed to Lead (runs full safety gates internally)
    await triggerSpeedToLead({
      leadId,
      leadPhone: phone,
      leadName,
      leadSource,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Zoho Webhook] Error:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
