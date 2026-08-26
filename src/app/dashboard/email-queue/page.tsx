"use client";

import { useEffect, useState } from "react";
import { Mail } from "lucide-react";

interface PendingEmail {
  id: string;
  created_at: string;
  payload: { subject?: string; body?: string; to?: string };
  status: string;
  contacts: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
}

interface UpcomingEmail {
  id: string;
  contact_name: string | null;
  next_send_at: string;
  current_step: number;
  email_sequences: { name: string; slug: string } | null;
}

export default function EmailQueuePage() {
  const [pending, setPending] = useState<PendingEmail[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingEmail[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/email-queue")
      .then((r) => r.json())
      .then((d) => {
        setPending(d.pending ?? []);
        setUpcoming(d.upcoming ?? []);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(27,101,167,0.15)]">
            <Mail className="h-5 w-5 text-[#0E8C77]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Email Queue</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">{pending.length} pending approval, {upcoming.length} sequence emails in next 24h</p>
          </div>
        </div>
      </div>

      <h2 className="text-sm font-semibold text-white mb-3">Pending AI-drafted emails</h2>
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden mb-8">
        <table className="w-full text-sm">
          <thead className="bg-[rgba(255,255,255,0.04)] text-xs text-[rgba(255,255,255,0.5)]">
            <tr>
              <th className="text-left px-4 py-3">Merchant</th>
              <th className="text-left px-4 py-3">Subject</th>
              <th className="text-left px-4 py-3">Preview</th>
              <th className="text-left px-4 py-3">Created</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">Loading...</td></tr>
            ) : pending.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">Nothing awaiting approval. Clean queue.</td></tr>
            ) : pending.map((p) => (
              <tr key={p.id} className="border-t border-[rgba(255,255,255,0.05)]">
                <td className="px-4 py-3 text-white">{(p.contacts?.business_name ?? (`${p.contacts?.first_name ?? ""} ${p.contacts?.last_name ?? ""}`.trim())) || "—"}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.7)]">{p.payload.subject ?? "(no subject)"}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.4)] max-w-xs truncate">{p.payload.body?.slice(0, 120) ?? ""}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.4)]">{new Date(p.created_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="text-sm font-semibold text-white mb-3">Sequence drips (next 24h)</h2>
      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[rgba(255,255,255,0.04)] text-xs text-[rgba(255,255,255,0.5)]">
            <tr>
              <th className="text-left px-4 py-3">Contact</th>
              <th className="text-left px-4 py-3">Sequence</th>
              <th className="text-left px-4 py-3">Step</th>
              <th className="text-left px-4 py-3">Scheduled</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">Loading...</td></tr>
            ) : upcoming.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">No sequence emails in next 24h.</td></tr>
            ) : upcoming.map((u) => (
              <tr key={u.id} className="border-t border-[rgba(255,255,255,0.05)]">
                <td className="px-4 py-3 text-white">{u.contact_name ?? "—"}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.6)]">{u.email_sequences?.name ?? "—"}</td>
                <td className="px-4 py-3 text-xs">{u.current_step + 1}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.5)]">{new Date(u.next_send_at).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
