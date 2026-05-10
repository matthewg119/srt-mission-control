import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/db";
import { ibkr, buildBuyToOpenLimit } from "@/lib/ibkr";
import {
  calculateIndicators,
  detectStandardSignal,
  detectBOSSignal,
  selectBestOption,
} from "@/lib/ta-analysis";
import { buildChartUrl } from "@/lib/chart-renderer";
import { telegram } from "@/lib/telegram";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// conid cache — contract IDs don't change, avoid repeated lookups
const conidCache = new Map<string, number>();

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

function isMarketHours(): boolean {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return false;
  const etHour = now.getUTCHours() - 4; // EDT
  const etMin = now.getUTCMinutes();
  const totalMins = etHour * 60 + etMin;
  return totalMins >= 9 * 60 + 30 && totalMins < 16 * 60;
}

async function loadConfig(): Promise<Record<string, string>> {
  const { data } = await supabaseAdmin.from("bot_config").select("key, value");
  const cfg: Record<string, string> = {};
  for (const row of data ?? []) cfg[row.key] = row.value;
  return cfg;
}

async function checkRiskLimits(
  cfg: Record<string, string>
): Promise<{ allowed: boolean; reason?: string }> {
  if (cfg.bot_active !== "true") return { allowed: false, reason: "bot_inactive" };

  const today = new Date().toISOString().slice(0, 10);
  const { data: todayTrades } = await supabaseAdmin
    .from("bot_trades")
    .select("id, pnl")
    .gte("opened_at", today);

  const trades = todayTrades ?? [];
  const maxTrades = parseInt(cfg.max_daily_trades ?? "5");
  if (trades.length >= maxTrades)
    return { allowed: false, reason: `max_daily_trades_reached (${trades.length}/${maxTrades})` };

  const totalPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0);
  const maxLoss = parseFloat(cfg.max_daily_loss_dollars ?? "500");
  if (totalPnl <= -maxLoss)
    return { allowed: false, reason: `max_daily_loss_reached ($${Math.abs(totalPnl).toFixed(0)})` };

  return { allowed: true };
}

async function getConid(symbol: string): Promise<number> {
  if (conidCache.has(symbol)) return conidCache.get(symbol)!;
  const conid = await ibkr.searchContract(symbol);
  conidCache.set(symbol, conid);
  return conid;
}

async function processSymbol(
  symbol: string,
  cfg: Record<string, string>
): Promise<void> {
  const telegramChatId = process.env.TELEGRAM_USER_ID ?? "";
  const isPaper = cfg.paper_mode === "true";
  const targetDelta = parseFloat(cfg.target_delta ?? "0.30");
  const dteMin = parseInt(cfg.dte_min ?? "7");
  const dteMax = parseInt(cfg.dte_max ?? "21");
  const maxContracts = parseInt(cfg.max_contracts ?? "1");
  const stopPct = parseFloat(cfg.stop_loss_percent ?? "50") / 100;
  const tpPct = parseFloat(cfg.take_profit_percent ?? "100") / 100;

  const conid = await getConid(symbol);

  // Fetch OHLCV data for multiple timeframes
  const [bars5m, bars15m, bars3m] = await Promise.all([
    ibkr.getPriceHistory(conid, "1d", "5min"),
    ibkr.getPriceHistory(conid, "1d", "15min"),
    ibkr.getPriceHistory(conid, "1d", "3min"),
  ]);

  // Get previous close (last bar of prior day)
  const prevDayBars = await ibkr.getPriceHistory(conid, "2d", "1day");
  const prevClose =
    prevDayBars.length >= 2
      ? prevDayBars[prevDayBars.length - 2].close
      : bars5m[0]?.close ?? 0;

  if (bars5m.length < 30) return;

  const ind5m = calculateIndicators(bars5m);
  const ind15m = calculateIndicators(bars15m);

  const signal =
    detectStandardSignal(ind5m, prevClose) ??
    detectBOSSignal(bars3m, bars5m, bars15m);

  if (!signal) return;

  // Insert signal record
  const { data: signalRow } = await supabaseAdmin
    .from("trade_signals")
    .insert({
      symbol,
      signal_type: signal.type,
      entry_trigger: signal.trigger,
      underlying_price: bars5m[bars5m.length - 1].close,
      timeframe: "5m",
      status: "pending",
      confidence_score: signal.score,
      notes: JSON.stringify(signal.conditions),
    })
    .select("id")
    .single();

  if (!signalRow) return;

  // Find best option contract via IBKR
  const chain = await ibkr.getOptionsChain(
    symbol,
    signal.type === "CALL" ? "C" : "P",
    dteMin,
    dteMax
  );

  const contract = selectBestOption(
    chain as Record<string, unknown>,
    signal.type,
    targetDelta,
    dteMin,
    dteMax
  );

  if (!contract) {
    await supabaseAdmin
      .from("trade_signals")
      .update({ status: "rejected", notes: "no_option_found" })
      .eq("id", signalRow.id);
    return;
  }

  await supabaseAdmin
    .from("trade_signals")
    .update({
      strike: contract.strike,
      expiration: contract.expiration,
      delta: contract.delta,
      status: "executed",
    })
    .eq("id", signalRow.id);

  const limitPrice = contract.ask;
  const stopLoss = parseFloat((limitPrice * (1 - stopPct)).toFixed(2));
  const takeProfit = parseFloat((limitPrice * (1 + tpPct)).toFixed(2));

  // Place order
  let ibkrOrderId = "paper_" + Date.now();
  if (!isPaper) {
    const order = buildBuyToOpenLimit(
      contract.conid ?? 0,
      maxContracts,
      limitPrice
    );
    ibkrOrderId = await ibkr.placeOrder(order);
  }

  await supabaseAdmin.from("bot_trades").insert({
    signal_id: signalRow.id,
    schwab_order_id: ibkrOrderId, // reusing column for IBKR order ID
    symbol,
    option_symbol: contract.symbol,
    trade_type: "BUY_TO_OPEN",
    contracts: maxContracts,
    entry_price: limitPrice,
    premium_paid: limitPrice * maxContracts * 100,
    status: "open",
    stop_loss_price: stopLoss,
    take_profit_price: takeProfit,
    opened_at: new Date().toISOString(),
    is_paper: isPaper,
  });

  if (telegramChatId) {
    const modeTag = isPaper ? "📄 PAPER" : "💰 LIVE";
    const direction = signal.type === "CALL" ? "📈 CALL" : "📉 PUT";
    const msg = [
      `🤖 *Trade Signal — ${modeTag}*`,
      `${direction} *${symbol}* | Score: ${signal.score}/100`,
      `Trigger: \`${signal.trigger}\``,
      `Strike: $${contract.strike} | Exp: ${contract.expiration} | Δ ${contract.delta.toFixed(2)}`,
      `Entry: $${limitPrice.toFixed(2)} | Stop: $${stopLoss.toFixed(2)} | TP: $${takeProfit.toFixed(2)}`,
    ].join("\n");

    const chart15mUrl = buildChartUrl(bars15m, ind15m, "15m", signal.type);
    const chart5mUrl = buildChartUrl(bars5m, ind5m, "5m", signal.type);

    await Promise.all([
      telegram.sendMessage(telegramChatId, msg),
      telegram.sendPhoto(telegramChatId, chart15mUrl, `${symbol} 15m`),
      telegram.sendPhoto(telegramChatId, chart5mUrl, `${symbol} 5m`),
    ]);
  }
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!isMarketHours()) {
    return NextResponse.json({ ok: true, skipped: "outside_market_hours" });
  }

  const telegramChatId = process.env.TELEGRAM_USER_ID ?? "";

  // Check IBKR auth first
  const authed = await ibkr.checkAuth();
  if (!authed) {
    if (telegramChatId) {
      await telegram.sendMessage(
        telegramChatId,
        "⚠️ *IBKR gateway needs re-auth*\nVisit https://localhost:5055 to log back in."
      );
    }
    return NextResponse.json({ ok: false, error: "ibkr_not_authenticated" });
  }

  const cfg = await loadConfig();
  const risk = await checkRiskLimits(cfg);
  if (!risk.allowed) {
    return NextResponse.json({ ok: true, skipped: risk.reason });
  }

  const symbols: string[] = [];
  if (cfg.spy_enabled === "true") symbols.push("SPY");
  if (cfg.qqq_enabled === "true") symbols.push("QQQ");

  const results: string[] = [];
  for (const symbol of symbols) {
    try {
      await processSymbol(symbol, cfg);
      results.push(`${symbol}: processed`);
    } catch (err) {
      results.push(`${symbol}: error — ${String(err)}`);
      await supabaseAdmin.from("system_logs").insert({
        event_type: "bot_scan_error",
        description: `Error scanning ${symbol}`,
        metadata: { error: String(err) },
      });
    }
  }

  return NextResponse.json({ ok: true, results });
}
