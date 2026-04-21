"use client";

import { useEffect, useState } from "react";
import { Clock } from "lucide-react";

interface Lead {
  id: string;
  name: string;
  business_name: string | null;
  phone: string | null;
  email: string | null;
  application_signed_at: string;
  hours_in_limbo: number;
  last_nudge_posted_at: string | null;
  awaiting_escalation_fired_at: string | null;
  ad_source: string | null;
}

function formatPhone(p: string | null): string {
  if (!p) return "—";
  const d = p.replace(/\D/g, "").replace(/^1/, "");
  if (d.length !== 10) return p;
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function formatLimbo(h: number): string {
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

export default function AwaitingStatementsPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/leads/awaiting-statements")
      .then((r) => r.json())
      .then((d) => setLeads(d.leads ?? []))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(245,166,35,0.15)]">
            <Clock className="h-5 w-5 text-[#F5A623]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Awaiting Statements</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">
              {leads.length} merchant{leads.length === 1 ? "" : "s"} signed the application but haven&apos;t uploaded bank statements yet
            </p>
          </div>
        </div>
      </div>

      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[rgba(255,255,255,0.04)] text-xs text-[rgba(255,255,255,0.5)]">
            <tr>
              <th className="text-left px-4 py-3">Merchant</th>
              <th className="text-left px-4 py-3">Phone</th>
              <th className="text-left px-4 py-3">In Limbo</th>
              <th className="text-left px-4 py-3">Last Nudge</th>
              <th className="text-left px-4 py-3">Escalation</th>
              <th className="text-left px-4 py-3">Source</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">
                  Loading...
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">
                  Nothing here. Everyone who signed has uploaded statements.
                </td>
              </tr>
            ) : (
              leads.map((l) => {
                const urgent = l.hours_in_limbo >= 168;
                const warning = l.hours_in_limbo >= 72 && l.hours_in_limbo < 168;
                const color = urgent ? "#ef4444" : warning ? "#F5A623" : "rgba(255,255,255,0.7)";
                return (
                  <tr key={l.id} className="border-t border-[rgba(255,255,255,0.05)]">
                    <td className="px-4 py-3">
                      <div className="text-white">{l.name}</div>
                      {l.business_name && (
                        <div className="text-xs text-[rgba(255,255,255,0.4)]">{l.business_name}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.7)]">{formatPhone(l.phone)}</td>
                    <td className="px-4 py-3 text-xs font-semibold" style={{ color }}>
                      {formatLimbo(l.hours_in_limbo)}
                    </td>
                    <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.5)]">
                      {l.last_nudge_posted_at
                        ? new Date(l.last_nudge_posted_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.5)]">
                      {l.awaiting_escalation_fired_at
                        ? new Date(l.awaiting_escalation_fired_at).toLocaleString()
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.4)]">{l.ad_source || "—"}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
