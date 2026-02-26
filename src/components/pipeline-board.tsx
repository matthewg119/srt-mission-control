"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { PIPELINE_STAGES } from "@/config/pipeline";
import { formatCurrency } from "@/lib/utils";

interface Deal {
  id: string;
  ghl_opportunity_id: string;
  contact_name: string;
  business_name: string;
  stage: string;
  amount: number | null;
  assigned_to: string | null;
  last_activity: string | null;
  synced_at: string;
}

interface PipelineBoardProps {
  initialDeals: Deal[];
}

export function PipelineBoard({ initialDeals }: PipelineBoardProps) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/ghl/sync", { method: "POST" });
      if (res.ok) {
        // Refetch pipeline data
        const dataRes = await fetch("/api/ghl/sync");
        if (dataRes.ok) {
          const data = await dataRes.json();
          if (data.deals) setDeals(data.deals);
        }
        // Also just refetch from our cache
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

      {/* Kanban Board */}
      <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 200px)" }}>
        {PIPELINE_STAGES.map((stage) => {
          const stageDeals = deals.filter((d) => d.stage === stage.name);
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
          <p className="text-sm">Click &quot;Sync from GHL&quot; to load your pipeline.</p>
        </div>
      )}
    </div>
  );
}
