"use client";

import { useState, useEffect } from "react";
import { Plus, Mail, MessageSquare, Search, Zap } from "lucide-react";
import { TemplateEditor } from "@/components/template-editor";

interface Template {
  id: string;
  name: string;
  slug: string;
  type: "SMS" | "Email";
  category: string;
  subject: string | null;
  body: string;
  variables: string[];
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<"all" | "SMS" | "Email">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showEditor, setShowEditor] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const fetchTemplates = async () => {
    try {
      const res = await fetch("/api/templates");
      const data = await res.json();
      setTemplates(data.templates || []);
    } catch {
      setTemplates([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchTemplates(); }, []);

  const handleSeed = async () => {
    setSeeding(true);
    try {
      const res = await fetch("/api/templates/seed", { method: "POST" });
      const data = await res.json();
      if (data.seeded > 0) {
        fetchTemplates();
      }
    } catch {
      // Error
    }
    setSeeding(false);
  };

  const handleSave = async (template: { id?: string; name: string; slug: string; type: "SMS" | "Email"; category: string; subject: string | null; body: string; variables: string[] }) => {
    try {
      const method = template.id ? "PUT" : "POST";
      const res = await fetch("/api/templates", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(template),
      });
      if (res.ok) {
        fetchTemplates();
        setShowEditor(false);
        setEditingTemplate(null);
      }
    } catch {
      // Error
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this template?")) return;
    try {
      const res = await fetch(`/api/templates?id=${id}`, { method: "DELETE" });
      if (res.ok) fetchTemplates();
    } catch {
      // Error
    }
  };

  const handleToggleActive = async (template: Template) => {
    try {
      await fetch("/api/templates", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: template.id, is_active: !template.is_active }),
      });
      fetchTemplates();
    } catch {
      // Error
    }
  };

  // Filtering
  const filtered = templates.filter((t) => {
    if (filterType !== "all" && t.type !== filterType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return (
        t.name.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q) ||
        t.body.toLowerCase().includes(q)
      );
    }
    return true;
  });

  // Group by category
  const categories = [...new Set(filtered.map((t) => t.category))];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Templates</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            SMS & Email templates for every pipeline stage
          </p>
        </div>
        <div className="flex items-center gap-2">
          {templates.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 px-4 py-2 bg-[rgba(255,255,255,0.08)] text-white rounded-lg text-sm hover:bg-[rgba(255,255,255,0.12)] disabled:opacity-50 transition-colors"
            >
              <Zap size={14} />
              {seeding ? "Seeding..." : "Seed Default Templates"}
            </button>
          )}
          <button
            onClick={() => { setEditingTemplate(null); setShowEditor(true); }}
            className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={14} />
            New Template
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex gap-1 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-1">
          {(["all", "SMS", "Email"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filterType === t
                  ? "bg-[rgba(255,255,255,0.1)] text-white"
                  : "text-[rgba(255,255,255,0.4)] hover:text-white"
              }`}
            >
              {t === "all" ? "All" : t}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search templates..."
            className="w-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
          />
        </div>
        <div className="text-xs text-[rgba(255,255,255,0.4)]">
          {filtered.length} template{filtered.length !== 1 ? "s" : ""}
        </div>
      </div>

      {/* Template List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      ) : templates.length === 0 ? (
        <div className="text-center py-16 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl">
          <MessageSquare size={40} className="mx-auto text-[rgba(255,255,255,0.2)] mb-4" />
          <p className="text-lg text-[rgba(255,255,255,0.4)] mb-2">No templates yet</p>
          <p className="text-sm text-[rgba(255,255,255,0.3)] mb-4">
            Seed 18 professional templates or create your own
          </p>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
          >
            {seeding ? "Seeding..." : "Seed Default Templates"}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {categories.map((cat) => {
            const catTemplates = filtered.filter((t) => t.category === cat);
            return (
              <div key={cat}>
                <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.6)] mb-3 uppercase tracking-wider">
                  {cat}
                </h3>
                <div className="space-y-2">
                  {catTemplates.map((template) => (
                    <div
                      key={template.id}
                      className={`bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 card-hover ${
                        !template.is_active ? "opacity-50" : ""
                      }`}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 flex-1 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                            template.type === "SMS"
                              ? "bg-[#00C9A7]/10 text-[#00C9A7]"
                              : "bg-[#1B65A7]/10 text-[#1B65A7]"
                          }`}>
                            {template.type === "SMS" ? <MessageSquare size={16} /> : <Mail size={16} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <p className="font-semibold text-white text-sm">{template.name}</p>
                              <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                template.type === "SMS"
                                  ? "bg-[#00C9A7]/10 text-[#00C9A7]"
                                  : "bg-[#1B65A7]/10 text-[#1B65A7]"
                              }`}>
                                {template.type}
                              </span>
                            </div>
                            {template.subject && (
                              <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5">
                                Subject: {template.subject}
                              </p>
                            )}
                            <p className="text-xs text-[rgba(255,255,255,0.3)] mt-1 truncate">
                              {template.body.slice(0, 120)}...
                            </p>
                            {template.variables.length > 0 && (
                              <div className="flex flex-wrap gap-1 mt-2">
                                {template.variables.map((v) => (
                                  <span key={v} className="text-[9px] px-1.5 py-0.5 bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] rounded font-mono">
                                    {`{{${v}}}`}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 ml-4">
                          <button
                            onClick={() => handleToggleActive(template)}
                            className={`text-[10px] px-2 py-1 rounded ${
                              template.is_active
                                ? "bg-[#00C9A7]/10 text-[#00C9A7]"
                                : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)]"
                            }`}
                          >
                            {template.is_active ? "Active" : "Inactive"}
                          </button>
                          <button
                            onClick={() => { setEditingTemplate(template); setShowEditor(true); }}
                            className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDelete(template.id)}
                            className="text-xs text-[rgba(255,255,255,0.3)] hover:text-[#E74C3C] transition-colors"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Editor Modal */}
      {showEditor && (
        <TemplateEditor
          template={editingTemplate}
          onSave={handleSave}
          onClose={() => { setShowEditor(false); setEditingTemplate(null); }}
        />
      )}
    </div>
  );
}
