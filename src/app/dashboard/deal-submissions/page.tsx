"use client";

import { useEffect, useState } from "react";
import { Send, ExternalLink } from "lucide-react";

interface Submission {
  id: string;
  submitted_at: string | null;
  amount_requested: number | null;
  status: "pending" | "approved" | "declined" | "counter";
  last_funder_response_at: string | null;
  follow_up_sent: boolean;
  onedrive_folder_url: string | null;
  notes: string | null;
  approved_amount: number | null;
  buy_rate: number | null;
  sell_rate: number | null;
  term: string | null;
  lenders: { name: string; submission_email: string | null; tier: number } | null;
  contacts: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
}

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-[rgba(245,166,35,0.15)] text-[#F5A623]",
  approved: "bg-[rgba(76,175,80,0.15)] text-[#4CAF50]",
  declined: "bg-[rgba(231,76,60,0.15)] text-[#E74C3C]",
  counter: "bg-[rgba(27,101,167,0.15)] text-[#1B65A7]",
};

const STATUS_CHOICES: Submission["status"][] = ["pending", "approved", "counter", "declined"];

export default function DealSubmissionsPage() {
  const [rows, setRows] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Submission["status"]>("all");

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

  const patchField = async (id: string, field: string, value: string | number | null) => {
    const res = await fetch("/api/deal-submissions", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, [field]: value }),
    });
    if (!res.ok) return;
    const data = await res.json();
    if (data.submission) {
      setRows((prev) => prev.map((r) => (r.id === id ? (data.submission as Submission) : r)));
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(0,201,167,0.15)]">
            <Send className="h-5 w-5 text-[#00C9A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Lender Submissions</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">{rows.length} submissions — click any cell to edit</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        {(["all", "pending", "approved", "counter", "declined"] as const).map((s) => (
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
              <th className="text-left px-3 py-3">Merchant</th>
              <th className="text-left px-3 py-3">Lender</th>
              <th className="text-left px-3 py-3">Approval</th>
              <th className="text-left px-3 py-3">Buy</th>
              <th className="text-left px-3 py-3">Sell</th>
              <th className="text-left px-3 py-3">Term</th>
              <th className="text-left px-3 py-3">Status</th>
              <th className="text-left px-3 py-3">Notes</th>
              <th className="text-left px-3 py-3">Silent</th>
              <th className="text-left px-3 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">No submissions.</td></tr>
            ) : rows.map((r) => {
              const silent = silentHours(r);
              const red = silent !== null && silent >= 24;
              const merchant = r.contacts?.business_name
                ?? `${r.contacts?.first_name ?? ""} ${r.contacts?.last_name ?? ""}`.trim()
                ?? "—";
              return (
                <tr key={r.id} className={`border-t border-[rgba(255,255,255,0.05)] ${red ? "bg-[rgba(231,76,60,0.05)]" : ""}`}>
                  <td className="px-3 py-2 text-white text-xs">{merchant || "—"}</td>
                  <td className="px-3 py-2 text-xs text-[rgba(255,255,255,0.7)]">{r.lenders?.name ?? "—"}</td>
                  <td className="px-3 py-2"><NumberCell value={r.approved_amount} prefix="$" onSave={(v) => patchField(r.id, "approved_amount", v)} /></td>
                  <td className="px-3 py-2"><NumberCell value={r.buy_rate} onSave={(v) => patchField(r.id, "buy_rate", v)} /></td>
                  <td className="px-3 py-2"><NumberCell value={r.sell_rate} onSave={(v) => patchField(r.id, "sell_rate", v)} /></td>
                  <td className="px-3 py-2"><TextCell value={r.term} placeholder="40 weeks" onSave={(v) => patchField(r.id, "term", v)} /></td>
                  <td className="px-3 py-2">
                    <select
                      value={r.status}
                      onChange={(e) => patchField(r.id, "status", e.target.value)}
                      className={`px-2 py-0.5 rounded text-xs border-0 outline-none cursor-pointer ${STATUS_COLORS[r.status] ?? "bg-[rgba(255,255,255,0.1)]"}`}
                    >
                      {STATUS_CHOICES.map((s) => <option key={s} value={s}>{s}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 min-w-[220px]"><TextCell value={r.notes} placeholder="Approved / decline reason / pending stips..." onSave={(v) => patchField(r.id, "notes", v)} /></td>
                  <td className={`px-3 py-2 text-xs ${red ? "text-[#E74C3C] font-semibold" : "text-[rgba(255,255,255,0.5)]"}`}>{silent !== null ? `${silent}h` : "—"}</td>
                  <td className="px-3 py-2 text-xs">
                    {r.onedrive_folder_url && (
                      <a href={r.onedrive_folder_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[#1B65A7] hover:underline">
                        <ExternalLink size={11} />
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

function NumberCell({ value, prefix, onSave }: { value: number | null; prefix?: string; onSave: (v: number | null) => void }) {
  const [local, setLocal] = useState(value != null ? String(value) : "");
  useEffect(() => { setLocal(value != null ? String(value) : ""); }, [value]);

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === "") {
      if (value !== null) onSave(null);
      return;
    }
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n === value) return;
    onSave(n);
  };

  return (
    <div className="flex items-center gap-1">
      {prefix && <span className="text-xs text-[rgba(255,255,255,0.3)]">{prefix}</span>}
      <input
        type="text"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="w-20 bg-transparent border-0 outline-none text-xs text-white focus:bg-[rgba(255,255,255,0.05)] focus:px-1 focus:rounded"
        placeholder="—"
      />
    </div>
  );
}

function TextCell({ value, placeholder, onSave }: { value: string | null; placeholder?: string; onSave: (v: string | null) => void }) {
  const [local, setLocal] = useState(value ?? "");
  useEffect(() => { setLocal(value ?? ""); }, [value]);

  const commit = () => {
    const trimmed = local.trim();
    const next = trimmed === "" ? null : trimmed;
    if (next === value) return;
    onSave(next);
  };

  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-full bg-transparent border-0 outline-none text-xs text-white focus:bg-[rgba(255,255,255,0.05)] focus:px-1 focus:rounded"
      placeholder={placeholder ?? "—"}
    />
  );
}
