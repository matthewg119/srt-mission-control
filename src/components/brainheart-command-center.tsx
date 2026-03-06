"use client";

import { useState, useEffect, Suspense } from "react";
import { Brain, Activity, CheckSquare, Clock, TrendingUp, Zap } from "lucide-react";
import { ChatInterface } from "@/components/chat-interface";
import Link from "next/link";

interface ActivityEntry {
  event_type: string;
  description: string;
  relativeTime: string;
}

interface PulseData {
  id: string;
  pulse_type: string;
  summary: string;
  metrics: Record<string, number>;
  created_at: string;
}

interface TaskSummary {
  id: string;
  title: string;
  priority: string;
  type: string;
  status: string;
}

interface BrainHeartCommandCenterProps {
  userName?: string;
  recentActivity?: ActivityEntry[];
}

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#E74C3C",
  high: "#F5A623",
  medium: "#1B65A7",
  low: "rgba(255,255,255,0.3)",
};

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function BrainHeartCommandCenter({ userName, recentActivity }: BrainHeartCommandCenterProps) {
  const [pulse, setPulse] = useState<PulseData | null>(null);
  const [tasks, setTasks] = useState<TaskSummary[]>([]);
  const [activeTab, setActiveTab] = useState<"chat" | "overview">("overview");

  useEffect(() => {
    // Fetch latest pulse
    fetch("/api/brainheart/pulse")
      .then((r) => r.json())
      .then((d) => { if (d.pulse) setPulse(d.pulse); })
      .catch(() => {});

    // Fetch pending tasks
    fetch("/api/tasks?status=pending&limit=8")
      .then((r) => r.json())
      .then((d) => { if (d.tasks) setTasks(d.tasks); })
      .catch(() => {});
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Top bar with tabs */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[rgba(0,201,167,0.15)] flex items-center justify-center">
            <Brain size={16} className="text-[#00C9A7]" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">BrainHeart</h1>
            <p className="text-xs text-[rgba(255,255,255,0.4)]">
              {pulse ? `Last pulse: ${formatRelative(pulse.created_at)}` : "AI Operating System"}
            </p>
          </div>
        </div>

        <div className="flex gap-1 bg-[rgba(255,255,255,0.03)] rounded-lg p-0.5">
          <button
            onClick={() => setActiveTab("overview")}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === "overview"
                ? "bg-[rgba(0,201,167,0.15)] text-[#00C9A7]"
                : "text-[rgba(255,255,255,0.4)] hover:text-white"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab("chat")}
            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
              activeTab === "chat"
                ? "bg-[rgba(0,201,167,0.15)] text-[#00C9A7]"
                : "text-[rgba(255,255,255,0.4)] hover:text-white"
            }`}
          >
            Chat
          </button>
        </div>
      </div>

      {activeTab === "chat" ? (
        <div className="flex-1 overflow-hidden">
          <Suspense fallback={null}>
            <ChatInterface userName={userName} recentActivity={recentActivity} />
          </Suspense>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Pulse Summary */}
          {pulse && (
            <div className="bg-[rgba(0,201,167,0.04)] border border-[rgba(0,201,167,0.12)] rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap size={14} className="text-[#00C9A7]" />
                <span className="text-xs font-medium text-[#00C9A7] uppercase tracking-wider">
                  Latest Pulse — {pulse.pulse_type.replace(/_/g, " ")}
                </span>
                <span className="text-xs text-[rgba(255,255,255,0.3)] ml-auto">{formatRelative(pulse.created_at)}</span>
              </div>
              <p className="text-sm text-white">{pulse.summary}</p>

              {pulse.metrics && Object.keys(pulse.metrics).length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                  {Object.entries(pulse.metrics).map(([key, val]) => (
                    <div key={key} className="bg-[rgba(0,0,0,0.2)] rounded-lg px-3 py-2">
                      <div className="text-lg font-bold text-white">{val}</div>
                      <div className="text-[10px] text-[rgba(255,255,255,0.4)] uppercase">{key}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* No pulse yet */}
          {!pulse && (
            <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-6 text-center">
              <Brain size={32} className="mx-auto mb-3 text-[rgba(255,255,255,0.15)]" />
              <p className="text-sm text-[rgba(255,255,255,0.4)]">
                BrainHeart hasn&apos;t run a pulse yet. Set up the cron schedule to activate autonomous thinking.
              </p>
              <p className="text-xs text-[rgba(255,255,255,0.25)] mt-2">
                Pulses run at 9am, 12pm, 3pm, 6pm EST
              </p>
            </div>
          )}

          {/* Today's Tasks */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CheckSquare size={14} className="text-[rgba(255,255,255,0.4)]" />
                <h2 className="text-sm font-semibold text-white">Pending Tasks</h2>
              </div>
              <Link href="/dashboard/tasks" className="text-xs text-[#00C9A7] hover:underline">
                View all
              </Link>
            </div>

            {tasks.length === 0 ? (
              <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-4 text-center">
                <p className="text-xs text-[rgba(255,255,255,0.3)]">No pending tasks</p>
              </div>
            ) : (
              <div className="space-y-1">
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-2.5"
                  >
                    <div
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: PRIORITY_COLORS[task.priority] }}
                    />
                    <span className="text-sm text-white flex-1 truncate">{task.title}</span>
                    <span className="text-[10px] text-[rgba(255,255,255,0.25)]">
                      {task.type.replace(/_/g, " ")}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recent Activity */}
          {recentActivity && recentActivity.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Activity size={14} className="text-[rgba(255,255,255,0.4)]" />
                <h2 className="text-sm font-semibold text-white">Recent Activity</h2>
              </div>
              <div className="space-y-1">
                {recentActivity.slice(0, 8).map((log, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-2.5"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-1.5 h-1.5 rounded-full bg-[#00C9A7] shrink-0" />
                      <span className="text-sm text-[rgba(255,255,255,0.7)]">{log.description}</span>
                    </div>
                    <span className="text-xs text-[rgba(255,255,255,0.2)] whitespace-nowrap ml-3">
                      {log.relativeTime}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
