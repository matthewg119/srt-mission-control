"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search,
  Plus,
  Edit3,
  Trash2,
  X,
  Upload,
  Eye,
  EyeOff,
} from "lucide-react";
import { formatDate, truncate } from "@/lib/utils";
import type {
  CoachingCategory,
  CoachingPlaybookEntry,
} from "@/types/coaching";

interface FormState {
  trigger: string;
  category: string;
  suggestions: string; // textarea, one per line
  context: string;
}

const EMPTY_FORM: FormState = {
  trigger: "",
  category: "",
  suggestions: "",
  context: "",
};

export function PlaybookManager() {
  const [entries, setEntries] = useState<CoachingPlaybookEntry[]>([]);
  const [categories, setCategories] = useState<CoachingCategory[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [showInactive, setShowInactive] = useState(false);
  const [loading, setLoading] = useState(true);

  const [showDialog, setShowDialog] = useState(false);
  const [editingEntry, setEditingEntry] =
    useState<CoachingPlaybookEntry | null>(null);
  const [formData, setFormData] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [showImport, setShowImport] = useState(false);
  const [importText, setImportText] = useState("");
  const [importing, setImporting] = useState(false);

  const categoryColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    categories.forEach((c) => {
      map[c.name] = c.color;
    });
    return map;
  }, [categories]);

  const fetchCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/coaching-studio/categories");
      const data = await res.json();
      setCategories(data.categories || []);
    } catch {
      setCategories([]);
    }
  }, []);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (activeCategory !== "All") params.set("category", activeCategory);
    if (showInactive) params.set("includeInactive", "true");
    try {
      const res = await fetch(`/api/coaching-studio/playbook?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, [search, activeCategory, showInactive]);

  useEffect(() => {
    fetchCategories();
  }, [fetchCategories]);

  useEffect(() => {
    const timer = setTimeout(fetchEntries, 250);
    return () => clearTimeout(timer);
  }, [fetchEntries]);

  const openCreate = () => {
    setEditingEntry(null);
    setFormData({
      ...EMPTY_FORM,
      category: categories[0]?.name || "discovery",
    });
    setShowDialog(true);
  };

  const openEdit = (entry: CoachingPlaybookEntry) => {
    setEditingEntry(entry);
    setFormData({
      trigger: entry.trigger,
      category: entry.category,
      suggestions: (entry.suggestions || []).join("\n"),
      context: entry.context || "",
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    if (!formData.trigger.trim() || !formData.category.trim()) return;
    setSaving(true);
    const body = {
      trigger: formData.trigger.trim(),
      category: formData.category,
      suggestions: formData.suggestions
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
      context: formData.context.trim() || null,
      ...(editingEntry ? { id: editingEntry.id } : {}),
    };
    try {
      await fetch("/api/coaching-studio/playbook", {
        method: editingEntry ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowDialog(false);
      fetchEntries();
    } catch {
      // swallow — user sees no update, can retry
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Deactivate this playbook entry?")) return;
    await fetch(`/api/coaching-studio/playbook?id=${id}`, { method: "DELETE" });
    fetchEntries();
  };

  const handleToggleActive = async (entry: CoachingPlaybookEntry) => {
    await fetch("/api/coaching-studio/playbook", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: entry.id, is_active: !entry.is_active }),
    });
    fetchEntries();
  };

  const handleImport = async () => {
    setImporting(true);
    try {
      const parsed = JSON.parse(importText);
      const res = await fetch("/api/coaching-studio/playbook/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          Array.isArray(parsed) ? { entries: parsed } : parsed
        ),
      });
      const result = await res.json();
      if (!res.ok) {
        alert(result.error || "Import failed");
      } else {
        alert(`Imported ${result.imported} entries`);
        setShowImport(false);
        setImportText("");
        fetchEntries();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Invalid JSON");
    }
    setImporting(false);
  };

  const filterPills = ["All", ...categories.map((c) => c.name)];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Playbook</h2>
          <p className="text-sm text-[rgba(255,255,255,0.4)] mt-1">
            Triggers and suggestions the live call coach uses in real time.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 px-3 py-2 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white rounded-lg text-sm hover:bg-[rgba(255,255,255,0.08)]"
          >
            <Upload size={14} />
            Import JSON
          </button>
          <button
            onClick={openCreate}
            className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0a0a0a] rounded-lg font-semibold text-sm hover:opacity-90"
          >
            <Plus size={16} />
            New Entry
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search
          size={16}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]"
        />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search triggers, context..."
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
        />
      </div>

      {/* Filter pills + inactive toggle */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        <div className="flex gap-2 overflow-x-auto pb-2 flex-1">
          {filterPills.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                activeCategory === cat
                  ? "bg-[#00C9A7] text-[#0a0a0a]"
                  : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowInactive((v) => !v)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
            showInactive
              ? "bg-[rgba(255,255,255,0.1)] text-white"
              : "bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.4)] hover:text-white"
          }`}
        >
          {showInactive ? <Eye size={12} /> : <EyeOff size={12} />}
          {showInactive ? "Showing inactive" : "Hide inactive"}
        </button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 animate-pulse h-48"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <p className="text-lg mb-2">No playbook entries</p>
          <p className="text-sm">
            Create your first entry or import existing ones.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 card-hover ${
                !entry.is_active ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-start justify-between mb-3">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                  style={{
                    backgroundColor:
                      categoryColorMap[entry.category] || "#0E8C77",
                  }}
                >
                  {entry.category}
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => handleToggleActive(entry)}
                    className="p-1 text-[rgba(255,255,255,0.3)] hover:text-white"
                    title={entry.is_active ? "Deactivate" : "Activate"}
                  >
                    {entry.is_active ? <Eye size={14} /> : <EyeOff size={14} />}
                  </button>
                  <button
                    onClick={() => openEdit(entry)}
                    className="p-1 text-[rgba(255,255,255,0.3)] hover:text-white"
                  >
                    <Edit3 size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(entry.id)}
                    className="p-1 text-[rgba(255,255,255,0.3)] hover:text-[#E74C3C]"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-white mb-2">
                &ldquo;{entry.trigger}&rdquo;
              </h3>
              {entry.context && (
                <p className="text-xs text-[rgba(255,255,255,0.4)] mb-3 leading-relaxed">
                  {truncate(entry.context, 100)}
                </p>
              )}
              <div className="space-y-1.5 mb-3">
                {(entry.suggestions || []).slice(0, 2).map((s, i) => (
                  <div
                    key={i}
                    className="text-xs text-[rgba(255,255,255,0.7)] bg-[rgba(0,201,167,0.05)] border-l-2 border-[#00C9A7] pl-2 py-1"
                  >
                    {truncate(s, 120)}
                  </div>
                ))}
                {(entry.suggestions || []).length > 2 && (
                  <p className="text-[10px] text-[rgba(255,255,255,0.3)] pl-2">
                    +{entry.suggestions.length - 2} more
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-[rgba(255,255,255,0.05)]">
                <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                  {entry.source}
                </span>
                <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                  {formatDate(entry.updated_at)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/edit dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#111111] border border-[rgba(255,255,255,0.1)] rounded-xl p-6 w-full max-w-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {editingEntry ? "Edit Entry" : "New Playbook Entry"}
              </h2>
              <button
                onClick={() => setShowDialog(false)}
                className="text-[rgba(255,255,255,0.4)] hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">
                  Trigger <span className="text-[#E74C3C]">*</span>
                </label>
                <input
                  value={formData.trigger}
                  onChange={(e) =>
                    setFormData({ ...formData, trigger: e.target.value })
                  }
                  placeholder='e.g. "too expensive" or "need to think about it"'
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
                />
                <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-1">
                  The phrase or keyword the merchant says that should fire this
                  entry.
                </p>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">
                  Category <span className="text-[#E74C3C]">*</span>
                </label>
                <select
                  value={formData.category}
                  onChange={(e) =>
                    setFormData({ ...formData, category: e.target.value })
                  }
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                >
                  {categories.map((cat) => (
                    <option
                      key={cat.id}
                      value={cat.name}
                      className="bg-[#111111]"
                    >
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">
                  Suggestions (one per line)
                </label>
                <textarea
                  value={formData.suggestions}
                  onChange={(e) =>
                    setFormData({ ...formData, suggestions: e.target.value })
                  }
                  rows={6}
                  placeholder={
                    "I hear you — and before we talk price, what were you hoping to do with the capital?\nTotally fair. Let me ask you this — what was the original reason you were looking at funding?"
                  }
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none font-mono leading-relaxed"
                />
                <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-1">
                  What the rep should say out loud. The AI will pick the best
                  one for the moment.
                </p>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">
                  Context (optional)
                </label>
                <textarea
                  value={formData.context}
                  onChange={(e) =>
                    setFormData({ ...formData, context: e.target.value })
                  }
                  rows={2}
                  placeholder="When/why to use this"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  onClick={() => setShowDialog(false)}
                  className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={
                    saving || !formData.trigger.trim() || !formData.category
                  }
                  className="px-4 py-2 bg-[#00C9A7] text-[#0a0a0a] rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : editingEntry ? "Update" : "Create"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Import dialog */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#111111] border border-[rgba(255,255,255,0.1)] rounded-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                Import Playbook JSON
              </h2>
              <button
                onClick={() => setShowImport(false)}
                className="text-[rgba(255,255,255,0.4)] hover:text-white"
              >
                <X size={20} />
              </button>
            </div>
            <p className="text-xs text-[rgba(255,255,255,0.5)] mb-3">
              Paste a JSON array of entries with fields: trigger, category,
              suggestions (array), context, source.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={16}
              placeholder={`[\n  {\n    "trigger": "too expensive",\n    "category": "objection_discovery",\n    "suggestions": ["..."],\n    "context": "price objection"\n  }\n]`}
              className="w-full bg-[rgba(0,0,0,0.3)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-xs text-white font-mono placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
            />
            <div className="flex gap-2 justify-end mt-4">
              <button
                onClick={() => setShowImport(false)}
                className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={importing || !importText.trim()}
                className="px-4 py-2 bg-[#00C9A7] text-[#0a0a0a] rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-50"
              >
                {importing ? "Importing..." : "Import"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
