export const dynamic = "force-dynamic";
import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200);
  const action = url.searchParams.get("action");
  const trigger = url.searchParams.get("trigger");

  let query = supabaseAdmin
    .from("ai_decisions")
    .select("id, created_at, merchant_id, zoho_id, trigger_type, state_classified, action_taken, was_approved, approved_by, reasoning, model_used, latency_ms, meta_capi_event_fired, contacts:merchant_id(business_name, first_name, last_name)")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (action) query = query.eq("action_taken", action);
  if (trigger) query = query.eq("trigger_type", trigger);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ decisions: data ?? [] });
}
