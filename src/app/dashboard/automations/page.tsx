"use client";

import { useState, useEffect } from "react";
import { Zap, Play, Pause, Clock, ArrowRight } from "lucide-react";
import { DEFAULT_AUTOMATIONS, type AutomationRule } from "@/config/automations";
import { formatRelativeTime } from "@/lib/utils";

interface AutomationLog {
  id: string;
  opportunity_id: string;
  contact_id: string;
  from_stage: string | null;
  to_stage: string | null;
  action_type: string;
  template_slug: string | null;
  status: string;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export default function AutomationsPage() {
  const [rules, setRules] = useState<AutomationRule[]>(DEFAULT_AUTOMATIONS);
  const [logs, setLogs] = useState<AutomationLog[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [activeTab, setActiveTab] = useState<"rules" | "history">("rules");
  const [filterPipeline, setFilterPipeline] = useState<"all" | "New Deals" | "Active Deals">("all");
  const [runningStaleCheck, setRunningStaleCheck] = useState(false);

  useEffect(() => {
    fetchLogs();
  }, []);

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/automations/logs");
      const data = await res.json();
      setLogs(data.logs || []);
    } catch {
      setLogs([]);
    }
    setLoadingLogs(false);
  };

  const toggleRule = (ruleId: string) => {
    setRules((prev) =>
      prev.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r))
    );
  };

  const handleRunStaleCheck = async () => {
    setRunningStaleCheck(true);
    try {
      await fetch("/api/cron/stale-deals");
      fetchLogs();
    } catch {
      // Error
    }
    setRunningStaleCheck(false);
  };

  const filteredRules = rules.filter(
    (r) => filterPipeline === "all" || r.pipeline === filterPipeline
  );

  const onEnterRules = filteredRules.filter((r) => r.trigger === "on_enter");
  const staleRules = filteredRules.filter((r) => r.trigger === "stale");

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Automations</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            Auto-send SMS & Email when deals move stages
          </p>
        </div>
        <button
          onClick={handleRunStaleCheck}
          disabled={runningStaleCheck}
          className="flex items-center gap-2 px-4 py-2 bg-[rgba(255,255,255,0.08)] text-white rounded-lg text-sm hover:bg-[rgba(255,255,255,0.12)] disabled:opacity-50 transition-colors"
        >
          <Clock size={14} />
          {runningStaleCheck ? "Checking..." : "Run Stale Check"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {(["rules", "history"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? "bg-[#00C9A7] text-[#0B1426]"
                : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.08)]"
            }`}
          >
            {tab === "rules" ? "Automation Rules" : "Execution History"}
          </button>
        ))}
      </div>

      {activeTab === "rules" && (
        <>
          {/* Pipeline filter */}
          <div className="flex gap-1 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-1 mb-6 w-fit">
            {(["all", "New Deals", "Active Deals"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setFilterPipeline(p)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  filterPipeline === p
                    ? "bg-[rgba(255,255,255,0.1)] text-white"
                    : "text-[rgba(255,255,255,0.4)] hover:text-white"
                }`}
              >
                {p === "all" ? "All Pipelines" : p}
              </button>
            ))}
          </div>

          {/* On Enter Rules */}
          <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.6)] mb-3 uppercase tracking-wider">
            Stage Entry Automations
          </h3>
          <div className="space-y-2 mb-8">
            {onEnterRules.map((rule) => (
              <AutomationRuleCard key={rule.id} rule={rule} onToggle={toggleRule} />
            ))}
          </div>

          {/* Stale Rules */}
          <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.6)] mb-3 uppercase tracking-wider">
            Stale Deal Alerts
          </h3>
          <div className="space-y-2">
            {staleRules.map((rule) => (
              <AutomationRuleCard key={rule.id} rule={rule} onToggle={toggleRule} />
            ))}
          </div>
        </>
      )}

      {activeTab === "history" && (
        <div className="space-y-2">
          {loadingLogs ? (
            <>
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 animate-pulse h-16" />
              ))}
            </>
          ) : logs.length === 0 ? (
            <div className="text-center py-16 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl">
              <Zap size={40} className="mx-auto text-[rgba(255,255,255,0.2)] mb-4" />
              <p className="text-lg text-[rgba(255,255,255,0.4)] mb-2">No automation history yet</p>
              <p className="text-sm text-[rgba(255,255,255,0.3)]">
                Automations will fire when deals move stages in GHL
              </p>
            </div>
          ) : (
            logs.map((log) => (
              <div
                key={log.id}
                className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl px-4 py-3"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      log.status === "success" ? "bg-[#00C9A7]" :
                      log.status === "failed" ? "bg-[#E74C3C]" :
                      "bg-[#F5A623]"
                    }`} />
                    <div>
                      <span className="text-sm text-white">
                        {log.action_type === "stage_change" ? (
                          <span className="flex items-center gap-1">
                            {log.from_stage || "New"} <ArrowRight size={12} /> {log.to_stage}
                          </span>
                        ) : (
                          <span>
                            {log.action_type}{log.template_slug ? `: ${log.template_slug}` : ""}
                          </span>
                        )}
                      </span>
                      {log.error && (
                        <p className="text-xs text-[#E74C3C]">{log.error}</p>
                      )}
                    </div>
                  </div>
                  <span className="text-xs text-[rgba(255,255,255,0.3)]">
                    {formatRelativeTime(log.created_at)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function AutomationRuleCard({
  rule,
  onToggle,
}: {
  rule: AutomationRule;
  onToggle: (id: string) => void;
}) {
  const actionIcons: Record<string, string> = {
    send_sms: "SMS",
    send_email: "Email",
    add_tag: "+Tag",
    remove_tag: "-Tag",
    notify_team: "Alert",
  };

  return (
    <div className={`bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 ${
      !rule.enabled ? "opacity-50" : ""
    }`}>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className={rule.enabled ? "text-[#00C9A7]" : "text-[rgba(255,255,255,0.3)]"} />
            <span className="text-sm font-semibold text-white">{rule.description}</span>
          </div>
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] font-mono">
              {rule.pipeline}
            </span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]">
              {rule.trigger === "on_enter" ? `On enter: ${rule.stage}` : `Stale ${rule.staleDays}d: ${rule.stage}`}
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {rule.actions.map((action, i) => (
              <span
                key={i}
                className={`text-[10px] px-1.5 py-0.5 rounded font-mono ${
                  action.type === "send_sms"
                    ? "bg-[#00C9A7]/10 text-[#00C9A7]"
                    : action.type === "send_email"
                    ? "bg-[#1B65A7]/10 text-[#1B65A7]"
                    : action.type === "notify_team"
                    ? "bg-[#F5A623]/10 text-[#F5A623]"
                    : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)]"
                }`}
              >
                {actionIcons[action.type] || action.type}
                {action.delayMinutes ? ` (${action.delayMinutes}m delay)` : ""}
              </span>
            ))}
          </div>
        </div>
        <button
          onClick={() => onToggle(rule.id)}
          className={`flex items-center gap-1 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
            rule.enabled
              ? "bg-[#00C9A7]/10 text-[#00C9A7] hover:bg-[#00C9A7]/20"
              : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)] hover:text-white"
          }`}
        >
          {rule.enabled ? <Play size={12} /> : <Pause size={12} />}
          {rule.enabled ? "Active" : "Paused"}
        </button>
      </div>
    </div>
  );
}
