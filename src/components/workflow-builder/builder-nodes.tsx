"use client";

import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { Zap, GitBranch, Play, Clock, Trash2 } from "lucide-react";

export interface TriggerNodeData {
  label: string;
  event: string;
  eventConfig?: Record<string, string>;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export interface ConditionNodeData {
  label: string;
  field: string;
  operator: string;
  value: string;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export interface ActionNodeData {
  label: string;
  actionType: string;
  actionConfig?: Record<string, string>;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

export interface DelayNodeData {
  label: string;
  delayMinutes: number;
  onDelete?: (id: string) => void;
  [key: string]: unknown;
}

const NODE_STYLES = {
  trigger: { border: "#1B65A7", bg: "rgba(27,101,167,0.15)", icon: Zap },
  condition: { border: "#f59e0b", bg: "rgba(245,158,11,0.12)", icon: GitBranch },
  action: { border: "#00C9A7", bg: "rgba(0,201,167,0.12)", icon: Play },
  delay: { border: "#8b5cf6", bg: "rgba(139,92,246,0.12)", icon: Clock },
};

const EVENT_LABELS: Record<string, string> = {
  stage_change: "Stage Change",
  new_lead: "New Lead",
  application_complete: "Application Complete",
  tag_added: "Tag Added",
  schedule: "On Schedule",
};

const ACTION_LABELS: Record<string, string> = {
  send_sms: "Send SMS",
  send_email: "Send Email",
  add_tag: "Add Tag",
  move_stage: "Move Stage",
  notify_slack: "Notify Slack",
  wait: "Wait",
};

const OPERATOR_LABELS: Record<string, string> = {
  equals: "=",
  not_equals: "!=",
  contains: "contains",
  gt: ">",
  lt: "<",
};

function BaseNode({
  id,
  type,
  label,
  subtitle,
  selected,
  onDelete,
}: {
  id: string;
  type: keyof typeof NODE_STYLES;
  label: string;
  subtitle?: string;
  selected?: boolean;
  onDelete?: (id: string) => void;
}) {
  const style = NODE_STYLES[type];
  const Icon = style.icon;

  return (
    <div
      className="relative rounded-xl px-4 py-3 min-w-[180px] max-w-[240px] shadow-lg group transition-all"
      style={{
        background: style.bg,
        border: `${selected ? 2 : 1}px solid ${style.border}${selected ? "" : "55"}`,
      }}
    >
      {type !== "trigger" && (
        <Handle
          type="target"
          position={Position.Top}
          style={{ background: style.border, border: "none", width: 8, height: 8 }}
        />
      )}

      <div className="flex items-start gap-2.5">
        <div
          className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
          style={{ background: `${style.border}25` }}
        >
          <Icon size={14} style={{ color: style.border }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-white leading-snug truncate">{label}</p>
          {subtitle && (
            <p className="text-[10px] text-[rgba(255,255,255,0.4)] mt-0.5 leading-snug truncate">
              {subtitle}
            </p>
          )}
        </div>
        {onDelete && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete(id);
            }}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[rgba(239,68,68,0.2)]"
          >
            <Trash2 size={12} className="text-red-400" />
          </button>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: style.border, border: "none", width: 8, height: 8 }}
      />
    </div>
  );
}

export const TriggerNode = memo(function TriggerNode({ id, data, selected }: NodeProps) {
  const d = data as TriggerNodeData;
  return (
    <BaseNode
      id={id}
      type="trigger"
      label={d.label || "Trigger"}
      subtitle={EVENT_LABELS[d.event] || d.event || "Select event..."}
      selected={selected}
      onDelete={d.onDelete as ((id: string) => void) | undefined}
    />
  );
});

export const ConditionNode = memo(function ConditionNode({ id, data, selected }: NodeProps) {
  const d = data as ConditionNodeData;
  const sub = d.field
    ? `${d.field} ${OPERATOR_LABELS[d.operator] || d.operator} ${d.value}`
    : "Configure condition...";
  return (
    <BaseNode
      id={id}
      type="condition"
      label={d.label || "Condition"}
      subtitle={sub}
      selected={selected}
      onDelete={d.onDelete as ((id: string) => void) | undefined}
    />
  );
});

export const ActionNode = memo(function ActionNode({ id, data, selected }: NodeProps) {
  const d = data as ActionNodeData;
  return (
    <BaseNode
      id={id}
      type="action"
      label={d.label || "Action"}
      subtitle={ACTION_LABELS[d.actionType] || d.actionType || "Select action..."}
      selected={selected}
      onDelete={d.onDelete as ((id: string) => void) | undefined}
    />
  );
});

export const DelayNode = memo(function DelayNode({ id, data, selected }: NodeProps) {
  const d = data as DelayNodeData;
  const mins = d.delayMinutes || 0;
  const sub =
    mins >= 1440
      ? `Wait ${Math.round(mins / 1440)} day(s)`
      : mins >= 60
        ? `Wait ${Math.round(mins / 60)} hour(s)`
        : mins > 0
          ? `Wait ${mins} min`
          : "Set delay...";
  return (
    <BaseNode
      id={id}
      type="delay"
      label={d.label || "Delay"}
      subtitle={sub}
      selected={selected}
      onDelete={d.onDelete as ((id: string) => void) | undefined}
    />
  );
});

export const builderNodeTypes = {
  trigger: TriggerNode,
  condition: ConditionNode,
  action: ActionNode,
  delay: DelayNode,
};
