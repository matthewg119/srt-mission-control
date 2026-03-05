"use client";

import Link from "next/link";

interface Lender {
  id: string;
  name: string;
  submission_email?: string;
  min_credit_score?: number;
  max_amount?: number;
  products?: string[];
  product_types?: string[];
  response_time_days?: number;
  notes?: string;
  is_active?: boolean;
  tier?: number;
  tier_label?: string;
  submission_method?: string;
}

interface LendersResult {
  lenders?: Lender[];
  count?: number;
  tier_breakdown?: { tier_1: number; tier_2: number; tier_3: number };
  error?: string;
}

const TIER_COLORS: Record<number, { color: string; bg: string }> = {
  1: { color: "#4CAF50", bg: "rgba(76,175,80,0.15)" },
  2: { color: "#F5A623", bg: "rgba(245,166,35,0.15)" },
  3: { color: "#E74C3C", bg: "rgba(231,76,60,0.15)" },
};

export function LenderListCard({ data }: { data: LendersResult }) {
  if (data.error) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">{data.error}</p>
      </div>
    );
  }

  const lenders = data.lenders || [];

  if (lenders.length === 0) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3 flex items-center justify-between">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">No lenders found. Add some in the Lenders section.</p>
        <Link href="/dashboard/lenders" className="text-xs text-[#00C9A7] hover:underline shrink-0 ml-2">
          Add Lenders →
        </Link>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider">
            Lenders ({lenders.length})
          </span>
          {data.tier_breakdown && (
            <div className="flex items-center gap-2">
              {data.tier_breakdown.tier_1 > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: TIER_COLORS[1].bg, color: TIER_COLORS[1].color }}>
                  {data.tier_breakdown.tier_1} A Paper
                </span>
              )}
              {data.tier_breakdown.tier_2 > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: TIER_COLORS[2].bg, color: TIER_COLORS[2].color }}>
                  {data.tier_breakdown.tier_2} B Paper
                </span>
              )}
              {data.tier_breakdown.tier_3 > 0 && (
                <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: TIER_COLORS[3].bg, color: TIER_COLORS[3].color }}>
                  {data.tier_breakdown.tier_3} High Risk
                </span>
              )}
            </div>
          )}
        </div>
        <Link href="/dashboard/lenders" className="text-xs text-[#00C9A7] hover:underline">
          Manage →
        </Link>
      </div>
      <div className="divide-y divide-[rgba(255,255,255,0.04)]">
        {lenders.slice(0, 10).map((lender) => {
          const products = lender.products || lender.product_types || [];
          const tier = lender.tier || 2;
          const tierStyle = TIER_COLORS[tier] || TIER_COLORS[2];
          return (
            <div key={lender.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-white">{lender.name}</p>
                  <span
                    className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                    style={{ backgroundColor: tierStyle.bg, color: tierStyle.color }}
                  >
                    {lender.tier_label || (tier === 1 ? "A" : tier === 2 ? "B" : "C")}
                  </span>
                  {lender.submission_method && lender.submission_method !== "email" && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)]">
                      {lender.submission_method === "portal" ? "Portal" : "Email+Portal"}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lender.min_credit_score && (
                    <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
                      {lender.min_credit_score}+ credit
                    </span>
                  )}
                  {lender.max_amount && (
                    <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
                      up to ${(lender.max_amount / 1000).toFixed(0)}k
                    </span>
                  )}
                </div>
              </div>
              {products.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {products.slice(0, 4).map((p: string) => (
                    <span
                      key={p}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(27,101,167,0.15)] border border-[rgba(27,101,167,0.2)] text-[#1B65A7]"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {lenders.length > 10 && (
          <div className="px-4 py-2 text-center">
            <span className="text-[10px] text-[rgba(255,255,255,0.3)]">+{lenders.length - 10} more lenders</span>
          </div>
        )}
      </div>
    </div>
  );
}
