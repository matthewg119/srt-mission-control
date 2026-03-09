"use client";

import { useState, useRef, useCallback } from "react";
import {
  RefreshCw, Plus, Upload, Download, LayoutGrid, List,
  Search, X, ChevronDown, Loader2,
} from "lucide-react";
import Link from "next/link";
import { NEW_DEALS_PIPELINE, ACTIVE_DEALS_PIPELINE } from "@/config/pipeline";
import { formatCurrency } from "@/lib/utils";

interface Deal {
  id: string;
  contact_name: string;
  business_name: string;
  stage: string;
  pipeline?: string;
  amount: number | null;
  assigned_to: string | null;
  last_activity: string | null;
  updated_at: string;
}

interface PipelineBoardProps {
  initialDeals: Deal[];
}

const PIPELINE_TABS = [
  { key: "active", label: "Active Deals", pipeline: ACTIVE_DEALS_PIPELINE },
  { key: "new", label: "New Deals", pipeline: NEW_DEALS_PIPELINE },
] as const;

const ASSIGNEES = ["Matthew", "Benjamin", ""];

// ── New Lead Modal ──────────────────────────────────────────────────────────

function NewLeadModal({ onClose, onCreated }: { onClose: () => void; onCreated: (deal: Deal) => void }) {
  const [form, setForm] = useState({
    first_name: "", last_name: "", business_name: "", email: "",
    phone: "", amount: "", pipeline: "New Deals", stage: "Open - Not Contacted",
    assigned_to: "Matthew",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const pipelineStages =
    form.pipeline === "New Deals"
      ? NEW_DEALS_PIPELINE.stages
      : ACTIVE_DEALS_PIPELINE.stages;

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.first_name.trim()) { setError("First name is required"); return; }
    setSaving(true);
    setError("");
    try {
      // 1. Create contact
      const contactRes = await fetch("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          first_name: form.first_name.trim(),
          last_name: form.last_name.trim() || null,
          email: form.email.trim() || null,
          phone: form.phone.trim() || null,
          business_name: form.business_name.trim() || null,
          source: "Manual",
        }),
      });
      const contactData = await contactRes.json();
      if (!contactRes.ok) throw new Error(contactData.error || "Failed to create contact");

      // 2. Create deal
      const dealRes = await fetch("/api/deals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contactData.contact.id,
          pipeline: form.pipeline,
          stage: form.stage,
          amount: form.amount ? parseFloat(form.amount.replace(/,/g, "")) : 0,
          assigned_to: form.assigned_to || null,
          source: "Manual",
        }),
      });
      const dealData = await dealRes.json();
      if (!dealRes.ok) throw new Error(dealData.error || "Failed to create deal");

      const c = contactData.contact;
      onCreated({
        id: dealData.deal.id,
        contact_name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
        business_name: c.business_name || "",
        stage: dealData.deal.stage,
        pipeline: dealData.deal.pipeline,
        amount: dealData.deal.amount,
        assigned_to: dealData.deal.assigned_to,
        last_activity: dealData.deal.updated_at,
        updated_at: dealData.deal.updated_at,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  };

  const INPUT = "w-full bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#00C9A7]";
  const LABEL = "block text-xs text-[rgba(255,255,255,0.5)] mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-[#0B1426] border border-[rgba(255,255,255,0.1)] rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <h2 className="text-lg font-bold text-white">Add New Lead</h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>First Name *</label>
              <input className={INPUT} value={form.first_name} onChange={(e) => set("first_name", e.target.value)} placeholder="John" />
            </div>
            <div>
              <label className={LABEL}>Last Name</label>
              <input className={INPUT} value={form.last_name} onChange={(e) => set("last_name", e.target.value)} placeholder="Smith" />
            </div>
          </div>
          <div>
            <label className={LABEL}>Business Name</label>
            <input className={INPUT} value={form.business_name} onChange={(e) => set("business_name", e.target.value)} placeholder="Acme Corp" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Email</label>
              <input className={INPUT} type="email" value={form.email} onChange={(e) => set("email", e.target.value)} placeholder="john@acme.com" />
            </div>
            <div>
              <label className={LABEL}>Phone</label>
              <input className={INPUT} value={form.phone} onChange={(e) => set("phone", e.target.value)} placeholder="(818) 000-0000" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Pipeline</label>
              <select
                className={INPUT}
                value={form.pipeline}
                onChange={(e) => {
                  const p = e.target.value;
                  const firstStage = p === "New Deals"
                    ? NEW_DEALS_PIPELINE.stages[0].name
                    : ACTIVE_DEALS_PIPELINE.stages[0].name;
                  setForm((prev) => ({ ...prev, pipeline: p, stage: firstStage }));
                }}
              >
                <option>New Deals</option>
                <option>Active Deals</option>
              </select>
            </div>
            <div>
              <label className={LABEL}>Stage</label>
              <select className={INPUT} value={form.stage} onChange={(e) => set("stage", e.target.value)}>
                {pipelineStages.map((s) => (
                  <option key={s.name}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Amount Requested ($)</label>
              <input className={INPUT} value={form.amount} onChange={(e) => set("amount", e.target.value)} placeholder="50,000" />
            </div>
            <div>
              <label className={LABEL}>Assigned To</label>
              <select className={INPUT} value={form.assigned_to} onChange={(e) => set("assigned_to", e.target.value)}>
                {ASSIGNEES.map((a) => (
                  <option key={a} value={a}>{a || "Unassigned"}</option>
                ))}
              </select>
            </div>
          </div>
          {error && <p className="text-[#E74C3C] text-xs">{error}</p>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white transition-colors">
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-sm font-semibold bg-[#00C9A7] text-[#0B1426] rounded-lg hover:bg-[#00b396] disabled:opacity-60 transition-colors flex items-center gap-2"
            >
              {saving && <Loader2 size={14} className="animate-spin" />}
              {saving ? "Creating..." : "Create Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Import CSV Modal ────────────────────────────────────────────────────────

interface CsvRow {
  first_name: string;
  last_name: string;
  business_name: string;
  email: string;
  phone: string;
  amount: string;
  pipeline: string;
  stage: string;
}

function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CsvRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const parseCSV = (text: string): CsvRow[] => {
    const lines = text.trim().split("\n").filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z_]/g, ""));
    return lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
      const obj: Record<string, string> = {};
      headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
      return {
        first_name: obj.first_name || obj.firstname || obj.first || "",
        last_name: obj.last_name || obj.lastname || obj.last || "",
        business_name: obj.business_name || obj.business || obj.company || "",
        email: obj.email || "",
        phone: obj.phone || obj.mobile || obj.cell || "",
        amount: obj.amount || obj.funding_amount || "",
        pipeline: obj.pipeline || "New Deals",
        stage: obj.stage || "Open - Not Contacted",
      } as CsvRow;
    }).filter((r) => r.first_name || r.business_name || r.email);
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = parseCSV(ev.target?.result as string);
        setRows(parsed);
        setError(parsed.length === 0 ? "No valid rows found. Check CSV format." : "");
      } catch {
        setError("Failed to parse CSV");
      }
    };
    reader.readAsText(file);
  };

  const BATCH_SIZE = 500;

  const handleImport = async () => {
    if (!rows.length) return;
    setImporting(true);
    setProgress(0);
    let totalCreated = 0;

    // Send in batches of 500
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE).map((r) => ({
        first_name: r.first_name || "Unknown",
        last_name: r.last_name || undefined,
        business_name: r.business_name || undefined,
        email: r.email || undefined,
        phone: r.phone || undefined,
        amount: r.amount ? parseFloat(r.amount.replace(/[$,]/g, "")) : 0,
        pipeline: r.pipeline || "New Deals",
        stage: r.stage || "Open - Not Contacted",
      }));

      try {
        const res = await fetch("/api/contacts/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rows: batch }),
        });
        const data = await res.json();
        if (res.ok) totalCreated += data.created || 0;
      } catch {
        // continue with next batch
      }

      setProgress(Math.min(i + BATCH_SIZE, rows.length));
    }

    setImporting(false);
    setDone(true);
    // Reload the page to show the new leads
    setTimeout(() => window.location.reload(), 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60">
      <div className="bg-[#0B1426] border border-[rgba(255,255,255,0.1)] rounded-2xl w-full max-w-2xl shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
          <h2 className="text-lg font-bold text-white">Import Leads (CSV)</h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">
            <X size={20} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.07)] rounded-lg p-3 text-xs text-[rgba(255,255,255,0.5)]">
            <p className="font-semibold text-[rgba(255,255,255,0.7)] mb-1">Expected CSV columns (headers, any order):</p>
            <p className="font-mono">first_name, last_name, business_name, email, phone, amount, pipeline, stage</p>
          </div>

          <div
            className="border-2 border-dashed border-[rgba(255,255,255,0.12)] rounded-xl p-8 text-center cursor-pointer hover:border-[#00C9A7]/40 transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={24} className="mx-auto mb-2 text-[rgba(255,255,255,0.3)]" />
            <p className="text-sm text-[rgba(255,255,255,0.5)]">Click to choose a CSV file</p>
            <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleFile} />
          </div>

          {error && <p className="text-[#E74C3C] text-xs">{error}</p>}

          {rows.length > 0 && !done && (
            <>
              <div className="max-h-48 overflow-auto border border-[rgba(255,255,255,0.08)] rounded-lg">
                <table className="w-full text-xs text-[rgba(255,255,255,0.7)]">
                  <thead>
                    <tr className="border-b border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.03)]">
                      {["Name", "Business", "Email", "Phone", "Pipeline", "Stage"].map((h) => (
                        <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i} className="border-b border-[rgba(255,255,255,0.05)]">
                        <td className="px-3 py-1.5">{`${r.first_name} ${r.last_name}`.trim() || "—"}</td>
                        <td className="px-3 py-1.5">{r.business_name || "—"}</td>
                        <td className="px-3 py-1.5">{r.email || "—"}</td>
                        <td className="px-3 py-1.5">{r.phone || "—"}</td>
                        <td className="px-3 py-1.5">{r.pipeline}</td>
                        <td className="px-3 py-1.5">{r.stage}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-[rgba(255,255,255,0.4)]">{rows.length} rows ready to import</p>
            </>
          )}

          {importing && (
            <div className="space-y-2">
              <div className="h-2 bg-[rgba(255,255,255,0.08)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#00C9A7] transition-all"
                  style={{ width: `${Math.round((progress / rows.length) * 100)}%` }}
                />
              </div>
              <p className="text-xs text-[rgba(255,255,255,0.5)] text-center">
                Importing {progress} / {rows.length}...
              </p>
            </div>
          )}

          {done && (
            <p className="text-center text-[#00C9A7] text-sm font-semibold">
              Import complete! Reloading pipeline...
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white transition-colors">
              {done ? "Close" : "Cancel"}
            </button>
            {!done && (
              <button
                onClick={handleImport}
                disabled={rows.length === 0 || importing}
                className="px-5 py-2 text-sm font-semibold bg-[#00C9A7] text-[#0B1426] rounded-lg hover:bg-[#00b396] disabled:opacity-60 transition-colors flex items-center gap-2"
              >
                {importing && <Loader2 size={14} className="animate-spin" />}
                Import {rows.length > 0 ? `${rows.length} Leads` : ""}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Pipeline Board ──────────────────────────────────────────────────────────

export function PipelineBoard({ initialDeals }: PipelineBoardProps) {
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [activeTab, setActiveTab] = useState<"active" | "new">("active");
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [search, setSearch] = useState("");
  const [filterStage, setFilterStage] = useState("");
  const [filterAssigned, setFilterAssigned] = useState("");
  const [showNewModal, setShowNewModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);

  const currentPipeline = PIPELINE_TABS.find((t) => t.key === activeTab)!.pipeline;

  // Pipeline filter
  const pipelineDeals = deals.filter((d) => {
    if (d.pipeline) return d.pipeline === currentPipeline.name;
    return currentPipeline.stages.some((s) => s.name === d.stage);
  });

  // Apply search + filters
  const filteredDeals = pipelineDeals.filter((d) => {
    const q = search.toLowerCase();
    if (q && !d.contact_name.toLowerCase().includes(q) && !d.business_name.toLowerCase().includes(q)) return false;
    if (filterStage && d.stage !== filterStage) return false;
    if (filterAssigned && d.assigned_to !== filterAssigned) return false;
    return true;
  });

  const getDaysInStage = (lastActivity: string | null): number => {
    if (!lastActivity) return 0;
    return Math.floor((Date.now() - new Date(lastActivity).getTime()) / (1000 * 60 * 60 * 24));
  };

  // Export CSV
  const handleExport = useCallback(() => {
    const headers = ["Business Name", "Contact Name", "Stage", "Pipeline", "Amount", "Assigned To", "Days in Stage", "Updated At"];
    const rows = filteredDeals.map((d) => [
      d.business_name || "",
      d.contact_name || "",
      d.stage,
      d.pipeline || "",
      d.amount ? String(d.amount) : "0",
      d.assigned_to || "",
      String(getDaysInStage(d.last_activity)),
      d.updated_at ? new Date(d.updated_at).toLocaleDateString() : "",
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${currentPipeline.name.replace(" ", "-").toLowerCase()}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [filteredDeals, currentPipeline.name]);

  const newDealsCount = deals.filter((d) => d.pipeline === NEW_DEALS_PIPELINE.name || (!d.pipeline && NEW_DEALS_PIPELINE.stages.some((s) => s.name === d.stage))).length;
  const activeDealsCount = deals.filter((d) => d.pipeline === ACTIVE_DEALS_PIPELINE.name || (!d.pipeline && ACTIVE_DEALS_PIPELINE.stages.some((s) => s.name === d.stage))).length;

  const hasFilters = search || filterStage || filterAssigned;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-2xl font-bold text-white">Pipeline</h1>
        <div className="flex items-center gap-2">
          {/* View Toggle */}
          <div className="flex bg-[rgba(255,255,255,0.06)] rounded-lg p-0.5">
            <button
              onClick={() => setView("kanban")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${view === "kanban" ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
            >
              <LayoutGrid size={13} /> Board
            </button>
            <button
              onClick={() => setView("list")}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center gap-1.5 ${view === "list" ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
            >
              <List size={13} /> List
            </button>
          </div>

          <button
            onClick={() => setShowImportModal(true)}
            className="flex items-center gap-1.5 px-3 py-2 bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] rounded-lg text-xs hover:bg-[rgba(255,255,255,0.1)] hover:text-white transition-colors"
          >
            <Upload size={13} /> Import
          </button>

          <button
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] rounded-lg text-xs hover:bg-[rgba(255,255,255,0.1)] hover:text-white transition-colors"
          >
            <Download size={13} /> Export
          </button>

          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 px-3 py-2 bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.7)] rounded-lg text-xs hover:bg-[rgba(255,255,255,0.1)] hover:text-white transition-colors"
          >
            <RefreshCw size={13} />
          </button>

          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:bg-[#00b396] transition-colors"
          >
            <Plus size={16} /> Add Lead
          </button>
        </div>
      </div>

      {/* Pipeline Tabs + Filters Row */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Pipeline Tabs */}
        <div className="flex gap-2">
          {PIPELINE_TABS.map((tab) => {
            const count = tab.key === "active" ? activeDealsCount : newDealsCount;
            return (
              <button
                key={tab.key}
                onClick={() => { setActiveTab(tab.key); setFilterStage(""); }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab.key
                    ? "bg-[#00C9A7] text-[#0B1426]"
                    : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.08)]"
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className={`ml-2 text-xs px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.key ? "bg-[#0B1426]/20 text-[#0B1426]" : "bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)]"
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Search */}
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search name or business..."
            className="pl-8 pr-3 py-2 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[rgba(255,255,255,0.2)] w-52"
          />
        </div>

        {/* Stage Filter */}
        <div className="relative">
          <select
            value={filterStage}
            onChange={(e) => setFilterStage(e.target.value)}
            className="appearance-none pl-3 pr-7 py-2 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs text-[rgba(255,255,255,0.7)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
          >
            <option value="">All Stages</option>
            {currentPipeline.stages.map((s) => (
              <option key={s.name} value={s.name}>{s.name}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] pointer-events-none" />
        </div>

        {/* Assigned Filter */}
        <div className="relative">
          <select
            value={filterAssigned}
            onChange={(e) => setFilterAssigned(e.target.value)}
            className="appearance-none pl-3 pr-7 py-2 bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.08)] rounded-lg text-xs text-[rgba(255,255,255,0.7)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
          >
            <option value="">All Assignees</option>
            {ASSIGNEES.filter(Boolean).map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
          <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)] pointer-events-none" />
        </div>

        {hasFilters && (
          <button
            onClick={() => { setSearch(""); setFilterStage(""); setFilterAssigned(""); }}
            className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white transition-colors flex items-center gap-1"
          >
            <X size={11} /> Clear
          </button>
        )}
      </div>

      {/* Count indicator */}
      <div className="mb-4 text-xs text-[rgba(255,255,255,0.3)]">
        {filteredDeals.length} deal{filteredDeals.length !== 1 ? "s" : ""}
        {hasFilters && " (filtered)"}
      </div>

      {/* ── KANBAN VIEW ── */}
      {view === "kanban" && (
        <div className="flex gap-4 overflow-x-auto pb-4" style={{ minHeight: "calc(100vh - 340px)" }}>
          {currentPipeline.stages.map((stage) => {
            const stageDeals = filteredDeals.filter((d) => d.stage === stage.name);
            return (
              <div key={stage.name} className="flex-shrink-0 w-[260px]">
                <div
                  className="rounded-t-lg px-3 py-2 mb-2"
                  style={{ borderTop: `3px solid ${stage.color}`, background: "rgba(255,255,255,0.03)" }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-white">{stage.name}</span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: stage.color }}>
                      {stageDeals.length}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  {stageDeals.length === 0 ? (
                    <div className="text-center py-8 text-[rgba(255,255,255,0.15)] text-xs">Empty</div>
                  ) : (
                    stageDeals.map((deal) => {
                      const days = getDaysInStage(deal.last_activity);
                      return (
                        <Link
                          key={deal.id}
                          href={`/dashboard/deals/${deal.id}`}
                          className="block bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 hover:border-[rgba(255,255,255,0.15)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                        >
                          <p className="font-semibold text-white text-sm mb-0.5 truncate">
                            {deal.business_name || "Unknown Business"}
                          </p>
                          <p className="text-xs text-[rgba(255,255,255,0.4)] mb-2 truncate">
                            {deal.contact_name || "No contact"}
                          </p>
                          <div className="flex items-center justify-between">
                            <span className="font-mono text-sm text-[#00C9A7]">
                              {deal.amount ? formatCurrency(Number(deal.amount)) : "—"}
                            </span>
                            <div className="flex items-center gap-1.5">
                              {days > 0 && (
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                                  days > 7 ? "bg-[#E74C3C]/20 text-[#E74C3C]" :
                                  days > 3 ? "bg-[#F5A623]/20 text-[#F5A623]" :
                                  "bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)]"
                                }`}>
                                  {days}d
                                </span>
                              )}
                              {deal.assigned_to && (
                                <div className="w-5 h-5 rounded-full bg-[#1B65A7] flex items-center justify-center text-[8px] font-bold text-white">
                                  {deal.assigned_to.charAt(0).toUpperCase()}
                                </div>
                              )}
                            </div>
                          </div>
                        </Link>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {view === "list" && (
        <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.07)] rounded-xl overflow-hidden">
          {filteredDeals.length === 0 ? (
            <div className="text-center py-16 text-[rgba(255,255,255,0.3)] text-sm">No deals found</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)]">
                  {["Business", "Contact", "Stage", "Amount", "Assigned", "Age"].map((h) => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredDeals.map((deal, idx) => {
                  const days = getDaysInStage(deal.last_activity);
                  const stageColor = currentPipeline.stages.find((s) => s.name === deal.stage)?.color || "#666";
                  return (
                    <tr
                      key={deal.id}
                      className={`border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.04)] transition-colors ${idx % 2 === 0 ? "" : "bg-[rgba(255,255,255,0.01)]"}`}
                    >
                      <td className="px-4 py-3">
                        <Link href={`/dashboard/deals/${deal.id}`} className="text-sm font-semibold text-white hover:text-[#00C9A7] transition-colors">
                          {deal.business_name || "Unknown Business"}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-sm text-[rgba(255,255,255,0.5)]">
                        {deal.contact_name || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className="text-xs px-2 py-0.5 rounded-full font-medium"
                          style={{ backgroundColor: `${stageColor}22`, color: stageColor }}
                        >
                          {deal.stage}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-sm text-[#00C9A7]">
                        {deal.amount ? formatCurrency(Number(deal.amount)) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        {deal.assigned_to ? (
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-[#1B65A7] flex items-center justify-center text-[9px] font-bold text-white">
                              {deal.assigned_to.charAt(0).toUpperCase()}
                            </div>
                            <span className="text-xs text-[rgba(255,255,255,0.5)]">{deal.assigned_to}</span>
                          </div>
                        ) : (
                          <span className="text-xs text-[rgba(255,255,255,0.2)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {days > 0 ? (
                          <span className={`text-xs font-mono px-2 py-0.5 rounded ${
                            days > 7 ? "bg-[#E74C3C]/15 text-[#E74C3C]" :
                            days > 3 ? "bg-[#F5A623]/15 text-[#F5A623]" :
                            "text-[rgba(255,255,255,0.3)]"
                          }`}>
                            {days}d
                          </span>
                        ) : (
                          <span className="text-xs text-[rgba(255,255,255,0.2)]">Today</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Empty state */}
      {deals.length === 0 && (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <p className="text-lg mb-2">No deals yet</p>
          <p className="text-sm mb-6">Add your first lead or import a CSV to get started.</p>
          <button
            onClick={() => setShowNewModal(true)}
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:bg-[#00b396] transition-colors"
          >
            <Plus size={16} /> Add First Lead
          </button>
        </div>
      )}

      {/* Modals */}
      {showNewModal && (
        <NewLeadModal
          onClose={() => setShowNewModal(false)}
          onCreated={(deal) => setDeals((prev) => [deal, ...prev])}
        />
      )}
      {showImportModal && (
        <ImportModal
          onClose={() => setShowImportModal(false)}
          onImported={() => window.location.reload()}
        />
      )}
    </div>
  );
}
