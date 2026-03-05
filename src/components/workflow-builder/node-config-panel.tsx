"use client";

import type { Node } from "@xyflow/react";
import { X } from "lucide-react";

interface NodeConfigPanelProps {
  node: Node | null;
  onUpdate: (id: string, data: Record<string, unknown>) => void;
  onClose: () => void;
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.35)] font-semibold">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white text-xs focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
      >
        <option value="">Select...</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function TextField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.35)] font-semibold">
        {label}
      </label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white text-xs placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.35)] font-semibold">
        {label}
      </label>
      <input
        type="number"
        value={value}
        min={0}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white text-xs focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
      />
    </div>
  );
}

function TextAreaField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.35)] font-semibold">
        {label}
      </label>
      <textarea
        value={value}
        placeholder={placeholder}
        rows={3}
        onChange={(e) => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white text-xs placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[rgba(255,255,255,0.2)] resize-none"
      />
    </div>
  );
}

function TriggerConfig({ node, onUpdate }: { node: Node; onUpdate: NodeConfigPanelProps["onUpdate"] }) {
  const data = node.data as Record<string, unknown>;
  const event = (data.event as string) || "";
  const config = (data.eventConfig as Record<string, string>) || {};

  const updateConfig = (key: string, value: string) => {
    onUpdate(node.id, { eventConfig: { ...config, [key]: value } });
  };

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Event"
        value={event}
        onChange={(v) => onUpdate(node.id, { event: v })}
        options={[
          { value: "stage_change", label: "Stage Change" },
          { value: "new_lead", label: "New Lead Captured" },
          { value: "application_complete", label: "Application Complete" },
          { value: "tag_added", label: "Tag Added" },
          { value: "schedule", label: "On Schedule (Cron)" },
        ]}
      />
      {event === "stage_change" && (
        <>
          <SelectField
            label="Pipeline"
            value={config.pipeline || ""}
            onChange={(v) => updateConfig("pipeline", v)}
            options={[
              { value: "New Deals", label: "New Deals" },
              { value: "Active Deals", label: "Active Deals" },
            ]}
          />
          <TextField
            label="Stage Name"
            value={config.stageName || ""}
            placeholder="e.g. Submitted to Lenders"
            onChange={(v) => updateConfig("stageName", v)}
          />
        </>
      )}
      {event === "tag_added" && (
        <TextField
          label="Tag"
          value={config.tag || ""}
          placeholder="e.g. application-completed"
          onChange={(v) => updateConfig("tag", v)}
        />
      )}
    </div>
  );
}

function ConditionConfig({ node, onUpdate }: { node: Node; onUpdate: NodeConfigPanelProps["onUpdate"] }) {
  const data = node.data as Record<string, unknown>;
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Field"
        value={(data.field as string) || ""}
        onChange={(v) => onUpdate(node.id, { field: v })}
        options={[
          { value: "stage", label: "Pipeline Stage" },
          { value: "tag", label: "Contact Tag" },
          { value: "email", label: "Has Email" },
          { value: "phone", label: "Has Phone" },
          { value: "lead_score", label: "Lead Score" },
          { value: "source", label: "Lead Source" },
        ]}
      />
      <SelectField
        label="Operator"
        value={(data.operator as string) || ""}
        onChange={(v) => onUpdate(node.id, { operator: v })}
        options={[
          { value: "equals", label: "Equals" },
          { value: "not_equals", label: "Not Equals" },
          { value: "contains", label: "Contains" },
          { value: "gt", label: "Greater Than" },
          { value: "lt", label: "Less Than" },
        ]}
      />
      <TextField
        label="Value"
        value={(data.value as string) || ""}
        placeholder="e.g. New Lead"
        onChange={(v) => onUpdate(node.id, { value: v })}
      />
    </div>
  );
}

function ActionConfig({ node, onUpdate }: { node: Node; onUpdate: NodeConfigPanelProps["onUpdate"] }) {
  const data = node.data as Record<string, unknown>;
  const actionType = (data.actionType as string) || "";
  const config = (data.actionConfig as Record<string, string>) || {};

  const updateConfig = (key: string, value: string) => {
    onUpdate(node.id, { actionConfig: { ...config, [key]: value } });
  };

  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Action Type"
        value={actionType}
        onChange={(v) => onUpdate(node.id, { actionType: v })}
        options={[
          { value: "send_sms", label: "Send SMS" },
          { value: "send_email", label: "Send Email" },
          { value: "add_tag", label: "Add Tag" },
          { value: "move_stage", label: "Move Stage" },
          { value: "notify_slack", label: "Notify Slack" },
        ]}
      />
      {(actionType === "send_sms" || actionType === "send_email") && (
        <>
          <TextField
            label="Template Slug"
            value={config.templateSlug || ""}
            placeholder="e.g. welcome-sms"
            onChange={(v) => updateConfig("templateSlug", v)}
          />
          <TextAreaField
            label="Message (or leave empty to use template)"
            value={config.message || ""}
            placeholder="Hi {{first_name}}, welcome to SRT Agency!"
            onChange={(v) => updateConfig("message", v)}
          />
        </>
      )}
      {actionType === "send_email" && (
        <TextField
          label="Subject"
          value={config.subject || ""}
          placeholder="e.g. Your Application Update"
          onChange={(v) => updateConfig("subject", v)}
        />
      )}
      {actionType === "add_tag" && (
        <TextField
          label="Tag"
          value={config.tag || ""}
          placeholder="e.g. contacted"
          onChange={(v) => updateConfig("tag", v)}
        />
      )}
      {actionType === "move_stage" && (
        <>
          <SelectField
            label="Pipeline"
            value={config.pipeline || ""}
            onChange={(v) => updateConfig("pipeline", v)}
            options={[
              { value: "New Deals", label: "New Deals" },
              { value: "Active Deals", label: "Active Deals" },
            ]}
          />
          <TextField
            label="Stage Name"
            value={config.stageName || ""}
            placeholder="e.g. Pre-Approval"
            onChange={(v) => updateConfig("stageName", v)}
          />
        </>
      )}
      {actionType === "notify_slack" && (
        <TextAreaField
          label="Message"
          value={config.message || ""}
          placeholder="New deal moved to {{stage_name}}"
          onChange={(v) => updateConfig("message", v)}
        />
      )}
    </div>
  );
}

function DelayConfig({ node, onUpdate }: { node: Node; onUpdate: NodeConfigPanelProps["onUpdate"] }) {
  const data = node.data as Record<string, unknown>;
  const mins = (data.delayMinutes as number) || 0;

  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Delay (minutes)"
        value={mins}
        onChange={(v) => onUpdate(node.id, { delayMinutes: v })}
      />
      <div className="flex gap-2">
        {[
          { label: "5m", value: 5 },
          { label: "30m", value: 30 },
          { label: "1h", value: 60 },
          { label: "24h", value: 1440 },
        ].map((preset) => (
          <button
            key={preset.label}
            onClick={() => onUpdate(node.id, { delayMinutes: preset.value })}
            className={`px-2.5 py-1 rounded text-[10px] font-semibold transition-colors ${
              mins === preset.value
                ? "bg-[rgba(139,92,246,0.3)] text-purple-300 border border-purple-500/40"
                : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] border border-[rgba(255,255,255,0.08)] hover:text-white"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function NodeConfigPanel({ node, onUpdate, onClose }: NodeConfigPanelProps) {
  if (!node) return null;

  const TYPE_LABELS: Record<string, string> = {
    trigger: "Trigger",
    condition: "Condition",
    action: "Action",
    delay: "Delay",
  };

  const TYPE_COLORS: Record<string, string> = {
    trigger: "#1B65A7",
    condition: "#f59e0b",
    action: "#00C9A7",
    delay: "#8b5cf6",
  };

  const color = TYPE_COLORS[node.type || "action"];

  return (
    <div className="w-64 shrink-0 border-l border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.15)] flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full" style={{ background: color }} />
          <span className="text-xs font-semibold text-white">
            {TYPE_LABELS[node.type || "action"]}
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-[rgba(255,255,255,0.05)]">
          <X size={14} className="text-[rgba(255,255,255,0.4)]" />
        </button>
      </div>

      {/* Config */}
      <div className="p-4 flex flex-col gap-4 overflow-y-auto flex-1">
        <TextField
          label="Label"
          value={(node.data as Record<string, unknown>).label as string || ""}
          placeholder="Node label"
          onChange={(v) => onUpdate(node.id, { label: v })}
        />

        {node.type === "trigger" && <TriggerConfig node={node} onUpdate={onUpdate} />}
        {node.type === "condition" && <ConditionConfig node={node} onUpdate={onUpdate} />}
        {node.type === "action" && <ActionConfig node={node} onUpdate={onUpdate} />}
        {node.type === "delay" && <DelayConfig node={node} onUpdate={onUpdate} />}
      </div>
    </div>
  );
}
