import { NextResponse } from "next/server";
import { processScheduledEmails } from "@/lib/sequence-engine";
import { supabaseAdmin } from "@/lib/db";
import { systemAlert } from "@/lib/notify";

export async function GET() {
  try {
    const result = await processScheduledEmails();

    // Log the run
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_sequences",
      description: `Sequence processor: ${result.sent} sent, ${result.cancelled} cancelled, ${result.errors} errors (${result.processed} processed)`,
      metadata: result,
    });

    // Alert if there were errors
    if (result.errors > 0) {
      await systemAlert(
        "Sequence Errors",
        `${result.errors} error(s) occurred during sequence processing (${result.sent} sent, ${result.processed} processed)`,
        "cron/process-sequences",
        "warning"
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error("Sequence cron error:", error);
    await systemAlert(
      "Sequence Cron Crashed",
      error instanceof Error ? error.message : "Sequence processing failed unexpectedly",
      "cron/process-sequences",
      "critical"
    );
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sequence processing failed" },
      { status: 500 }
    );
  }
}
