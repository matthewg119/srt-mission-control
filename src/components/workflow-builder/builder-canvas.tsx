"use client";

import { useCallback, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useNodesState,
  useEdgesState,
  BackgroundVariant,
  type Connection,
  type Node,
  type Edge,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { builderNodeTypes } from "./builder-nodes";
import { NodePalette } from "./node-palette";
import { NodeConfigPanel } from "./node-config-panel";

const DEFAULT_NODE_DATA: Record<string, Record<string, unknown>> = {
  trigger: { label: "Trigger", event: "", eventConfig: {} },
  condition: { label: "Condition", field: "", operator: "equals", value: "" },
  action: { label: "Action", actionType: "", actionConfig: {} },
  delay: { label: "Delay", delayMinutes: 30 },
};

const EDGE_STYLE = { stroke: "rgba(255,255,255,0.2)", strokeWidth: 1.5 };

interface BuilderCanvasProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  onChange?: (nodes: Node[], edges: Edge[]) => void;
}

let nodeIdCounter = 0;
function getNextId() {
  return `node_${Date.now()}_${nodeIdCounter++}`;
}

export function BuilderCanvas({ initialNodes = [], initialEdges = [], onChange }: BuilderCanvasProps) {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  // Notify parent of changes
  const notifyChange = useCallback(
    (n: Node[], e: Edge[]) => {
      onChange?.(n, e);
    },
    [onChange]
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => {
        const next = addEdge({ ...connection, style: EDGE_STYLE, animated: true }, eds);
        notifyChange(nodes, next);
        return next;
      });
    },
    [setEdges, nodes, notifyChange]
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const type = e.dataTransfer.getData("application/reactflow");
      if (!type || !rfInstance || !reactFlowWrapper.current) return;

      const bounds = reactFlowWrapper.current.getBoundingClientRect();
      const position = rfInstance.screenToFlowPosition({
        x: e.clientX - bounds.left,
        y: e.clientY - bounds.top,
      });

      const newNode: Node = {
        id: getNextId(),
        type,
        position,
        data: {
          ...DEFAULT_NODE_DATA[type],
          onDelete: handleDeleteNode,
        },
      };

      setNodes((nds) => {
        const next = [...nds, newNode];
        notifyChange(next, edges);
        return next;
      });
    },
    [rfInstance, setNodes, edges, notifyChange]
  );

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => {
        const next = nds.filter((n) => n.id !== nodeId);
        setEdges((eds) => {
          const nextEdges = eds.filter((e) => e.source !== nodeId && e.target !== nodeId);
          notifyChange(next, nextEdges);
          return nextEdges;
        });
        return next;
      });
      setSelectedNode((prev) => (prev?.id === nodeId ? null : prev));
    },
    [setNodes, setEdges, notifyChange]
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedNode(node);
    },
    []
  );

  const onPaneClick = useCallback(() => {
    setSelectedNode(null);
  }, []);

  const handleNodeDataUpdate = useCallback(
    (id: string, dataUpdate: Record<string, unknown>) => {
      setNodes((nds) => {
        const next = nds.map((n) =>
          n.id === id ? { ...n, data: { ...n.data, ...dataUpdate, onDelete: handleDeleteNode } } : n
        );
        // Update selected node ref
        const updated = next.find((n) => n.id === id);
        if (updated) setSelectedNode(updated);
        notifyChange(next, edges);
        return next;
      });
    },
    [setNodes, edges, notifyChange, handleDeleteNode]
  );

  // Inject onDelete into nodes
  const nodesWithCallbacks = nodes.map((n) => ({
    ...n,
    data: { ...n.data, onDelete: handleDeleteNode },
  }));

  return (
    <div className="flex flex-1 min-h-0">
      <NodePalette />

      <div ref={reactFlowWrapper} className="flex-1 min-w-0">
        <ReactFlow
          nodes={nodesWithCallbacks}
          edges={edges}
          nodeTypes={builderNodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onInit={(instance) => setRfInstance(instance as unknown as ReactFlowInstance)}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onNodeClick={onNodeClick}
          onPaneClick={onPaneClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          minZoom={0.3}
          maxZoom={2}
          style={{ background: "#0B1426" }}
          proOptions={{ hideAttribution: true }}
          deleteKeyCode="Delete"
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

      {selectedNode && (
        <NodeConfigPanel
          node={selectedNode}
          onUpdate={handleNodeDataUpdate}
          onClose={() => setSelectedNode(null)}
        />
      )}
    </div>
  );
}
