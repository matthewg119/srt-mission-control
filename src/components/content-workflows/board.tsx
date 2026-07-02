"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  BackgroundVariant,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { GroupLabel } from "@/components/workflow-map/flow-nodes";

export interface WorkflowCard {
  id: string;
  vertical_id: string;
  name: string;
  category: string;
  subcategory: string | null;
  status: string;
  configured: boolean;
  shots: number;
  mode: string | null;
  song: string;
}

interface CardData extends WorkflowCard {
  live: boolean;
  [key: string]: unknown;
}

function prettyAvatar(id: string): string {
  return id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function WorkflowCardNode({ data }: { data: CardData }) {
  const color = data.status === "active" ? "#00C9A7" : "#f59e0b";
  return (
    <div
      className="relative rounded-xl px-4 py-3 w-[220px] shadow-lg cursor-pointer transition-transform hover:-translate-y-0.5"
      style={{ background: `${color}12`, border: `1px solid ${color}55` }}
    >
      <Handle type="target" position={Position.Top} style={{ opacity: 0 }} />
      <div className="flex items-start gap-2">
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ background: color, boxShadow: data.live ? `0 0 0 4px ${color}44` : "none" }}
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-white leading-snug truncate">{data.name}</p>
          <p className="text-[10px] text-[rgba(255,255,255,0.4)] mt-0.5">
            {data.category}
            {data.subcategory ? ` · ${data.subcategory}` : ""}
          </p>
          <div className="flex flex-wrap items-center gap-1 mt-1.5">
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: `${color}22`, color }}>
              {data.status === "active" ? `${data.shots} shots` : "needs config"}
            </span>
            {data.mode && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-white/5 text-white/50">
                {data.mode === "animated" ? "video" : "images"}
              </span>
            )}
            {data.live && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300">live</span>
            )}
          </div>
          <p className="text-[10px] text-white/30 mt-1 truncate">♪ {data.song}</p>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ opacity: 0 }} />
    </div>
  );
}

const nodeTypes = { workflowCard: WorkflowCardNode, groupLabel: GroupLabel };

const AVATAR_COLORS = ["#8b5cf6", "#1B65A7", "#00C9A7", "#f59e0b", "#ef4444"];

interface BoardProps {
  workflows: WorkflowCard[];
  liveWorkflowIds: string[];
  onSelect: (id: string) => void;
}

export function ContentWorkflowBoard({ workflows, liveWorkflowIds, onSelect }: BoardProps) {
  const nodes: Node[] = useMemo(() => {
    const COL_W = 250;
    const ROW_H = 132;
    const PER_ROW = 4;
    const X0 = 40;
    const LABEL_H = 52;

    // Group by avatar (vertical), preserving encounter order.
    const groups = new Map<string, WorkflowCard[]>();
    for (const w of workflows) {
      if (!groups.has(w.vertical_id)) groups.set(w.vertical_id, []);
      groups.get(w.vertical_id)!.push(w);
    }

    const out: Node[] = [];
    let y = 20;
    let gi = 0;
    for (const [vertical, items] of groups) {
      const color = AVATAR_COLORS[gi % AVATAR_COLORS.length];
      out.push({
        id: `lbl_${vertical}`,
        type: "groupLabel",
        position: { x: X0, y },
        data: { label: prettyAvatar(vertical), color },
        draggable: false,
        selectable: false,
      });
      y += LABEL_H;
      // Active first within a group.
      const ordered = [...items].sort((a, b) => (a.status === b.status ? 0 : a.status === "active" ? -1 : 1));
      ordered.forEach((w, i) => {
        const col = i % PER_ROW;
        const row = Math.floor(i / PER_ROW);
        out.push({
          id: w.id,
          type: "workflowCard",
          position: { x: X0 + col * COL_W, y: y + row * ROW_H },
          data: { ...w, live: liveWorkflowIds.includes(w.id) } as CardData,
        });
      });
      const rows = Math.max(1, Math.ceil(ordered.length / PER_ROW));
      y += rows * ROW_H + 40;
      gi++;
    }
    return out;
  }, [workflows, liveWorkflowIds]);

  return (
    <div className="h-[calc(100vh-180px)] w-full rounded-2xl border border-white/10 bg-[#0b0f17]">
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodeClick={(_e, node) => {
          if (node.type === "workflowCard") onSelect(node.id);
        }}
        fitView
        proOptions={{ hideAttribution: true }}
        minZoom={0.3}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#ffffff10" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
