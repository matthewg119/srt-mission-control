import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

/**
 * POST /api/integrations/microsoft/disconnect
 * Disconnects Microsoft 365 by clearing tokens (looks up by name, not ID).
 */
export async function POST() {
  try {
    const { data, error } = await supabaseAdmin
      .from("integrations")
      .update({
        status: "disconnected",
        config: {},
        updated_at: new Date().toISOString(),
      })
      .eq("name", "Microsoft 365")
      .select()
      .single();

    if (error) {
      console.error("Microsoft disconnect error:", error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    await supabaseAdmin.from("system_logs").insert({
      event_type: "integration_disconnected",
      description: "Microsoft 365 disconnected",
    });

    return NextResponse.json({ success: true, integration: data });
  } catch (error) {
    console.error("Microsoft disconnect error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Disconnect failed" },
      { status: 500 }
    );
  }
}
