import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { schwab, buildSellToCloseMarket } from "@/lib/schwab";
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

  const { data: openTrades } = await supabaseAdmin
    .from("bot_trades")
    .select("*")
    .eq("status", "open");

  if (!openTrades || openTrades.length === 0) {
    return NextResponse.json({ ok: true, monitored: 0 });
  }

  const { data: cfgRows } = await supabaseAdmin
    .from("bot_config")
    .select("key, value");
  const cfg: Record<string, string> = {};
  for (const row of cfgRows ?? []) cfg[row.key] = row.value;

  const telegramChatId = process.env.TELEGRAM_USER_ID ?? "";
  const accountHash = await schwab.getAccountHash();

  let closed = 0;

  for (const trade of openTrades) {
    try {
      const quote = await schwab.getQuote(trade.option_symbol);
      const mark = Number(
        (quote as Record<string, Record<string, unknown>>)?.quote?.mark ?? 0
      );

      if (mark <= 0) continue;

      const pnl = (mark - trade.entry_price) * trade.contracts * 100;
      const pnlPct = ((mark - trade.entry_price) / trade.entry_price) * 100;

      // Update unrealized P&L
      await supabaseAdmin
        .from("bot_trades")
        .update({ pnl, pnl_percent: pnlPct })
        .eq("id", trade.id);

      const hitStop = mark <= trade.stop_loss_price;
      const hitTarget = mark >= trade.take_profit_price;

      if (!hitStop && !hitTarget) continue;

      // Close position
      if (!trade.is_paper) {
        const closeOrder = buildSellToCloseMarket(
          trade.option_symbol,
          trade.contracts
        );
        await schwab.placeOrder(accountHash, closeOrder);
      }

      const reason = hitStop ? "stop_loss" : "take_profit";
      await supabaseAdmin
        .from("bot_trades")
        .update({
          status: "closed",
          exit_price: mark,
          pnl,
          pnl_percent: pnlPct,
          premium_received: mark * trade.contracts * 100,
          closed_at: new Date().toISOString(),
        })
        .eq("id", trade.id);

      closed++;

      // Telegram notification
      if (telegramChatId) {
        const isWin = pnl >= 0;
        const emoji = hitStop ? "🛑" : "✅";
        const pnlStr = `${isWin ? "+" : ""}$${pnl.toFixed(0)} (${isWin ? "+" : ""}${pnlPct.toFixed(1)}%)`;
        await telegram.sendMessage(
          telegramChatId,
          `${emoji} *${reason.replace("_", " ").toUpperCase()}* — ${trade.symbol}\n` +
            `Option: \`${trade.option_symbol}\`\n` +
            `Entry: $${trade.entry_price.toFixed(2)} → Exit: $${mark.toFixed(2)}\n` +
            `P&L: *${pnlStr}*${trade.is_paper ? " _(paper)_" : ""}`
        );
      }
    } catch (err) {
      await supabaseAdmin.from("system_logs").insert({
        event_type: "bot_monitor_error",
        description: `Error monitoring trade ${trade.id}`,
        metadata: { error: String(err) },
      });
    }
  }

  return NextResponse.json({ ok: true, monitored: openTrades.length, closed });
}
