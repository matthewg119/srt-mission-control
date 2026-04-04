import { NextRequest, NextResponse } from "next/server";
import { triggerSpeedToLead } from "@/lib/speed-to-lead";

// Allow up to 60s for RingOut polling on Vercel
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  // Authenticate with shared secret header
  const secret = request.headers.get("x-zoho-webhook-secret");
  const expectedSecret = process.env.ZOHO_WEBHOOK_SECRET;

  if (!expectedSecret || secret !== expectedSecret) {
    console.error("[Zoho Webhook] Unauthorized — bad or missing x-zoho-webhook-secret");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    console.log("[Zoho Webhook] Received:", JSON.stringify(body).slice(0, 500));

    // Zoho Workflow webhooks send lead data in various shapes.
    // Support both flat payload and nested "data" array (Zoho Notifications API).
    const lead = body.data?.[0] || body;

    // Extract phone — Zoho field names: Phone, Mobile, or phone/mobile
    const phone = lead.Phone || lead.Mobile || lead.phone || lead.mobile || "";
    if (!phone) {
      console.log("[Zoho Webhook] No phone number in payload — skipping Speed to Lead");
      return NextResponse.json({ success: true, skipped: true, reason: "no_phone" });
    }

    // Extract lead name
    const firstName = lead.First_Name || lead.first_name || "";
    const lastName = lead.Last_Name || lead.last_name || "";
    const fullName = lead.Full_Name || lead.full_name || "";
    const leadName = fullName || [firstName, lastName].filter(Boolean).join(" ") || "Zoho Lead";

    // Extract source and ID
    const leadSource = lead.Lead_Source || lead.lead_source || "Zoho CRM";
    const leadId = lead.id || lead.Id || undefined;

    console.log(`[Zoho Webhook] Lead: ${leadName}, Phone: ${phone}, Source: ${leadSource}`);

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
