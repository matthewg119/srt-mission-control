import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
    .toISOString()
    .slice(0, 10);

  const [dailyResult, allTimeResult] = await Promise.all([
    supabaseAdmin
      .from("daily_stats")
      .select("*")
      .gte("date", thirtyDaysAgo)
      .order("date", { ascending: true }),
    supabaseAdmin
      .from("bot_trades")
      .select("pnl, status")
      .eq("status", "closed"),
  ]);

  const allTrades = allTimeResult.data ?? [];
  const totalTrades = allTrades.length;
  const winners = allTrades.filter((t) => (t.pnl ?? 0) > 0);
  const totalPnl = allTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
  const losers = allTrades.filter((t) => (t.pnl ?? 0) <= 0);
  const avgWinner =
    winners.length > 0
      ? winners.reduce((s, t) => s + (t.pnl ?? 0), 0) / winners.length
      : 0;
  const avgLoser =
    losers.length > 0
      ? losers.reduce((s, t) => s + (t.pnl ?? 0), 0) / losers.length
      : 0;

  return NextResponse.json({
    daily: dailyResult.data ?? [],
    allTime: { totalTrades, wins: winners.length, totalPnl, winRate, avgWinner, avgLoser },
  });
}
