"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { ArrowLeft, Save, Trash2 } from "lucide-react";
import { BuilderCanvas } from "@/components/workflow-builder/builder-canvas";
import type { Node, Edge } from "@xyflow/react";

interface Workflow {
  id: string;
  name: string;
  description: string | null;
  enabled: boolean;
  nodes: Node[];
  edges: Edge[];
}

export default function EditWorkflowPage() {
  const router = useRouter();
  const params = useParams();
  const id = params.id as string;
  const [workflow, setWorkflow] = useState<Workflow | null>(null);
  const [name, setName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

  useEffect(() => {
    fetch(`/api/workflows/custom/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setWorkflow(data);
        setName(data.name);
        setEnabled(data.enabled);
        nodesRef.current = data.nodes || [];
        edgesRef.current = data.edges || [];
      })
      .finally(() => setLoading(false));
  }, [id]);

  const handleChange = useCallback((nodes: Node[], edges: Edge[]) => {
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, []);

  const stripCallbacks = (nodes: Node[]) =>
    nodes.map((n) => {
      const { onDelete, ...rest } = n.data as Record<string, unknown>;
      void onDelete;
      return { ...n, data: rest };
    });

  const handleSave = async () => {
    setSaving(true);
    try {
      await fetch(`/api/workflows/custom/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          enabled,
          nodes: stripCallbacks(nodesRef.current),
          edges: edgesRef.current,
        }),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Delete this workflow?")) return;
    await fetch(`/api/workflows/custom/${id}`, { method: "DELETE" });
    router.push("/dashboard/workflows");
  };

  const handleToggle = async () => {
    const next = !enabled;
    setEnabled(next);
    await fetch(`/api/workflows/custom/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)] text-[rgba(255,255,255,0.3)] text-sm">
        Loading workflow...
      </div>
    );
  }

  if (!workflow) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-64px)] text-red-400 text-sm">
        Workflow not found
      </div>
    );
  }

  return (
    <div className="-m-6 flex flex-col h-[calc(100vh-64px)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)] shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard/workflows")}
            className="p-1.5 rounded-lg hover:bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.5)] hover:text-white transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="bg-transparent border-none text-sm font-semibold text-white focus:outline-none focus:ring-1 focus:ring-[rgba(255,255,255,0.1)] rounded px-2 py-1 -ml-2"
          />
        </div>
        <div className="flex items-center gap-2">
          {/* Toggle */}
          <button
            onClick={handleToggle}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              enabled
                ? "bg-[rgba(0,201,167,0.15)] text-[#00C9A7] border border-[rgba(0,201,167,0.3)]"
                : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] border border-[rgba(255,255,255,0.08)]"
            }`}
          >
            {enabled ? "Active" : "Inactive"}
          </button>
          <button
            onClick={handleDelete}
            className="p-2 rounded-lg hover:bg-[rgba(239,68,68,0.1)] text-[rgba(255,255,255,0.3)] hover:text-red-400 transition-colors"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#00C9A7] text-[#0B1426] rounded-lg hover:bg-[#00ddb8] transition-colors disabled:opacity-50"
          >
            <Save size={14} />
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 flex">
        <BuilderCanvas
          initialNodes={workflow.nodes}
          initialEdges={workflow.edges}
          onChange={handleChange}
        />
      </div>
    </div>
  );
}
