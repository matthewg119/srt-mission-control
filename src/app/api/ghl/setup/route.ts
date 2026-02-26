import { NextResponse } from "next/server";
import { ghl } from "@/lib/ghl";
import { PIPELINE_STAGES, GHL_CUSTOM_FIELDS } from "@/config/pipeline";
import { supabaseAdmin } from "@/lib/db";

export async function POST() {
  try {
    const results = await ghl.setupPipelineAndFields(
      PIPELINE_STAGES.map((s) => ({ name: s.name })),
      GHL_CUSTOM_FIELDS
    );

    const { summary } = results;
    const description = `GHL setup completed: ${summary.created} created, ${summary.skipped} skipped, ${summary.errors} errors. Pipeline: ${results.pipeline.status}.`;

    // Log each custom field operation
    for (const field of results.customFields) {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "ghl_setup",
        description: `Custom field "${field.name}": ${field.status}${field.error ? ` - ${field.error}` : ""}`,
        metadata: { field },
      });
    }

    // Log overall summary
    await supabaseAdmin.from("system_logs").insert({
      event_type: "ghl_setup",
      description,
      metadata: { summary, pipeline: results.pipeline },
    });

    // Update integration status
    await supabaseAdmin
      .from("integrations")
      .update({
        status: "connected",
        last_sync: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("name", "GoHighLevel");

    return NextResponse.json(results);
  } catch (error) {
    console.error("GHL setup error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "GHL setup failed" },
      { status: 500 }
    );
  }
}
