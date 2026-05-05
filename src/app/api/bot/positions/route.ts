import { NextResponse } from "next/server";
import { schwab } from "@/lib/schwab";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { data: openTrades } = await supabaseAdmin
    .from("bot_trades")
    .select("*")
    .eq("status", "open");

  if (!openTrades || openTrades.length === 0) {
    return NextResponse.json({ positions: [] });
  }

  const positions = await Promise.all(
    openTrades.map(async (trade) => {
      try {
        const quote = await schwab.getQuote(trade.option_symbol);
        const mark = Number(
          (quote as Record<string, Record<string, unknown>>)?.quote?.mark ?? 0
        );
        const pnl = mark > 0 ? (mark - trade.entry_price) * trade.contracts * 100 : null;
        const pnlPct = mark > 0 ? ((mark - trade.entry_price) / trade.entry_price) * 100 : null;
        return { ...trade, current_price: mark, unrealized_pnl: pnl, unrealized_pnl_pct: pnlPct };
      } catch {
        return { ...trade, current_price: null, unrealized_pnl: null, unrealized_pnl_pct: null };
      }
    })
  );

  return NextResponse.json({ positions });
}
