"use client";

import { Zap, GitBranch, Play, Clock } from "lucide-react";
import type { DragEvent } from "react";

const PALETTE_ITEMS = [
  {
    type: "trigger",
    label: "Trigger",
    desc: "Event that starts the flow",
    icon: Zap,
    color: "#1B65A7",
  },
  {
    type: "condition",
    label: "Condition",
    desc: "If/else branching",
    icon: GitBranch,
    color: "#f59e0b",
  },
  {
    type: "action",
    label: "Action",
    desc: "Send SMS, email, tag, etc.",
    icon: Play,
    color: "#00C9A7",
  },
  {
    type: "delay",
    label: "Delay",
    desc: "Wait before next step",
    icon: Clock,
    color: "#8b5cf6",
  },
];

export function NodePalette() {
  const onDragStart = (e: DragEvent, nodeType: string) => {
    e.dataTransfer.setData("application/reactflow", nodeType);
    e.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="w-48 shrink-0 border-r border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.15)] p-3 flex flex-col gap-2">
      <p className="text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)] font-semibold mb-1">
        Drag to canvas
      </p>
      {PALETTE_ITEMS.map((item) => {
        const Icon = item.icon;
        return (
          <div
            key={item.type}
            draggable
            onDragStart={(e) => onDragStart(e, item.type)}
            className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg cursor-grab active:cursor-grabbing transition-all hover:scale-[1.02]"
            style={{
              background: `${item.color}12`,
              border: `1px solid ${item.color}30`,
            }}
          >
            <div
              className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
              style={{ background: `${item.color}20` }}
            >
              <Icon size={14} style={{ color: item.color }} />
            </div>
            <div>
              <p className="text-xs font-semibold text-white">{item.label}</p>
              <p className="text-[9px] text-[rgba(255,255,255,0.35)]">{item.desc}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
