"use client";

import { useEffect, useState } from "react";
import { Send, ExternalLink } from "lucide-react";

interface Submission {
  id: string;
  submitted_at: string | null;
  amount_requested: number | null;
  status: string;
  last_funder_response_at: string | null;
  follow_up_sent: boolean;
  onedrive_folder_url: string | null;
  notes: string | null;
  lenders: { name: string; submission_email: string | null; tier: number } | null;
  contacts: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[rgba(245,166,35,0.15)] text-[#F5A623]",
  approved: "bg-[rgba(76,175,80,0.15)] text-[#4CAF50]",
  declined: "bg-[rgba(231,76,60,0.15)] text-[#E74C3C]",
  counter: "bg-[rgba(27,101,167,0.15)] text-[#1B65A7]",
};

export default function DealSubmissionsPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "approved" | "declined" | "counter">("all");

  const load = () => {
    const params = new URLSearchParams({ limit: "200" });
    if (filter !== "all") params.set("status", filter);
    setLoading(true);
    fetch(`/api/deal-submissions?${params}`)
      .then((r) => r.json())
      .then((d) => setRows(d.submissions ?? []))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [filter]);

  const silentHours = (r: Submission): number | null => {
    if (!r.submitted_at || r.last_funder_response_at) return null;
    return Math.floor((Date.now() - new Date(r.submitted_at).getTime()) / (1000 * 60 * 60));
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.15)]">
            <Send className="h-5 w-5 text-[#00C9A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Deal Submissions</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">{rows.length} submissions</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {(["all", "pending", "approved", "declined", "counter"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === s ? "bg-[rgba(0,201,167,0.2)] text-[#00C9A7]" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
          >
            {s}
          </button>
        ))}
      </div>

      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[rgba(255,255,255,0.04)] text-xs text-[rgba(255,255,255,0.5)]">
            <tr>
              <th className="text-left px-4 py-3">Merchant</th>
              <th className="text-left px-4 py-3">Lender</th>
              <th className="text-left px-4 py-3">Amount</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Submitted</th>
              <th className="text-left px-4 py-3">Hours Silent</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">No submissions.</td></tr>
            ) : rows.map((r) => {
              const silent = silentHours(r);
              const red = silent !== null && silent >= 24;
              return (
                <tr key={r.id} className={`border-t border-[rgba(255,255,255,0.05)] ${red ? "bg-[rgba(231,76,60,0.05)]" : ""}`}>
                  <td className="px-4 py-3 text-white">{(r.contacts?.business_name ?? (`${r.contacts?.first_name ?? ""} ${r.contacts?.last_name ?? ""}`.trim())) || "—"}</td>
                  <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.6)]">{r.lenders?.name ?? "—"}{r.lenders?.tier ? ` (T${r.lenders.tier})` : ""}</td>
                  <td className="px-4 py-3 text-xs">${(r.amount_requested ?? 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-xs"><span className={`px-2 py-0.5 rounded ${STATUS_COLORS[r.status] ?? "bg-[rgba(255,255,255,0.1)]"}`}>{r.status}</span></td>
                  <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.5)]">{r.submitted_at ? new Date(r.submitted_at).toLocaleString() : "—"}</td>
                  <td className={`px-4 py-3 text-xs ${red ? "text-[#E74C3C] font-semibold" : "text-[rgba(255,255,255,0.5)]"}`}>{silent !== null ? `${silent}h` : "—"}</td>
                  <td className="px-4 py-3 text-xs">
                    {r.onedrive_folder_url && (
                      <a href={r.onedrive_folder_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1B65A7] hover:underline">
                        <ExternalLink size={11} />
                        OneDrive
                      </a>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
