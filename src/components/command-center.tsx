"use client";

import { Suspense } from "react";
import { ChatInterface } from "@/components/chat-interface";

interface ActivityEntry {
  event_type: string;
  description: string;
  relativeTime: string;
}

interface CommandCenterProps {
  userName?: string;
  recentActivity?: ActivityEntry[];
}

export function CommandCenter({ userName, recentActivity }: CommandCenterProps) {
  return (
    <div className="h-full flex flex-col">
      <Suspense fallback={null}>
        <ChatInterface userName={userName} recentActivity={recentActivity} />
      </Suspense>
    </div>
  );
}
