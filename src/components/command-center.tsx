"use client";

import { Suspense } from "react";
import { ChatInterface } from "@/components/chat-interface";

interface CommandCenterProps {
  userName?: string;
}

export function CommandCenter({ userName }: CommandCenterProps) {
  return (
    <div className="h-full flex flex-col">
      <Suspense fallback={null}>
        <ChatInterface userName={userName} />
      </Suspense>
    </div>
  );
}
