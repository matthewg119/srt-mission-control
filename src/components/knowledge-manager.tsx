"use client";

import { useState, useEffect, useCallback } from "react";
import { Search, Plus, Edit3, Trash2, X } from "lucide-react";
import { formatDate, truncate } from "@/lib/utils";

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

const CATEGORIES = ["All", "General", "Products", "SOPs", "Sales Scripts", "Marketing", "Strategy", "Pipeline"];

const CATEGORY_COLORS: Record<string, string> = {
  General: "#1B65A7",
  Products: "#00C9A7",
  SOPs: "#F5A623",
  "Sales Scripts": "#9C27B0",
  Marketing: "#FF9800",
  Strategy: "#00BCD4",
  Pipeline: "#4CAF50",
};

export function KnowledgeManager() {
  const [entries, setEntries] = useState<KnowledgeEntry[]>([]);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const [formData, setFormData] = useState({ title: "", content: "", category: "General", tags: "" });
  const [saving, setSaving] = useState(false);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (activeCategory !== "All") params.set("category", activeCategory);
    try {
      const res = await fetch(`/api/knowledge?${params}`);
      const data = await res.json();
      setEntries(data.entries || []);
    } catch {
      setEntries([]);
    }
    setLoading(false);
  }, [search, activeCategory]);

  useEffect(() => {
    const timer = setTimeout(fetchEntries, 300);
    return () => clearTimeout(timer);
  }, [fetchEntries]);

  const openCreate = () => {
    setEditingEntry(null);
    setFormData({ title: "", content: "", category: "General", tags: "" });
    setShowDialog(true);
  };

  const openEdit = (entry: KnowledgeEntry) => {
    setEditingEntry(entry);
    setFormData({
      title: entry.title,
      content: entry.content,
      category: entry.category,
      tags: entry.tags?.join(", ") || "",
    });
    setShowDialog(true);
  };

  const handleSave = async () => {
    setSaving(true);
    const body = {
      ...formData,
      tags: formData.tags.split(",").map((t) => t.trim()).filter(Boolean),
      ...(editingEntry ? { id: editingEntry.id } : {}),
    };
    try {
      await fetch("/api/knowledge", {
        method: editingEntry ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setShowDialog(false);
      fetchEntries();
    } catch {
      // Error handling
    }
    setSaving(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this knowledge entry?")) return;
    await fetch("/api/knowledge", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    fetchEntries();
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-white">Knowledge Base</h1>
        <button
          onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          <Plus size={16} />
          Add Entry
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search knowledge base..."
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
        />
      </div>

      {/* Category tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              activeCategory === cat
                ? "bg-[#00C9A7] text-[#0B1426]"
                : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white"
            }`}
          >
            {cat}
          </button>
        ))}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 animate-pulse h-48" />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <p className="text-lg mb-2">No entries found</p>
          <p className="text-sm">Create your first knowledge base entry to get started.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 card-hover"
            >
              <div className="flex items-start justify-between mb-3">
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                  style={{ backgroundColor: CATEGORY_COLORS[entry.category] || "#1B65A7" }}
                >
                  {entry.category}
                </span>
                <div className="flex gap-1">
                  <button onClick={() => openEdit(entry)} className="p-1 text-[rgba(255,255,255,0.3)] hover:text-white">
                    <Edit3 size={14} />
                  </button>
                  <button onClick={() => handleDelete(entry.id)} className="p-1 text-[rgba(255,255,255,0.3)] hover:text-[#E74C3C]">
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
              <h3 className="font-semibold text-white mb-2">{entry.title}</h3>
              <p className="text-sm text-[rgba(255,255,255,0.4)] mb-3 leading-relaxed">
                {truncate(entry.content, 120)}
              </p>
              {entry.tags?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-3">
                  {entry.tags.map((tag) => (
                    <span key={tag} className="text-[10px] px-2 py-0.5 bg-[rgba(255,255,255,0.05)] rounded-full text-[rgba(255,255,255,0.4)]">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-[rgba(255,255,255,0.3)]">{formatDate(entry.updated_at)}</p>
            </div>
          ))}
        </div>
      )}

      {/* Dialog */}
      {showDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">
                {editingEntry ? "Edit Entry" : "New Entry"}
              </h2>
              <button onClick={() => setShowDialog(false)} className="text-[rgba(255,255,255,0.4)] hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Title</label>
                <input
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Category</label>
                <select
                  value={formData.category}
                  onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                >
                  {CATEGORIES.filter((c) => c !== "All").map((cat) => (
                    <option key={cat} value={cat} className="bg-[#0f1d32]">{cat}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Tags (comma-separated)</label>
                <input
                  value={formData.tags}
                  onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                  placeholder="tag1, tag2, tag3"
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
                />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Content</label>
                <textarea
                  value={formData.content}
                  onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                  rows={8}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowDialog(false)}
                  className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formData.title || !formData.content}
                  className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
