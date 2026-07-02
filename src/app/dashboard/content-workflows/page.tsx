"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { ContentWorkflowBoard, type WorkflowCard } from "@/components/content-workflows/board";
import { DetailDrawer } from "@/components/content-workflows/detail-drawer";

export default function ContentWorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowCard[]>([]);
  const [liveWorkflowIds, setLiveWorkflowIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchWorkflows = useCallback(async () => {
    try {
      const res = await fetch("/api/content-workflows");
      if (res.ok) {
        const data = await res.json();
        setWorkflows(data.workflows ?? []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRuns = useCallback(async () => {
    try {
      const res = await fetch("/api/content-workflows/runs");
      if (res.ok) {
        const data = await res.json();
        setLiveWorkflowIds(data.liveWorkflowIds ?? []);
      }
    } catch {
      // silent
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
    fetchRuns();
    const t = setInterval(fetchRuns, 5000);
    return () => clearInterval(t);
  }, [fetchWorkflows, fetchRuns]);

  const activeCount = workflows.filter((w) => w.status === "active").length;

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-semibold text-white">Content Studio</h1>
          <p className="text-sm text-white/40 mt-0.5">
            Every content workflow, from a higher perspective. Observe here, run in Slack.{" "}
            {activeCount} active · {workflows.length - activeCount} drafts
            {liveWorkflowIds.length > 0 && <span className="text-emerald-400"> · {liveWorkflowIds.length} live</span>}
          </p>
        </div>
        <button
          onClick={fetchWorkflows}
          className="flex items-center gap-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 text-sm px-3 py-2"
        >
          <RefreshCw size={15} /> Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-white/40 text-sm">Loading workflows…</p>
      ) : (
        <ContentWorkflowBoard workflows={workflows} liveWorkflowIds={liveWorkflowIds} onSelect={setSelected} />
      )}

      {selected && <DetailDrawer id={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
