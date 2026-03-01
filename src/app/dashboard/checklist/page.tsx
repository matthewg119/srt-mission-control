"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import {
  ClipboardCheck,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  RotateCcw,
  Download,
  Filter,
} from "lucide-react";
import { QA_CHECKLIST, countChecklistItems } from "@/config/checklist";
import type { ChecklistCategory, ChecklistSection } from "@/config/checklist";

const STORAGE_KEY = "srt-qa-checklist-v1";

function loadCheckedState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveCheckedState(state: Record<string, boolean>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage full or unavailable
  }
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: "bg-red-500/20 text-red-400 border-red-500/30",
  high: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  medium: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  low: "bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] border-[rgba(255,255,255,0.1)]",
};

type FilterMode = "all" | "pending" | "completed" | "critical";

export default function ChecklistPage() {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FilterMode>("all");

  // Load state from localStorage on mount
  useEffect(() => {
    setChecked(loadCheckedState());
    // Expand all categories by default
    const cats: Record<string, boolean> = {};
    for (const cat of QA_CHECKLIST) cats[cat.id] = true;
    setExpandedCategories(cats);
  }, []);

  const totalItems = useMemo(() => countChecklistItems(QA_CHECKLIST), []);
  const completedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked]
  );
  const percentage = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

  const toggleItem = useCallback(
    (id: string) => {
      setChecked((prev) => {
        const next = { ...prev, [id]: !prev[id] };
        saveCheckedState(next);
        return next;
      });
    },
    []
  );

  const toggleCategory = useCallback((catId: string) => {
    setExpandedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }, []);

  const toggleSection = useCallback((secId: string) => {
    setExpandedSections((prev) => ({ ...prev, [secId]: !prev[secId] }));
  }, []);

  const resetAll = useCallback(() => {
    if (window.confirm("Reset all checklist progress? This cannot be undone.")) {
      setChecked({});
      saveCheckedState({});
    }
  }, []);

  const exportMarkdown = useCallback(() => {
    let md = "# SRT Agency QA Checklist\n\n";
    md += `Progress: ${completedCount}/${totalItems} (${percentage}%)\n\n`;
    for (const cat of QA_CHECKLIST) {
      md += `## ${cat.title}\n\n`;
      for (const sec of cat.sections) {
        md += `### ${sec.title}\n\n`;
        for (const item of sec.items) {
          md += `- [${checked[item.id] ? "x" : " "}] ${item.label}\n`;
        }
        md += "\n";
      }
    }
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `qa-checklist-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }, [checked, completedCount, totalItems, percentage]);

  // Filter logic
  const shouldShowItem = useCallback(
    (id: string, priority?: string) => {
      switch (filter) {
        case "pending":
          return !checked[id];
        case "completed":
          return !!checked[id];
        case "critical":
          return priority === "critical";
        default:
          return true;
      }
    },
    [checked, filter]
  );

  function getSectionStats(section: ChecklistSection) {
    const total = section.items.length;
    const done = section.items.filter((i) => checked[i.id]).length;
    return { total, done };
  }

  function getCategoryStats(category: ChecklistCategory) {
    let total = 0;
    let done = 0;
    for (const sec of category.sections) {
      const stats = getSectionStats(sec);
      total += stats.total;
      done += stats.done;
    }
    return { total, done };
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.1)]">
            <ClipboardCheck className="h-5 w-5 text-[#00C9A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">QA Checklist</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">
              Pre-launch quality assurance
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportMarkdown}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.05)] text-sm text-[rgba(255,255,255,0.6)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
          >
            <Download className="h-3.5 w-3.5" />
            Export
          </button>
          <button
            onClick={resetAll}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.05)] text-sm text-[rgba(255,255,255,0.6)] hover:text-red-400 hover:bg-red-500/10 transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl p-5 mb-6">
        <div className="flex items-center justify-between mb-3">
          <span className="text-sm font-medium text-white">
            {completedCount} / {totalItems} completed
          </span>
          <span
            className={`text-lg font-bold ${
              percentage === 100
                ? "text-[#00C9A7]"
                : percentage >= 75
                ? "text-green-400"
                : percentage >= 50
                ? "text-yellow-400"
                : percentage >= 25
                ? "text-orange-400"
                : "text-[rgba(255,255,255,0.5)]"
            }`}
          >
            {percentage}%
          </span>
        </div>
        <div className="w-full h-3 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${percentage}%`,
              background:
                percentage === 100
                  ? "#00C9A7"
                  : "linear-gradient(90deg, #1B65A7, #00C9A7)",
            }}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-[rgba(255,255,255,0.03)] rounded-lg w-fit">
        {(
          [
            { key: "all", label: "All" },
            { key: "pending", label: "Pending" },
            { key: "completed", label: "Done" },
            { key: "critical", label: "Critical" },
          ] as const
        ).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === tab.key
                ? "bg-[rgba(255,255,255,0.1)] text-white"
                : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]"
            }`}
          >
            <Filter className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Checklist Categories */}
      <div className="space-y-4">
        {QA_CHECKLIST.map((category) => {
          const catStats = getCategoryStats(category);
          const isExpanded = expandedCategories[category.id];
          const catDone = catStats.done === catStats.total;

          return (
            <div
              key={category.id}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden"
            >
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-[rgba(255,255,255,0.4)]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[rgba(255,255,255,0.4)]" />
                  )}
                  <h2 className="text-base font-semibold text-white">
                    {category.title}
                  </h2>
                  {catDone && (
                    <CheckCircle2 className="h-4 w-4 text-[#00C9A7]" />
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[rgba(255,255,255,0.4)]">
                    {catStats.done}/{catStats.total}
                  </span>
                  <div className="w-20 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#00C9A7] transition-all duration-300"
                      style={{
                        width: `${catStats.total > 0 ? (catStats.done / catStats.total) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              </button>

              {/* Category Content */}
              {isExpanded && (
                <div className="border-t border-[rgba(255,255,255,0.06)]">
                  {category.sections.map((section) => {
                    const secStats = getSectionStats(section);
                    const secKey = `${category.id}-${section.id}`;
                    const secExpanded = expandedSections[secKey] !== false; // default expanded
                    const secDone = secStats.done === secStats.total;
                    const visibleItems = section.items.filter((i) =>
                      shouldShowItem(i.id, i.priority)
                    );

                    if (visibleItems.length === 0 && filter !== "all")
                      return null;

                    return (
                      <div key={section.id} className="border-b border-[rgba(255,255,255,0.04)] last:border-b-0">
                        {/* Section Header */}
                        <button
                          onClick={() => toggleSection(secKey)}
                          className="w-full flex items-center justify-between px-6 py-2.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {secExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5 text-[rgba(255,255,255,0.3)]" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5 text-[rgba(255,255,255,0.3)]" />
                            )}
                            <h3 className="text-sm font-medium text-[rgba(255,255,255,0.7)]">
                              {section.title}
                            </h3>
                            {secDone && (
                              <CheckCircle2 className="h-3.5 w-3.5 text-[#00C9A7]" />
                            )}
                          </div>
                          <span className="text-xs text-[rgba(255,255,255,0.3)]">
                            {secStats.done}/{secStats.total}
                          </span>
                        </button>

                        {/* Section Items */}
                        {secExpanded && (
                          <div className="pb-2">
                            {visibleItems.map((item) => (
                              <label
                                key={item.id}
                                className="flex items-center gap-3 px-6 py-1.5 cursor-pointer hover:bg-[rgba(255,255,255,0.02)] transition-colors group"
                              >
                                <button
                                  onClick={(e) => {
                                    e.preventDefault();
                                    toggleItem(item.id);
                                  }}
                                  className="shrink-0"
                                >
                                  {checked[item.id] ? (
                                    <CheckCircle2 className="h-4 w-4 text-[#00C9A7]" />
                                  ) : (
                                    <Circle className="h-4 w-4 text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.4)]" />
                                  )}
                                </button>
                                <span
                                  className={`text-sm flex-1 ${
                                    checked[item.id]
                                      ? "text-[rgba(255,255,255,0.3)] line-through"
                                      : "text-[rgba(255,255,255,0.7)]"
                                  }`}
                                >
                                  {item.label}
                                </span>
                                {item.priority && (
                                  <span
                                    className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${
                                      PRIORITY_COLORS[item.priority]
                                    }`}
                                  >
                                    {item.priority}
                                  </span>
                                )}
                              </label>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom Summary */}
      <div className="mt-6 mb-8 text-center text-sm text-[rgba(255,255,255,0.3)]">
        {percentage === 100
          ? "All checks passed! Ready for launch."
          : `${totalItems - completedCount} items remaining`}
      </div>
    </div>
  );
}
