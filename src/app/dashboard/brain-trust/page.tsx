"use client";

import { useState, Suspense } from "react";
import { AgentList } from "@/components/brain-trust/agent-list";
import { ChatInterface } from "@/components/chat-interface";
import { AGENTS, type Agent } from "@/config/agents";

export default function BrainTrustPage() {
  const [selectedAgent, setSelectedAgent] = useState<Agent>(AGENTS[0]);

  return (
    <div className="-m-6 flex h-[calc(100vh-64px)]">
      {/* Agent selector panel */}
      <div className="w-[280px] shrink-0 border-r border-[rgba(255,255,255,0.06)] overflow-hidden">
        <AgentList
          selectedId={selectedAgent.id}
          onSelect={(agent) => setSelectedAgent(agent)}
        />
      </div>

      {/* Chat panel */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={null}>
          <ChatInterface
            key={selectedAgent.id}
            userName={selectedAgent.name}
            apiEndpoint="/api/brain-trust"
            agentId={selectedAgent.id}
          />
        </Suspense>
      </div>
    </div>
  );
}
