// OPTIONAL — Zoho calls this endpoint (free; no API-call cost to us).
// Set up in Zoho: Setup → Developer Space → Notifications → New Notification,
// pointing at /api/sales-twin/zoho/webhook with header x-zoho-webhook-token.
import { supabaseAdmin } from "@/lib/db";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TENANT_ID = process.env.ST_DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  const token = req.headers.get("x-zoho-webhook-token");
  if (!process.env.ZOHO_WEBHOOK_TOKEN || token !== process.env.ZOHO_WEBHOOK_TOKEN) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const payload = await req.json();
  const records = payload.data || [];

  for (const record of records) {
    await supabaseAdmin.from("st_leads").upsert(
      {
        tenant_id: TENANT_ID,
        external_id: record.id,
        name: `${record.First_Name || ""} ${record.Last_Name || ""}`.trim() || "Unknown",
        company: record.Company || null,
        phone: record.Phone || record.Mobile || null,
        email: record.Email || null,
        stage: record.Lead_Status || "No Contact",
        zoho_synced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tenant_id,external_id" }
    );

    // Look up the lead uuid so the timeline event references it correctly.
    const { data: lead } = await supabaseAdmin
      .from("st_leads")
      .select("id")
      .eq("tenant_id", TENANT_ID)
      .eq("external_id", record.id)
      .single();

    if (lead) {
      await supabaseAdmin.from("st_lead_timeline_events").insert({
        tenant_id: TENANT_ID,
        lead_id: lead.id,
        event_type: "zoho_sync",
        body: `Zoho webhook: ${payload.operation || "update"}`,
        occurred_at: new Date().toISOString(),
      });
    }
  }

  return NextResponse.json({ received: records.length });
}
