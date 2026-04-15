"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  BookOpen,
  Library,
  Activity,
  GitBranch,
  Sparkles,
  MessageCircle,
} from "lucide-react";
import { PlaybookManager } from "@/components/coaching-studio/playbook-manager";
import { CallLibrary } from "@/components/coaching-studio/call-library";

type TabId =
  | "playbook"
  | "library"
  | "analyzer"
  | "script"
  | "learning"
  | "chat";

const TABS: Array<{
  id: TabId;
  label: string;
  icon: typeof BookOpen;
  phase?: string;
}> = [
  { id: "playbook", label: "Playbook", icon: BookOpen },
  { id: "library", label: "Call Library", icon: Library },
  { id: "analyzer", label: "Analyzer", icon: Activity, phase: "Phase 2" },
  { id: "script", label: "Script Builder", icon: GitBranch, phase: "Phase 2" },
  {
    id: "learning",
    label: "Auto-Learning",
    icon: Sparkles,
    phase: "Phase 3",
  },
  { id: "chat", label: "Coach Chat", icon: MessageCircle, phase: "Phase 3" },
];

function ComingSoon({ phase }: { phase: string }) {
  return (
    <div className="text-center py-24 text-[rgba(255,255,255,0.4)]">
      <p className="text-sm uppercase tracking-wide text-[rgba(255,255,255,0.3)]">
        {phase}
      </p>
      <p className="text-lg mt-2 text-white">Coming next</p>
      <p className="text-sm mt-2 max-w-md mx-auto">
        This tab ships in a later phase of the Coaching Studio rollout.
      </p>
    </div>
  );
}

function CoachingStudioInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = (searchParams.get("tab") as TabId) || "playbook";

  const setTab = useCallback(
    (id: TabId) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", id);
      router.replace(`/dashboard/coaching-studio?${params.toString()}`, {
        scroll: false,
      });
    },
    [router, searchParams]
  );

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Coaching Studio</h1>
        <p className="text-sm text-[rgba(255,255,255,0.4)] mt-1">
          Tune the live call coach — edit the playbook, review calls, and train
          it to follow the script.
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-[rgba(255,255,255,0.06)] mb-6">
        <div className="flex gap-1 overflow-x-auto">
          {TABS.map((t) => {
            const Icon = t.icon;
            const isActive = activeTab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  isActive
                    ? "text-[#00C9A7] border-[#00C9A7]"
                    : "text-[rgba(255,255,255,0.5)] border-transparent hover:text-white"
                }`}
              >
                <Icon size={14} />
                {t.label}
                {t.phase && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] ml-1">
                    {t.phase}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "playbook" && <PlaybookManager />}
      {activeTab === "library" && <CallLibrary />}
      {activeTab === "analyzer" && <ComingSoon phase="Phase 2" />}
      {activeTab === "script" && <ComingSoon phase="Phase 2" />}
      {activeTab === "learning" && <ComingSoon phase="Phase 3" />}
      {activeTab === "chat" && <ComingSoon phase="Phase 3" />}
    </div>
  );
}

export default function CoachingStudioPage() {
  return (
    <Suspense
      fallback={
        <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading...</div>
      }
    >
      <CoachingStudioInner />
    </Suspense>
  );
}
