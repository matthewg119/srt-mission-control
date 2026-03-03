"use client";

interface StageData {
  count: number;
  totalAmount: number;
  staleCount: number;
}

interface PipelineOverviewResult {
  total_deals?: number;
  stages?: Record<string, StageData>;
  pipelines?: Record<string, number>;
  message?: string;
}

export function PipelineOverviewCard({ data }: { data: PipelineOverviewResult }) {
  if (data.message || !data.stages) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">{data.message || "No pipeline data"}</p>
      </div>
    );
  }

  const stages = Object.entries(data.stages);
  const newDeals = stages.filter(([k]) => k.startsWith("New Deals"));
  const activeDeals = stages.filter(([k]) => k.startsWith("Active Deals"));

  const renderGroup = (group: [string, StageData][], label: string) => (
    <div className="mb-3 last:mb-0">
      <p className="text-[10px] font-semibold text-[rgba(255,255,255,0.3)] uppercase tracking-wider mb-2">{label}</p>
      <div className="space-y-1">
        {group.map(([key, val]) => {
          const stageName = key.replace(`${label} → `, "");
          return (
            <div key={key} className="flex items-center justify-between text-xs">
              <span className="text-[rgba(255,255,255,0.55)] min-w-0 truncate">{stageName}</span>
              <div className="flex items-center gap-2 shrink-0 ml-2">
                {val.staleCount > 0 && (
                  <span className="text-[#ef4444] text-[10px]">{val.staleCount} stale</span>
                )}
                {val.totalAmount > 0 && (
                  <span className="text-[rgba(255,255,255,0.35)] text-[10px]">
                    ${(val.totalAmount / 1000).toFixed(0)}k
                  </span>
                )}
                <span className="font-semibold text-white min-w-[1.5rem] text-right">{val.count}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider">
          Pipeline Overview
        </span>
        <span className="text-xs text-white font-semibold">{data.total_deals} total</span>
      </div>
      <div className="px-4 py-3">
        {newDeals.length > 0 && renderGroup(newDeals, "New Deals")}
        {activeDeals.length > 0 && renderGroup(activeDeals, "Active Deals")}
      </div>
    </div>
  );
}
