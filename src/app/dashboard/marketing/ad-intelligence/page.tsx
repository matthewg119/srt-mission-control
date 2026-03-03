"use client";

import { useState, useEffect, useCallback } from "react";
import { Brain, Loader2, Zap, TrendingUp, Calendar, Lightbulb } from "lucide-react";
import { AWARENESS_LEVELS } from "@/config/ads-verticals";

interface AdIdea {
  hook: string;
  primaryText: string;
  headline: string;
  vertical: string;
  layer: string;
  cta: string;
}

interface Report {
  id: string;
  description: string;
  metadata: {
    ideas_count: number;
    verticals_used: string[];
    ideas: AdIdea[];
    generated_at: string;
  };
  created_at: string;
}

type Tab = "ideas" | "patterns" | "reports";

export default function AdIntelligencePage() {
  const [tab, setTab] = useState<Tab>("ideas");
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  const fetchReports = useCallback(async () => {
    try {
      const res = await fetch("/api/marketing/intelligence");
      if (res.ok) {
        const data = await res.json();
        setReports(data.reports || []);
      }
    } catch {
      // silent
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchReports();
  }, [fetchReports]);

  const generateNow = useCallback(async () => {
    setGenerating(true);
    try {
      await fetch("/api/cron/ad-intelligence");
      await fetchReports();
    } catch {
      // silent
    }
    setGenerating(false);
  }, [fetchReports]);

  const latestReport = reports[0];
  const allIdeas: AdIdea[] = reports.flatMap((r) => r.metadata?.ideas || []);
  const totalIdeas = reports.reduce((s, r) => s + (r.metadata?.ideas_count || 0), 0);
  const thisWeek = reports.filter((r) => {
    const d = new Date(r.created_at);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return d > weekAgo;
  });
  const thisWeekIdeas = thisWeek.reduce((s, r) => s + (r.metadata?.ideas_count || 0), 0);

  // Find most common vertical across all ideas
  const verticalCounts: Record<string, number> = {};
  allIdeas.forEach((idea) => {
    if (idea.vertical) {
      verticalCounts[idea.vertical] = (verticalCounts[idea.vertical] || 0) + 1;
    }
  });
  const topPattern = Object.entries(verticalCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

  const getLayerColor = (layerName: string): string => {
    const level = AWARENESS_LEVELS.find(
      (l) => l.label.toLowerCase() === layerName?.toLowerCase()
    );
    return level?.color || "#6B7280";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[rgba(155,89,182,0.12)] flex items-center justify-center">
          <Brain className="h-4.5 w-4.5 text-[#9B59B6]" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Ad Intelligence</h1>
          <p className="text-xs text-[rgba(255,255,255,0.35)]">
            AI-powered nightly ad ideas and pattern detection
          </p>
        </div>
        <button
          onClick={generateNow}
          disabled={generating}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-[#9B59B6] text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
        >
          {generating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Zap className="h-3.5 w-3.5" />
          )}
          Generate Now
        </button>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Lightbulb className="h-3.5 w-3.5 text-[#F5A623]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.35)]">Total Ideas</span>
          </div>
          <p className="text-xl font-bold text-white">{totalIdeas}</p>
        </div>
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Calendar className="h-3.5 w-3.5 text-[#1B65A7]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.35)]">This Week</span>
          </div>
          <p className="text-xl font-bold text-white">{thisWeekIdeas}</p>
        </div>
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-3.5 w-3.5 text-[#00C9A7]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.35)]">Top Vertical</span>
          </div>
          <p className="text-sm font-bold text-white truncate">{topPattern}</p>
        </div>
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
          <div className="flex items-center gap-2 mb-1">
            <Brain className="h-3.5 w-3.5 text-[#9B59B6]" />
            <span className="text-[10px] text-[rgba(255,255,255,0.35)]">Reports</span>
          </div>
          <p className="text-xl font-bold text-white">{reports.length}</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[rgba(255,255,255,0.06)]">
        {(["ideas", "patterns", "reports"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-xs font-medium border-b-2 transition-colors capitalize ${
              tab === t
                ? "border-[#9B59B6] text-[#9B59B6]"
                : "border-transparent text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.6)]"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-[200px]">
          <Loader2 className="h-6 w-6 text-[#9B59B6] animate-spin" />
        </div>
      ) : (
        <>
          {/* ─── IDEAS TAB ─── */}
          {tab === "ideas" && (
            <div className="space-y-2 max-h-[600px] overflow-y-auto">
              {allIdeas.length > 0 ? (
                allIdeas.slice(0, 50).map((idea, i) => (
                  <div
                    key={i}
                    className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-white">
                        {idea.hook}
                      </p>
                      <p className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5 line-clamp-2">
                        {idea.primaryText}
                      </p>
                      <div className="flex gap-2 mt-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 bg-[rgba(27,101,167,0.1)] text-[#1B65A7] rounded">
                          {idea.vertical}
                        </span>
                        <span
                          className="text-[9px] px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${getLayerColor(idea.layer)}18`,
                            color: getLayerColor(idea.layer),
                          }}
                        >
                          {idea.layer}
                        </span>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-[200px] text-[rgba(255,255,255,0.2)] text-sm">
                  No ideas generated yet. Click &quot;Generate Now&quot; to start.
                </div>
              )}
            </div>
          )}

          {/* ─── PATTERNS TAB ─── */}
          {tab === "patterns" && (
            <div className="space-y-4">
              {Object.entries(verticalCounts).length > 0 ? (
                <>
                  <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)]">
                    Vertical Distribution
                  </h3>
                  <div className="space-y-2">
                    {Object.entries(verticalCounts)
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 15)
                      .map(([vertical, count]) => {
                        const max = Math.max(...Object.values(verticalCounts));
                        const pct = (count / max) * 100;
                        return (
                          <div key={vertical} className="flex items-center gap-3">
                            <span className="text-xs text-[rgba(255,255,255,0.5)] w-[120px] truncate">
                              {vertical}
                            </span>
                            <div className="flex-1 h-2 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                              <div
                                className="h-full bg-[#9B59B6] rounded-full"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-[10px] text-[rgba(255,255,255,0.3)] w-8 text-right">
                              {count}
                            </span>
                          </div>
                        );
                      })}
                  </div>

                  <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)] mt-6">
                    Layer Distribution
                  </h3>
                  <div className="space-y-2">
                    {AWARENESS_LEVELS.map((level) => {
                      const count = allIdeas.filter(
                        (i) => i.layer?.toLowerCase() === level.label.toLowerCase()
                      ).length;
                      const max = Math.max(1, allIdeas.length / 7);
                      const pct = Math.min((count / max) * 100, 100);
                      return (
                        <div key={level.level} className="flex items-center gap-3">
                          <span className="text-xs text-[rgba(255,255,255,0.5)] w-[120px] truncate">
                            L{level.level}: {level.label}
                          </span>
                          <div className="flex-1 h-2 bg-[rgba(255,255,255,0.04)] rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${pct}%`, backgroundColor: level.color }}
                            />
                          </div>
                          <span className="text-[10px] text-[rgba(255,255,255,0.3)] w-8 text-right">
                            {count}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-[200px] text-[rgba(255,255,255,0.2)] text-sm">
                  Generate ideas to see patterns
                </div>
              )}
            </div>
          )}

          {/* ─── REPORTS TAB ─── */}
          {tab === "reports" && (
            <div className="space-y-3">
              {reports.length > 0 ? (
                reports.map((report) => (
                  <div
                    key={report.id}
                    className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-white">
                        {new Date(report.created_at).toLocaleDateString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </p>
                      <span className="text-[10px] px-2 py-0.5 bg-[rgba(155,89,182,0.1)] text-[#9B59B6] rounded-full">
                        {report.metadata?.ideas_count || 0} ideas
                      </span>
                    </div>
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)]">
                      {report.description}
                    </p>
                    {report.metadata?.verticals_used && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {report.metadata.verticals_used.map((v) => (
                          <span
                            key={v}
                            className="text-[9px] px-1.5 py-0.5 bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] rounded"
                          >
                            {v}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              ) : (
                <div className="flex items-center justify-center h-[200px] text-[rgba(255,255,255,0.2)] text-sm">
                  No reports yet. Click &quot;Generate Now&quot; to create the first one.
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
