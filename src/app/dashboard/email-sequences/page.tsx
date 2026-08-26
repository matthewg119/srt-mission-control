"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  RefreshCw,
  CheckCircle2,
  Clock,
  AlertCircle,
  ChevronDown,
  Mail,
  Building2,
  Play,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  email: string | null;
  zoho_lead_id: string | null;
  portal_app_completed: boolean;
  portal_statements_uploaded: boolean;
  portal_login_count: number;
  updated_at: string | null;
  created_at: string | null;
}

interface EligibilityRow {
  contact: Contact | null;
  reason_snapshot: Record<string, unknown>;
  computed_at: string;
  already_enrolled: boolean;
}

interface ListSummary {
  count: number;
  computed_at: string;
}

const SEQUENCES = [
  { slug: "fu-new-inbound", label: "FU — New Inbound" },
  { slug: "awaiting-statements", label: "Awaiting Statements" },
  { slug: "pre-approved-nurture", label: "Pre-Approved Nurture" },
  { slug: "post-call-followup", label: "Post-Call Follow-Up" },
  { slug: "approved-nurture", label: "Approved Nurture" },
];

const LIST_META: Record<string, { label: string; color: string; suggestedSequence: string }> = {
  eligible_fu_new:               { label: "FU New",             color: "#0E8C77", suggestedSequence: "fu-new-inbound" },
  eligible_app_started:          { label: "App Started",        color: "#8B5CF6", suggestedSequence: "fu-new-inbound" },
  eligible_awaiting_statements:  { label: "Awaiting Stmts",     color: "#F59E0B", suggestedSequence: "awaiting-statements" },
  eligible_post_call_followup:   { label: "Post-Call",          color: "#00C9A7", suggestedSequence: "post-call-followup" },
  eligible_pre_approved:         { label: "Pre-Approved",       color: "#E8792B", suggestedSequence: "pre-approved-nurture" },
  eligible_approved_nurture:     { label: "Approved Nurture",   color: "#22c55e", suggestedSequence: "approved-nurture" },
  eligible_breakup:              { label: "Breakup",            color: "#ef4444", suggestedSequence: "fu-new-inbound" },
};

const LIST_NAMES = Object.keys(LIST_META);

// ── Helpers ────────────────────────────────────────────────────────────────

function daysSince(iso: string | null): string {
  if (!iso) return "—";
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  return d < 1 ? `${Math.round(d * 24)}h ago` : `${Math.floor(d)}d ago`;
}

// ── Main component ─────────────────────────────────────────────────────────

export default function EmailSequencesPage() {
  const [activeList, setActiveList] = useState("eligible_fu_new");
  const [listSummary, setListSummary] = useState<Record<string, ListSummary>>({});
  const [contacts, setContacts] = useState<EligibilityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [segmenting, setSegmenting] = useState(false);
  const [enrollingId, setEnrollingId] = useState<string | null>(null);
  const [enrollResult, setEnrollResult] = useState<Record<string, string>>({});
  const [selectedSequences, setSelectedSequences] = useState<Record<string, string>>({});
  const [bulkSelected, setBulkSelected] = useState<Set<string>>(new Set());
  const [bulkSequence, setBulkSequence] = useState("fu-new-inbound");
  const [bulkEnrolling, setBulkEnrolling] = useState(false);

  const fetchSummary = useCallback(async () => {
    const res = await fetch("/api/sequences/eligibility");
    const data = await res.json();
    setListSummary(data.lists ?? {});
  }, []);

  const fetchList = useCallback(async (listName: string) => {
    setLoading(true);
    setContacts([]);
    setBulkSelected(new Set());
    try {
      const res = await fetch(`/api/sequences/eligibility?list=${listName}`);
      const data = await res.json();
      setContacts(data.contacts ?? []);
    } catch {
      setContacts([]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    fetchList(activeList);
  }, [activeList, fetchList]);

  const handleEnroll = async (row: EligibilityRow, sequenceSlug: string) => {
    if (!row.contact?.zoho_lead_id) return;
    setEnrollingId(row.contact.id);
    try {
      const res = await fetch("/api/sequences/enroll", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          zoho_contact_id: row.contact.zoho_lead_id,
          sequence_slug: sequenceSlug,
          enrolled_by: "ui",
        }),
      });
      const data = await res.json();
      setEnrollResult((prev) => ({
        ...prev,
        [row.contact!.id]: data.enrolled ? "✅ Enrolled" : `⚠️ ${data.reason}`,
      }));
      if (data.enrolled) {
        setContacts((prev) =>
          prev.map((r) => (r.contact?.id === row.contact?.id ? { ...r, already_enrolled: true } : r))
        );
        fetchSummary();
      }
    } catch (e) {
      setEnrollResult((prev) => ({
        ...prev,
        [row.contact!.id]: `⚠️ ${e instanceof Error ? e.message : "Failed"}`,
      }));
    }
    setEnrollingId(null);
  };

  const handleBulkEnroll = async () => {
    setBulkEnrolling(true);
    const toEnroll = contacts.filter(
      (r) => r.contact && bulkSelected.has(r.contact.id) && !r.already_enrolled && r.contact.zoho_lead_id
    );
    for (const row of toEnroll) {
      await handleEnroll(row, bulkSequence);
    }
    setBulkSelected(new Set());
    setBulkEnrolling(false);
  };

  const handleRunSegmenter = async () => {
    setSegmenting(true);
    try {
      await fetch("/api/cron/run-segmenter", { method: "POST" });
      await fetchSummary();
      await fetchList(activeList);
    } catch {/* ignore */}
    setSegmenting(false);
  };

  const meta = LIST_META[activeList] ?? { label: activeList, color: "#64748b", suggestedSequence: "fu-new-inbound" };
  const computedAt = listSummary[activeList]?.computed_at;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Email Sequences</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            Nightly-segmented lead lists · Enroll in AI-drafted sequences · Approve in Slack
          </p>
        </div>
        <button
          onClick={handleRunSegmenter}
          disabled={segmenting}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.6)] hover:text-white hover:border-[rgba(255,255,255,0.2)] transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`h-4 w-4 ${segmenting ? "animate-spin" : ""}`} />
          {segmenting ? "Segmenting..." : "Run Segmenter Now"}
        </button>
      </div>

      {/* List tabs */}
      <div className="flex gap-2 flex-wrap mb-6">
        {LIST_NAMES.map((listName) => {
          const m = LIST_META[listName];
          const count = listSummary[listName]?.count ?? 0;
          const isActive = activeList === listName;
          return (
            <button
              key={listName}
              onClick={() => setActiveList(listName)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                isActive
                  ? "text-white border-[rgba(255,255,255,0.2)] bg-[rgba(255,255,255,0.07)]"
                  : "text-[rgba(255,255,255,0.45)] border-[rgba(255,255,255,0.07)] bg-transparent hover:border-[rgba(255,255,255,0.15)]"
              }`}
            >
              <span
                className="h-2 w-2 rounded-full shrink-0"
                style={{ backgroundColor: m.color }}
              />
              {m.label}
              {count > 0 && (
                <span
                  className="ml-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold"
                  style={{ backgroundColor: `${m.color}25`, color: m.color }}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bulk actions bar */}
      {bulkSelected.size > 0 && (
        <div className="mb-4 p-3 rounded-xl border border-[rgba(0,201,167,0.3)] bg-[rgba(0,201,167,0.06)] flex items-center gap-3 flex-wrap">
          <span className="text-sm text-[#00C9A7] font-medium">{bulkSelected.size} selected</span>
          <select
            value={bulkSequence}
            onChange={(e) => setBulkSequence(e.target.value)}
            className="px-2 py-1 rounded-lg text-sm bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white"
          >
            {SEQUENCES.map((s) => (
              <option key={s.slug} value={s.slug} className="bg-[#0a0a0a] text-white">{s.label}</option>
            ))}
          </select>
          <button
            onClick={handleBulkEnroll}
            disabled={bulkEnrolling}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#00C9A7] text-[#0a0a0a] hover:bg-[#00b598] transition-colors disabled:opacity-40"
          >
            <Play className="h-3 w-3" />
            {bulkEnrolling ? "Enrolling..." : "Enroll Selected"}
          </button>
          <button
            onClick={() => setBulkSelected(new Set())}
            className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white"
          >
            Clear
          </button>
        </div>
      )}

      {/* Last computed time */}
      {computedAt && (
        <p className="text-xs text-[rgba(255,255,255,0.3)] mb-4 flex items-center gap-1">
          <Clock className="h-3 w-3" />
          Last segmented: {new Date(computedAt).toLocaleString()}
        </p>
      )}

      {/* Contact list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 rounded-xl bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] animate-pulse" />
          ))}
        </div>
      ) : contacts.length === 0 ? (
        <div className="py-12 text-center">
          <Users className="h-10 w-10 text-[rgba(255,255,255,0.1)] mx-auto mb-3" />
          <p className="text-sm text-[rgba(255,255,255,0.3)]">No contacts in this list.</p>
          <p className="text-xs text-[rgba(255,255,255,0.2)] mt-1">Run the segmenter to populate.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {contacts.map((row) => {
            if (!row.contact) return null;
            const c = row.contact;
            const name = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Unknown";
            const result = enrollResult[c.id];
            const sequenceSlug = selectedSequences[c.id] ?? meta.suggestedSequence;
            const isEnrolling = enrollingId === c.id;
            const snapshot = row.reason_snapshot ?? {};

            return (
              <div
                key={c.id}
                className={`rounded-xl border p-4 flex items-center gap-4 transition-colors ${
                  row.already_enrolled
                    ? "border-[rgba(0,201,167,0.2)] bg-[rgba(0,201,167,0.04)]"
                    : "border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.12)]"
                }`}
              >
                {/* Checkbox */}
                <input
                  type="checkbox"
                  checked={bulkSelected.has(c.id)}
                  disabled={row.already_enrolled || !c.zoho_lead_id}
                  onChange={(e) => {
                    setBulkSelected((prev) => {
                      const next = new Set(prev);
                      e.target.checked ? next.add(c.id) : next.delete(c.id);
                      return next;
                    });
                  }}
                  className="accent-[#00C9A7] w-4 h-4 shrink-0"
                />

                {/* Contact info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-white truncate">{name}</span>
                    {row.already_enrolled && (
                      <span className="flex items-center gap-0.5 text-[10px] text-[#00C9A7] font-medium shrink-0">
                        <CheckCircle2 className="h-3 w-3" /> Enrolled
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[rgba(255,255,255,0.4)]">
                    {c.business_name && (
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3 w-3" /> {c.business_name}
                      </span>
                    )}
                    {c.email && (
                      <span className="flex items-center gap-1">
                        <Mail className="h-3 w-3" /> {c.email}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" /> {daysSince(c.updated_at)}
                    </span>
                  </div>
                  {/* Reason snapshot pills */}
                  <div className="flex gap-1.5 mt-1.5 flex-wrap">
                    {Object.entries(snapshot)
                      .filter(([, v]) => v !== false && v !== null && v !== undefined)
                      .slice(0, 4)
                      .map(([k, v]) => (
                        <span
                          key={k}
                          className="text-[9px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.35)] border border-[rgba(255,255,255,0.06)]"
                        >
                          {k.replace(/_/g, " ")}: {String(v)}
                        </span>
                      ))}
                  </div>
                </div>

                {/* Result badge */}
                {result && (
                  <span className="text-xs text-[rgba(255,255,255,0.5)] shrink-0">{result}</span>
                )}

                {/* Enroll controls */}
                {!row.already_enrolled && c.zoho_lead_id && (
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="relative">
                      <select
                        value={sequenceSlug}
                        onChange={(e) => setSelectedSequences((prev) => ({ ...prev, [c.id]: e.target.value }))}
                        className="appearance-none pl-2 pr-6 py-1.5 rounded-lg text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.7)] cursor-pointer"
                      >
                        {SEQUENCES.map((s) => (
                          <option key={s.slug} value={s.slug} className="bg-[#0a0a0a] text-white">{s.label}</option>
                        ))}
                      </select>
                      <ChevronDown className="h-3 w-3 text-[rgba(255,255,255,0.3)] absolute right-1.5 top-2 pointer-events-none" />
                    </div>
                    <button
                      onClick={() => handleEnroll(row, sequenceSlug)}
                      disabled={isEnrolling}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[#00C9A7] text-[#0a0a0a] hover:bg-[#00b598] transition-colors disabled:opacity-40"
                    >
                      {isEnrolling ? <RefreshCw className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                      {isEnrolling ? "..." : "Enroll"}
                    </button>
                  </div>
                )}

                {!row.already_enrolled && !c.zoho_lead_id && (
                  <span className="flex items-center gap-1 text-[10px] text-[rgba(255,255,255,0.3)] shrink-0">
                    <AlertCircle className="h-3 w-3" /> No Zoho ID
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
