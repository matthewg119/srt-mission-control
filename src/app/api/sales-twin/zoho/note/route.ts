import { supabaseAdmin } from "@/lib/db";
import { writeNoteToZoho } from "@/lib/sales-twin/zoho-bridge";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TENANT_ID = process.env.ST_DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";

export async function POST(req: NextRequest) {
  const { leadExternalId, noteBody, repName, disposition } = await req.json();

  if (!leadExternalId || !noteBody) {
    return NextResponse.json({ ok: false, error: "Missing leadExternalId or noteBody" }, { status: 400 });
  }

  // Budget guard.
  const { data: integration } = await supabaseAdmin
    .from("st_integrations")
    .select("api_calls_today,api_calls_reset_at")
    .eq("tenant_id", TENANT_ID)
    .eq("provider", "zoho")
    .single();

  const today = new Date().toISOString().split("T")[0];
  const calls = integration?.api_calls_reset_at === today ? integration.api_calls_today || 0 : 0;
  const budget = parseInt(process.env.ST_ZOHO_DAILY_BUDGET || "80", 10);

  if (calls + 1 > budget) {
    return NextResponse.json({ ok: false, error: "Daily API budget reached" }, { status: 429 });
  }

  const result = await writeNoteToZoho({ leadExternalId, noteBody, repName: repName || "Sales Twin", disposition });

  await supabaseAdmin
    .from("st_integrations")
    .update({ api_calls_today: calls + 1, api_calls_reset_at: today, last_sync_at: new Date().toISOString() })
    .eq("tenant_id", TENANT_ID)
    .eq("provider", "zoho");

  return NextResponse.json(result);
}
