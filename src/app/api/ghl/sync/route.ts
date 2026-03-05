import { NextResponse } from "next/server";
import { ghl } from "@/lib/ghl";
import { supabaseAdmin } from "@/lib/db";
import { PIPELINES } from "@/config/pipeline";

export async function GET() {
  return POST();
}

export async function POST() {
  try {
    let totalSynced = 0;
    let totalOpps = 0;

    for (const pipeline of PIPELINES) {
      const pipelineId = pipeline.id;

      // Build stage ID → name map from GHL
      const pipelinesResponse = await ghl.getPipelines();
      const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
      const ghlPipeline = allPipelines.find((p) => p.id === pipelineId);

      if (!ghlPipeline) {
        console.warn(`Pipeline ${pipeline.name} (${pipelineId}) not found in GHL, skipping`);
        continue;
      }

      const stages = (ghlPipeline.stages as Array<Record<string, unknown>>) || [];
      const stageMap = new Map<string, string>();
      for (const stage of stages) {
        stageMap.set(stage.id as string, stage.name as string);
      }

      // Fetch opportunities for this pipeline
      const oppResponse = await ghl.getOpportunities(pipelineId);
      const opportunities = (oppResponse.opportunities as Array<Record<string, unknown>>) || [];

      // Batch-fetch existing UTM data so we don't lose it during sync
      const oppIds = opportunities.map((o) => o.id as string);
      const { data: existingRows } = await supabaseAdmin
        .from("pipeline_cache")
        .select("ghl_opportunity_id, utm_campaign, utm_content, utm_medium, ad_id, ad_source, fbc, fbp, lead_score")
        .in("ghl_opportunity_id", oppIds);

      const utmMap = new Map<string, Record<string, unknown>>();
      for (const row of existingRows || []) {
        utmMap.set(row.ghl_opportunity_id, row);
      }

      for (const opp of opportunities) {
        const ghlOpportunityId = opp.id as string;
        const stageId = opp.pipelineStageId as string;
        const stageName = stageMap.get(stageId) || "Unknown";
        const contact = (opp.contact as Record<string, unknown>) || {};

        const contactName = [contact.firstName, contact.lastName]
          .filter(Boolean)
          .join(" ") || (contact.name as string) || "";

        // Core fields that definitely exist in the table
        const record: Record<string, unknown> = {
          ghl_opportunity_id: ghlOpportunityId,
          contact_name: contactName,
          business_name: (contact.companyName as string) || "",
          stage: stageName,
          pipeline_name: pipeline.name,
          amount: opp.monetaryValue ? Number(opp.monetaryValue) : null,
          updated_at: new Date().toISOString(),
        };

        // Preserve existing UTM/attribution fields (not available from GHL)
        const existing = utmMap.get(ghlOpportunityId);
        if (existing) {
          if (existing.utm_campaign) record.utm_campaign = existing.utm_campaign;
          if (existing.utm_content) record.utm_content = existing.utm_content;
          if (existing.utm_medium) record.utm_medium = existing.utm_medium;
          if (existing.ad_id) record.ad_id = existing.ad_id;
          if (existing.ad_source) record.ad_source = existing.ad_source;
          if (existing.fbc) record.fbc = existing.fbc;
          if (existing.fbp) record.fbp = existing.fbp;
          if (existing.lead_score) record.lead_score = existing.lead_score;
        }

        // Try with all optional fields first
        let { error } = await supabaseAdmin
          .from("pipeline_cache")
          .upsert({
            ...record,
            ghl_contact_id: (opp.contactId as string) || (contact.id as string) || null,
            assigned_to: (opp.assignedTo as string) || null,
            last_activity: (opp.lastActivity as string) || (opp.updatedAt as string) || null,
          }, { onConflict: "ghl_opportunity_id" });

        // If full upsert failed (missing columns), retry with core fields only
        if (error) {
          console.warn(`Full upsert failed for ${ghlOpportunityId}, retrying with core fields:`, error.message);
          ({ error } = await supabaseAdmin
            .from("pipeline_cache")
            .upsert(record, { onConflict: "ghl_opportunity_id" }));
        }

        if (!error) {
          totalSynced++;
        } else {
          console.error(`Failed to upsert opportunity ${ghlOpportunityId}:`, error);
        }
      }

      totalOpps += opportunities.length;
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
      description: `Pipeline sync completed: ${totalSynced}/${totalOpps} opportunities synced across ${PIPELINES.length} pipelines.`,
      metadata: { synced: totalSynced, total: totalOpps, pipelines: PIPELINES.map((p) => p.name) },
    });

    return NextResponse.json({
      synced: totalSynced,
      total: totalOpps,
    });
  } catch (error) {
    console.error("GHL sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GHL sync failed" },
      { status: 500 }
    );
  }
}
