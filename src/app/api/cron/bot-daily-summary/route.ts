import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { telegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: trades } = await supabaseAdmin
    .from("bot_trades")
    .select("*")
    .eq("status", "closed")
    .gte("opened_at", today);

  const closed = trades ?? [];
  const totalTrades = closed.length;
  const winners = closed.filter((t) => (t.pnl ?? 0) > 0);
  const losers = closed.filter((t) => (t.pnl ?? 0) <= 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate = totalTrades > 0 ? (winners.length / totalTrades) * 100 : 0;
  const avgWinner =
    winners.length > 0
      ? winners.reduce((s, t) => s + (t.pnl ?? 0), 0) / winners.length
      : 0;
  const avgLoser =
    losers.length > 0
      ? losers.reduce((s, t) => s + (t.pnl ?? 0), 0) / losers.length
      : 0;

  // Upsert daily_stats
  await supabaseAdmin.from("daily_stats").upsert({
    date: today,
    total_trades: totalTrades,
    winning_trades: winners.length,
    total_pnl: totalPnl,
    win_rate: winRate,
    avg_winner: avgWinner,
    avg_loser: avgLoser,
  });

  const telegramChatId = process.env.TELEGRAM_USER_ID ?? "";
  if (telegramChatId) {
    const pnlStr = `${totalPnl >= 0 ? "+" : ""}$${totalPnl.toFixed(0)}`;
    const msg = [
      `📊 *Bot Daily Summary — ${today}*`,
      `Trades: ${totalTrades} | Wins: ${winners.length} | Losses: ${losers.length}`,
      `Win Rate: ${winRate.toFixed(0)}%`,
      `Total P&L: *${pnlStr}*`,
      avgWinner !== 0 ? `Avg Winner: +$${avgWinner.toFixed(0)}` : "",
      avgLoser !== 0 ? `Avg Loser: -$${Math.abs(avgLoser).toFixed(0)}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await telegram.sendMessage(telegramChatId, msg);
  }

  return NextResponse.json({
    ok: true,
    date: today,
    totalTrades,
    wins: winners.length,
    losses: losers.length,
    totalPnl,
    winRate,
  });
}
