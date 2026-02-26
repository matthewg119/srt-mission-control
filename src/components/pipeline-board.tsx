"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { NEW_DEALS_PIPELINE, ACTIVE_DEALS_PIPELINE } from "@/config/pipeline";
import { formatCurrency } from "@/lib/utils";

interface Deal {
  id: string;
  ghl_opportunity_id: string;
  contact_name: string;
  business_name: string;
  stage: string;
  pipeline_name?: string;
  amount: number | null;
  assigned_to: string | null;
  last_activity: string | null;
  synced_at: string;
}

interface PipelineBoardProps {
  initialDeals: Deal[];
}

const PIPELINE_TABS = [
  { key: "active", label: "Active Deals", pipeline: ACTIVE_DEALS_PIPELINE },
  { key: "new", label: "New Deals", pipeline: NEW_DEALS_PIPELINE },
] as const;

export function PipelineBoard({ initialDeals }: PipelineBoardProps) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [syncing, setSyncing] = useState(false);
  const [activeTab, setActiveTab] = useState<"active" | "new">("active");

  const currentPipeline = PIPELINE_TABS.find((t) => t.key === activeTab)!.pipeline;

  // Filter deals by pipeline — use pipeline_name if available, otherwise match by stage names
  const pipelineDeals = deals.filter((d) => {
    if (d.pipeline_name) return d.pipeline_name === currentPipeline.name;
    return currentPipeline.stages.some((s) => s.name === d.stage);
  });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/ghl/sync", { method: "POST" });
      if (res.ok) {
        window.location.reload();
      }
    } catch {
      // Error handling
    }
    setSyncing(false);
  };

  const getDaysInStage = (lastActivity: string | null): number => {
    if (!lastActivity) return 0;
    const diff = Date.now() - new Date(lastActivity).getTime();
    return Math.floor(diff / (1000 * 60 * 60 * 24));
  };

  // Counts for tab badges
  const newDealsCount = deals.filter((d) => {
    if (d.pipeline_name) return d.pipeline_name === NEW_DEALS_PIPELINE.name;
    return NEW_DEALS_PIPELINE.stages.some((s) => s.name === d.stage);
  }).length;

  const activeDealsCount = deals.filter((d) => {
    if (d.pipeline_name) return d.pipeline_name === ACTIVE_DEALS_PIPELINE.name;
    return ACTIVE_DEALS_PIPELINE.stages.some((s) => s.name === d.stage);
  }).length;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Pipeline</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="flex items-center gap-2 px-4 py-2 bg-[rgba(255,255,255,0.08)] text-white rounded-lg text-sm hover:bg-[rgba(255,255,255,0.12)] disabled:opacity-50 transition-colors"
        >
          <RefreshCw size={14} className={syncing ? "animate-spin" : ""} />
          {syncing ? "Syncing..." : "Sync from GHL"}
        </button>
      </div>

      {/* Pipeline Tabs */}
      <div className="flex gap-2 mb-6">
        {PIPELINE_TABS.map((tab) => {
          const count = tab.key === "active" ? activeDealsCount : newDealsCount;
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-[#00C9A7] text-[#0B1426]"
                  : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.08)]"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                  activeTab === tab.key
                    ? "bg-[#0B1426]/20 text-[#0B1426]"
                    : "bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)]"
                }`}>
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 280px)" }}>
        {currentPipeline.stages.map((stage) => {
          const stageDeals = pipelineDeals.filter((d) => d.stage === stage.name);
          return (
            <div key={stage.name} className="flex-shrink-0 w-[280px]">
              {/* Stage Header */}
              <div
                className="rounded-t-lg px-3 py-2 mb-2"
                style={{ borderTop: `3px solid ${stage.color}`, background: "rgba(255,255,255,0.03)" }}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-white">{stage.name}</span>
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded-full text-white"
                    style={{ backgroundColor: stage.color }}
                  >
                    {stageDeals.length}
                  </span>
                </div>
              </div>

              {/* Deal Cards */}
              <div className="space-y-2">
                {stageDeals.length === 0 ? (
                  <div className="text-center py-8 text-[rgba(255,255,255,0.2)] text-xs">
                    No deals
                  </div>
                ) : (
                  stageDeals.map((deal) => {
                    const days = getDaysInStage(deal.last_activity);
                    return (
                      <div
                        key={deal.id}
                        className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 card-hover"
                      >
                        <p className="font-semibold text-white text-sm mb-1">
                          {deal.business_name || "Unknown Business"}
                        </p>
                        <p className="text-xs text-[rgba(255,255,255,0.4)] mb-2">
                          {deal.contact_name || "No contact"}
                        </p>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm text-[#00C9A7]">
                            {deal.amount ? formatCurrency(Number(deal.amount)) : "—"}
                          </span>
                          <div className="flex items-center gap-2">
                            {days > 0 && (
                              <span
                                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                  days > 7
                                    ? "bg-[#E74C3C]/20 text-[#E74C3C]"
                                    : days > 3
                                    ? "bg-[#F5A623]/20 text-[#F5A623]"
                                    : "bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)]"
                                }`}
                              >
                                {days}d
                              </span>
                            )}
                            {deal.assigned_to && (
                              <div className="w-5 h-5 rounded-full bg-[#1B65A7] flex items-center justify-center text-[8px] font-bold text-white">
                                {deal.assigned_to.charAt(0).toUpperCase()}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {deals.length === 0 && (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <p className="text-lg mb-2">No pipeline data yet</p>
          <p className="text-sm">Click &quot;Sync from GHL&quot; to load your pipelines.</p>
        </div>
      )}
    </div>
  );
}
