"use client";

import { useEffect, useState, useCallback } from "react";
import { WorkflowMap } from "@/components/workflow-map/workflow-map";
import { RefreshCw } from "lucide-react";

interface WorkflowStats {
  rejectedLeads: number;
  rejectedApps: number;
  enrollmentCounts: Record<string, number>;
  smsSent: number;
  emailSent: number;
  totalLeads: number;
  totalApps: number;
  totalEnrollments: number;
}

const DEFAULT_STATS: WorkflowStats = {
  rejectedLeads: 0,
  rejectedApps: 0,
  enrollmentCounts: {},
  smsSent: 0,
  emailSent: 0,
  totalLeads: 0,
  totalApps: 0,
  totalEnrollments: 0,
};

export default function WorkflowsPage() {
  const [stats, setStats] = useState<WorkflowStats>(DEFAULT_STATS);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows/stats");
      if (res.ok) {
        const data = await res.json();
        setStats(data);
        setLastUpdated(new Date());
      }
    } catch {
      // Silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats]);

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-64px)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[rgba(255,255,255,0.06)] shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-white">System Workflow Map</h2>
          <p className="text-xs text-[rgba(255,255,255,0.35)] mt-0.5">
            Live view of all automations — contact forms, applications, stage triggers, and email sequences
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastUpdated && (
            <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={fetchStats}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[rgba(255,255,255,0.6)] hover:text-white transition-colors disabled:opacity-50"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary chips */}
      <div className="flex items-center gap-3 px-6 py-2 border-b border-[rgba(255,255,255,0.04)] shrink-0 overflow-x-auto">
        {[
          { label: "Leads (7d)", value: stats.totalLeads, color: "#1B65A7" },
          { label: "Applications (7d)", value: stats.totalApps, color: "#8b5cf6" },
          { label: "Enrolled", value: stats.totalEnrollments, color: "#00C9A7" },
          { label: "SMS sent (7d)", value: stats.smsSent, color: "#0ea5e9" },
          { label: "Emails sent (7d)", value: stats.emailSent, color: "#f59e0b" },
          { label: "Blocked bots (7d)", value: stats.rejectedLeads + stats.rejectedApps, color: "#ef4444" },
        ].map((item) => (
          <div
            key={item.label}
            className="shrink-0 px-3 py-1.5 rounded-lg text-xs"
            style={{ background: `${item.color}15`, border: `1px solid ${item.color}30` }}
          >
            <span className="font-bold" style={{ color: item.color }}>{item.value}</span>
            <span className="text-[rgba(255,255,255,0.4)] ml-1.5">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Flow canvas */}
      <div className="flex-1 min-h-0">
        <WorkflowMap stats={stats} />
      </div>
    </div>
  );
}
