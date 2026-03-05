"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { WorkflowMap } from "@/components/workflow-map/workflow-map";
import { RefreshCw, Plus, Zap, Pencil, ChevronDown, ChevronUp } from "lucide-react";

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

interface CustomWorkflow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  nodes: unknown[];
  edges: unknown[];
  created_at: string;
  updated_at: string;
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
  const router = useRouter();
  const [stats, setStats] = useState<WorkflowStats>(DEFAULT_STATS);
  const [workflows, setWorkflows] = useState<CustomWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showSystemMap, setShowSystemMap] = useState(true);

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

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/workflows/custom");
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data);
      }
    } catch {
      // Silent fail
    }
  }, []);

  const toggleWorkflow = async (id: string, enabled: boolean) => {
    setWorkflows((prev) =>
      prev.map((w) => (w.id === id ? { ...w, enabled } : w))
    );
    await fetch(`/api/workflows/custom/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled }),
    });
  };

  useEffect(() => {
    fetchStats();
    fetchWorkflows();
    const interval = setInterval(fetchStats, 30_000);
    return () => clearInterval(interval);
  }, [fetchStats, fetchWorkflows]);

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-64px)]">
      {/* Header bar */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-[rgba(255,255,255,0.06)] shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-white">Workflows</h2>
          <p className="text-xs text-[rgba(255,255,255,0.35)] mt-0.5">
            Build custom automations and view system workflow map
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
          <button
            onClick={() => router.push("/dashboard/workflows/builder")}
            className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold bg-[#00C9A7] text-[#0B1426] rounded-lg hover:bg-[#00ddb8] transition-colors"
          >
            <Plus size={14} />
            New Workflow
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

      {/* My Workflows section */}
      <div className="px-6 py-4 border-b border-[rgba(255,255,255,0.06)] shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-[rgba(255,255,255,0.4)] mb-3">
          My Workflows
        </h3>
        {workflows.length === 0 ? (
          <div className="flex items-center gap-3 py-6 justify-center">
            <Zap size={16} className="text-[rgba(255,255,255,0.2)]" />
            <p className="text-xs text-[rgba(255,255,255,0.3)]">
              No custom workflows yet.{" "}
              <button
                onClick={() => router.push("/dashboard/workflows/builder")}
                className="text-[#00C9A7] hover:underline"
              >
                Create your first workflow
              </button>
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
            {workflows.map((w) => (
              <div
                key={w.id}
                className="group relative rounded-xl p-4 transition-all hover:scale-[1.01] cursor-pointer"
                style={{
                  background: w.enabled ? "rgba(0,201,167,0.06)" : "rgba(255,255,255,0.03)",
                  border: `1px solid ${w.enabled ? "rgba(0,201,167,0.2)" : "rgba(255,255,255,0.06)"}`,
                }}
                onClick={() => router.push(`/dashboard/workflows/builder/${w.id}`)}
              >
                <div className="flex items-start justify-between mb-2">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{
                      background: w.enabled ? "rgba(0,201,167,0.15)" : "rgba(255,255,255,0.05)",
                    }}
                  >
                    <Zap size={14} className={w.enabled ? "text-[#00C9A7]" : "text-[rgba(255,255,255,0.3)]"} />
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWorkflow(w.id, !w.enabled);
                    }}
                    className={`px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                      w.enabled
                        ? "bg-[rgba(0,201,167,0.2)] text-[#00C9A7]"
                        : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)]"
                    }`}
                  >
                    {w.enabled ? "Active" : "Off"}
                  </button>
                </div>
                <p className="text-xs font-semibold text-white truncate">{w.name}</p>
                <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">
                  {w.nodes.length} nodes
                </p>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/dashboard/workflows/builder/${w.id}`);
                  }}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-[rgba(255,255,255,0.1)] transition-all"
                >
                  <Pencil size={12} className="text-[rgba(255,255,255,0.5)]" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* System Map toggle + canvas */}
      <div className="flex-1 min-h-0 flex flex-col">
        <button
          onClick={() => setShowSystemMap(!showSystemMap)}
          className="flex items-center gap-2 px-6 py-2 text-xs text-[rgba(255,255,255,0.4)] hover:text-white transition-colors shrink-0"
        >
          {showSystemMap ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          <span className="font-semibold uppercase tracking-widest text-[10px]">System Workflow Map</span>
        </button>
        {showSystemMap && (
          <div className="flex-1 min-h-0">
            <WorkflowMap stats={stats} />
          </div>
        )}
      </div>
    </div>
  );
}
