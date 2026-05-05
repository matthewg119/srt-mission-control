import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status"); // open | closed | all
  const symbol = searchParams.get("symbol"); // SPY | QQQ

  let query = supabaseAdmin
    .from("bot_trades")
    .select("*, trade_signals(signal_type, entry_trigger, confidence_score, signal_time)")
    .order("opened_at", { ascending: false })
    .limit(50);

  if (status && status !== "all") query = query.eq("status", status);
  if (symbol) query = query.eq("symbol", symbol);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ trades: data });
}
