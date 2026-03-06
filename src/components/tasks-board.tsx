"use client";

import { useState, useEffect, useCallback } from "react";
import { CheckSquare, Clock, AlertTriangle, ChevronDown, ChevronRight, Circle } from "lucide-react";

interface Task {
  id: string;
  type: string;
  title: string;
  description: string | null;
  assignee: string;
  department: string;
  priority: string;
  status: string;
  due_date: string | null;
  deal_reference: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  source: string;
  created_at: string;
  completed_at: string | null;
}

const PRIORITY_ORDER = { urgent: 0, high: 1, medium: 2, low: 3 };
const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#E74C3C",
  high: "#F5A623",
  medium: "#1B65A7",
  low: "rgba(255,255,255,0.3)",
};

const STATUS_FILTERS = ["pending", "in_progress", "completed", "dismissed"] as const;

function formatRelative(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TasksBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>("pending");
  const [expandedTask, setExpandedTask] = useState<string | null>(null);

  const fetchTasks = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (filter) params.set("status", filter);
      const res = await fetch(`/api/tasks?${params}`);
      const data = await res.json();
      setTasks(data.tasks || []);
    } catch {
      console.error("Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  const updateTask = async (id: string, status: string) => {
    await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status }),
    });
    fetchTasks();
  };

  const sortedTasks = [...tasks].sort((a, b) => {
    const pa = PRIORITY_ORDER[a.priority as keyof typeof PRIORITY_ORDER] ?? 2;
    const pb = PRIORITY_ORDER[b.priority as keyof typeof PRIORITY_ORDER] ?? 2;
    return pa - pb;
  });

  // Group by priority
  const groups = sortedTasks.reduce<Record<string, Task[]>>((acc, task) => {
    const key = task.priority;
    if (!acc[key]) acc[key] = [];
    acc[key].push(task);
    return acc;
  }, {});

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-6">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => { setFilter(s); setLoading(true); }}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === s
                ? "bg-[rgba(0,201,167,0.15)] border-[rgba(0,201,167,0.3)] text-[#00C9A7]"
                : "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)] hover:border-[rgba(255,255,255,0.12)]"
            }`}
          >
            {s.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[rgba(255,255,255,0.1)] border-t-[#00C9A7] rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-8 text-center">
          <CheckSquare size={24} className="mx-auto mb-2 text-[rgba(255,255,255,0.2)]" />
          <p className="text-sm text-[rgba(255,255,255,0.4)]">No {filter} tasks</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([priority, groupTasks]) => (
            <div key={priority}>
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: PRIORITY_COLORS[priority] }} />
                <span className="text-xs font-medium text-[rgba(255,255,255,0.5)] uppercase tracking-wider">
                  {priority} ({groupTasks.length})
                </span>
              </div>

              <div className="space-y-1">
                {groupTasks.map((task) => (
                  <div
                    key={task.id}
                    className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg hover:border-[rgba(255,255,255,0.1)] transition-colors"
                  >
                    <div
                      className="flex items-center justify-between px-4 py-3 cursor-pointer"
                      onClick={() => setExpandedTask(expandedTask === task.id ? null : task.id)}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        {expandedTask === task.id ? (
                          <ChevronDown size={14} className="text-[rgba(255,255,255,0.3)] shrink-0" />
                        ) : (
                          <ChevronRight size={14} className="text-[rgba(255,255,255,0.3)] shrink-0" />
                        )}
                        <Circle
                          size={8}
                          className="shrink-0"
                          style={{ color: PRIORITY_COLORS[task.priority], fill: PRIORITY_COLORS[task.priority] }}
                        />
                        <span className="text-sm text-white truncate">{task.title}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)] shrink-0">
                          {task.type.replace(/_/g, " ")}
                        </span>
                      </div>

                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <span className="text-xs text-[rgba(255,255,255,0.3)]">{task.assignee}</span>
                        <span className="text-xs text-[rgba(255,255,255,0.2)]">{formatRelative(task.created_at)}</span>
                        {task.status === "pending" && (
                          <div className="flex gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); updateTask(task.id, "completed"); }}
                              className="text-[10px] px-2 py-1 rounded bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)] transition-colors"
                            >
                              Done
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); updateTask(task.id, "dismissed"); }}
                              className="text-[10px] px-2 py-1 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)] hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                        {task.status === "in_progress" && (
                          <button
                            onClick={(e) => { e.stopPropagation(); updateTask(task.id, "completed"); }}
                            className="text-[10px] px-2 py-1 rounded bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)] transition-colors"
                          >
                            Complete
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Expanded detail */}
                    {expandedTask === task.id && (
                      <div className="px-4 pb-3 border-t border-[rgba(255,255,255,0.04)]">
                        <div className="pt-3 space-y-2">
                          {task.description && (
                            <p className="text-sm text-[rgba(255,255,255,0.6)]">{task.description}</p>
                          )}
                          <div className="flex items-center gap-4 text-xs text-[rgba(255,255,255,0.3)]">
                            <span className="flex items-center gap-1">
                              <Clock size={10} /> {task.source}
                            </span>
                            {task.department !== "general" && (
                              <span className="flex items-center gap-1">
                                <AlertTriangle size={10} /> {task.department}
                              </span>
                            )}
                            {task.due_date && <span>Due: {task.due_date}</span>}
                          </div>
                          {task.deal_reference && (
                            <div className="text-xs text-[rgba(255,255,255,0.3)]">
                              Deal: {JSON.stringify(task.deal_reference)}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
