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
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
} from "lucide-react";
import { QA_CHECKLIST, countChecklistItems } from "@/config/checklist";
import type { ChecklistCategory, ChecklistSection } from "@/config/checklist";

const STORAGE_KEY = "srt-qa-checklist-v1";
const CUSTOM_KEY = "srt-qa-checklist-custom-v1";

interface CustomItem {
  id: string;
  categoryId: string;
  sectionId: string;
  label: string;
  priority?: string;
}

function loadCheckedState(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch { return {}; }
}

function saveCheckedState(state: Record<string, boolean>) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* full */ }
}

function loadCustomItems(): CustomItem[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(CUSTOM_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveCustomItems(items: CustomItem[]) {
  try { localStorage.setItem(CUSTOM_KEY, JSON.stringify(items)); } catch { /* full */ }
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
  const [customItems, setCustomItems] = useState<CustomItem[]>([]);
  const [expandedCategories, setExpandedCategories] = useState<Record<string, boolean>>({});
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState<FilterMode>("all");

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");

  // Add state: key = `${categoryId}-${sectionId}`
  const [addingToSection, setAddingToSection] = useState<string | null>(null);
  const [newItemLabel, setNewItemLabel] = useState("");

  useEffect(() => {
    setChecked(loadCheckedState());
    setCustomItems(loadCustomItems());
    const cats: Record<string, boolean> = {};
    for (const cat of QA_CHECKLIST) cats[cat.id] = true;
    setExpandedCategories(cats);
  }, []);

  // Merge static + custom items per section
  const mergedCategories = useMemo(() => {
    return QA_CHECKLIST.map((cat) => ({
      ...cat,
      sections: cat.sections.map((sec) => ({
        ...sec,
        items: [
          ...sec.items,
          ...customItems
            .filter((ci) => ci.categoryId === cat.id && ci.sectionId === sec.id)
            .map((ci) => ({ id: ci.id, label: ci.label, priority: ci.priority as "critical" | "high" | "medium" | "low" | undefined, isCustom: true })),
        ],
      })),
    }));
  }, [customItems]);

  const totalItems = useMemo(() => {
    return mergedCategories.reduce(
      (sum, cat) => sum + cat.sections.reduce((s, sec) => s + sec.items.length, 0),
      0
    );
  }, [mergedCategories]);

  const completedCount = useMemo(
    () => Object.values(checked).filter(Boolean).length,
    [checked]
  );
  const percentage = totalItems > 0 ? Math.round((completedCount / totalItems) * 100) : 0;

  const toggleItem = useCallback((id: string) => {
    setChecked((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCheckedState(next);
      return next;
    });
  }, []);

  const toggleCategory = useCallback((catId: string) => {
    setExpandedCategories((prev) => ({ ...prev, [catId]: !prev[catId] }));
  }, []);

  const toggleSection = useCallback((secKey: string) => {
    setExpandedSections((prev) => ({ ...prev, [secKey]: !prev[secKey] }));
  }, []);

  const resetAll = useCallback(() => {
    if (window.confirm("Reset all checklist progress? This cannot be undone.")) {
      setChecked({});
      saveCheckedState({});
    }
  }, []);

  // --- Edit ---
  const startEdit = useCallback((id: string, label: string) => {
    setEditingId(id);
    setEditLabel(label);
    setAddingToSection(null);
  }, []);

  const saveEdit = useCallback(() => {
    if (!editingId || !editLabel.trim()) { setEditingId(null); return; }
    setCustomItems((prev) => {
      const next = prev.map((ci) =>
        ci.id === editingId ? { ...ci, label: editLabel.trim() } : ci
      );
      saveCustomItems(next);
      return next;
    });
    setEditingId(null);
  }, [editingId, editLabel]);

  const cancelEdit = useCallback(() => setEditingId(null), []);

  // --- Delete ---
  const deleteItem = useCallback((id: string) => {
    if (!window.confirm("Delete this item?")) return;
    setCustomItems((prev) => {
      const next = prev.filter((ci) => ci.id !== id);
      saveCustomItems(next);
      return next;
    });
    setChecked((prev) => {
      const next = { ...prev };
      delete next[id];
      saveCheckedState(next);
      return next;
    });
  }, []);

  // --- Add ---
  const startAdd = useCallback((sectionKey: string) => {
    setAddingToSection(sectionKey);
    setNewItemLabel("");
    setEditingId(null);
  }, []);

  const saveAdd = useCallback((categoryId: string, sectionId: string) => {
    if (!newItemLabel.trim()) { setAddingToSection(null); return; }
    const newItem: CustomItem = {
      id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      categoryId,
      sectionId,
      label: newItemLabel.trim(),
    };
    setCustomItems((prev) => {
      const next = [...prev, newItem];
      saveCustomItems(next);
      return next;
    });
    setAddingToSection(null);
    setNewItemLabel("");
  }, [newItemLabel]);

  const exportMarkdown = useCallback(() => {
    let md = "# SRT Agency QA Checklist\n\n";
    md += `Progress: ${completedCount}/${totalItems} (${percentage}%)\n\n`;
    for (const cat of mergedCategories) {
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
  }, [checked, completedCount, totalItems, percentage, mergedCategories]);

  const shouldShowItem = useCallback(
    (id: string, priority?: string) => {
      switch (filter) {
        case "pending": return !checked[id];
        case "completed": return !!checked[id];
        case "critical": return priority === "critical";
        default: return true;
      }
    },
    [checked, filter]
  );

  function getSectionStats(section: ChecklistSection & { items: Array<{ id: string; priority?: string; isCustom?: boolean }> }) {
    const total = section.items.length;
    const done = section.items.filter((i) => checked[i.id]).length;
    return { total, done };
  }

  function getCategoryStats(category: ChecklistCategory & { sections: Array<ChecklistSection & { items: Array<{ id: string; priority?: string; isCustom?: boolean }> }> }) {
    let total = 0, done = 0;
    for (const sec of category.sections) {
      const s = getSectionStats(sec);
      total += s.total; done += s.done;
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
            <h1 className="text-xl font-bold text-white">Checklist</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">Track and manage your operational tasks</p>
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
          <span className="text-sm font-medium text-white">{completedCount} / {totalItems} completed</span>
          <span className={`text-lg font-bold ${percentage === 100 ? "text-[#00C9A7]" : percentage >= 75 ? "text-green-400" : percentage >= 50 ? "text-yellow-400" : percentage >= 25 ? "text-orange-400" : "text-[rgba(255,255,255,0.5)]"}`}>
            {percentage}%
          </span>
        </div>
        <div className="w-full h-3 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{ width: `${percentage}%`, background: percentage === 100 ? "#00C9A7" : "linear-gradient(90deg, #1B65A7, #00C9A7)" }}
          />
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-1 mb-4 p-1 bg-[rgba(255,255,255,0.03)] rounded-lg w-fit">
        {([{ key: "all", label: "All" }, { key: "pending", label: "Pending" }, { key: "completed", label: "Done" }, { key: "critical", label: "Critical" }] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === tab.key ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)]"}`}
          >
            <Filter className="h-3 w-3" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Checklist Categories */}
      <div className="space-y-4">
        {mergedCategories.map((category) => {
          const catStats = getCategoryStats(category);
          const isExpanded = expandedCategories[category.id];
          const catDone = catStats.done === catStats.total && catStats.total > 0;

          return (
            <div key={category.id} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden">
              {/* Category Header */}
              <button
                onClick={() => toggleCategory(category.id)}
                className="w-full flex items-center justify-between p-4 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? <ChevronDown className="h-4 w-4 text-[rgba(255,255,255,0.4)]" /> : <ChevronRight className="h-4 w-4 text-[rgba(255,255,255,0.4)]" />}
                  <h2 className="text-base font-semibold text-white">{category.title}</h2>
                  {catDone && <CheckCircle2 className="h-4 w-4 text-[#00C9A7]" />}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[rgba(255,255,255,0.4)]">{catStats.done}/{catStats.total}</span>
                  <div className="w-20 h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-[#00C9A7] transition-all duration-300" style={{ width: `${catStats.total > 0 ? (catStats.done / catStats.total) * 100 : 0}%` }} />
                  </div>
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-[rgba(255,255,255,0.06)]">
                  {category.sections.map((section) => {
                    const secStats = getSectionStats(section);
                    const secKey = `${category.id}-${section.id}`;
                    const secExpanded = expandedSections[secKey] !== false;
                    const secDone = secStats.done === secStats.total && secStats.total > 0;
                    const visibleItems = section.items.filter((i) => shouldShowItem(i.id, i.priority));

                    if (visibleItems.length === 0 && filter !== "all") return null;

                    return (
                      <div key={section.id} className="border-b border-[rgba(255,255,255,0.04)] last:border-b-0">
                        {/* Section Header */}
                        <button
                          onClick={() => toggleSection(secKey)}
                          className="w-full flex items-center justify-between px-6 py-2.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            {secExpanded ? <ChevronDown className="h-3.5 w-3.5 text-[rgba(255,255,255,0.3)]" /> : <ChevronRight className="h-3.5 w-3.5 text-[rgba(255,255,255,0.3)]" />}
                            <h3 className="text-sm font-medium text-[rgba(255,255,255,0.7)]">{section.title}</h3>
                            {secDone && <CheckCircle2 className="h-3.5 w-3.5 text-[#00C9A7]" />}
                          </div>
                          <span className="text-xs text-[rgba(255,255,255,0.3)]">{secStats.done}/{secStats.total}</span>
                        </button>

                        {secExpanded && (
                          <div className="pb-1">
                            {visibleItems.map((item) => {
                              const isCustom = !!(item as { isCustom?: boolean }).isCustom;
                              const isEditing = editingId === item.id;

                              return (
                                <div
                                  key={item.id}
                                  className="flex items-center gap-3 px-6 py-1.5 hover:bg-[rgba(255,255,255,0.02)] transition-colors group"
                                >
                                  {/* Check toggle */}
                                  <button onClick={() => toggleItem(item.id)} className="shrink-0">
                                    {checked[item.id]
                                      ? <CheckCircle2 className="h-4 w-4 text-[#00C9A7]" />
                                      : <Circle className="h-4 w-4 text-[rgba(255,255,255,0.2)] group-hover:text-[rgba(255,255,255,0.4)]" />}
                                  </button>

                                  {/* Label / edit input */}
                                  {isEditing ? (
                                    <div className="flex items-center gap-1.5 flex-1">
                                      <input
                                        autoFocus
                                        value={editLabel}
                                        onChange={(e) => setEditLabel(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                                        className="flex-1 bg-[rgba(255,255,255,0.08)] border border-[#00C9A7]/40 rounded px-2 py-0.5 text-sm text-white focus:outline-none"
                                      />
                                      <button onClick={saveEdit} className="p-1 text-[#00C9A7] hover:opacity-80"><Check className="h-3.5 w-3.5" /></button>
                                      <button onClick={cancelEdit} className="p-1 text-[rgba(255,255,255,0.3)] hover:text-white"><X className="h-3.5 w-3.5" /></button>
                                    </div>
                                  ) : (
                                    <span className={`text-sm flex-1 ${checked[item.id] ? "text-[rgba(255,255,255,0.3)] line-through" : "text-[rgba(255,255,255,0.7)]"}`}>
                                      {item.label}
                                    </span>
                                  )}

                                  {/* Priority badge */}
                                  {item.priority && !isEditing && (
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded border ${PRIORITY_COLORS[item.priority]}`}>
                                      {item.priority}
                                    </span>
                                  )}

                                  {/* Edit/Delete actions — always visible for custom, hover-only for static */}
                                  {!isEditing && (
                                    <div className={`flex items-center gap-1 ${isCustom ? "opacity-100" : "opacity-0 group-hover:opacity-100"} transition-opacity`}>
                                      {isCustom && (
                                        <button
                                          onClick={() => startEdit(item.id, item.label)}
                                          className="p-1 text-[rgba(255,255,255,0.3)] hover:text-[#00C9A7] transition-colors"
                                          title="Edit"
                                        >
                                          <Pencil className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                      {isCustom && (
                                        <button
                                          onClick={() => deleteItem(item.id)}
                                          className="p-1 text-[rgba(255,255,255,0.3)] hover:text-[#E74C3C] transition-colors"
                                          title="Delete"
                                        >
                                          <Trash2 className="h-3.5 w-3.5" />
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Add new item row */}
                            {addingToSection === `${category.id}-${section.id}` ? (
                              <div className="flex items-center gap-3 px-6 py-1.5">
                                <Circle className="h-4 w-4 text-[rgba(255,255,255,0.2)] shrink-0" />
                                <div className="flex items-center gap-1.5 flex-1">
                                  <input
                                    autoFocus
                                    value={newItemLabel}
                                    onChange={(e) => setNewItemLabel(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter") saveAdd(category.id, section.id);
                                      if (e.key === "Escape") setAddingToSection(null);
                                    }}
                                    placeholder="New item..."
                                    className="flex-1 bg-[rgba(255,255,255,0.08)] border border-[#00C9A7]/40 rounded px-2 py-0.5 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none"
                                  />
                                  <button onClick={() => saveAdd(category.id, section.id)} className="p-1 text-[#00C9A7] hover:opacity-80"><Check className="h-3.5 w-3.5" /></button>
                                  <button onClick={() => setAddingToSection(null)} className="p-1 text-[rgba(255,255,255,0.3)] hover:text-white"><X className="h-3.5 w-3.5" /></button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={() => startAdd(`${category.id}-${section.id}`)}
                                className="flex items-center gap-2 px-6 py-1.5 text-[rgba(255,255,255,0.25)] hover:text-[#00C9A7] text-xs transition-colors w-full text-left"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Add item
                              </button>
                            )}
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

      <div className="mt-6 mb-8 text-center text-sm text-[rgba(255,255,255,0.3)]">
        {percentage === 100 ? "All checks passed!" : `${totalItems - completedCount} items remaining`}
      </div>
    </div>
  );
}
