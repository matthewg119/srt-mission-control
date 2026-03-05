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
    const errors: string[] = [];

    for (const pipeline of PIPELINES) {
      const pipelineId = pipeline.id;

      // Build stage ID → name map from GHL
      const pipelinesResponse = await ghl.getPipelines();
      const allPipelines = (pipelinesResponse.pipelines as Array<Record<string, unknown>>) || [];
      const ghlPipeline = allPipelines.find((p) => p.id === pipelineId);

      if (!ghlPipeline) {
        console.warn(`Pipeline ${pipeline.name} (${pipelineId}) not found in GHL, skipping`);
        errors.push(`Pipeline ${pipeline.name} not found in GHL`);
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
      // Only query columns that definitely exist (skip ad_source, fbc, fbp, lead_score which may not be created yet)
      let utmMap = new Map<string, Record<string, unknown>>();
      if (opportunities.length > 0) {
        try {
          const oppIds = opportunities.map((o) => o.id as string);
          const { data: existingRows } = await supabaseAdmin
            .from("pipeline_cache")
            .select("ghl_opportunity_id, utm_campaign, utm_content, utm_medium, ad_id")
            .in("ghl_opportunity_id", oppIds);

          for (const row of existingRows || []) {
            utmMap.set(row.ghl_opportunity_id, row);
          }
        } catch (e) {
          console.warn("UTM batch-fetch failed (columns may not exist yet):", e);
        }
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
          console.warn(`Full upsert failed for ${ghlOpportunityId}:`, error.message);
          ({ error } = await supabaseAdmin
            .from("pipeline_cache")
            .upsert(record, { onConflict: "ghl_opportunity_id" }));
        }

        if (!error) {
          totalSynced++;
        } else {
          const msg = `${contactName || ghlOpportunityId}: ${error.message}`;
          console.error(`Upsert failed:`, msg);
          if (errors.length < 5) errors.push(msg);
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

    // Log the sync with error details
    const description = errors.length > 0
      ? `Pipeline sync: ${totalSynced}/${totalOpps} synced. Errors: ${errors.join(" | ")}`
      : `Pipeline sync completed: ${totalSynced}/${totalOpps} opportunities synced across ${PIPELINES.length} pipelines.`;

    await supabaseAdmin.from("system_logs").insert({
      event_type: "ghl_sync",
      description,
      metadata: { synced: totalSynced, total: totalOpps, pipelines: PIPELINES.map((p) => p.name), errors },
    });

    return NextResponse.json({
      synced: totalSynced,
      total: totalOpps,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("GHL sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GHL sync failed" },
      { status: 500 }
    );
  }
}
