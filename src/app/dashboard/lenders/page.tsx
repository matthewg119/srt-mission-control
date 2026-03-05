"use client";

import { useState, useEffect } from "react";
import {
  Building2, Plus, Pencil, Trash2, ExternalLink, Search, X, Check, Mail, Globe, Zap,
} from "lucide-react";

interface Lender {
  id: string;
  name: string;
  submission_email: string | null;
  portal_url: string | null;
  min_monthly_revenue: number | null;
  min_time_in_business_months: number | null;
  max_negative_days: number | null;
  min_credit_score: number | null;
  max_amount: number | null;
  products: string[];
  blocked_industries: string[];
  response_time_days: number | null;
  notes: string | null;
  is_active: boolean;
  submission_method: "email" | "portal" | "both";
  tier: 1 | 2 | 3;
}

const EMPTY_FORM: Omit<Lender, "id"> = {
  name: "",
  submission_email: "",
  portal_url: "",
  min_monthly_revenue: null,
  min_time_in_business_months: null,
  max_negative_days: null,
  min_credit_score: null,
  max_amount: null,
  products: [],
  blocked_industries: [],
  response_time_days: null,
  notes: "",
  is_active: true,
  submission_method: "email",
  tier: 2,
};

const PRODUCT_OPTIONS = [
  "Working Capital", "Term Loan", "Line of Credit", "Equipment Financing",
  "Invoice Factoring", "SBA Loan", "Revenue Based",
];

const TIER_CONFIG = {
  1: { label: "Tier 1 · A Paper", color: "#4CAF50", bg: "rgba(76,175,80,0.15)", border: "rgba(76,175,80,0.3)" },
  2: { label: "Tier 2 · B Paper", color: "#F5A623", bg: "rgba(245,166,35,0.15)", border: "rgba(245,166,35,0.3)" },
  3: { label: "Tier 3 · High Risk", color: "#E74C3C", bg: "rgba(231,76,60,0.15)", border: "rgba(231,76,60,0.3)" },
};

const METHOD_ICON = {
  email: Mail,
  portal: Globe,
  both: Zap,
};

type TierFilter = "all" | 1 | 2 | 3;
type MethodFilter = "all" | "email" | "portal" | "both";

export default function LendersPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<TierFilter>("all");
  const [methodFilter, setMethodFilter] = useState<MethodFilter>("all");
  const [showModal, setShowModal] = useState(false);
  const [editLender, setEditLender] = useState<Lender | null>(null);
  const [form, setForm] = useState<Omit<Lender, "id">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/lenders");
    const data = await res.json();
    setLenders(data.lenders || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const openAdd = () => {
    setEditLender(null);
    setForm(EMPTY_FORM);
    setShowModal(true);
  };

  const openEdit = (l: Lender) => {
    setEditLender(l);
    setForm({ ...l });
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editLender) {
      await fetch("/api/lenders", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editLender.id, ...form }),
      });
    } else {
      await fetch("/api/lenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
    }
    setSaving(false);
    setShowModal(false);
    load();
  };

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this lender?")) return;
    await fetch("/api/lenders", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    load();
  };

  const handleToggleActive = async (l: Lender) => {
    await fetch("/api/lenders", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: l.id, is_active: !l.is_active }),
    });
    load();
  };

  const handleSeed = async () => {
    if (!confirm("This will add ~50 lenders to your database (skipping duplicates). Continue?")) return;
    setSeeding(true);
    await fetch("/api/lenders/seed", { method: "POST" });
    setSeeding(false);
    load();
  };

  const toggleProduct = (p: string) => {
    setForm((f) => ({
      ...f,
      products: f.products.includes(p)
        ? f.products.filter((x) => x !== p)
        : [...f.products, p],
    }));
  };

  const filtered = lenders.filter((l) => {
    if (tierFilter !== "all" && l.tier !== tierFilter) return false;
    if (methodFilter !== "all" && l.submission_method !== methodFilter) return false;
    if (search) {
      const s = search.toLowerCase();
      return l.name.toLowerCase().includes(s) || (l.submission_email || "").toLowerCase().includes(s);
    }
    return true;
  });

  const tierCounts = { all: lenders.length, 1: 0, 2: 0, 3: 0 };
  lenders.forEach((l) => { tierCounts[l.tier] = (tierCounts[l.tier] || 0) + 1; });

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(27,101,167,0.15)]">
            <Building2 className="h-5 w-5 text-[#1B65A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Lenders</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">{lenders.length} lenders · {lenders.filter((l) => l.is_active).length} active</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lenders.length === 0 && (
            <button
              onClick={handleSeed}
              disabled={seeding}
              className="flex items-center gap-2 px-4 py-2 bg-[rgba(27,101,167,0.2)] text-[#1B65A7] rounded-lg text-sm font-semibold hover:bg-[rgba(27,101,167,0.3)] transition-colors disabled:opacity-50"
            >
              <Zap size={16} />
              {seeding ? "Seeding..." : "Seed Lenders"}
            </button>
          )}
          <button
            onClick={openAdd}
            className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus size={16} />
            Add Lender
          </button>
        </div>
      </div>

      {/* Tier Filter Tabs */}
      <div className="flex items-center gap-2 mb-4">
        {([["all", "All"], [1, "Tier 1 · A"], [2, "Tier 2 · B"], [3, "Tier 3 · High Risk"]] as [TierFilter, string][]).map(([val, label]) => (
          <button
            key={String(val)}
            onClick={() => setTierFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tierFilter === val
                ? val === "all"
                  ? "bg-[rgba(255,255,255,0.1)] text-white"
                  : `text-white`
                : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
            }`}
            style={tierFilter === val && val !== "all" ? {
              backgroundColor: TIER_CONFIG[val as 1 | 2 | 3].bg,
              color: TIER_CONFIG[val as 1 | 2 | 3].color,
            } : {}}
          >
            {label} ({tierCounts[val] || 0})
          </button>
        ))}
        <div className="w-px h-5 bg-[rgba(255,255,255,0.08)] mx-1" />
        {([["all", "All Methods"], ["email", "Email"], ["portal", "Portal"], ["both", "Both"]] as [MethodFilter, string][]).map(([val, label]) => (
          <button
            key={val}
            onClick={() => setMethodFilter(val)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              methodFilter === val
                ? "bg-[rgba(255,255,255,0.1)] text-white"
                : "text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.6)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative mb-6">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[rgba(255,255,255,0.3)]" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lenders..."
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
        />
      </div>

      {/* Lender cards */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <div key={i} className="h-32 bg-[rgba(255,255,255,0.03)] rounded-xl animate-pulse" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <Building2 size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{search || tierFilter !== "all" || methodFilter !== "all" ? "No lenders match your filters." : "No lenders yet. Add your first one or seed the database."}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((l) => {
            const tier = TIER_CONFIG[l.tier] || TIER_CONFIG[2];
            const MethodIconComponent = METHOD_ICON[l.submission_method] || Mail;
            return (
              <div
                key={l.id}
                className={`bg-[rgba(255,255,255,0.03)] border rounded-xl p-5 transition-colors ${l.is_active ? "border-[rgba(255,255,255,0.08)]" : "border-[rgba(255,255,255,0.04)] opacity-60"}`}
              >
                <div className="flex items-start justify-between gap-4">
                  {/* Left: name + tags */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="text-base font-semibold text-white truncate">{l.name}</h3>
                      {/* Tier badge */}
                      <span
                        className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: tier.bg, color: tier.color, border: `1px solid ${tier.border}` }}
                      >
                        {tier.label}
                      </span>
                      {/* Submission method badge */}
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)] flex items-center gap-1">
                        <MethodIconComponent size={9} />
                        {l.submission_method === "both" ? "Email + Portal" : l.submission_method === "portal" ? "Portal" : "Email"}
                      </span>
                      {!l.is_active && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.3)]">Inactive</span>
                      )}
                      {l.response_time_days != null && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(0,201,167,0.1)] text-[#00C9A7]">{l.response_time_days}d response</span>
                      )}
                    </div>

                    {l.submission_email && (
                      <p className="text-xs text-[rgba(255,255,255,0.4)] mb-2">{l.submission_email}</p>
                    )}

                    {/* Criteria row */}
                    <div className="flex flex-wrap gap-3 text-xs text-[rgba(255,255,255,0.5)] mb-2">
                      {l.min_credit_score && <span>Credit {l.min_credit_score}+</span>}
                      {l.min_monthly_revenue && <span>Rev ${(l.min_monthly_revenue / 1000).toFixed(0)}K+/mo</span>}
                      {l.max_amount && <span>Up to ${(l.max_amount / 1000).toFixed(0)}K</span>}
                      {l.min_time_in_business_months && <span>{l.min_time_in_business_months}mo TIB</span>}
                      {l.max_negative_days != null && <span>Max {l.max_negative_days} neg days</span>}
                    </div>

                    {/* Products */}
                    {l.products.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {l.products.map((p) => (
                          <span key={p} className="text-[10px] px-2 py-0.5 rounded-full bg-[rgba(27,101,167,0.2)] text-[#1B65A7] border border-[rgba(27,101,167,0.3)]">
                            {p}
                          </span>
                        ))}
                      </div>
                    )}

                    {l.notes && (
                      <p className="text-xs text-[rgba(255,255,255,0.35)] mt-2 italic">{l.notes}</p>
                    )}
                  </div>

                  {/* Right: actions */}
                  <div className="flex items-center gap-2 shrink-0">
                    {l.portal_url && (
                      <a
                        href={l.portal_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.05)] text-xs text-[rgba(255,255,255,0.6)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
                      >
                        <ExternalLink size={12} />
                        Portal
                      </a>
                    )}
                    <button
                      onClick={() => handleToggleActive(l)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${l.is_active ? "bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)]" : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] hover:text-white"}`}
                    >
                      {l.is_active ? "Active" : "Inactive"}
                    </button>
                    <button onClick={() => openEdit(l)} className="p-2 text-[rgba(255,255,255,0.3)] hover:text-[#00C9A7] transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => handleDelete(l.id)} className="p-2 text-[rgba(255,255,255,0.3)] hover:text-[#E74C3C] transition-colors">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-6 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-lg font-semibold text-white">{editLender ? "Edit Lender" : "Add Lender"}</h2>
              <button onClick={() => setShowModal(false)} className="text-[rgba(255,255,255,0.4)] hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-6 space-y-4">
              {/* Name */}
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Lender Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="e.g. ABC Capital" />
              </div>

              {/* Tier + Submission Method */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Tier</label>
                  <div className="flex gap-2">
                    {([1, 2, 3] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setForm({ ...form, tier: t })}
                        className="flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors border"
                        style={form.tier === t
                          ? { backgroundColor: TIER_CONFIG[t].bg, color: TIER_CONFIG[t].color, borderColor: TIER_CONFIG[t].border }
                          : { backgroundColor: "transparent", color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.1)" }
                        }
                      >
                        {t === 1 ? "Tier 1" : t === 2 ? "Tier 2" : "Tier 3"}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Submission Method</label>
                  <div className="flex gap-2">
                    {(["email", "portal", "both"] as const).map((m) => (
                      <button
                        key={m}
                        onClick={() => setForm({ ...form, submission_method: m })}
                        className={`flex-1 px-2 py-2 rounded-md text-xs font-medium transition-colors border ${
                          form.submission_method === m
                            ? "bg-[rgba(27,101,167,0.2)] text-[#1B65A7] border-[rgba(27,101,167,0.4)]"
                            : "bg-transparent text-[rgba(255,255,255,0.4)] border-[rgba(255,255,255,0.1)]"
                        }`}
                      >
                        {m === "both" ? "Both" : m === "portal" ? "Portal" : "Email"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Email + Portal */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Submission Email</label>
                  <input value={form.submission_email || ""} onChange={(e) => setForm({ ...form, submission_email: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="submissions@lender.com" />
                </div>
                <div>
                  <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Portal URL</label>
                  <input value={form.portal_url || ""} onChange={(e) => setForm({ ...form, portal_url: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="https://portal.lender.com" />
                </div>
              </div>

              {/* Criteria */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: "min_credit_score", label: "Min Credit Score", placeholder: "550" },
                  { key: "min_monthly_revenue", label: "Min Monthly Revenue ($)", placeholder: "10000" },
                  { key: "max_amount", label: "Max Funding Amount ($)", placeholder: "500000" },
                  { key: "min_time_in_business_months", label: "Min TIB (months)", placeholder: "6" },
                  { key: "max_negative_days", label: "Max Negative Days", placeholder: "5" },
                  { key: "response_time_days", label: "Avg Response (days)", placeholder: "2" },
                ].map(({ key, label, placeholder }) => (
                  <div key={key}>
                    <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">{label}</label>
                    <input
                      type="number"
                      value={(form as Record<string, unknown>)[key] as number ?? ""}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value ? Number(e.target.value) : null })}
                      className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]"
                      placeholder={placeholder}
                    />
                  </div>
                ))}
              </div>

              {/* Products */}
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-2">Products Funded</label>
                <div className="flex flex-wrap gap-2">
                  {PRODUCT_OPTIONS.map((p) => (
                    <button
                      key={p}
                      onClick={() => toggleProduct(p)}
                      className={`px-3 py-1 rounded-full text-xs font-medium transition-colors border ${
                        form.products.includes(p)
                          ? "bg-[rgba(27,101,167,0.3)] text-[#1B65A7] border-[rgba(27,101,167,0.5)]"
                          : "bg-transparent text-[rgba(255,255,255,0.4)] border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.3)]"
                      }`}
                    >
                      {form.products.includes(p) && <Check size={10} className="inline mr-1" />}
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Notes</label>
                <textarea
                  value={form.notes || ""}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none"
                  placeholder="e.g. Prefers deals over $25K. Fast on approvals."
                />
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setForm({ ...form, is_active: !form.is_active })}
                  className={`w-10 h-5 rounded-full transition-colors ${form.is_active ? "bg-[#00C9A7]" : "bg-[rgba(255,255,255,0.1)]"}`}
                >
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${form.is_active ? "translate-x-5" : "translate-x-0"}`} />
                </button>
                <span className="text-sm text-[rgba(255,255,255,0.6)]">Active lender</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-6 border-t border-[rgba(255,255,255,0.06)]">
              <button onClick={() => setShowModal(false)} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white">Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving || !form.name.trim()}
                className="px-5 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50"
              >
                {saving ? "Saving..." : editLender ? "Save Changes" : "Add Lender"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
