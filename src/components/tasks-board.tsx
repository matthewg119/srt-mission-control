"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { CheckSquare, Clock, ChevronDown, ChevronRight, Circle, AlertTriangle } from "lucide-react";
import {
  bucketTasks,
  formatDueDate,
  fromOpsTask,
  overdueDays,
  type FeedStatus,
  type FeedTask,
} from "@/lib/task-feed";

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "#E74C3C",
  high: "#F5A623",
  medium: "#1B65A7",
  low: "rgba(255,255,255,0.3)",
};

// Matches the tasks.status CHECK and maps cleanly onto lead_tasks
// (open→open, completed→done, cancelled→cancelled).
const STATUS_FILTERS: FeedStatus[] = ["open", "in_progress", "completed", "cancelled"];
const FILTER_LABELS: Record<FeedStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function addDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function TasksBoard() {
  const [tasks, setTasks] = useState<FeedTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FeedStatus>("open");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set when completing a follow-up leaves its lead with nothing scheduled.
  const [warning, setWarning] = useState<{ taskId: string; leadId: string; text: string } | null>(
    null
  );
  const [rescheduleDate, setRescheduleDate] = useState(addDays(3));

  const fetchTasks = useCallback(async () => {
    setError(null);
    // Two tables, one list. Neither is allowed to take the other down: the ops
    // `tasks` table may not even exist (docs/supabase-tasks-table.sql), and the
    // follow-up feed is the one the operator actually depends on.
    const [opsRes, followRes] = await Promise.allSettled([
      fetch(`/api/tasks?status=${filter}&limit=200`),
      fetch(`/api/crm/tasks?status=${filter}&limit=200`),
    ]);

    const merged: FeedTask[] = [];
    const failures: string[] = [];

    if (opsRes.status === "fulfilled" && opsRes.value.ok) {
      const d = await opsRes.value.json();
      for (const r of d.tasks ?? []) merged.push(fromOpsTask(r));
    } else {
      failures.push("ops tasks");
    }

    if (followRes.status === "fulfilled" && followRes.value.ok) {
      const d = await followRes.value.json();
      // Already normalised server-side by fromLeadTask.
      for (const t of d.tasks ?? []) merged.push(t as FeedTask);
    } else {
      failures.push("lead follow-ups");
    }

    if (failures.length) setError(`Could not load ${failures.join(" and ")}.`);
    setTasks(merged);
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // A follow-up must be mutated through the CRM route, never /api/tasks: that
  // is what keeps completeTask() bookkeeping, the lead_activities echo and the
  // contacts.open_task_count trigger correct.
  const updateTask = async (task: FeedTask, action: "complete" | "cancel") => {
    setError(null);
    try {
      const res =
        task.origin === "followup"
          ? await fetch(`/api/crm/tasks/${task.id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action }),
            })
          : await fetch("/api/tasks", {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: task.id,
                status: action === "complete" ? "completed" : "cancelled",
              }),
            });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error ?? `Could not update "${task.title}".`);
        return;
      }
      // The CRM route flags a lead left with no follow-up scheduled — the exact
      // state the mandatory-date rule exists to prevent. Offer the fix inline.
      if (body.warning && task.lead) {
        setWarning({ taskId: task.id, leadId: task.lead.id, text: body.warning });
        setRescheduleDate(addDays(3));
      }
      fetchTasks();
    } catch {
      setError(`Could not update "${task.title}".`);
    }
  };

  const reschedule = async (leadId: string) => {
    const res = await fetch(`/api/crm/leads/${leadId}/tasks`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Follow up", due_at: rescheduleDate }),
    });
    if (!res.ok) {
      const b = await res.json().catch(() => ({}));
      setError(b.error ?? "Could not schedule the follow-up.");
      return;
    }
    setWarning(null);
    fetchTasks();
  };

  const buckets = bucketTasks(tasks);

  return (
    <div>
      {/* Filter bar */}
      <div className="flex items-center gap-2 mb-6">
        {STATUS_FILTERS.map((s) => (
          <button
            key={s}
            onClick={() => {
              setFilter(s);
              setLoading(true);
            }}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              filter === s
                ? "bg-[rgba(0,201,167,0.15)] border-[rgba(0,201,167,0.3)] text-[#00C9A7]"
                : "bg-[rgba(255,255,255,0.03)] border-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.5)] hover:border-[rgba(255,255,255,0.12)]"
            }`}
          >
            {FILTER_LABELS[s]}
          </button>
        ))}
        {!loading && tasks.length > 0 && (
          <span className="ml-auto text-xs text-[rgba(255,255,255,0.3)]">
            {tasks.length} task{tasks.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[rgba(231,76,60,0.3)] bg-[rgba(231,76,60,0.08)] px-4 py-2.5 text-xs text-[#E74C3C]">
          {error}
        </div>
      )}

      {warning && (
        <div className="mb-4 rounded-lg border border-[rgba(245,166,35,0.3)] bg-[rgba(245,166,35,0.08)] px-4 py-3">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="text-[#F5A623] shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-[#F5A623]">{warning.text}</p>
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="date"
                  value={rescheduleDate}
                  onChange={(e) => setRescheduleDate(e.target.value)}
                  className="rounded border border-[rgba(255,255,255,0.12)] bg-[rgba(0,0,0,0.3)] px-2 py-1 text-xs text-white"
                />
                <button
                  onClick={() => reschedule(warning.leadId)}
                  className="rounded bg-[rgba(0,201,167,0.15)] px-2.5 py-1 text-[11px] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.25)]"
                >
                  Schedule next follow-up
                </button>
                <button
                  onClick={() => setWarning(null)}
                  className="text-[11px] text-[rgba(255,255,255,0.35)] hover:text-white"
                >
                  Leave it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <div className="w-6 h-6 border-2 border-[rgba(255,255,255,0.1)] border-t-[#00C9A7] rounded-full animate-spin" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-8 text-center">
          <CheckSquare size={24} className="mx-auto mb-2 text-[rgba(255,255,255,0.2)]" />
          <p className="text-sm text-[rgba(255,255,255,0.4)]">
            No {FILTER_LABELS[filter].toLowerCase()} tasks
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {buckets.map((bucket) => (
            <div key={bucket.key}>
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`text-xs font-medium uppercase tracking-wider ${
                    bucket.key === "overdue" ? "text-[#E74C3C]" : "text-[rgba(255,255,255,0.5)]"
                  }`}
                >
                  {bucket.label} ({bucket.tasks.length})
                </span>
              </div>

              <div className="space-y-1">
                {bucket.tasks.map((task) => {
                  const late = overdueDays(task.dueAt);
                  return (
                    <div
                      key={`${task.origin}:${task.id}`}
                      className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg hover:border-[rgba(255,255,255,0.1)] transition-colors"
                    >
                      <div
                        className="flex items-center justify-between px-4 py-3 cursor-pointer"
                        onClick={() =>
                          setExpanded(expanded === task.id ? null : task.id)
                        }
                      >
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          {expanded === task.id ? (
                            <ChevronDown size={14} className="text-[rgba(255,255,255,0.3)] shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="text-[rgba(255,255,255,0.3)] shrink-0" />
                          )}
                          <Circle
                            size={8}
                            className="shrink-0"
                            style={{
                              color: PRIORITY_COLORS[task.priority],
                              fill: PRIORITY_COLORS[task.priority],
                            }}
                          />
                          <span className="text-sm text-white truncate">{task.title}</span>

                          {task.lead && (
                            <Link
                              href={`/dashboard/leads/${task.lead.id}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-xs text-[#00C9A7] hover:underline truncate shrink-0 max-w-[180px]"
                            >
                              {task.lead.name}
                            </Link>
                          )}

                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)] shrink-0">
                            {task.typeLabel}
                          </span>
                        </div>

                        <div className="flex items-center gap-3 shrink-0 ml-2">
                          <span
                            className={`text-xs ${
                              late > 0 ? "text-[#E74C3C]" : "text-[rgba(255,255,255,0.3)]"
                            }`}
                          >
                            {formatDueDate(task.dueAt)}
                            {late > 0 && ` · ${late}d late`}
                          </span>

                          {(task.status === "open" || task.status === "in_progress") && (
                            <div className="flex gap-1">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTask(task, "complete");
                                }}
                                className="text-[10px] px-2 py-1 rounded bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)] transition-colors"
                              >
                                Done
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateTask(task, "cancel");
                                }}
                                className="text-[10px] px-2 py-1 rounded bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.3)] hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                              >
                                Dismiss
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {expanded === task.id && (
                        <div className="px-4 pb-3 border-t border-[rgba(255,255,255,0.04)]">
                          <div className="pt-3 space-y-2">
                            {task.description && (
                              <p className="text-sm text-[rgba(255,255,255,0.6)]">
                                {task.description}
                              </p>
                            )}
                            <div className="flex items-center gap-4 text-xs text-[rgba(255,255,255,0.3)]">
                              <span className="flex items-center gap-1">
                                <Clock size={10} />
                                {task.origin === "followup" ? "lead follow-up" : "ops task"}
                              </span>
                              {task.lead && (
                                <Link
                                  href={`/dashboard/leads/${task.lead.id}`}
                                  className="text-[#00C9A7] hover:underline"
                                >
                                  Open lead →
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
