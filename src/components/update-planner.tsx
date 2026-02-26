"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, ArrowLeft, Check, Copy, Download, RefreshCw, X, ChevronUp, ChevronDown } from "lucide-react";
import { formatDate } from "@/lib/utils";

interface UpdateTask {
  id: string;
  update_id: string;
  task: string;
  file_path: string | null;
  status: string;
  notes: string | null;
  sort_order: number;
}

interface Update {
  id: string;
  version: string;
  title: string;
  status: string;
  description: string | null;
  claude_code_instructions: string | null;
  target_date: string | null;
  deployed_date: string | null;
  created_at: string;
  tasks: UpdateTask[];
}

const STATUS_COLORS: Record<string, string> = {
  planned: "#1B65A7",
  in_progress: "#F5A623",
  testing: "#9C27B0",
  deployed: "#4CAF50",
  cancelled: "#E74C3C",
};

const STATUS_LABELS: Record<string, string> = {
  planned: "Planned",
  in_progress: "In Progress",
  testing: "Testing",
  deployed: "Deployed",
  cancelled: "Cancelled",
};

const FILTER_TABS = ["All", "Planned", "In Progress", "Testing", "Deployed", "Cancelled"];

export function UpdatePlanner() {
  const [updates, setUpdates] = useState<Update[]>([]);
  const [filter, setFilter] = useState("All");
  const [loading, setLoading] = useState(true);
  const [selectedUpdate, setSelectedUpdate] = useState<Update | null>(null);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);
  const [createForm, setCreateForm] = useState({ version: "", title: "", description: "", status: "planned", target_date: "" });
  const [taskForm, setTaskForm] = useState({ task: "", file_path: "", notes: "" });
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedMd, setGeneratedMd] = useState<string | null>(null);

  const fetchUpdates = useCallback(async () => {
    setLoading(true);
    const params = filter !== "All" ? `?status=${filter.toLowerCase().replace(" ", "_")}` : "";
    try {
      const res = await fetch(`/api/updates${params}`);
      const data = await res.json();
      setUpdates(data.updates || []);
    } catch {
      setUpdates([]);
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => { fetchUpdates(); }, [fetchUpdates]);

  const handleCreate = async () => {
    setSaving(true);
    try {
      await fetch("/api/updates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createForm),
      });
      setShowCreateDialog(false);
      setCreateForm({ version: "", title: "", description: "", status: "planned", target_date: "" });
      fetchUpdates();
    } catch { /* error */ }
    setSaving(false);
  };

  const handleAddTask = async () => {
    if (!selectedUpdate || !taskForm.task) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/updates/${selectedUpdate.id}/tasks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...taskForm, sort_order: (selectedUpdate.tasks?.length || 0) }),
      });
      if (res.ok) {
        const data = await res.json();
        setSelectedUpdate((prev) => prev ? { ...prev, tasks: [...(prev.tasks || []), data.task] } : prev);
        setTaskForm({ task: "", file_path: "", notes: "" });
        setShowAddTask(false);
      }
    } catch { /* error */ }
    setSaving(false);
  };

  const toggleTaskStatus = async (task: UpdateTask) => {
    const newStatus = task.status === "done" ? "pending" : "done";
    try {
      await fetch(`/api/updates/${task.update_id}/tasks/${task.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      setSelectedUpdate((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          tasks: prev.tasks.map((t) => (t.id === task.id ? { ...t, status: newStatus } : t)),
        };
      });
    } catch { /* error */ }
  };

  const handleGenerateMd = async (updateId: string) => {
    setGenerating(true);
    setGeneratedMd(null);
    try {
      const res = await fetch(`/api/updates/${updateId}/generate-md`, { method: "POST" });
      if (res.status === 503) {
        setGeneratedMd("⚠️ AI not configured. Add your Anthropic API key in Settings → AI Configuration to generate instructions.");
      } else if (res.ok) {
        const data = await res.json();
        setGeneratedMd(data.instructions || "No instructions generated.");
      }
    } catch {
      setGeneratedMd("Error generating instructions.");
    }
    setGenerating(false);
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const downloadMd = (text: string, version: string, title: string) => {
    const slug = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
    const blob = new Blob([text], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${version}-${slug}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Detail View
  if (selectedUpdate) {
    const doneTasks = selectedUpdate.tasks?.filter((t) => t.status === "done").length || 0;
    const totalTasks = selectedUpdate.tasks?.length || 0;
    const progress = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;

    return (
      <div>
        <button onClick={() => { setSelectedUpdate(null); setGeneratedMd(null); }} className="flex items-center gap-2 text-sm text-[rgba(255,255,255,0.5)] hover:text-white mb-4">
          <ArrowLeft size={14} /> Back to updates
        </button>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Left: Update Info + Tasks */}
          <div>
            <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 mb-4" style={{ borderLeftWidth: "3px", borderLeftColor: STATUS_COLORS[selectedUpdate.status] }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs font-mono px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: STATUS_COLORS[selectedUpdate.status] }}>{selectedUpdate.version}</span>
                <span className="text-xs text-[rgba(255,255,255,0.4)]">{STATUS_LABELS[selectedUpdate.status]}</span>
              </div>
              <h2 className="text-xl font-bold text-white mb-1">{selectedUpdate.title}</h2>
              {selectedUpdate.description && <p className="text-sm text-[rgba(255,255,255,0.5)]">{selectedUpdate.description}</p>}
              {selectedUpdate.target_date && <p className="text-xs text-[rgba(255,255,255,0.3)] mt-2">Target: {formatDate(selectedUpdate.target_date)}</p>}
              <div className="mt-3">
                <div className="flex justify-between text-xs text-[rgba(255,255,255,0.4)] mb-1">
                  <span>Progress</span>
                  <span>{doneTasks}/{totalTasks} tasks</span>
                </div>
                <div className="w-full h-1.5 bg-[rgba(255,255,255,0.1)] rounded-full">
                  <div className="h-full bg-[#00C9A7] rounded-full transition-all" style={{ width: `${progress}%` }} />
                </div>
              </div>
            </div>

            {/* Tasks */}
            <div className="space-y-2">
              {selectedUpdate.tasks?.sort((a, b) => a.sort_order - b.sort_order).map((task) => (
                <div key={task.id} className="flex items-start gap-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3">
                  <button onClick={() => toggleTaskStatus(task)} className={`mt-0.5 w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center ${task.status === "done" ? "bg-[#00C9A7] border-[#00C9A7]" : "border-[rgba(255,255,255,0.3)]"}`}>
                    {task.status === "done" && <Check size={10} className="text-[#0B1426]" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm ${task.status === "done" ? "text-[rgba(255,255,255,0.3)] line-through" : "text-white"}`}>{task.task}</p>
                    {task.file_path && <p className="text-[10px] font-mono text-[rgba(255,255,255,0.3)] mt-0.5">{task.file_path}</p>}
                    {task.notes && <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5">{task.notes}</p>}
                  </div>
                </div>
              ))}
            </div>

            {/* Add Task */}
            {showAddTask ? (
              <div className="mt-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg p-3 space-y-2">
                <input value={taskForm.task} onChange={(e) => setTaskForm({ ...taskForm, task: e.target.value })} placeholder="Task description" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white focus:outline-none focus:border-[#00C9A7]" />
                <input value={taskForm.file_path} onChange={(e) => setTaskForm({ ...taskForm, file_path: e.target.value })} placeholder="File path (optional)" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-[#00C9A7]" />
                <div className="flex gap-2">
                  <button onClick={handleAddTask} disabled={saving || !taskForm.task} className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium disabled:opacity-50">{saving ? "Adding..." : "Add Task"}</button>
                  <button onClick={() => setShowAddTask(false)} className="text-xs px-3 py-1.5 text-[rgba(255,255,255,0.5)]">Cancel</button>
                </div>
              </div>
            ) : (
              <button onClick={() => setShowAddTask(true)} className="mt-3 flex items-center gap-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-white">
                <Plus size={12} /> Add Task
              </button>
            )}
          </div>

          {/* Right: Claude Code Instructions */}
          <div>
            <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-white">Claude Code Instructions</h3>
                <button onClick={() => handleGenerateMd(selectedUpdate.id)} disabled={generating} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)] disabled:opacity-50">
                  <RefreshCw size={12} className={generating ? "animate-spin" : ""} />
                  {generating ? "Generating..." : "Generate"}
                </button>
              </div>
              <div className="bg-[rgba(0,0,0,0.3)] rounded-lg p-4 font-mono text-xs text-[rgba(255,255,255,0.6)] min-h-[300px] max-h-[500px] overflow-y-auto whitespace-pre-wrap">
                {generatedMd || selectedUpdate.claude_code_instructions || "Click 'Generate' to create Claude Code instructions based on the tasks above."}
              </div>
              {(generatedMd || selectedUpdate.claude_code_instructions) && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => copyToClipboard(generatedMd || selectedUpdate.claude_code_instructions || "")} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)]">
                    <Copy size={12} /> Copy
                  </button>
                  <button onClick={() => downloadMd(generatedMd || selectedUpdate.claude_code_instructions || "", selectedUpdate.version, selectedUpdate.title)} className="flex items-center gap-1 text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)]">
                    <Download size={12} /> Download MD
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // List View
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold text-white">System Updates</h1>
          {updates.find((u) => u.status === "deployed") && (
            <span className="text-xs font-mono px-2 py-0.5 bg-[#4CAF50] text-white rounded-full">
              {updates.find((u) => u.status === "deployed")?.version}
            </span>
          )}
        </div>
        <button onClick={() => setShowCreateDialog(true)} className="flex items-center gap-2 px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90">
          <Plus size={16} /> Plan New Update
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
        {FILTER_TABS.map((tab) => (
          <button key={tab} onClick={() => setFilter(tab)} className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${filter === tab ? "bg-[#00C9A7] text-[#0B1426]" : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white"}`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Update cards */}
      {loading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <div key={i} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 animate-pulse h-32" />)}
        </div>
      ) : updates.length === 0 ? (
        <div className="text-center py-16 text-[rgba(255,255,255,0.4)]">
          <p className="text-lg mb-2">No updates found</p>
          <p className="text-sm">Plan your first system update to get started.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {updates.map((update) => {
            const doneTasks = update.tasks?.filter((t) => t.status === "done").length || 0;
            const totalTasks = update.tasks?.length || 0;
            const progress = totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0;
            return (
              <div key={update.id} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 card-hover" style={{ borderLeftWidth: "3px", borderLeftColor: STATUS_COLORS[update.status] }}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-mono px-2 py-0.5 rounded-full text-white" style={{ backgroundColor: STATUS_COLORS[update.status] }}>{update.version}</span>
                      <span className="text-xs text-[rgba(255,255,255,0.4)]">{STATUS_LABELS[update.status]}</span>
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-1">{update.title}</h3>
                    {update.description && <p className="text-sm text-[rgba(255,255,255,0.4)] line-clamp-2">{update.description}</p>}
                    <div className="flex items-center gap-4 mt-3">
                      <div className="flex-1 max-w-[200px]">
                        <div className="w-full h-1.5 bg-[rgba(255,255,255,0.1)] rounded-full">
                          <div className="h-full bg-[#00C9A7] rounded-full transition-all" style={{ width: `${progress}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-[rgba(255,255,255,0.4)]">{doneTasks}/{totalTasks} tasks</span>
                      {update.target_date && <span className="text-xs text-[rgba(255,255,255,0.3)]">Target: {formatDate(update.target_date)}</span>}
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button onClick={() => setSelectedUpdate(update)} className="text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)]">View</button>
                    <button onClick={() => { setSelectedUpdate(update); handleGenerateMd(update.id); }} className="text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)]">Generate MD</button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Dialog */}
      {showCreateDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="bg-[#0f1d32] border border-[rgba(255,255,255,0.1)] rounded-xl p-6 w-full max-w-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Plan New Update</h2>
              <button onClick={() => setShowCreateDialog(false)} className="text-[rgba(255,255,255,0.4)] hover:text-white"><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Version</label>
                  <input value={createForm.version} onChange={(e) => setCreateForm({ ...createForm, version: e.target.value })} placeholder="v1.1.0" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white font-mono focus:outline-none focus:border-[#00C9A7]" />
                </div>
                <div>
                  <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Status</label>
                  <select value={createForm.status} onChange={(e) => setCreateForm({ ...createForm, status: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]">
                    <option value="planned" className="bg-[#0f1d32]">Planned</option>
                    <option value="in_progress" className="bg-[#0f1d32]">In Progress</option>
                    <option value="testing" className="bg-[#0f1d32]">Testing</option>
                    <option value="deployed" className="bg-[#0f1d32]">Deployed</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Title</label>
                <input value={createForm.title} onChange={(e) => setCreateForm({ ...createForm, title: e.target.value })} placeholder="Update title" className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Description</label>
                <textarea value={createForm.description} onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })} rows={3} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7] resize-none" />
              </div>
              <div>
                <label className="text-xs text-[rgba(255,255,255,0.5)] block mb-1">Target Date</label>
                <input type="date" value={createForm.target_date} onChange={(e) => setCreateForm({ ...createForm, target_date: e.target.value })} className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white focus:outline-none focus:border-[#00C9A7]" />
              </div>
              <div className="flex gap-2 justify-end">
                <button onClick={() => setShowCreateDialog(false)} className="px-4 py-2 text-sm text-[rgba(255,255,255,0.5)]">Cancel</button>
                <button onClick={handleCreate} disabled={saving || !createForm.version || !createForm.title} className="px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90 disabled:opacity-50">{saving ? "Creating..." : "Create Update"}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
