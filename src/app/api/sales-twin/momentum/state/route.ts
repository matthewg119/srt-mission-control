import { supabaseAdmin } from "@/lib/db";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TENANT_ID = process.env.ST_DEMO_TENANT_ID || "00000000-0000-0000-0000-000000000001";

export async function GET() {
  const { data } = await supabaseAdmin
    .from("st_momentum_state")
    .select("*")
    .eq("tenant_id", TENANT_ID)
    .single();

  const { data: config } = await supabaseAdmin
    .from("st_config_kv")
    .select("key,value")
    .eq("tenant_id", TENANT_ID)
    .in("key", ["momentum_required_connects", "momentum_window_minutes", "momentum_green_duration_minutes"]);

  const cfg = Object.fromEntries((config || []).map((r) => [r.key, r.value]));

  return NextResponse.json({
    state: data || { current_state: "RED", consecutive_connects: 0 },
    config: {
      required_connects: Number(cfg.momentum_required_connects) || 3,
      window_minutes: Number(cfg.momentum_window_minutes) || 8,
      green_duration_minutes: Number(cfg.momentum_green_duration_minutes) || 15,
    },
  });
}
