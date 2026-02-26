import { NextResponse } from "next/server";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";

export async function POST() {
  try {
    // Fetch pipelines and find "Business Loans"
    const pipelinesResponse = await ghl.getPipelines();
    const pipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
    const businessLoansPipeline = pipelines.find(
      (p) => p.name === "Business Loans"
    );

    if (!businessLoansPipeline) {
      return NextResponse.json(
        { error: "Business Loans pipeline not found in GoHighLevel" },
        { status: 404 }
      );
    }

    const pipelineId = businessLoansPipeline.id as string;
    const stages = (businessLoansPipeline.stages as Array<Record<string, unknown>>) || [];

    // Build stage ID to name map
    const stageMap = new Map<string, string>();
    for (const stage of stages) {
      stageMap.set(stage.id as string, stage.name as string);
    }

    // Fetch opportunities
    const oppResponse = await ghl.getOpportunities(pipelineId);
    const opportunities = (oppResponse.opportunities as Array<Record<string, unknown>>) || [];
    let synced = 0;

    for (const opp of opportunities) {
      const ghlOpportunityId = opp.id as string;
      const stageId = opp.pipelineStageId as string;
      const stageName = stageMap.get(stageId) || "Unknown";
      const contact = (opp.contact as Record<string, unknown>) || {};

      const contactName = [contact.firstName, contact.lastName]
        .filter(Boolean)
        .join(" ") || (contact.name as string) || "";

      const record = {
        ghl_opportunity_id: ghlOpportunityId,
        contact_name: contactName,
        business_name: (contact.companyName as string) || "",
        stage: stageName,
        amount: opp.monetaryValue ? Number(opp.monetaryValue) : null,
        assigned_to: (opp.assignedTo as string) || null,
        last_activity: (opp.lastActivity as string) || (opp.updatedAt as string) || null,
        metadata: opp,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabaseAdmin
        .from("pipeline_cache")
        .upsert(record, { onConflict: "ghl_opportunity_id" });

      if (!error) {
        synced++;
      } else {
        console.error(`Failed to upsert opportunity ${ghlOpportunityId}:`, error);
      }
    }

    // Update integration last_sync
    await supabaseAdmin
      .from("integrations")
      .update({
        last_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("name", "GoHighLevel");

    // Log the sync
    await supabaseAdmin.from("system_logs").insert({
      event_type: "ghl_sync",
      description: `Pipeline sync completed: ${synced}/${opportunities.length} opportunities synced.`,
      metadata: { synced, total: opportunities.length, pipelineId },
    });

    return NextResponse.json({
      synced,
      total: opportunities.length,
    });
  } catch (error) {
    console.error("GHL sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GHL sync failed" },
      { status: 500 }
    );
  }
}
