"use client";

import { useState, useEffect } from "react";
import { Mail, Clock, CheckCircle, XCircle, RefreshCw, Building2, ChevronDown, ChevronUp } from "lucide-react";

interface EmailDraft {
  id: string;
  agent: "submissions" | "underwriting";
  opportunity_id: string | null;
  contact_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  attachments: Array<{ name: string }>;
  deal_data: Record<string, unknown>;
  status: "draft" | "approved" | "sent" | "failed";
  sent_at: string | null;
  error: string | null;
  created_at: string;
}

const STATUS_STYLES: Record<string, string> = {
  draft: "bg-[#F5A623]/10 text-[#F5A623] border-[#F5A623]/20",
  approved: "bg-[rgba(0,201,167,0.1)] text-[#00C9A7] border-[rgba(0,201,167,0.2)]",
  sent: "bg-[rgba(76,175,80,0.1)] text-[#4CAF50] border-[rgba(76,175,80,0.2)]",
  failed: "bg-[rgba(231,76,60,0.1)] text-[#E74C3C] border-[rgba(231,76,60,0.2)]",
};

export default function EmailAgentsPage() {
  const [drafts, setDrafts] = useState<EmailDraft[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"all" | "draft" | "sent">("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/email-agents");
      const data = await res.json();
      setDrafts(data.drafts || []);
    } catch {
      setDrafts([]);
    }
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const handleApprove = async (id: string) => {
    if (!confirm("Send this email now?")) return;
    setActing(id);
    await fetch("/api/email-agents", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: "approve" }),
    });
    setActing(null);
    load();
  };

  const filtered = drafts.filter((d) => {
    if (activeTab === "draft") return d.status === "draft";
    if (activeTab === "sent") return d.status === "sent";
    return true;
  });

  const pendingCount = drafts.filter((d) => d.status === "draft").length;

  const relTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(27,101,167,0.15)]">
            <Mail className="h-5 w-5 text-[#1B65A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Email Agents</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">
              {pendingCount > 0
                ? <span className="text-[#F5A623]">{pendingCount} draft{pendingCount > 1 ? "s" : ""} awaiting approval</span>
                : "All emails reviewed"}
            </p>
          </div>
        </div>
        <button onClick={load} className="p-2 text-[rgba(255,255,255,0.4)] hover:text-white transition-colors">
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 p-1 bg-[rgba(255,255,255,0.03)] rounded-lg w-fit">
        {([
          { key: "all", label: `All (${drafts.length})` },
          { key: "draft", label: `Pending (${pendingCount})` },
          { key: "sent", label: `Sent (${drafts.filter((d) => d.status === "sent").length})` },
        ] as const).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${activeTab === tab.key ? "bg-[rgba(255,255,255,0.1)] text-white" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Drafts list */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <div key={i} className="h-24 bg-[rgba(255,255,255,0.03)] rounded-xl animate-pulse" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Mail size={40} className="mx-auto mb-3 text-[rgba(255,255,255,0.1)]" />
          <p className="text-sm text-[rgba(255,255,255,0.4)]">
            {activeTab === "draft"
              ? "No pending drafts. AI agents will create drafts here when deals are processed."
              : "No emails yet."}
          </p>
          <p className="text-xs text-[rgba(255,255,255,0.25)] mt-2">
            Drafts are created automatically when the Underwriting or Submissions bot processes a deal.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((draft) => {
            const isExpanded = expandedId === draft.id;
            return (
              <div
                key={draft.id}
                className={`bg-[rgba(255,255,255,0.03)] border rounded-xl overflow-hidden transition-colors ${
                  draft.status === "draft"
                    ? "border-[rgba(245,166,35,0.2)]"
                    : "border-[rgba(255,255,255,0.06)]"
                }`}
              >
                {/* Card header */}
                <div className="flex items-center gap-4 p-4">
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border uppercase ${
                      draft.agent === "underwriting"
                        ? "bg-[rgba(0,201,167,0.1)] text-[#00C9A7] border-[rgba(0,201,167,0.2)]"
                        : "bg-[rgba(27,101,167,0.1)] text-[#1B65A7] border-[rgba(27,101,167,0.2)]"
                    }`}>
                      {draft.agent === "underwriting" ? "Underwriting" : "Submissions"}
                    </span>
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-white truncate">{draft.subject}</p>
                    <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5">To: {draft.to_email}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span className={`text-[10px] px-2 py-0.5 rounded border ${STATUS_STYLES[draft.status]}`}>
                      {draft.status}
                    </span>
                    <span className="text-xs text-[rgba(255,255,255,0.3)]">{relTime(draft.created_at)}</span>

                    {draft.status === "draft" && (
                      <button
                        onClick={() => handleApprove(draft.id)}
                        disabled={acting === draft.id}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-lg text-xs font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                      >
                        <CheckCircle size={12} />
                        {acting === draft.id ? "Sending..." : "Approve & Send"}
                      </button>
                    )}

                    <button
                      onClick={() => setExpandedId(isExpanded ? null : draft.id)}
                      className="p-1 text-[rgba(255,255,255,0.3)] hover:text-white transition-colors"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>
                </div>

                {/* Expanded: email preview */}
                {isExpanded && (
                  <div className="border-t border-[rgba(255,255,255,0.06)] p-4 space-y-3">
                    {/* Attachments */}
                    {draft.attachments.length > 0 && (
                      <div>
                        <p className="text-xs text-[rgba(255,255,255,0.4)] mb-1">Attachments</p>
                        <div className="flex flex-wrap gap-2">
                          {draft.attachments.map((a, i) => (
                            <span key={i} className="text-xs px-2 py-1 bg-[rgba(255,255,255,0.05)] rounded border border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.6)]">
                              📎 {a.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Email body */}
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.4)] mb-1">Email Body</p>
                      <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 text-xs text-[rgba(255,255,255,0.6)] whitespace-pre-wrap font-mono leading-relaxed max-h-64 overflow-y-auto">
                        {draft.body}
                      </div>
                    </div>

                    {/* Error */}
                    {draft.error && (
                      <div className="flex items-center gap-2 text-xs text-[#E74C3C]">
                        <XCircle size={12} />
                        {draft.error}
                      </div>
                    )}

                    {/* Sent time */}
                    {draft.sent_at && (
                      <div className="flex items-center gap-2 text-xs text-[rgba(255,255,255,0.3)]">
                        <Clock size={12} />
                        Sent {new Date(draft.sent_at).toLocaleString()}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Coming soon notice */}
      <div className="mt-8 bg-[rgba(27,101,167,0.06)] border border-[rgba(27,101,167,0.15)] rounded-xl p-5">
        <div className="flex items-start gap-3">
          <Building2 size={16} className="text-[#1B65A7] shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-white">AI Agents Coming Soon</p>
            <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1">
              The Underwriting Bot and Submissions Bot will automatically create email drafts here when deals are processed. You review and approve before anything is sent.
            </p>
            <p className="text-xs text-[rgba(255,255,255,0.3)] mt-2">
              Requires: underwriting@srtagency.com + submissions@srtagency.com mailboxes and Azure app registration with application permissions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
