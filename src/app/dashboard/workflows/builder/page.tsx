"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Save } from "lucide-react";
import { BuilderCanvas } from "@/components/workflow-builder/builder-canvas";
import type { Node, Edge } from "@xyflow/react";

export default function NewWorkflowPage() {
  const router = useRouter();
  const [name, setName] = useState("Untitled Workflow");
  const [saving, setSaving] = useState(false);
  const nodesRef = useRef<Node[]>([]);
  const edgesRef = useRef<Edge[]>([]);

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
      const res = await fetch("/api/workflows/custom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          nodes: stripCallbacks(nodesRef.current),
          edges: edgesRef.current,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        router.push(`/dashboard/workflows/builder/${data.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

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
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-[#00C9A7] text-[#0B1426] rounded-lg hover:bg-[#00ddb8] transition-colors disabled:opacity-50"
        >
          <Save size={14} />
          {saving ? "Saving..." : "Save Workflow"}
        </button>
      </div>

      {/* Canvas */}
      <div className="flex-1 min-h-0 flex">
        <BuilderCanvas onChange={handleChange} />
      </div>
    </div>
  );
}
