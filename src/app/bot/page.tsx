"use client";

import { useEffect, useState, useCallback } from "react";
import {
  TrendingUp,
  TrendingDown,
  Activity,
  Power,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ---- types ----

interface BotConfig {
  bot_active: string;
  paper_mode: string;
  spy_enabled: string;
  qqq_enabled: string;
  max_contracts: string;
  max_daily_trades: string;
  max_daily_loss_dollars: string;
  stop_loss_percent: string;
  take_profit_percent: string;
  target_delta: string;
  dte_min: string;
  dte_max: string;
}

interface Signal {
  id: string;
  symbol: string;
  signal_type: string;
  entry_trigger: string;
  underlying_price: number;
  strike: number;
  expiration: string;
  confidence_score: number;
  status: string;
  signal_time: string;
}

interface Trade {
  id: string;
  symbol: string;
  option_symbol: string;
  trade_type: string;
  contracts: number;
  entry_price: number;
  exit_price: number | null;
  pnl: number | null;
  pnl_percent: number | null;
  status: string;
  stop_loss_price: number;
  take_profit_price: number;
  opened_at: string;
  closed_at: string | null;
  is_paper: boolean;
  current_price?: number | null;
  unrealized_pnl?: number | null;
  unrealized_pnl_pct?: number | null;
  trade_signals?: {
    signal_type: string;
    entry_trigger: string;
    confidence_score: number;
  } | null;
}

interface DailyStats {
  date: string;
  total_trades: number;
  winning_trades: number;
  total_pnl: number;
  win_rate: number;
}

interface AllTimeStats {
  totalTrades: number;
  wins: number;
  totalPnl: number;
  winRate: number;
  avgWinner: number;
  avgLoser: number;
}

// ---- helpers ----

function pnlClass(val: number | null): string {
  if (val === null) return "text-white/50";
  return val >= 0 ? "text-emerald-400" : "text-red-400";
}

function pnlStr(val: number | null): string {
  if (val === null) return "—";
  return `${val >= 0 ? "+" : ""}$${Math.abs(val).toFixed(0)}`;
}

function pctStr(val: number | null): string {
  if (val === null) return "";
  return ` (${val >= 0 ? "+" : ""}${val.toFixed(1)}%)`;
}

// ---- main component ----

export default function BotPage() {
  const [config, setConfig] = useState<BotConfig | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  const [positions, setPositions] = useState<Trade[]>([]);
  const [daily, setDaily] = useState<DailyStats[]>([]);
  const [allTime, setAllTime] = useState<AllTimeStats | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [localConfig, setLocalConfig] = useState<BotConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const fetchAll = useCallback(async () => {
    const [cfgRes, tradesRes, statsRes, posRes] = await Promise.all([
      fetch("/api/bot/config"),
      fetch("/api/bot/trades?status=all"),
      fetch("/api/bot/stats"),
      fetch("/api/bot/positions"),
    ]);

    if (cfgRes.ok) {
      const { config: cfg } = await cfgRes.json();
      setConfig(cfg);
      setLocalConfig(cfg);
    }
    if (tradesRes.ok) {
      const { trades: t } = await tradesRes.json();
      setTrades(t ?? []);
      setSignals(
        (t ?? [])
          .slice(0, 10)
          .map((tr: Trade) => ({
            id: tr.id,
            symbol: tr.symbol,
            signal_type: tr.trade_signals?.signal_type ?? "",
            entry_trigger: tr.trade_signals?.entry_trigger ?? "",
            underlying_price: tr.entry_price,
            strike: 0,
            expiration: "",
            confidence_score: tr.trade_signals?.confidence_score ?? 0,
            status: tr.status,
            signal_time: tr.opened_at,
          }))
      );
    }
    if (statsRes.ok) {
      const { daily: d, allTime: at } = await statsRes.json();
      setDaily(d ?? []);
      setAllTime(at);
    }
    if (posRes.ok) {
      const { positions: p } = await posRes.json();
      setPositions(p ?? []);
    }
    setLastRefresh(new Date());
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  async function toggleBot() {
    if (!config) return;
    const next = config.bot_active === "true" ? "false" : "true";
    await fetch("/api/bot/config", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "bot_active", value: next }),
    });
    setConfig((c) => (c ? { ...c, bot_active: next } : c));
  }

  async function saveConfig() {
    if (!localConfig) return;
    setSaving(true);
    const keys = Object.keys(localConfig) as (keyof BotConfig)[];
    await Promise.all(
      keys.map((key) =>
        fetch("/api/bot/config", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key, value: localConfig[key] }),
        })
      )
    );
    setConfig(localConfig);
    setSaving(false);
  }

  const botActive = config?.bot_active === "true";
  const isPaper = config?.paper_mode === "true";
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayStats = daily.find((d) => d.date === todayStr);
  const todayPnl = todayStats?.total_pnl ?? null;

  return (
    <div className="min-h-screen bg-[#0B1426] text-white p-6 space-y-6">
      {/* ── Status Bar ── */}
      <div className="flex flex-wrap items-center gap-4 bg-white/5 rounded-xl px-5 py-4 border border-white/10">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Activity className="h-5 w-5 text-[#00C9A7]" />
          Options Bot
        </h1>

        {/* ON/OFF toggle */}
        <button
          onClick={toggleBot}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            botActive
              ? "bg-[#00C9A7]/20 text-[#00C9A7] border border-[#00C9A7]/40 hover:bg-[#00C9A7]/30"
              : "bg-white/10 text-white/50 border border-white/20 hover:bg-white/15"
          }`}
        >
          <Power className="h-4 w-4" />
          {botActive ? "BOT ON" : "BOT OFF"}
        </button>

        {/* Paper mode badge */}
        <span
          className={`px-3 py-1 rounded-full text-xs font-bold ${
            isPaper
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-red-500/20 text-red-400 border border-red-500/30"
          }`}
        >
          {isPaper ? "PAPER" : "LIVE"}
        </span>

        {/* Today P&L */}
        <span className={`text-sm font-semibold ${pnlClass(todayPnl)}`}>
          Today: {pnlStr(todayPnl)}
        </span>

        {/* Open positions count */}
        <span className="text-sm text-white/50">
          {positions.length} open position{positions.length !== 1 ? "s" : ""}
        </span>

        {/* Symbols */}
        <div className="flex gap-2 ml-auto items-center">
          {config?.spy_enabled === "true" && (
            <span className="px-2 py-0.5 bg-[#1B65A7]/30 text-[#1B65A7] border border-[#1B65A7]/40 rounded text-xs font-mono">
              SPY
            </span>
          )}
          {config?.qqq_enabled === "true" && (
            <span className="px-2 py-0.5 bg-[#1B65A7]/30 text-[#1B65A7] border border-[#1B65A7]/40 rounded text-xs font-mono">
              QQQ
            </span>
          )}
          <button
            onClick={fetchAll}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-white transition-colors"
            title={`Last refresh: ${lastRefresh.toLocaleTimeString()}`}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* ── Signal Feed + Open Positions ── */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Signal Feed */}
        <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white/80">Recent Signals</h2>
          </div>
          <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
            {trades.slice(0, 10).length === 0 && (
              <p className="text-white/30 text-sm text-center py-8">No signals yet</p>
            )}
            {trades.slice(0, 10).map((t) => (
              <div key={t.id} className="px-5 py-3 flex items-center gap-3 hover:bg-white/3">
                <span
                  className={`shrink-0 px-2 py-0.5 rounded text-xs font-bold ${
                    t.trade_signals?.signal_type === "CALL"
                      ? "bg-[#00C9A7]/20 text-[#00C9A7]"
                      : "bg-red-500/20 text-red-400"
                  }`}
                >
                  {t.trade_signals?.signal_type ?? "—"}
                </span>
                <span className="font-mono text-sm">{t.symbol}</span>
                <span className="text-xs text-white/40 truncate flex-1">
                  {t.trade_signals?.entry_trigger ?? ""}
                </span>
                <span className="text-xs text-white/30">
                  {new Date(t.opened_at).toLocaleTimeString()}
                </span>
                <span
                  className={`shrink-0 px-2 py-0.5 rounded text-xs ${
                    t.status === "open"
                      ? "bg-blue-500/20 text-blue-400"
                      : t.status === "closed"
                      ? "bg-white/10 text-white/40"
                      : "bg-yellow-500/20 text-yellow-400"
                  }`}
                >
                  {t.status}
                </span>
                {t.pnl !== null && (
                  <span className={`shrink-0 text-xs font-semibold ${pnlClass(t.pnl)}`}>
                    {pnlStr(t.pnl)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Open Positions */}
        <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/10">
            <h2 className="text-sm font-semibold text-white/80">Open Positions</h2>
          </div>
          <div className="divide-y divide-white/5 max-h-80 overflow-y-auto">
            {positions.length === 0 && (
              <p className="text-white/30 text-sm text-center py-8">No open positions</p>
            )}
            {positions.map((p) => {
              const progress =
                p.entry_price && p.take_profit_price && p.stop_loss_price && p.current_price
                  ? Math.max(
                      0,
                      Math.min(
                        100,
                        ((p.current_price - p.stop_loss_price) /
                          (p.take_profit_price - p.stop_loss_price)) *
                          100
                      )
                    )
                  : 50;
              const barColor =
                progress > 60
                  ? "bg-[#00C9A7]"
                  : progress > 30
                  ? "bg-yellow-400"
                  : "bg-red-400";

              return (
                <div key={p.id} className="px-5 py-3 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-mono">{p.option_symbol}</span>
                    <span className="text-white/40">×{p.contracts}</span>
                    {p.is_paper && (
                      <span className="text-xs text-emerald-400/60">paper</span>
                    )}
                    <span className={`ml-auto font-semibold ${pnlClass(p.unrealized_pnl ?? null)}`}>
                      {pnlStr(p.unrealized_pnl ?? null)}
                      {pctStr(p.unrealized_pnl_pct ?? null)}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-white/40">
                    <span>Entry ${p.entry_price.toFixed(2)}</span>
                    <span>→</span>
                    <span>{p.current_price ? `$${p.current_price.toFixed(2)}` : "—"}</span>
                    <span className="ml-auto">
                      Stop ${p.stop_loss_price.toFixed(2)} / TP ${p.take_profit_price.toFixed(2)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${barColor}`}
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* ── P&L Chart ── */}
      <div className="bg-white/5 rounded-xl border border-white/10 p-5">
        <h2 className="text-sm font-semibold text-white/80 mb-4">30-Day P&L</h2>

        {/* Stats row */}
        {allTime && (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-5">
            {[
              { label: "Total Trades", value: String(allTime.totalTrades) },
              { label: "Wins", value: String(allTime.wins) },
              {
                label: "Win Rate",
                value: `${allTime.winRate.toFixed(0)}%`,
                highlight: allTime.winRate >= 50,
              },
              {
                label: "Total P&L",
                value: pnlStr(allTime.totalPnl),
                positive: allTime.totalPnl >= 0,
              },
              {
                label: "Avg Winner",
                value: allTime.avgWinner ? `+$${allTime.avgWinner.toFixed(0)}` : "—",
                positive: true,
              },
              {
                label: "Avg Loser",
                value: allTime.avgLoser ? `-$${Math.abs(allTime.avgLoser).toFixed(0)}` : "—",
                positive: false,
              },
            ].map(({ label, value, highlight, positive }) => (
              <div key={label} className="bg-white/5 rounded-lg p-3">
                <p className="text-xs text-white/40 mb-1">{label}</p>
                <p
                  className={`text-base font-semibold ${
                    positive === true
                      ? "text-emerald-400"
                      : positive === false
                      ? "text-red-400"
                      : highlight
                      ? "text-[#00C9A7]"
                      : "text-white"
                  }`}
                >
                  {value}
                </p>
              </div>
            ))}
          </div>
        )}

        {daily.length > 0 ? (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={daily} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <XAxis
                dataKey="date"
                tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                tickFormatter={(v: string) => v.slice(5)}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: "rgba(255,255,255,0.3)", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `$${v}`}
                width={55}
              />
              <Tooltip
                contentStyle={{
                  background: "#0B1426",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  color: "#fff",
                  fontSize: 12,
                }}
                formatter={(val: unknown) => {
                  const n = Number(val ?? 0);
                  return [`${n >= 0 ? "+" : ""}$${n.toFixed(0)}`, "P&L"] as [string, string];
                }}
              />
              <ReferenceLine y={0} stroke="rgba(255,255,255,0.15)" />
              <Line
                type="monotone"
                dataKey="total_pnl"
                stroke="#00C9A7"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#00C9A7" }}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-[220px] flex items-center justify-center text-white/30 text-sm">
            No closed trades yet
          </div>
        )}
      </div>

      {/* ── Config Panel ── */}
      <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
        <button
          onClick={() => setConfigOpen((o) => !o)}
          className="w-full px-5 py-4 flex items-center justify-between hover:bg-white/3 transition-colors"
        >
          <h2 className="text-sm font-semibold text-white/80">Configuration</h2>
          {configOpen ? (
            <ChevronUp className="h-4 w-4 text-white/40" />
          ) : (
            <ChevronDown className="h-4 w-4 text-white/40" />
          )}
        </button>

        {configOpen && localConfig && (
          <div className="px-5 pb-5 space-y-4 border-t border-white/10">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 pt-4">
              {/* Toggles */}
              {(
                [
                  ["spy_enabled", "SPY Enabled"],
                  ["qqq_enabled", "QQQ Enabled"],
                ] as [keyof BotConfig, string][]
              ).map(([key, label]) => (
                <div key={key} className="flex items-center justify-between bg-white/5 rounded-lg p-3">
                  <span className="text-sm text-white/70">{label}</span>
                  <button
                    onClick={() =>
                      setLocalConfig((c) =>
                        c ? { ...c, [key]: c[key] === "true" ? "false" : "true" } : c
                      )
                    }
                    className={`w-10 h-5 rounded-full transition-all relative ${
                      localConfig[key] === "true" ? "bg-[#00C9A7]" : "bg-white/20"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${
                        localConfig[key] === "true" ? "left-5" : "left-0.5"
                      }`}
                    />
                  </button>
                </div>
              ))}

              {/* Number inputs */}
              {(
                [
                  ["max_contracts", "Max Contracts"],
                  ["max_daily_trades", "Max Daily Trades"],
                  ["max_daily_loss_dollars", "Max Daily Loss ($)"],
                  ["stop_loss_percent", "Stop Loss (%)"],
                  ["take_profit_percent", "Take Profit (%)"],
                  ["target_delta", "Target Delta"],
                  ["dte_min", "DTE Min"],
                  ["dte_max", "DTE Max"],
                ] as [keyof BotConfig, string][]
              ).map(([key, label]) => (
                <div key={key} className="bg-white/5 rounded-lg p-3 space-y-1">
                  <label className="text-xs text-white/50">{label}</label>
                  <input
                    type="number"
                    value={localConfig[key]}
                    onChange={(e) =>
                      setLocalConfig((c) => (c ? { ...c, [key]: e.target.value } : c))
                    }
                    className="w-full bg-transparent text-sm font-mono text-white border-b border-white/20 focus:border-[#00C9A7] outline-none pb-0.5"
                    step="any"
                  />
                </div>
              ))}
            </div>

            <button
              onClick={saveConfig}
              disabled={saving}
              className="px-5 py-2 bg-[#00C9A7] text-[#0B1426] font-semibold text-sm rounded-lg hover:bg-[#00C9A7]/90 disabled:opacity-50 transition-all"
            >
              {saving ? "Saving..." : "Save Configuration"}
            </button>
          </div>
        )}
      </div>

      {/* ── Closed Trades History ── */}
      <div className="bg-white/5 rounded-xl border border-white/10 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/10">
          <h2 className="text-sm font-semibold text-white/80">Trade History</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-white/40 text-xs border-b border-white/5">
                <th className="text-left px-5 py-2">Symbol</th>
                <th className="text-left px-5 py-2">Option</th>
                <th className="text-left px-5 py-2">Type</th>
                <th className="text-right px-5 py-2">Entry</th>
                <th className="text-right px-5 py-2">Exit</th>
                <th className="text-right px-5 py-2">P&L</th>
                <th className="text-right px-5 py-2">Opened</th>
                <th className="text-right px-5 py-2">Mode</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {trades.filter((t) => t.status === "closed").length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center text-white/30 py-6">
                    No closed trades yet
                  </td>
                </tr>
              )}
              {trades
                .filter((t) => t.status === "closed")
                .map((t) => (
                  <tr key={t.id} className="hover:bg-white/3 transition-colors">
                    <td className="px-5 py-2.5 font-mono font-semibold">{t.symbol}</td>
                    <td className="px-5 py-2.5 font-mono text-xs text-white/60">
                      {t.option_symbol}
                    </td>
                    <td className="px-5 py-2.5">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-bold ${
                          t.trade_signals?.signal_type === "CALL"
                            ? "bg-[#00C9A7]/20 text-[#00C9A7]"
                            : "bg-red-500/20 text-red-400"
                        }`}
                      >
                        {t.trade_signals?.signal_type ?? "—"}
                      </span>
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono">
                      ${t.entry_price.toFixed(2)}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono text-white/60">
                      {t.exit_price ? `$${t.exit_price.toFixed(2)}` : "—"}
                    </td>
                    <td className={`px-5 py-2.5 text-right font-semibold ${pnlClass(t.pnl)}`}>
                      {pnlStr(t.pnl)}
                      {pctStr(t.pnl_percent)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-white/40 text-xs">
                      {new Date(t.opened_at).toLocaleDateString()}
                    </td>
                    <td className="px-5 py-2.5 text-right">
                      <span
                        className={`text-xs px-2 py-0.5 rounded ${
                          t.is_paper
                            ? "text-emerald-400/60"
                            : "text-red-400/60"
                        }`}
                      >
                        {t.is_paper ? "paper" : "live"}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
