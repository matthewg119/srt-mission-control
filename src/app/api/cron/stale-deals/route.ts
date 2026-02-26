import { NextResponse } from "next/server";
import { processStaleDeals } from "@/lib/automation-engine";
import { supabaseAdmin } from "@/lib/db";

// This endpoint can be called by Vercel Cron or manually
// Configure in vercel.json: { "crons": [{ "path": "/api/cron/stale-deals", "schedule": "0 9 * * *" }] }

export async function GET() {
  try {
    const result = await processStaleDeals();

    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_stale_deals",
      description: `Stale deal check: ${result.checked} deals checked, ${result.actioned} actions taken.`,
      metadata: result,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Stale deals cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Stale deals check failed" },
      { status: 500 }
    );
  }
}
