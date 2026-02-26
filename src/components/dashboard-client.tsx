"use client";

import { useState } from "react";
import { MessageSquare, BookOpen, Kanban, Zap, Activity } from "lucide-react";
import { StatCard } from "./stat-card";
import Link from "next/link";

interface DashboardClientProps {
  userName: string;
  formattedDate: string;
  stats: {
    activeDeals: number;
    thisWeek: number;
    funded: number;
    pendingDocs: number;
  };
  logs: Array<{
    id: string;
    event_type: string;
    description: string;
    relativeTime: string;
  }>;
}

export function DashboardClient({ userName, formattedDate, stats, logs }: DashboardClientProps) {
  const [settingUp, setSettingUp] = useState(false);
  const [setupDone, setSetupDone] = useState(false);
  const [setupResult, setSetupResult] = useState<Record<string, unknown> | null>(null);

  const handleSetupGHL = async () => {
    if (!confirm("This will create 26 custom fields in GoHighLevel. Continue?")) return;
    setSettingUp(true);
    try {
      const res = await fetch("/api/ghl/setup", { method: "POST" });
      const data = await res.json();
      setSetupResult(data);
      setSetupDone(true);
    } catch {
      setSetupResult({ error: "Setup failed" });
    }
    setSettingUp(false);
  };

  const handleSyncPipeline = async () => {
    setSettingUp(true);
    try {
      await fetch("/api/ghl/sync", { method: "POST" });
      window.location.reload();
    } catch {
      // Error
    }
    setSettingUp(false);
  };

  return (
    <div>
      {/* Welcome */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Welcome back, {userName}</h1>
        <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
          SRT Agency Operations Center — {formattedDate}
        </p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Pipeline" value={stats.activeDeals} accentColor="#00C9A7" />
        <StatCard label="This Week" value={stats.thisWeek} accentColor="#1B65A7" />
        <StatCard label="Funded" value={stats.funded} accentColor="#4CAF50" />
        <StatCard label="In Underwriting" value={stats.pendingDocs} accentColor="#F5A623" />
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <Link
          href="/dashboard/assistant"
          className="flex items-center gap-2 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl text-sm text-white hover:border-[rgba(255,255,255,0.12)] transition-colors"
        >
          <MessageSquare size={16} className="text-[#00C9A7]" />
          New Chat
        </Link>
        <Link
          href="/dashboard/knowledge"
          className="flex items-center gap-2 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl text-sm text-white hover:border-[rgba(255,255,255,0.12)] transition-colors"
        >
          <BookOpen size={16} className="text-[#1B65A7]" />
          Knowledge Base
        </Link>
        <Link
          href="/dashboard/pipeline"
          className="flex items-center gap-2 px-4 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl text-sm text-white hover:border-[rgba(255,255,255,0.12)] transition-colors"
        >
          <Kanban size={16} className="text-[#9C27B0]" />
          View Pipeline
        </Link>
        {setupDone ? (
          <button
            onClick={handleSyncPipeline}
            disabled={settingUp}
            className="flex items-center gap-2 px-4 py-3 bg-[#00C9A7] text-[#0B1426] rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Zap size={16} />
            {settingUp ? "Syncing..." : "Sync Pipeline"}
          </button>
        ) : (
          <button
            onClick={handleSetupGHL}
            disabled={settingUp}
            className="flex items-center gap-2 px-4 py-3 bg-[#00C9A7] text-[#0B1426] rounded-xl text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Zap size={16} />
            {settingUp ? "Setting up..." : "Setup GHL"}
          </button>
        )}
      </div>

      {/* Setup Result */}
      {setupResult && (setupResult as Record<string, Record<string, number>>).summary && (
        <div className="mb-6 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
          <h3 className="text-sm font-semibold text-white mb-2">GHL Setup Complete</h3>
          <div className="flex gap-4 text-xs">
            <span className="text-[#00C9A7]">✓ Created: {((setupResult as Record<string, Record<string, number>>).summary).created}</span>
            <span className="text-[#F5A623]">⟳ Skipped: {((setupResult as Record<string, Record<string, number>>).summary).skipped}</span>
            <span className="text-[#E74C3C]">✗ Errors: {((setupResult as Record<string, Record<string, number>>).summary).errors}</span>
          </div>
        </div>
      )}

      {/* Activity Feed */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-[rgba(255,255,255,0.4)]" />
          <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
        </div>
        {logs.length === 0 ? (
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-6 text-center">
            <p className="text-[rgba(255,255,255,0.4)] text-sm">
              No activity yet. Start by setting up your GHL integration.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="flex items-center justify-between bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-2 h-2 rounded-full bg-[#00C9A7]" />
                  <span className="text-sm text-white">{log.description}</span>
                </div>
                <span className="text-xs text-[rgba(255,255,255,0.3)] whitespace-nowrap ml-4">
                  {log.relativeTime}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
