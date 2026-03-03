import { NextResponse } from "next/server";
import { processScheduledEmails } from "@/lib/sequence-engine";
import { supabaseAdmin } from "@/lib/db";

export async function GET() {
  try {
    const result = await processScheduledEmails();

    // Log the run
    await supabaseAdmin.from("system_logs").insert({
      event_type: "cron_sequences",
      description: `Sequence processor: ${result.sent} sent, ${result.cancelled} cancelled, ${result.errors} errors (${result.processed} processed)`,
      metadata: result,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Sequence cron error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sequence processing failed" },
      { status: 500 }
    );
  }
}
