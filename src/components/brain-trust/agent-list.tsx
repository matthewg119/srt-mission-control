"use client";

import { AGENTS, type Agent } from "@/config/agents";

interface AgentListProps {
  selectedId: string;
  onSelect: (agent: Agent) => void;
}

export function AgentList({ selectedId, onSelect }: AgentListProps) {
  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
        <h2 className="text-xs font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider">Brain Trust</h2>
        <p className="text-[10px] text-[rgba(255,255,255,0.25)] mt-0.5">8 specialized AI advisors</p>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {AGENTS.map((agent) => (
          <button
            key={agent.id}
            onClick={() => onSelect(agent)}
            className={`w-full text-left p-3 rounded-xl transition-all ${
              selectedId === agent.id
                ? "bg-[rgba(255,255,255,0.08)] border border-[rgba(255,255,255,0.12)]"
                : "hover:bg-[rgba(255,255,255,0.04)] border border-transparent"
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className="text-xl leading-none mt-0.5 w-8 h-8 flex items-center justify-center rounded-lg shrink-0"
                style={{ background: `${agent.color}22`, border: `1px solid ${agent.color}44` }}
              >
                {agent.icon}
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white">{agent.name}</span>
                  <span
                    className="text-[10px] font-medium px-1.5 py-0.5 rounded-full"
                    style={{ background: `${agent.color}22`, color: agent.color }}
                  >
                    {agent.role}
                  </span>
                </div>
                <p className="text-xs text-[rgba(255,255,255,0.35)] mt-0.5 leading-snug">
                  {agent.description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
