"use client";

import { useEffect, useState } from "react";
import { Brain, Filter } from "lucide-react";

interface Decision {
  id: string;
  created_at: string;
  merchant_id: string | null;
  zoho_id: string | null;
  trigger_type: string;
  state_classified: string | null;
  action_taken: string | null;
  was_approved: boolean | null;
  approved_by: string | null;
  reasoning: string | null;
  model_used: string | null;
  latency_ms: number | null;
  meta_capi_event_fired: string | null;
  contacts: { business_name: string | null; first_name: string | null; last_name: string | null } | null;
}

const TRIGGERS = ["all", "cron", "webhook_zoho", "inbound_email", "slack_command"] as const;
const ACTIONS = ["all", "suppress", "submit_deal", "draft_email", "slack_alert", "none"] as const;

export default function AIDecisionsPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [trigger, setTrigger] = useState<(typeof TRIGGERS)[number]>("all");
  const [action, setAction] = useState<(typeof ACTIONS)[number]>("all");
  const [selected, setSelected] = useState<Decision | null>(null);

  useEffect(() => {
    const params = new URLSearchParams({ limit: "100" });
    if (trigger !== "all") params.set("trigger", trigger);
    if (action !== "all") params.set("action", action);

    setLoading(true);
    fetch(`/api/ai-decisions?${params}`)
      .then((r) => r.json())
      .then((d) => setDecisions(d.decisions ?? []))
      .finally(() => setLoading(false));
  }, [trigger, action]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(139,92,246,0.15)]">
            <Brain className="h-5 w-5 text-[#8b5cf6]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">AI Decisions</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">{decisions.length} decisions logged</p>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Filter size={14} className="text-[rgba(255,255,255,0.4)]" />
          <span className="text-xs text-[rgba(255,255,255,0.4)]">Trigger:</span>
          {TRIGGERS.map((t) => (
            <button
              key={t}
              onClick={() => setTrigger(t)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${trigger === t ? "bg-[rgba(139,92,246,0.2)] text-[#8b5cf6]" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[rgba(255,255,255,0.4)]">Action:</span>
          {ACTIONS.map((a) => (
            <button
              key={a}
              onClick={() => setAction(a)}
              className={`px-3 py-1 rounded-lg text-xs font-medium ${action === a ? "bg-[rgba(0,201,167,0.2)] text-[#00C9A7]" : "text-[rgba(255,255,255,0.4)] hover:text-white"}`}
            >
              {a}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-[rgba(255,255,255,0.04)] text-xs text-[rgba(255,255,255,0.5)]">
            <tr>
              <th className="text-left px-4 py-3">When</th>
              <th className="text-left px-4 py-3">Merchant</th>
              <th className="text-left px-4 py-3">Trigger</th>
              <th className="text-left px-4 py-3">State</th>
              <th className="text-left px-4 py-3">Action</th>
              <th className="text-left px-4 py-3">Approved</th>
              <th className="text-left px-4 py-3">Reasoning</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">Loading...</td></tr>
            ) : decisions.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-[rgba(255,255,255,0.4)]">No decisions match these filters.</td></tr>
            ) : decisions.map((d) => (
              <tr key={d.id} onClick={() => setSelected(d)} className="border-t border-[rgba(255,255,255,0.05)] hover:bg-[rgba(255,255,255,0.03)] cursor-pointer">
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.5)]">{new Date(d.created_at).toLocaleString()}</td>
                <td className="px-4 py-3 text-white">{(d.contacts?.business_name ?? (`${d.contacts?.first_name ?? ""} ${d.contacts?.last_name ?? ""}`.trim())) || "—"}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.6)]">{d.trigger_type}</td>
                <td className="px-4 py-3 text-xs"><span className="px-2 py-0.5 rounded bg-[rgba(27,101,167,0.15)] text-[#1B65A7]">{d.state_classified ?? "—"}</span></td>
                <td className="px-4 py-3 text-xs">{d.action_taken ?? "—"}</td>
                <td className="px-4 py-3 text-xs">{d.was_approved === true ? "✅" : d.was_approved === false ? "❌" : "—"}</td>
                <td className="px-4 py-3 text-xs text-[rgba(255,255,255,0.5)] max-w-xs truncate">{d.reasoning ?? ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setSelected(null)}>
          <div className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6">
              <h2 className="text-lg font-semibold text-white mb-2">AI Decision {selected.id.slice(0, 8)}</h2>
              <p className="text-xs text-[rgba(255,255,255,0.5)] mb-4">{new Date(selected.created_at).toLocaleString()}</p>
              <div className="space-y-2 text-sm text-[rgba(255,255,255,0.7)]">
                <div><strong>Merchant:</strong> {selected.contacts?.business_name ?? "—"}</div>
                <div><strong>Trigger:</strong> {selected.trigger_type}</div>
                <div><strong>State:</strong> {selected.state_classified}</div>
                <div><strong>Action:</strong> {selected.action_taken}</div>
                <div><strong>Approved by:</strong> {selected.approved_by ?? "—"}</div>
                <div><strong>Meta CAPI:</strong> {selected.meta_capi_event_fired ?? "—"}</div>
                <div><strong>Model:</strong> {selected.model_used} ({selected.latency_ms}ms)</div>
                <div><strong>Reasoning:</strong> {selected.reasoning}</div>
              </div>
              <button onClick={() => setSelected(null)} className="mt-6 px-4 py-2 bg-[rgba(255,255,255,0.05)] rounded-lg text-sm text-white">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
