"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Phone,
  Search,
  Filter,
  Clock,
  DollarSign,
  User,
  Building2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import Link from "next/link";
import { generateCallHistory } from "@/config/mock-calls";
import type { MockCall } from "@/config/mock-calls";

const OUTCOME_COLORS: Record<string, string> = {
  interested: "#00C9A7",
  applied: "#1B65A7",
  needs_docs: "#F5A623",
  callback: "#9B59B6",
  not_interested: "#E74C3C",
};

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CallLogPage() {
  const [calls, setCalls] = useState<MockCall[]>([]);
  const [search, setSearch] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    setCalls(generateCallHistory(7, 6));
  }, []);

  const filtered = useMemo(() => {
    let result = calls;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (c) =>
          c.contactName.toLowerCase().includes(q) ||
          c.businessName.toLowerCase().includes(q) ||
          c.industry.toLowerCase().includes(q)
      );
    }
    if (outcomeFilter !== "all") {
      result = result.filter((c) => c.outcome === outcomeFilter);
    }
    return result;
  }, [calls, search, outcomeFilter]);

  const outcomes = ["all", "interested", "applied", "needs_docs", "callback", "not_interested"];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(27,101,167,0.15)]">
          <Phone className="h-5 w-5 text-[#1B65A7]" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-white">Call Log</h1>
          <p className="text-sm text-[rgba(255,255,255,0.4)]">
            {filtered.length} calls in the last 7 days
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-1">
        {[
          { key: "feed", label: "Feed", href: "/dashboard/call-recap" },
          { key: "log", label: "Call Log", href: "/dashboard/call-recap/log" },
          { key: "daily", label: "Daily Recap", href: "/dashboard/call-recap/daily" },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex-1 text-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab.key === "log"
                ? "bg-[rgba(255,255,255,0.08)] text-white"
                : "text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[rgba(255,255,255,0.3)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, business, or industry..."
            className="w-full pl-9 pr-3 py-2.5 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {outcomes.map((o) => (
            <button
              key={o}
              onClick={() => setOutcomeFilter(o)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                outcomeFilter === o
                  ? "bg-[rgba(255,255,255,0.1)] text-white"
                  : "text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.05)]"
              }`}
            >
              {o === "all" ? "All" : o.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {/* Call List */}
      <div className="space-y-2">
        {filtered.length === 0 && (
          <div className="text-center py-12 text-[rgba(255,255,255,0.3)] text-sm">
            No calls match your filters
          </div>
        )}

        {filtered.map((call) => {
          const isExpanded = expandedId === call.id;
          const color = OUTCOME_COLORS[call.outcome] || "#1B65A7";

          return (
            <div
              key={call.id}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl hover:border-[rgba(255,255,255,0.12)] transition-colors"
            >
              <button
                onClick={() => setExpandedId(isExpanded ? null : call.id)}
                className="w-full flex items-center gap-3 p-4 text-left"
              >
                <div
                  className="w-2 h-2 rounded-full shrink-0"
                  style={{ backgroundColor: color }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white truncate">
                      {call.contactName}
                    </span>
                    <span className="text-xs text-[rgba(255,255,255,0.3)]">
                      {call.businessName}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-0.5">
                    <span className="text-xs text-[rgba(255,255,255,0.3)]">
                      {call.industry}
                    </span>
                    <span className="text-xs text-[rgba(255,255,255,0.25)]">
                      ${call.requestedAmount.toLocaleString()}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-[rgba(255,255,255,0.3)]">
                    {formatDuration(call.durationSeconds)}
                  </span>
                  <span
                    className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${color}18`,
                      color,
                    }}
                  >
                    {call.outcome.replace("_", " ")}
                  </span>
                  <span className="text-xs text-[rgba(255,255,255,0.25)]">
                    {formatDate(call.calledAt)}
                  </span>
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-[rgba(255,255,255,0.3)]" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-[rgba(255,255,255,0.3)]" />
                  )}
                </div>
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-[rgba(255,255,255,0.04)]">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-3">
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.3)] mb-1">Phone</p>
                      <p className="text-sm text-white">{call.phone}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.3)] mb-1">Agent</p>
                      <p className="text-sm text-white">{call.agentName}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.3)] mb-1">Funding Purpose</p>
                      <p className="text-sm text-white">{call.fundingPurpose}</p>
                    </div>
                    <div>
                      <p className="text-xs text-[rgba(255,255,255,0.3)] mb-1">Pain Points</p>
                      <div className="flex flex-wrap gap-1">
                        {call.painPoints.map((p) => (
                          <span
                            key={p}
                            className="text-[10px] px-2 py-0.5 bg-[rgba(255,255,255,0.05)] rounded-full text-[rgba(255,255,255,0.5)]"
                          >
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <p className="text-xs text-[rgba(255,255,255,0.3)] mb-1">Summary</p>
                    <p className="text-sm text-[rgba(255,255,255,0.6)]">{call.summary}</p>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
