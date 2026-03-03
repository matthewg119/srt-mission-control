"use client";

import { Handle, Position } from "@xyflow/react";

interface NodeData {
  label: string;
  sub?: string;
  count?: number;
  countLabel?: string;
  type?: "trigger" | "action" | "condition" | "outcome" | "error";
  color?: string;
}

const TYPE_STYLES: Record<string, { border: string; bg: string; dot: string }> = {
  trigger: { border: "#1B65A7", bg: "rgba(27,101,167,0.12)", dot: "#1B65A7" },
  action: { border: "#00C9A7", bg: "rgba(0,201,167,0.08)", dot: "#00C9A7" },
  condition: { border: "#f59e0b", bg: "rgba(245,158,11,0.08)", dot: "#f59e0b" },
  outcome: { border: "#8b5cf6", bg: "rgba(139,92,246,0.08)", dot: "#8b5cf6" },
  error: { border: "#ef4444", bg: "rgba(239,68,68,0.08)", dot: "#ef4444" },
};

export function FlowNode({ data }: { data: NodeData }) {
  const style = TYPE_STYLES[data.type || "action"];
  const color = data.color || style.border;

  return (
    <div
      className="relative rounded-xl px-4 py-3 min-w-[160px] max-w-[220px] shadow-lg"
      style={{
        background: data.color ? `${data.color}12` : style.bg,
        border: `1px solid ${color}55`,
      }}
    >
      <Handle type="target" position={Position.Top} style={{ background: color, border: "none", width: 8, height: 8 }} />

      <div className="flex items-start gap-2">
        <span
          className="w-2 h-2 rounded-full mt-1.5 shrink-0"
          style={{ background: color }}
        />
        <div>
          <p className="text-xs font-semibold text-white leading-snug">{data.label}</p>
          {data.sub && (
            <p className="text-[10px] text-[rgba(255,255,255,0.4)] mt-0.5 leading-snug">{data.sub}</p>
          )}
          {data.count !== undefined && (
            <span
              className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{ background: `${color}22`, color: color }}
            >
              {data.count} {data.countLabel || "active"}
            </span>
          )}
        </div>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: color, border: "none", width: 8, height: 8 }} />
    </div>
  );
}

export function GroupLabel({ data }: { data: { label: string; color: string } }) {
  return (
    <div
      className="px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest"
      style={{ color: data.color, background: `${data.color}15`, border: `1px solid ${data.color}30` }}
    >
      {data.label}
    </div>
  );
}
