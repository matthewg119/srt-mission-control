import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { PIPELINES } from "@/config/pipeline";
import { processStageChange } from "@/lib/automation-engine";

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

        // Determine pipeline name from pipelineId
        const pipelineId = (opp.pipelineId as string) || (body.pipelineId as string) || "";
        const matchedPipeline = PIPELINES.find((p) => p.id === pipelineId);
        const pipelineName = matchedPipeline?.name || "";

        const newStage = (opp.stageName as string) || (opp.stage as string) || "";

        // Check for stage change — look up previous stage
        const { data: existing } = await supabaseAdmin
          .from("pipeline_cache")
          .select("stage")
          .eq("ghl_opportunity_id", ghlOpportunityId)
          .single();

        const previousStage = existing?.stage || null;
        const stageChanged = previousStage !== newStage && newStage !== "";

        // Upsert to pipeline_cache
        await supabaseAdmin.from("pipeline_cache").upsert(
          {
            ghl_opportunity_id: ghlOpportunityId,
            contact_name: contactName || undefined,
            business_name: (contact.companyName as string) || undefined,
            stage: newStage || undefined,
            pipeline_name: pipelineName || undefined,
            amount: opp.monetaryValue ? Number(opp.monetaryValue) : undefined,
            assigned_to: (opp.assignedTo as string) || undefined,
            last_activity: new Date().toISOString(),
            metadata: opp,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "ghl_opportunity_id" }
        );

        // Fire automations on stage change
        if (stageChanged && pipelineName && newStage) {
          const contactId = (contact.id as string) || (opp.contactId as string) || "";
          const result = await processStageChange(
            pipelineName,
            previousStage,
            newStage,
            {
              opportunityId: ghlOpportunityId,
              contactId,
              contactName,
              firstName: (contact.firstName as string) || contactName?.split(" ")[0],
              businessName: (contact.companyName as string) || "",
              stageName: newStage,
              pipelineName,
            }
          );

          await supabaseAdmin.from("system_logs").insert({
            event_type: "automation_run",
            description: `Stage change: ${previousStage || "new"} → ${newStage} | ${result.executed} actions, ${result.errors} errors`,
            metadata: { opportunityId: ghlOpportunityId, previousStage, newStage, pipelineName, ...result },
          });
        }
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
