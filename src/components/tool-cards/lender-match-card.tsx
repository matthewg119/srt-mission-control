"use client";

interface MatchedLender {
  id: string;
  name: string;
  tier: number;
  tier_label: string;
  submission_method: string;
  submission_email?: string;
  score: number;
  reasons: string[];
  warnings: string[];
  products?: string[];
}

interface MatchResult {
  deal_summary?: { business: string; amount: number; credit: string; product: string };
  matches?: MatchedLender[];
  total_matches?: number;
  message?: string;
  error?: string;
}

const TIER_COLORS: Record<number, { color: string; bg: string }> = {
  1: { color: "#4CAF50", bg: "rgba(76,175,80,0.15)" },
  2: { color: "#F5A623", bg: "rgba(245,166,35,0.15)" },
  3: { color: "#E74C3C", bg: "rgba(231,76,60,0.15)" },
};

export function LenderMatchCard({ data, onAction }: { data: MatchResult; onAction?: (prompt: string) => void }) {
  if (data.error) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">{data.error}</p>
      </div>
    );
  }

  const matches = data.matches || [];
  const summary = data.deal_summary;

  if (matches.length === 0) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">No matching lenders found. Try adjusting the deal criteria or seed more lenders.</p>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(0,201,167,0.2)] bg-[rgba(0,201,167,0.03)] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-[rgba(0,201,167,0.15)]">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold text-[#00C9A7] uppercase tracking-wider">
            Lender Matches ({data.total_matches || matches.length})
          </span>
          {summary && (
            <span className="text-[10px] text-[rgba(255,255,255,0.35)]">
              {summary.business} · ${typeof summary.amount === "number" ? (summary.amount / 1000).toFixed(0) + "K" : summary.amount} · {summary.product}
            </span>
          )}
        </div>
      </div>

      {/* Matches */}
      <div className="divide-y divide-[rgba(255,255,255,0.04)]">
        {matches.map((m, i) => {
          const tierStyle = TIER_COLORS[m.tier] || TIER_COLORS[2];
          return (
            <div key={m.id} className="px-4 py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] text-[rgba(255,255,255,0.3)] font-mono w-4">#{i + 1}</span>
                    <p className="text-sm font-medium text-white">{m.name}</p>
                    <span
                      className="text-[9px] px-1.5 py-0.5 rounded font-medium"
                      style={{ backgroundColor: tierStyle.bg, color: tierStyle.color }}
                    >
                      {m.tier_label}
                    </span>
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)]">
                      {m.submission_method === "portal" ? "Portal" : m.submission_method === "both" ? "Email+Portal" : "Email"}
                    </span>
                  </div>
                  {/* Reasons */}
                  {m.reasons.length > 0 && (
                    <div className="flex flex-wrap gap-1 mb-1 ml-6">
                      {m.reasons.map((r, j) => (
                        <span key={j} className="text-[10px] text-[#00C9A7]">+ {r}</span>
                      ))}
                    </div>
                  )}
                  {/* Warnings */}
                  {m.warnings.length > 0 && (
                    <div className="flex flex-wrap gap-1 ml-6">
                      {m.warnings.map((w, j) => (
                        <span key={j} className="text-[10px] text-[#F5A623]">! {w}</span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] font-mono text-[rgba(255,255,255,0.3)]">
                    {m.score}pts
                  </span>
                  {m.submission_email && onAction && (
                    <button
                      onClick={() => onAction(`Submit this deal to ${m.name}`)}
                      className="text-[10px] px-2 py-1 rounded bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)] transition-colors"
                    >
                      Submit
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
