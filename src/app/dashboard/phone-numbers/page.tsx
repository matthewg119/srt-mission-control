"use client";

import { useState, useEffect } from "react";
import { RefreshCw, Phone, TrendingUp, Calendar, ExternalLink } from "lucide-react";

interface PhoneNumber {
  sender: string;
  senderSlug: string;
  sentToday: number;
  sentThisWeek: number;
  sentTotal: number;
  firstUsedAt: string | null;
  daysActive: number;
  warmupStatus: "warming" | "warm";
  recommendedDailyLimit: number;
  todayLimitUsedPct: number;
}

function ProgressBar({ pct }: { pct: number }) {
  const color =
    pct > 100 ? "bg-red-500" : pct > 80 ? "bg-yellow-400" : "bg-emerald-400";
  return (
    <div className="w-full h-2 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${color}`}
        style={{ width: `${Math.min(pct, 100)}%` }}
      />
    </div>
  );
}

export default function PhoneNumbersPage() {
  const [numbers, setNumbers] = useState<PhoneNumber[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchNumbers = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/sms/phone-numbers");
      const data = await res.json() as { numbers: PhoneNumber[] };
      setNumbers(data.numbers ?? []);
    } catch {
      setNumbers([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchNumbers(); }, []);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Phone Numbers</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            LoopMessage iMessage senders — monitor warmup progress and daily caps
          </p>
        </div>
        <button
          onClick={fetchNumbers}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white text-sm transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading…</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {numbers.map((n) => (
            <div key={n.sender} className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-2xl p-5 flex flex-col gap-4">
              {/* Sender slug */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Phone size={16} className="text-[#00B4B4]" />
                  <span className="text-white font-bold text-base">{n.senderSlug}</span>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.4)]">{n.sender}</span>
              </div>

              {/* Warmup status badge */}
              {n.warmupStatus === "warming" ? (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-400/10 rounded-lg">
                  <span className="text-sm">🌱</span>
                  <span className="text-yellow-400 text-xs font-medium">
                    Warming up — Day {n.daysActive} of 14
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-emerald-400/10 rounded-lg">
                  <span className="text-sm">✅</span>
                  <span className="text-emerald-400 text-xs font-medium">Warm</span>
                </div>
              )}

              {/* Today progress */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-[rgba(255,255,255,0.5)]">Today</span>
                  <span className="text-xs text-white font-medium">
                    {n.sentToday} / {n.recommendedDailyLimit}
                    {n.todayLimitUsedPct > 100 && (
                      <span className="text-red-400 ml-1">({n.todayLimitUsedPct}%)</span>
                    )}
                  </span>
                </div>
                <ProgressBar pct={n.todayLimitUsedPct} />
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[rgba(255,255,255,0.04)] rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <Calendar size={11} className="text-[rgba(255,255,255,0.4)]" />
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">This week</span>
                  </div>
                  <span className="text-white text-lg font-bold">{n.sentThisWeek.toLocaleString()}</span>
                </div>
                <div className="bg-[rgba(255,255,255,0.04)] rounded-lg p-3">
                  <div className="flex items-center gap-1 mb-1">
                    <TrendingUp size={11} className="text-[rgba(255,255,255,0.4)]" />
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">All time</span>
                  </div>
                  <span className="text-white text-lg font-bold">{n.sentTotal.toLocaleString()}</span>
                </div>
              </div>

              {/* Recommendation */}
              <div className="text-[rgba(255,255,255,0.5)] text-xs bg-[rgba(255,255,255,0.04)] rounded-lg px-3 py-2">
                Send up to <span className="text-white font-medium">{n.recommendedDailyLimit}</span> today
                {n.warmupStatus === "warming" && ` (day ${n.daysActive})`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Buy New Number section */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-2xl p-6 mt-2">
        <div className="flex items-center gap-2 mb-4">
          <ExternalLink size={14} className="text-[#00B4B4]" />
          <h2 className="text-white font-semibold text-sm">Add a New Sender</h2>
        </div>
        <ol className="flex flex-col gap-2 text-sm text-[rgba(255,255,255,0.5)]">
          <li className="flex gap-2">
            <span className="text-[#00B4B4] font-medium w-4 flex-shrink-0">1.</span>
            Go to LoopMessage dashboard → <strong className="text-white">Senders</strong>
          </li>
          <li className="flex gap-2">
            <span className="text-[#00B4B4] font-medium w-4 flex-shrink-0">2.</span>
            Add a new sender and copy the sender slug
          </li>
          <li className="flex gap-2">
            <span className="text-[#00B4B4] font-medium w-4 flex-shrink-0">3.</span>
            Add to Vercel environment variables as <code className="text-white bg-[rgba(255,255,255,0.08)] px-1 rounded">LOOP_SENDER_{numbers.length + 1}</code>
          </li>
          <li className="flex gap-2">
            <span className="text-[#00B4B4] font-medium w-4 flex-shrink-0">4.</span>
            Trigger a Vercel redeploy — the new sender will appear here automatically
          </li>
        </ol>
      </div>
    </div>
  );
}
