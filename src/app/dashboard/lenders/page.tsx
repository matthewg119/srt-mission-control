"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Building2, Plus, Pencil, Trash2, ExternalLink, Search, X, Check, Mail,
  Globe, Zap, Upload, ImageIcon, FileText, Send, RefreshCw, ChevronDown, ChevronUp,
} from "lucide-react";

// ── Types ──

interface Lender {
  id: string;
  name: string;
  tier: 1 | 2 | 3;
  tier_label: string | null;
  is_active: boolean;
  submission_method: "email" | "portal" | "both";
  submission_email: string | null;
  portal_url: string | null;
  min_credit_score: number | null;
  min_monthly_revenue: number | null;
  min_time_in_business_months: number | null;
  max_amount: number | null;
  max_negative_days: number | null;
  response_time_days: number | null;
  products: string[];
  blocked_industries: string[];
  notes: string | null;
  cc_emails: string[];
  rep_name: string | null;
  rep_email: string | null;
  factor_rate_range: string | null;
  positions_funded: string | null;
  funding_speed: string | null;
  repayment_frequency: string | null;
  guideline_pdf_url: string | null;
  guideline_pdf_name: string | null;
}

interface ChatMessage {
  id: string;
  role: "user" | "vektor";
  text: string;
  routingResult?: RoutingResult;
}

interface LenderMatch {
  lender_id: string;
  name: string;
  tier_label: string;
  match_score: number;
  reasons: string[];
  warnings: string[];
  factor_rate_used: number;
  payback_amount: number;
  term_months: number;
  daily_payment: number;
  weekly_payment: number;
  submission_email: string | null;
  rep_name: string | null;
}

interface RoutingResult {
  deal_summary: {
    business: string | null;
    amount: number;
    credit_score: number | null;
    monthly_revenue: number | null;
    tib_months: number | null;
    position: string;
    industry: string | null;
    use_of_funds: string | null;
  };
  top3: LenderMatch[];
}

// ── Constants ──

const TIER_CONFIG = {
  1: { label: "Tier 1 — A Paper", color: "#4CAF50", bg: "rgba(76,175,80,0.18)", border: "rgba(76,175,80,0.35)", headerBg: "rgba(76,175,80,0.12)" },
  2: { label: "Tier 2 — B Paper", color: "#F5A623", bg: "rgba(245,166,35,0.18)", border: "rgba(245,166,35,0.35)", headerBg: "rgba(245,166,35,0.10)" },
  3: { label: "Tier 3 — C / Flexible", color: "#E74C3C", bg: "rgba(231,76,60,0.18)", border: "rgba(231,76,60,0.35)", headerBg: "rgba(231,76,60,0.10)" },
} as const;

const PRODUCT_OPTIONS = [
  "Working Capital", "Term Loan", "Line of Credit", "Equipment Financing",
  "Invoice Factoring", "SBA Loan", "Revenue Based",
];

const EMPTY_FORM: Omit<Lender, "id"> = {
  name: "", tier: 2, tier_label: null, is_active: true,
  submission_method: "email", submission_email: "", portal_url: "",
  min_credit_score: null, min_monthly_revenue: null, min_time_in_business_months: null,
  max_amount: null, max_negative_days: null, response_time_days: null,
  products: [], blocked_industries: [], notes: "", cc_emails: [],
  rep_name: null, rep_email: null, factor_rate_range: null,
  positions_funded: null, funding_speed: null, repayment_frequency: null,
  guideline_pdf_url: null, guideline_pdf_name: null,
};

function fmt(n: number) {
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function fmtDec(n: number) {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── Main Component ──

export default function LendersPage() {
  const [lenders, setLenders] = useState<Lender[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | 1 | 2 | 3>("all");
  const [showInactive, setShowInactive] = useState(false);

  // Detail popup
  const [selectedLender, setSelectedLender] = useState<Lender | null>(null);

  // Edit modal
  const [showEditModal, setShowEditModal] = useState(false);
  const [editLender, setEditLender] = useState<Lender | null>(null);
  const [form, setForm] = useState<Omit<Lender, "id">>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  // PDF fetch
  const [fetchingPdfs, setFetchingPdfs] = useState(false);
  const [pdfFetchResult, setPdfFetchResult] = useState<string | null>(null);

  // Seeding
  const [seeding, setSeeding] = useState(false);

  // Chat
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [routing, setRouting] = useState(false);
  const [sendingSlack, setSendingSlack] = useState<string | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/lenders");
    const data = await res.json();
    setLenders(data.lenders || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [chatMessages]);

  // ── Filtering ──
  const filtered = lenders.filter((l) => {
    if (tierFilter !== "all" && l.tier !== tierFilter) return false;
    if (!showInactive && !l.is_active) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        l.name.toLowerCase().includes(s) ||
        (l.submission_email ?? "").toLowerCase().includes(s) ||
        (l.rep_name ?? "").toLowerCase().includes(s)
      );
    }
    return true;
  });

  const byTier = {
    1: filtered.filter((l) => l.tier === 1),
    2: filtered.filter((l) => l.tier === 2),
    3: filtered.filter((l) => l.tier === 3),
  };

  const tierCounts = { 1: 0, 2: 0, 3: 0 } as Record<1 | 2 | 3, number>;
  lenders.forEach((l) => { tierCounts[l.tier] = (tierCounts[l.tier] || 0) + 1; });

  // ── CRUD ──
  const openAdd = () => {
    setEditLender(null);
    setForm(EMPTY_FORM);
    setScanned(false);
    setShowEditModal(true);
  };

  const openEdit = (l: Lender, e?: React.MouseEvent) => {
    e?.stopPropagation();
    setEditLender(l);
    setForm({ ...l });
    setScanned(false);
    setShowEditModal(true);
    setSelectedLender(null);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    if (editLender) {
      await fetch("/api/lenders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editLender.id, ...form }) });
    } else {
      await fetch("/api/lenders", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    }
    setSaving(false);
    setShowEditModal(false);
    load();
  };

  const handleDelete = async (id: string, e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!confirm("Delete this lender?")) return;
    await fetch("/api/lenders", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    setSelectedLender(null);
    load();
  };

  const handleToggleActive = async (l: Lender, e?: React.MouseEvent) => {
    e?.stopPropagation();
    await fetch("/api/lenders", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: l.id, is_active: !l.is_active }) });
    load();
  };

  const handleSeed = async () => {
    if (!confirm("Add ~50 lenders to your database (skipping duplicates)?")) return;
    setSeeding(true);
    await fetch("/api/lenders/seed", { method: "POST" });
    setSeeding(false);
    load();
  };

  const handleScan = async (file: File) => {
    setScanning(true);
    setScanned(false);
    try {
      const fd = new FormData();
      fd.append("image", file);
      const res = await fetch("/api/lenders/scan", { method: "POST", body: fd });
      const data = await res.json();
      if (data.success && data.lender) {
        const l = data.lender;
        setForm((prev) => ({
          ...prev,
          name: l.name || prev.name,
          min_credit_score: l.min_credit_score ?? prev.min_credit_score,
          min_monthly_revenue: l.min_monthly_revenue ?? prev.min_monthly_revenue,
          max_amount: l.max_amount ?? prev.max_amount,
          min_time_in_business_months: l.min_time_in_business_months ?? prev.min_time_in_business_months,
          max_negative_days: l.max_negative_days ?? prev.max_negative_days,
          products: Array.isArray(l.products) && l.products.length > 0 ? l.products.filter((p: string) => PRODUCT_OPTIONS.includes(p)) : prev.products,
          submission_email: l.submission_email || prev.submission_email,
          portal_url: l.portal_url || prev.portal_url,
          notes: l.notes || prev.notes,
          tier: [1, 2, 3].includes(l.tier) ? l.tier : prev.tier,
          response_time_days: l.response_time_days ?? prev.response_time_days,
          submission_method: l.portal_url && l.submission_email ? "both" : l.portal_url ? "portal" : l.submission_email ? "email" : prev.submission_method,
        }));
        setScanned(true);
      } else {
        alert(data.error || "Failed to scan image");
      }
    } catch {
      alert("Scan failed. Please try again.");
    } finally {
      setScanning(false);
    }
  };

  const handleFetchPdfs = async () => {
    setFetchingPdfs(true);
    setPdfFetchResult(null);
    try {
      const res = await fetch("/api/lenders/fetch-pdfs", { method: "POST" });
      const data = await res.json();
      const uploaded = (data.results as { status: string }[] | undefined)?.filter((r) => r.status === "uploaded").length ?? 0;
      setPdfFetchResult(`Done — ${uploaded} PDF(s) fetched from your inbox.`);
      load();
    } catch {
      setPdfFetchResult("Failed to fetch PDFs.");
    } finally {
      setFetchingPdfs(false);
    }
  };

  // ── Chat ──
  const sendChat = async () => {
    const msg = chatInput.trim();
    if (!msg || routing) return;
    setChatInput("");
    const userMsg: ChatMessage = { id: Date.now().toString(), role: "user", text: msg };
    setChatMessages((prev) => [...prev, userMsg]);
    setRouting(true);
    try {
      const res = await fetch("/api/lenders/route-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      const data = await res.json() as RoutingResult & { error?: string };
      if (data.error) {
        setChatMessages((prev) => [...prev, { id: Date.now().toString(), role: "vektor", text: `Error: ${data.error}` }]);
      } else {
        const summary = data.deal_summary;
        const summaryText = [
          summary.business ? `*${summary.business}*` : "Deal",
          summary.amount ? `$${fmt(summary.amount)} requested` : null,
          summary.credit_score ? `Credit ${summary.credit_score}` : null,
          summary.monthly_revenue ? `$${fmt(summary.monthly_revenue)}/mo revenue` : null,
          summary.position ? `${summary.position} position` : null,
        ].filter(Boolean).join(" · ");

        setChatMessages((prev) => [
          ...prev,
          { id: Date.now().toString(), role: "vektor", text: `Top 3 matches for: ${summaryText}`, routingResult: data },
        ]);
      }
    } catch {
      setChatMessages((prev) => [...prev, { id: Date.now().toString(), role: "vektor", text: "Routing failed. Please try again." }]);
    } finally {
      setRouting(false);
    }
  };

  const sendToSlack = async (result: RoutingResult, msgId: string) => {
    setSendingSlack(msgId);
    try {
      await fetch("/api/lenders/post-to-slack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deal_summary: result.deal_summary, top3: result.top3 }),
      });
      setChatMessages((prev) => [
        ...prev,
        { id: Date.now().toString(), role: "vektor", text: "Posted to #srt-sub. React ✅ to approve sending." },
      ]);
    } catch {
      alert("Slack post failed.");
    } finally {
      setSendingSlack(null);
    }
  };

  const toggleProduct = (p: string) => setForm((f) => ({ ...f, products: f.products.includes(p) ? f.products.filter((x) => x !== p) : [...f.products, p] }));

  // ── Render ──
  return (
    <div className="flex h-[calc(100vh-112px)] overflow-hidden gap-0 -mx-6 -mt-6">

      {/* ── LEFT PANEL: Lender Table ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 pt-6 pb-3 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(27,101,167,0.15)]">
                <Building2 className="h-5 w-5 text-[#1B65A7]" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-white">Lenders</h1>
                <p className="text-xs text-[rgba(255,255,255,0.4)]">
                  {lenders.filter((l) => l.is_active).length} active · {lenders.filter((l) => !l.is_active).length} pending
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleFetchPdfs}
                disabled={fetchingPdfs}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(139,92,246,0.15)] text-[#8b5cf6] text-xs font-medium hover:bg-[rgba(139,92,246,0.25)] transition-colors disabled:opacity-50"
              >
                <RefreshCw size={12} className={fetchingPdfs ? "animate-spin" : ""} />
                {fetchingPdfs ? "Fetching..." : "Fetch PDFs"}
              </button>
              {lenders.length === 0 && (
                <button onClick={handleSeed} disabled={seeding} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(27,101,167,0.15)] text-[#1B65A7] text-xs font-medium hover:bg-[rgba(27,101,167,0.25)] disabled:opacity-50">
                  <Zap size={12} />
                  {seeding ? "Seeding..." : "Seed DB"}
                </button>
              )}
              <button onClick={openAdd} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-lg text-xs font-semibold hover:opacity-90">
                <Plus size={12} />
                Add Lender
              </button>
            </div>
          </div>

          {pdfFetchResult && (
            <p className="text-xs text-[#8b5cf6] mb-3">{pdfFetchResult}</p>
          )}

          {/* Filters */}
          <div className="flex items-center gap-2 flex-wrap mb-3">
            {([["all", "All"], [1, "Tier 1"], [2, "Tier 2"], [3, "Tier 3"]] as [("all" | 1 | 2 | 3), string][]).map(([val, label]) => (
              <button
                key={String(val)}
                onClick={() => setTierFilter(val)}
                className="px-2.5 py-1 rounded-md text-xs font-medium transition-colors"
                style={tierFilter === val
                  ? val === "all"
                    ? { backgroundColor: "rgba(255,255,255,0.1)", color: "white" }
                    : { backgroundColor: TIER_CONFIG[val as 1 | 2 | 3].bg, color: TIER_CONFIG[val as 1 | 2 | 3].color, border: `1px solid ${TIER_CONFIG[val as 1 | 2 | 3].border}` }
                  : { color: "rgba(255,255,255,0.4)" }}
              >
                {label} {val !== "all" ? `(${tierCounts[val as 1 | 2 | 3]})` : `(${lenders.length})`}
              </button>
            ))}
            <button
              onClick={() => setShowInactive(!showInactive)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${showInactive ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[rgba(255,255,255,0.4)]"}`}
            >
              {showInactive ? "Hide Inactive" : "Show Inactive"}
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[rgba(255,255,255,0.3)]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search lenders, email, rep..."
              className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg pl-9 pr-4 py-1.5 text-xs text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
            />
          </div>
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-6 space-y-2">{[1,2,3,4,5].map(i => <div key={i} className="h-8 bg-[rgba(255,255,255,0.03)] rounded animate-pulse" />)}</div>
          ) : (
            <table className="w-full text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[#0B1426]">
                <tr className="text-[rgba(255,255,255,0.4)] border-b border-[rgba(255,255,255,0.06)]">
                  <th className="text-left px-4 py-2 font-medium">Lender</th>
                  <th className="text-center px-2 py-2 font-medium">Credit</th>
                  <th className="text-center px-2 py-2 font-medium">Rev/mo</th>
                  <th className="text-center px-2 py-2 font-medium">TIB</th>
                  <th className="text-center px-2 py-2 font-medium">Max $</th>
                  <th className="text-left px-2 py-2 font-medium">Positions</th>
                  <th className="text-left px-2 py-2 font-medium">Factor Rate</th>
                  <th className="text-left px-2 py-2 font-medium">Speed</th>
                  <th className="text-left px-2 py-2 font-medium">Rep</th>
                  <th className="px-2 py-2" />
                </tr>
              </thead>
              <tbody>
                {([1, 2, 3] as const).map((tier) => {
                  const tierLenders = byTier[tier];
                  if (tierLenders.length === 0 && tierFilter !== "all" && tierFilter !== tier) return null;
                  if (tierLenders.length === 0) return null;
                  const cfg = TIER_CONFIG[tier];
                  return (
                    <>
                      {/* Tier header row */}
                      <tr key={`tier-header-${tier}`} style={{ backgroundColor: cfg.headerBg }}>
                        <td colSpan={10} className="px-4 py-1.5 font-semibold text-[11px] tracking-wide" style={{ color: cfg.color }}>
                          {cfg.label} — {tierLenders.filter(l => l.is_active).length} active
                          {tierLenders.some(l => !l.is_active) ? `, ${tierLenders.filter(l => !l.is_active).length} pending` : ""}
                        </td>
                      </tr>
                      {tierLenders.map((l) => (
                        <tr
                          key={l.id}
                          onClick={() => setSelectedLender(l)}
                          className={`border-b border-[rgba(255,255,255,0.04)] cursor-pointer transition-colors hover:bg-[rgba(255,255,255,0.04)] ${!l.is_active ? "opacity-50" : ""}`}
                        >
                          <td className="px-4 py-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-white">{l.name}</span>
                              {l.guideline_pdf_url && (
                                <FileText size={11} className="text-[#8b5cf6] shrink-0" aria-label="Guidelines PDF available" />
                              )}
                              {!l.is_active && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(245,166,35,0.15)] text-[#F5A623]">Pending</span>
                              )}
                            </div>
                            {l.submission_email && (
                              <div className="text-[rgba(255,255,255,0.35)] mt-0.5">{l.submission_email}</div>
                            )}
                          </td>
                          <td className="text-center px-2 py-2 text-[rgba(255,255,255,0.6)]">{l.min_credit_score ? `${l.min_credit_score}+` : "—"}</td>
                          <td className="text-center px-2 py-2 text-[rgba(255,255,255,0.6)]">{l.min_monthly_revenue ? `$${(l.min_monthly_revenue / 1000).toFixed(0)}K` : "—"}</td>
                          <td className="text-center px-2 py-2 text-[rgba(255,255,255,0.6)]">{l.min_time_in_business_months ? `${l.min_time_in_business_months}mo` : "—"}</td>
                          <td className="text-center px-2 py-2 text-[rgba(255,255,255,0.6)]">{l.max_amount ? `$${(l.max_amount / 1000).toFixed(0)}K` : "—"}</td>
                          <td className="px-2 py-2 text-[rgba(255,255,255,0.55)] max-w-[100px] truncate">{l.positions_funded ?? "—"}</td>
                          <td className="px-2 py-2 text-[rgba(255,255,255,0.55)]">{l.factor_rate_range ?? "—"}</td>
                          <td className="px-2 py-2 text-[rgba(255,255,255,0.55)]">{l.funding_speed ?? "—"}</td>
                          <td className="px-2 py-2 text-[rgba(255,255,255,0.55)] max-w-[90px] truncate">{l.rep_name ?? "—"}</td>
                          <td className="px-2 py-2">
                            <button onClick={(e) => openEdit(l, e)} className="p-1 text-[rgba(255,255,255,0.25)] hover:text-[#00C9A7] transition-colors">
                              <Pencil size={11} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ── RIGHT PANEL: Deal Router ── */}
      <div className="w-80 xl:w-96 flex flex-col border-l border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.01)]">
        <div className="px-4 pt-4 pb-3 border-b border-[rgba(255,255,255,0.06)]">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-[#00C9A7]" />
            <h2 className="text-sm font-semibold text-white">Route a Deal</h2>
          </div>
          <p className="text-[10px] text-[rgba(255,255,255,0.35)] mt-0.5">
            Describe any deal — Vektor picks the top 3 lenders + runs the calc
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
          {chatMessages.length === 0 && (
            <div className="text-center py-8">
              <Zap size={28} className="mx-auto mb-2 text-[rgba(255,255,255,0.1)]" />
              <p className="text-xs text-[rgba(255,255,255,0.3)]">Type a deal and Vektor will suggest the best lenders with a calculator.</p>
              <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-2">Example: "Restaurant, $45K, 580 credit, $18K/mo revenue, 1st position"</p>
            </div>
          )}

          {chatMessages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-full ${msg.role === "user" ? "bg-[rgba(27,101,167,0.25)] rounded-xl rounded-tr-sm" : "bg-[rgba(255,255,255,0.05)] rounded-xl rounded-tl-sm"} px-3 py-2`}>
                {msg.role === "vektor" && (
                  <p className="text-[10px] text-[#00C9A7] font-medium mb-1">Vektor</p>
                )}
                <p className="text-xs text-white">{msg.text}</p>

                {/* Lender match cards */}
                {msg.routingResult && (
                  <div className="mt-3 space-y-2">
                    {msg.routingResult.top3.map((l, i) => (
                      <div key={l.lender_id} className="bg-[rgba(255,255,255,0.06)] rounded-lg p-2.5 border border-[rgba(255,255,255,0.08)]">
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="font-semibold text-white text-xs">
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"} {l.name}
                          </span>
                          <span className="text-[10px] text-[#00C9A7] font-medium">{l.match_score}%</span>
                        </div>
                        {l.tier_label && (
                          <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-1">{l.tier_label}</p>
                        )}
                        {msg.routingResult!.deal_summary.amount > 0 && (
                          <div className="text-[10px] text-[rgba(255,255,255,0.6)] bg-[rgba(0,201,167,0.08)] rounded p-1.5 mb-1.5 space-y-0.5">
                            <div>Factor <span className="text-white">{l.factor_rate_used}×</span> → Payback <span className="text-white">${fmt(l.payback_amount)}</span></div>
                            <div>Daily <span className="text-white">${fmtDec(l.daily_payment)}</span> · Weekly <span className="text-white">${fmtDec(l.weekly_payment)}</span></div>
                            <div className="text-[rgba(255,255,255,0.35)]">~{l.term_months} month term</div>
                          </div>
                        )}
                        <div className="space-y-0.5">
                          {l.reasons.map((r, ri) => (
                            <p key={ri} className="text-[10px] text-[rgba(255,255,255,0.5)]">• {r}</p>
                          ))}
                          {l.warnings.map((w, wi) => (
                            <p key={wi} className="text-[10px] text-[#F5A623]">⚠ {w}</p>
                          ))}
                        </div>
                        {l.submission_email && (
                          <p className="text-[10px] text-[rgba(255,255,255,0.35)] mt-1">{l.submission_email}</p>
                        )}
                      </div>
                    ))}

                    <button
                      onClick={() => sendToSlack(msg.routingResult!, msg.id)}
                      disabled={sendingSlack === msg.id}
                      className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-[rgba(0,201,167,0.15)] text-[#00C9A7] rounded-lg text-xs font-medium hover:bg-[rgba(0,201,167,0.25)] transition-colors disabled:opacity-50"
                    >
                      <Send size={11} />
                      {sendingSlack === msg.id ? "Posting..." : "Send to Slack #srt-sub"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {routing && (
            <div className="flex justify-start">
              <div className="bg-[rgba(255,255,255,0.05)] rounded-xl rounded-tl-sm px-3 py-2">
                <p className="text-[10px] text-[#00C9A7] font-medium mb-1">Vektor</p>
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <div key={i} className="w-1.5 h-1.5 rounded-full bg-[rgba(255,255,255,0.3)] animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Input */}
        <div className="px-4 pb-4 pt-2 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex gap-2">
            <textarea
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
              placeholder="Restaurant, $45K, 580 credit, $18K/mo, 1st position..."
              rows={2}
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-xs text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#00C9A7] resize-none"
            />
            <button
              onClick={sendChat}
              disabled={routing || !chatInput.trim()}
              className="flex items-center justify-center w-9 h-full min-h-[60px] rounded-lg bg-[#00C9A7] text-[#0B1426] hover:opacity-90 disabled:opacity-40 transition-opacity shrink-0"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* ── LENDER DETAIL POPUP ── */}
      {selectedLender && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => setSelectedLender(null)}>
          <div
            className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-start justify-between p-5 border-b border-[rgba(255,255,255,0.06)]">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <h2 className="text-lg font-bold text-white">{selectedLender.name}</h2>
                  {selectedLender.tier && (
                    <span
                      className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: TIER_CONFIG[selectedLender.tier].bg,
                        color: TIER_CONFIG[selectedLender.tier].color,
                        border: `1px solid ${TIER_CONFIG[selectedLender.tier].border}`,
                      }}
                    >
                      {selectedLender.tier_label ?? TIER_CONFIG[selectedLender.tier].label}
                    </span>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full ${selectedLender.is_active ? "bg-[rgba(0,201,167,0.1)] text-[#00C9A7]" : "bg-[rgba(245,166,35,0.1)] text-[#F5A623]"}`}>
                    {selectedLender.is_active ? "Active" : "Pending"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button onClick={(e) => openEdit(selectedLender, e)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(255,255,255,0.05)] text-xs text-[rgba(255,255,255,0.6)] hover:text-white transition-colors">
                  <Pencil size={12} /> Edit
                </button>
                <button onClick={() => setSelectedLender(null)} className="p-1.5 text-[rgba(255,255,255,0.4)] hover:text-white">
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {/* Criteria grid */}
              <div>
                <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wide mb-3">Underwriting Criteria</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {[
                    { label: "Min Credit Score", value: selectedLender.min_credit_score ? `${selectedLender.min_credit_score}+` : "Not specified" },
                    { label: "Min Monthly Revenue", value: selectedLender.min_monthly_revenue ? `$${fmt(selectedLender.min_monthly_revenue)}/mo` : "Not specified" },
                    { label: "Min Time in Business", value: selectedLender.min_time_in_business_months ? `${selectedLender.min_time_in_business_months} months` : "Not specified" },
                    { label: "Max Funding Amount", value: selectedLender.max_amount ? `$${fmt(selectedLender.max_amount)}` : "Not specified" },
                    { label: "Max Negative Days", value: selectedLender.max_negative_days != null ? `${selectedLender.max_negative_days} days` : "Not specified" },
                    { label: "Factor Rate Range", value: selectedLender.factor_rate_range ?? "Not specified" },
                    { label: "Positions Funded", value: selectedLender.positions_funded ?? "Not specified" },
                    { label: "Repayment", value: selectedLender.repayment_frequency ?? "Not specified" },
                    { label: "Funding Speed", value: selectedLender.funding_speed ?? "Not specified" },
                  ].map(({ label, value }) => (
                    <div key={label} className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
                      <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">{label}</p>
                      <p className="text-xs text-white font-medium">{value}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Contact */}
              <div>
                <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wide mb-3">Contact & Submission</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {selectedLender.rep_name && (
                    <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
                      <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">ISO Rep</p>
                      <p className="text-xs text-white font-medium">{selectedLender.rep_name}</p>
                      {selectedLender.rep_email && <p className="text-[10px] text-[rgba(255,255,255,0.4)]">{selectedLender.rep_email}</p>}
                    </div>
                  )}
                  {selectedLender.submission_email && (
                    <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
                      <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">Submission Email</p>
                      <p className="text-xs text-white font-medium">{selectedLender.submission_email}</p>
                      {selectedLender.cc_emails?.length > 0 && (
                        <p className="text-[10px] text-[rgba(255,255,255,0.4)]">CC: {selectedLender.cc_emails.join(", ")}</p>
                      )}
                    </div>
                  )}
                  {selectedLender.portal_url && (
                    <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
                      <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">Portal</p>
                      <a href={selectedLender.portal_url} target="_blank" rel="noopener noreferrer" className="text-xs text-[#1B65A7] hover:underline flex items-center gap-1">
                        Open Portal <ExternalLink size={10} />
                      </a>
                    </div>
                  )}
                  {selectedLender.submission_method && (
                    <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3">
                      <p className="text-[10px] text-[rgba(255,255,255,0.4)] mb-0.5">Submission Method</p>
                      <p className="text-xs text-white capitalize">{selectedLender.submission_method}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              {selectedLender.notes && (
                <div>
                  <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wide mb-2">Notes</h3>
                  <p className="text-xs text-[rgba(255,255,255,0.6)] bg-[rgba(255,255,255,0.03)] rounded-lg p-3 leading-relaxed">{selectedLender.notes}</p>
                </div>
              )}

              {/* Guideline PDF */}
              <div className="flex items-center justify-between p-3 rounded-lg bg-[rgba(139,92,246,0.08)] border border-[rgba(139,92,246,0.2)]">
                <div className="flex items-center gap-2">
                  <FileText size={14} className="text-[#8b5cf6]" />
                  <div>
                    <p className="text-xs font-medium text-white">
                      {selectedLender.guideline_pdf_url ? "Underwriting Guidelines PDF" : "No Guidelines PDF on File"}
                    </p>
                    {selectedLender.guideline_pdf_name && (
                      <p className="text-[10px] text-[rgba(255,255,255,0.4)]">{selectedLender.guideline_pdf_name}</p>
                    )}
                  </div>
                </div>
                {selectedLender.guideline_pdf_url ? (
                  <a
                    href={selectedLender.guideline_pdf_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#8b5cf6] text-white text-xs font-medium hover:opacity-90 transition-opacity"
                  >
                    <ExternalLink size={11} /> Open PDF
                  </a>
                ) : (
                  <button
                    onClick={handleFetchPdfs}
                    disabled={fetchingPdfs}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(139,92,246,0.2)] text-[#8b5cf6] text-xs font-medium hover:bg-[rgba(139,92,246,0.3)] disabled:opacity-50"
                  >
                    <RefreshCw size={11} className={fetchingPdfs ? "animate-spin" : ""} />
                    Fetch from Email
                  </button>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={(e) => handleToggleActive(selectedLender, e)}
                  className={`flex-1 py-2 rounded-lg text-xs font-medium transition-colors ${selectedLender.is_active ? "bg-[rgba(231,76,60,0.1)] text-[#E74C3C] hover:bg-[rgba(231,76,60,0.2)]" : "bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)]"}`}
                >
                  {selectedLender.is_active ? "Mark as Inactive" : "Mark as Active"}
                </button>
                <button
                  onClick={(e) => handleDelete(selectedLender.id, e)}
                  className="px-4 py-2 rounded-lg text-xs font-medium text-[rgba(255,255,255,0.4)] hover:text-[#E74C3C] transition-colors"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ADD / EDIT MODAL ── */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-base font-semibold text-white">{editLender ? "Edit Lender" : "Add Lender"}</h2>
              <button onClick={() => setShowEditModal(false)} className="text-[rgba(255,255,255,0.4)] hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-5 space-y-4">
              {/* AI scan (add only) */}
              {!editLender && (
                <div className={`rounded-lg border border-dashed p-3 transition-colors ${scanned ? "border-[rgba(0,201,167,0.4)] bg-[rgba(0,201,167,0.05)]" : "border-[rgba(255,255,255,0.15)] bg-[rgba(255,255,255,0.02)]"}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {scanning ? <div className="h-8 w-8 rounded-lg bg-[rgba(139,92,246,0.15)] flex items-center justify-center"><div className="h-4 w-4 border-2 border-[#8b5cf6] border-t-transparent rounded-full animate-spin" /></div>
                        : scanned ? <div className="h-8 w-8 rounded-lg bg-[rgba(0,201,167,0.15)] flex items-center justify-center"><Check size={14} className="text-[#00C9A7]" /></div>
                        : <div className="h-8 w-8 rounded-lg bg-[rgba(139,92,246,0.15)] flex items-center justify-center"><ImageIcon size={14} className="text-[#8b5cf6]" /></div>}
                      <div>
                        <p className="text-xs font-medium text-white">{scanning ? "Scanning..." : scanned ? "Scanned from image" : "Scan Rate Sheet"}</p>
                        <p className="text-[10px] text-[rgba(255,255,255,0.4)]">{scanned ? "Fields populated — review below" : "Upload a spec sheet to auto-fill"}</p>
                      </div>
                    </div>
                    {!scanning && (
                      <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[rgba(139,92,246,0.15)] text-[#8b5cf6] text-xs font-medium cursor-pointer hover:bg-[rgba(139,92,246,0.25)]">
                        <Upload size={11} />{scanned ? "Re-scan" : "Upload"}
                        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleScan(f); e.target.value = ""; }} />
                      </label>
                    )}
                  </div>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Lender Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="e.g. ABC Capital" />
              </div>

              {/* Tier + Method */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Tier</label>
                  <div className="flex gap-1.5">
                    {([1, 2, 3] as const).map((t) => (
                      <button key={t} onClick={() => setForm({ ...form, tier: t })} className="flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border"
                        style={form.tier === t
                          ? { backgroundColor: TIER_CONFIG[t].bg, color: TIER_CONFIG[t].color, borderColor: TIER_CONFIG[t].border }
                          : { backgroundColor: "transparent", color: "rgba(255,255,255,0.4)", borderColor: "rgba(255,255,255,0.1)" }}
                      >T{t}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Submission</label>
                  <div className="flex gap-1.5">
                    {(["email", "portal", "both"] as const).map((m) => (
                      <button key={m} onClick={() => setForm({ ...form, submission_method: m })} className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-colors border ${form.submission_method === m ? "bg-[rgba(27,101,167,0.2)] text-[#1B65A7] border-[rgba(27,101,167,0.4)]" : "bg-transparent text-[rgba(255,255,255,0.4)] border-[rgba(255,255,255,0.1)]"}`}>
                        {m === "both" ? "Both" : m}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Emails */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Submission Email</label>
                  <input value={form.submission_email || ""} onChange={(e) => setForm({ ...form, submission_email: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="submissions@lender.com" />
                </div>
                <div>
                  <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Portal URL</label>
                  <input value={form.portal_url || ""} onChange={(e) => setForm({ ...form, portal_url: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="https://portal.lender.com" />
                </div>
              </div>

              {/* Rep */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Rep Name</label>
                  <input value={form.rep_name || ""} onChange={(e) => setForm({ ...form, rep_name: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="Jane Smith" />
                </div>
                <div>
                  <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Rep Email</label>
                  <input value={form.rep_email || ""} onChange={(e) => setForm({ ...form, rep_email: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder="jane@lender.com" />
                </div>
              </div>

              {/* Criteria */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {[
                  { key: "min_credit_score", label: "Min Credit Score", ph: "550" },
                  { key: "min_monthly_revenue", label: "Min Revenue ($/mo)", ph: "10000" },
                  { key: "max_amount", label: "Max Funding ($)", ph: "500000" },
                  { key: "min_time_in_business_months", label: "Min TIB (months)", ph: "6" },
                  { key: "max_negative_days", label: "Max Neg Days", ph: "5" },
                  { key: "response_time_days", label: "Response (days)", ph: "2" },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">{label}</label>
                    <input type="number" value={(form as Record<string, unknown>)[key] as number ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value ? Number(e.target.value) : null })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder={ph} />
                  </div>
                ))}
              </div>

              {/* Factor rate / positions / speed */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { key: "factor_rate_range", label: "Factor Rate Range", ph: "1.25 - 1.50" },
                  { key: "positions_funded", label: "Positions Funded", ph: "1st thru 3rd" },
                  { key: "funding_speed", label: "Funding Speed", ph: "24-48 hrs" },
                ].map(({ key, label, ph }) => (
                  <div key={key}>
                    <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">{label}</label>
                    <input value={(form as Record<string, unknown>)[key] as string ?? ""} onChange={(e) => setForm({ ...form, [key]: e.target.value || null })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" placeholder={ph} />
                  </div>
                ))}
              </div>

              {/* Products */}
              <div>
                <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-2">Products</label>
                <div className="flex flex-wrap gap-1.5">
                  {PRODUCT_OPTIONS.map((p) => (
                    <button key={p} onClick={() => toggleProduct(p)} className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors border ${form.products.includes(p) ? "bg-[rgba(27,101,167,0.3)] text-[#1B65A7] border-[rgba(27,101,167,0.5)]" : "bg-transparent text-[rgba(255,255,255,0.4)] border-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.3)]"}`}>
                      {form.products.includes(p) && <Check size={9} className="inline mr-1" />}{p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="text-[10px] text-[rgba(255,255,255,0.5)] block mb-1">Notes</label>
                <textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none" placeholder="ISO date, special requirements, notes..." />
              </div>

              {/* Active toggle */}
              <div className="flex items-center gap-2">
                <button onClick={() => setForm({ ...form, is_active: !form.is_active })} className={`w-9 h-5 rounded-full transition-colors ${form.is_active ? "bg-[#00C9A7]" : "bg-[rgba(255,255,255,0.1)]"}`}>
                  <div className={`w-4 h-4 rounded-full bg-white shadow transition-transform mx-0.5 ${form.is_active ? "translate-x-4" : "translate-x-0"}`} />
                </button>
                <span className="text-xs text-[rgba(255,255,255,0.6)]">Active lender</span>
              </div>
            </div>

            <div className="flex justify-end gap-2 p-5 border-t border-[rgba(255,255,255,0.06)]">
              <button onClick={() => setShowEditModal(false)} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.name.trim()} className="px-5 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50">
                {saving ? "Saving..." : editLender ? "Save Changes" : "Add Lender"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
