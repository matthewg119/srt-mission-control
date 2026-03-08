"use client";

import { useCallback, useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  BackgroundVariant,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { FlowNode, GroupLabel } from "./flow-nodes";

const nodeTypes = {
  flowNode: FlowNode,
  groupLabel: GroupLabel,
};

interface WorkflowStats {
  rejectedLeads: number;
  rejectedApps: number;
  enrollmentCounts: Record<string, number>;
  smsSent: number;
  emailSent: number;
  totalLeads: number;
  totalApps: number;
  totalEnrollments: number;
}

interface WorkflowMapProps {
  stats: WorkflowStats;
}

export function WorkflowMap({ stats }: WorkflowMapProps) {
  // ── Track X positions (4 vertical columns) ──────────────────────────────
  const X1 = 60;    // Contact Form
  const X2 = 360;   // Application Form
  const X3 = 660;   // Stage Automations
  const X4 = 960;   // Sequence Processor

  const nodes: Node[] = useMemo(() => [
    // ── Track Labels ──────────────────────────────────────────────
    { id: "lbl1", type: "groupLabel", position: { x: X1, y: 20 }, data: { label: "Contact Form", color: "#1B65A7" } },
    { id: "lbl2", type: "groupLabel", position: { x: X2, y: 20 }, data: { label: "Apply Form", color: "#8b5cf6" } },
    { id: "lbl3", type: "groupLabel", position: { x: X3, y: 20 }, data: { label: "Stage Automations", color: "#f59e0b" } },
    { id: "lbl4", type: "groupLabel", position: { x: X4, y: 20 }, data: { label: "Email Sequences", color: "#00C9A7" } },

    // ── Track 1: Contact Form ──────────────────────────────────────
    { id: "cf1", type: "flowNode", position: { x: X1, y: 90 }, data: { label: "Contact Form", sub: "srtagency.com/contact", type: "trigger", count: stats.totalLeads, countLabel: "leads (7d)" } },
    { id: "cf2", type: "flowNode", position: { x: X1, y: 210 }, data: { label: "Bot Validation", sub: "Honeypot + timing check", type: "condition" } },
    { id: "cf3", type: "flowNode", position: { x: X1 - 50, y: 330 }, data: { label: "Rejected", sub: "Bot detected → logged", type: "error", count: stats.rejectedLeads, countLabel: "blocked (7d)" } },
    { id: "cf4", type: "flowNode", position: { x: X1 + 50, y: 330 }, data: { label: "Contact Created", sub: "Contact + deal", type: "action" } },
    { id: "cf5", type: "flowNode", position: { x: X1, y: 450 }, data: { label: "Tag: website-lead", type: "action" } },
    { id: "cf6", type: "flowNode", position: { x: X1 - 60, y: 570 }, data: { label: "Enroll: nurture", sub: "website-lead-nurture", type: "outcome", count: stats.enrollmentCounts["website-lead-nurture"] || 0, countLabel: "active" } },
    { id: "cf7", type: "flowNode", position: { x: X1 + 60, y: 570 }, data: { label: "Enroll: to-apply", sub: "website-lead-to-application", type: "outcome", count: stats.enrollmentCounts["website-lead-to-application"] || 0, countLabel: "active" } },

    // ── Track 2: Application Form ──────────────────────────────────
    { id: "af1", type: "flowNode", position: { x: X2, y: 90 }, data: { label: "Apply — 25%", sub: "First milestone hit", type: "trigger", count: stats.totalApps, countLabel: "started (7d)" } },
    { id: "af2", type: "flowNode", position: { x: X2, y: 210 }, data: { label: "Bot Validation", sub: "Duplicate + timing check", type: "condition" } },
    { id: "af3", type: "flowNode", position: { x: X2 - 50, y: 330 }, data: { label: "Rejected", sub: "Bot or duplicate", type: "error", count: stats.rejectedApps, countLabel: "blocked (7d)" } },
    { id: "af4", type: "flowNode", position: { x: X2 + 50, y: 330 }, data: { label: "Contact Created", sub: "Tag: application-started", type: "action" } },
    { id: "af5", type: "flowNode", position: { x: X2, y: 450 }, data: { label: "Enroll: abandoned", sub: "application-abandoned", type: "outcome", count: stats.enrollmentCounts["application-abandoned"] || 0, countLabel: "active" } },
    { id: "af6", type: "flowNode", position: { x: X2, y: 570 }, data: { label: "Apply — 100%", sub: "Full application submitted", type: "trigger" } },
    { id: "af7", type: "flowNode", position: { x: X2, y: 690 }, data: { label: "PDF + Signature", sub: "Generated & uploaded to OneDrive", type: "action" } },
    { id: "af8", type: "flowNode", position: { x: X2, y: 810 }, data: { label: "Tag: completed", sub: "Cancel: abandoned | Enroll: nurture", type: "outcome", count: stats.enrollmentCounts["application-completed-nurture"] || 0, countLabel: "enrolled" } },

    // ── Track 3: Stage Automations ──────────────────────────────────
    { id: "sa1", type: "flowNode", position: { x: X3, y: 90 }, data: { label: "Stage Change", sub: "AI or manual move", type: "trigger" } },
    { id: "sa2", type: "flowNode", position: { x: X3, y: 210 }, data: { label: "processStageChange()", sub: "Match 15 automation rules", type: "condition" } },
    { id: "sa3", type: "flowNode", position: { x: X3 - 90, y: 330 }, data: { label: "Send SMS", type: "action", count: stats.smsSent, countLabel: "sent (7d)" } },
    { id: "sa4", type: "flowNode", position: { x: X3 - 20, y: 330 }, data: { label: "Send Email", type: "action", count: stats.emailSent, countLabel: "sent (7d)" } },
    { id: "sa5", type: "flowNode", position: { x: X3 + 60, y: 330 }, data: { label: "Add Tag", type: "action" } },
    { id: "sa6", type: "flowNode", position: { x: X3 + 130, y: 330 }, data: { label: "Team Notify", type: "action" } },

    // ── Track 4: Sequence Processor ──────────────────────────────────
    { id: "sp1", type: "flowNode", position: { x: X4, y: 90 }, data: { label: "Vercel Cron — 5 min", sub: "/api/cron/process-sequences", type: "trigger" } },
    { id: "sp2", type: "flowNode", position: { x: X4, y: 210 }, data: { label: "processScheduledEmails()", sub: "Find: next_send_at ≤ now, active", type: "condition", count: stats.totalEnrollments, countLabel: "enrollments" } },
    { id: "sp3", type: "flowNode", position: { x: X4, y: 330 }, data: { label: "Check Cancel Tag", sub: "Skip if contact has cancel tag", type: "condition" } },
    { id: "sp4", type: "flowNode", position: { x: X4, y: 450 }, data: { label: "microsoft.sendMail()", sub: "Deliver via Microsoft 365", type: "action", count: stats.emailSent, countLabel: "sent (7d)" } },
    { id: "sp5", type: "flowNode", position: { x: X4 - 50, y: 570 }, data: { label: "Advance Step", sub: "Next email scheduled", type: "outcome" } },
    { id: "sp6", type: "flowNode", position: { x: X4 + 60, y: 570 }, data: { label: "Completed", sub: "Sequence finished", type: "outcome", color: "#00C9A7" } },
  ], [stats, X1, X2, X3, X4]);

  const edges: Edge[] = useMemo(() => [
    // Track 1: Contact Form
    { id: "e-cf1-2", source: "cf1", target: "cf2", animated: true, style: { stroke: "#1B65A7", strokeWidth: 2 } },
    { id: "e-cf2-3", source: "cf2", target: "cf3", label: "FAIL", labelStyle: { fill: "#ef4444", fontSize: 9 }, style: { stroke: "#ef4444", strokeWidth: 1.5, strokeDasharray: "4 2" } },
    { id: "e-cf2-4", source: "cf2", target: "cf4", label: "PASS", labelStyle: { fill: "#00C9A7", fontSize: 9 }, style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
    { id: "e-cf4-5", source: "cf4", target: "cf5", style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
    { id: "e-cf5-6", source: "cf5", target: "cf6", style: { stroke: "#8b5cf6", strokeWidth: 1.5 } },
    { id: "e-cf5-7", source: "cf5", target: "cf7", style: { stroke: "#8b5cf6", strokeWidth: 1.5 } },

    // Track 2: Application Form
    { id: "e-af1-2", source: "af1", target: "af2", animated: true, style: { stroke: "#8b5cf6", strokeWidth: 2 } },
    { id: "e-af2-3", source: "af2", target: "af3", label: "FAIL", labelStyle: { fill: "#ef4444", fontSize: 9 }, style: { stroke: "#ef4444", strokeWidth: 1.5, strokeDasharray: "4 2" } },
    { id: "e-af2-4", source: "af2", target: "af4", label: "PASS", labelStyle: { fill: "#00C9A7", fontSize: 9 }, style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
    { id: "e-af4-5", source: "af4", target: "af5", style: { stroke: "#8b5cf6", strokeWidth: 1.5 } },
    { id: "e-af5-6", source: "af5", target: "af6", style: { stroke: "#8b5cf6", strokeWidth: 1.5, strokeDasharray: "4 2" } },
    { id: "e-af6-7", source: "af6", target: "af7", style: { stroke: "#8b5cf6", strokeWidth: 1.5 } },
    { id: "e-af7-8", source: "af7", target: "af8", style: { stroke: "#00C9A7", strokeWidth: 1.5 } },

    // Track 3: Stage Automations
    { id: "e-sa1-2", source: "sa1", target: "sa2", animated: true, style: { stroke: "#f59e0b", strokeWidth: 2 } },
    { id: "e-sa2-3", source: "sa2", target: "sa3", style: { stroke: "#0ea5e9", strokeWidth: 1.5 } },
    { id: "e-sa2-4", source: "sa2", target: "sa4", style: { stroke: "#0ea5e9", strokeWidth: 1.5 } },
    { id: "e-sa2-5", source: "sa2", target: "sa5", style: { stroke: "#0ea5e9", strokeWidth: 1.5 } },
    { id: "e-sa2-6", source: "sa2", target: "sa6", style: { stroke: "#0ea5e9", strokeWidth: 1.5 } },

    // Track 4: Sequence Processor
    { id: "e-sp1-2", source: "sp1", target: "sp2", animated: true, style: { stroke: "#00C9A7", strokeWidth: 2 } },
    { id: "e-sp2-3", source: "sp2", target: "sp3", style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
    { id: "e-sp3-4", source: "sp3", target: "sp4", label: "send", labelStyle: { fill: "#00C9A7", fontSize: 9 }, style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
    { id: "e-sp4-5", source: "sp4", target: "sp5", style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
    { id: "e-sp4-6", source: "sp4", target: "sp6", style: { stroke: "#00C9A7", strokeWidth: 1.5 } },
  ], []);

  const onInit = useCallback(() => {}, []);

  return (
    <div style={{ width: "100%", height: "100%" }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onInit={onInit}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.3}
        maxZoom={2}
        style={{ background: "#0B1426" }}
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="rgba(255,255,255,0.04)" />
        <Controls
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
          }}
        />
      </ReactFlow>
    </div>
  );
}
