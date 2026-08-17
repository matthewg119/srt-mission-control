"use client";

import { Suspense } from "react";
import { ChatInterface } from "@/components/chat-interface";

// Vektor, full page.
//
// This used to redirect to /dashboard. It is now the general chatbot over the
// whole CRM — ask it anything, including "who do we need to call today?",
// which is the first suggestion chip on the empty state.
//
// Same tool loop as the floating ChatPopup and as Slack (see
// src/lib/ai-tools.ts AI_TOOLS), so an answer here and an answer in Slack come
// from identical data. The full-page layout exists because the worklist and
// timeline tool cards need the width.
export default function AssistantPage() {
  return (
    <div className="-m-6 h-[calc(100vh-64px)]">
      <Suspense fallback={null}>
        <ChatInterface userName="Vektor" apiEndpoint="/api/chat" />
      </Suspense>
    </div>
  );
}
