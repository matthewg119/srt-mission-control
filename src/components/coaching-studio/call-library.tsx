"use client";

import { useCallback, useEffect, useState } from "react";
import { Search, X, Phone, Clock, User, Building2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import { TranscriptViewer } from "./transcript-viewer";
import type { CoachingSession, TranscriptEntry } from "@/types/coaching";

const OUTCOMES = [
  { value: "all", label: "All" },
  { value: "interested", label: "Interested" },
  { value: "applied", label: "Applied" },
  { value: "needs_docs", label: "Needs Docs" },
  { value: "callback", label: "Callback" },
  { value: "not_interested", label: "Not Interested" },
];

const OUTCOME_COLORS: Record<string, string> = {
  interested: "#00C9A7",
  applied: "#1B65A7",
  needs_docs: "#F5A623",
  callback: "#9C27B0",
  not_interested: "#E74C3C",
};

function formatDuration(sec: number | null): string {
  if (!sec || sec <= 0) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function CallLibrary() {
  const [sessions, setSessions] = useState<CoachingSession[]>([]);
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detailSession, setDetailSession] = useState<CoachingSession | null>(
    null
  );
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [savingMeta, setSavingMeta] = useState(false);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (outcomeFilter !== "all") params.set("outcome", outcomeFilter);
    try {
      const res = await fetch(`/api/coaching-studio/sessions?${params}`);
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {
      setSessions([]);
    }
    setLoading(false);
  }, [search, outcomeFilter]);

  useEffect(() => {
    const timer = setTimeout(fetchSessions, 250);
    return () => clearTimeout(timer);
  }, [fetchSessions]);

  const openDetail = useCallback(async (id: string) => {
    setSelectedId(id);
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/coaching-studio/sessions/${id}`);
      const data = await res.json();
      setDetailSession(data.session || null);
      setTranscript(data.transcript || []);
    } catch {
      setDetailSession(null);
      setTranscript([]);
    }
    setLoadingDetail(false);
  }, []);

  const closeDetail = () => {
    setSelectedId(null);
    setDetailSession(null);
    setTranscript([]);
  };

  const updateSessionMeta = async (
    updates: Partial<Pick<CoachingSession, "title" | "contact_name" | "business_name" | "outcome" | "notes">>
  ) => {
    if (!selectedId) return;
    setSavingMeta(true);
    try {
      await fetch(`/api/coaching-studio/sessions/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      setDetailSession((prev) => (prev ? { ...prev, ...updates } : prev));
      // Refresh list in the background so the row reflects changes.
      fetchSessions();
    } catch {
      // swallow
    }
    setSavingMeta(false);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white">Call Library</h2>
          <p className="text-sm text-[rgba(255,255,255,0.4)] mt-1">
            Every recorded call with full transcripts.
          </p>
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
          placeholder="Search by contact, business, or title..."
          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg pl-10 pr-4 py-2.5 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
        />
      </div>

      {/* Outcome filter pills */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            onClick={() => setOutcomeFilter(o.value)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
              outcomeFilter === o.value
                ? "bg-[#00C9A7] text-[#0B1426]"
                : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div
              key={i}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 animate-pulse h-16"
            />
          ))}
        </div>
      ) : sessions.length === 0 ? (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <Phone
            size={32}
            className="mx-auto mb-3 text-[rgba(255,255,255,0.2)]"
          />
          <p className="text-lg mb-2">No calls yet</p>
          <p className="text-sm">
            Calls recorded by the live coach extension will appear here.
          </p>
        </div>
      ) : (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-[rgba(255,255,255,0.03)] text-[rgba(255,255,255,0.4)]">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-xs">Date</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Rep</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Contact / Business</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Duration</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Lines</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Outcome</th>
                <th className="text-left px-4 py-3 font-medium text-xs">Score</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.id}
                  onClick={() => openDetail(s.id)}
                  className="border-t border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] cursor-pointer"
                >
                  <td className="px-4 py-3 text-[rgba(255,255,255,0.7)]">
                    {formatRelativeTime(s.started_at)}
                  </td>
                  <td className="px-4 py-3 text-[rgba(255,255,255,0.8)]">
                    {s.rep_name || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">
                      {s.contact_name || s.title || "Untitled call"}
                    </div>
                    {s.business_name && (
                      <div className="text-xs text-[rgba(255,255,255,0.4)]">
                        {s.business_name}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[rgba(255,255,255,0.7)]">
                    {formatDuration(s.duration_seconds)}
                  </td>
                  <td className="px-4 py-3 text-[rgba(255,255,255,0.7)]">
                    {s.transcript_count || 0}
                  </td>
                  <td className="px-4 py-3">
                    {s.outcome ? (
                      <span
                        className="text-[10px] font-semibold px-2 py-0.5 rounded-full text-white"
                        style={{
                          backgroundColor:
                            OUTCOME_COLORS[s.outcome] || "#1B65A7",
                        }}
                      >
                        {s.outcome}
                      </span>
                    ) : (
                      <span className="text-xs text-[rgba(255,255,255,0.3)]">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-[rgba(255,255,255,0.7)]">
                    {typeof s.score === "number" ? (
                      <span
                        className={`font-semibold ${
                          s.score >= 70
                            ? "text-[#00C9A7]"
                            : s.score >= 40
                            ? "text-[#F5A623]"
                            : "text-[#E74C3C]"
                        }`}
                      >
                        {s.score}
                      </span>
                    ) : (
                      <span className="text-xs text-[rgba(255,255,255,0.3)]">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Detail slide-over */}
      {selectedId && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/60"
          onClick={closeDetail}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-[#0f1d32] border-l border-[rgba(255,255,255,0.1)] w-full max-w-3xl h-full overflow-y-auto"
          >
            <div className="sticky top-0 bg-[#0f1d32] border-b border-[rgba(255,255,255,0.1)] p-5 flex items-center justify-between z-10">
              <div>
                <h3 className="text-lg font-semibold text-white">
                  {detailSession?.title ||
                    detailSession?.contact_name ||
                    "Call details"}
                </h3>
                {detailSession && (
                  <p className="text-xs text-[rgba(255,255,255,0.4)] mt-1">
                    {detailSession.rep_name} &middot;{" "}
                    {formatRelativeTime(detailSession.started_at)} &middot;{" "}
                    {formatDuration(detailSession.duration_seconds)}
                  </p>
                )}
              </div>
              <button
                onClick={closeDetail}
                className="text-[rgba(255,255,255,0.4)] hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-5">
              {loadingDetail ? (
                <div className="text-[rgba(255,255,255,0.4)] text-sm">
                  Loading...
                </div>
              ) : !detailSession ? (
                <div className="text-[rgba(255,255,255,0.4)] text-sm">
                  Call not found.
                </div>
              ) : (
                <>
                  {/* Meta editor */}
                  <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 mb-6 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase tracking-wide flex items-center gap-1">
                          <User size={10} /> Contact
                        </span>
                        <input
                          defaultValue={detailSession.contact_name || ""}
                          onBlur={(e) =>
                            updateSessionMeta({
                              contact_name: e.target.value || null,
                            })
                          }
                          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1.5 text-sm text-white mt-1 focus:outline-none focus:border-[#00C9A7]"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase tracking-wide flex items-center gap-1">
                          <Building2 size={10} /> Business
                        </span>
                        <input
                          defaultValue={detailSession.business_name || ""}
                          onBlur={(e) =>
                            updateSessionMeta({
                              business_name: e.target.value || null,
                            })
                          }
                          className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1.5 text-sm text-white mt-1 focus:outline-none focus:border-[#00C9A7]"
                        />
                      </label>
                    </div>
                    <label className="block">
                      <span className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase tracking-wide">
                        Outcome
                      </span>
                      <select
                        value={detailSession.outcome || ""}
                        onChange={(e) =>
                          updateSessionMeta({
                            outcome: e.target.value || null,
                          })
                        }
                        className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1.5 text-sm text-white mt-1 focus:outline-none focus:border-[#00C9A7]"
                      >
                        <option value="" className="bg-[#0f1d32]">
                          —
                        </option>
                        {OUTCOMES.filter((o) => o.value !== "all").map((o) => (
                          <option
                            key={o.value}
                            value={o.value}
                            className="bg-[#0f1d32]"
                          >
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="block">
                      <span className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase tracking-wide">
                        Notes
                      </span>
                      <textarea
                        defaultValue={detailSession.notes || ""}
                        onBlur={(e) =>
                          updateSessionMeta({ notes: e.target.value || null })
                        }
                        rows={2}
                        placeholder="Coaching notes for this call..."
                        className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-2 py-1.5 text-sm text-white mt-1 focus:outline-none focus:border-[#00C9A7] resize-none"
                      />
                    </label>
                    {savingMeta && (
                      <p className="text-[10px] text-[rgba(255,255,255,0.3)]">
                        Saving...
                      </p>
                    )}
                  </div>

                  {/* Stats */}
                  <div className="grid grid-cols-3 gap-3 mb-6">
                    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
                      <div className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase">
                        Duration
                      </div>
                      <div className="text-lg font-semibold text-white mt-1 flex items-center gap-1">
                        <Clock size={14} />
                        {formatDuration(detailSession.duration_seconds)}
                      </div>
                    </div>
                    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
                      <div className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase">
                        Suggestions
                      </div>
                      <div className="text-lg font-semibold text-white mt-1">
                        {detailSession.suggestions_clicked || 0} /{" "}
                        {detailSession.suggestions_shown || 0}
                      </div>
                    </div>
                    <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
                      <div className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase">
                        Transcript Lines
                      </div>
                      <div className="text-lg font-semibold text-white mt-1">
                        {transcript.length}
                      </div>
                    </div>
                  </div>

                  {/* Transcript */}
                  <h4 className="text-sm font-semibold text-white mb-3">
                    Transcript
                  </h4>
                  <TranscriptViewer transcript={transcript} />
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
