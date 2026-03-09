"use client";

import { ArrowRight } from "lucide-react";
import Link from "next/link";

interface Deal {
  id: string;
  contact: string;
  business: string;
  amount: number;
  stage: string;
  pipeline: string;
  days_in_stage?: number;
}

interface DealListResult {
  deals?: Deal[];
  count?: number;
  stage?: string;
  query?: string;
  total_deals?: number;
  message?: string;
}

const STAGE_COLORS: Record<string, string> = {
  "Open - Not Contacted": "#1B65A7",
  "Working - Contacted": "#9C27B0",
  "Working - Application Out": "#00BCD4",
  "Closed - Not Converted": "#E74C3C",
  "Converted": "#00C9A7",
  "Contract In": "#00BCD4",
  "Pending Stips": "#f59e0b",
  "Funding Call": "#9C27B0",
  "In Funding": "#1B65A7",
  "Funded": "#4CAF50",
  "Deal Lost": "#E74C3C",
};

export function DealListCard({ data }: { data: DealListResult }) {
  const deals = data.deals || [];
  const count = data.count ?? deals.length;
  const label = data.stage || data.query || "Deals";

  if (data.message && deals.length === 0) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">{data.message}</p>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider">
          {label} — {count} deal{count !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="divide-y divide-[rgba(255,255,255,0.04)]">
        {deals.map((deal) => (
          <Link
            key={deal.id}
            href={`/dashboard/pipeline`}
            className="flex items-center justify-between px-4 py-3 hover:bg-[rgba(255,255,255,0.02)] transition-colors group"
          >
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-white truncate">
                {deal.business || deal.contact}
              </p>
              <p className="text-xs text-[rgba(255,255,255,0.35)] truncate">
                {deal.pipeline} · {deal.contact}
              </p>
            </div>
            <div className="flex items-center gap-3 ml-3 shrink-0">
              <span
                className="flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full"
                style={{
                  color: STAGE_COLORS[deal.stage] || "#64748b",
                  background: `${STAGE_COLORS[deal.stage] || "#64748b"}18`,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ background: STAGE_COLORS[deal.stage] || "#64748b" }}
                />
                {deal.stage}
              </span>
              {deal.amount ? (
                <span className="text-sm font-semibold text-white">
                  ${deal.amount.toLocaleString()}
                </span>
              ) : null}
              {deal.days_in_stage != null && (
                <span
                  className={`text-xs font-medium ${
                    deal.days_in_stage > 3 ? "text-[#ef4444]" : "text-[rgba(255,255,255,0.35)]"
                  }`}
                >
                  {deal.days_in_stage}d
                </span>
              )}
              <ArrowRight className="h-3.5 w-3.5 text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.5)] transition-colors" />
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
