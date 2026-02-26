import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Log the webhook event
    await supabaseAdmin.from("system_logs").insert({
      event_type: "ghl_webhook",
      description: `Webhook received: ${body.type || body.event || "unknown event"}`,
      metadata: body,
    });

    // Handle opportunity updates
    const eventType = (body.type || body.event || "") as string;
    if (
      eventType.includes("opportunity") ||
      body.opportunity ||
      body.opportunityId
    ) {
      const opp = (body.opportunity as Record<string, unknown>) || body;
      const ghlOpportunityId =
        (opp.id as string) || (body.opportunityId as string);

      if (ghlOpportunityId) {
        const contact = (opp.contact as Record<string, unknown>) || {};
        const contactName =
          [contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
          (contact.name as string) ||
          "";

        await supabaseAdmin.from("pipeline_cache").upsert(
          {
            ghl_opportunity_id: ghlOpportunityId,
            contact_name: contactName || undefined,
            business_name: (contact.companyName as string) || undefined,
            stage: (opp.stageName as string) || (opp.stage as string) || undefined,
            amount: opp.monetaryValue ? Number(opp.monetaryValue) : undefined,
            assigned_to: (opp.assignedTo as string) || undefined,
            last_activity: new Date().toISOString(),
            metadata: opp,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ghl_opportunity_id" }
        );
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("GHL webhook error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Webhook processing failed" },
      { status: 500 }
    );
  }
}
