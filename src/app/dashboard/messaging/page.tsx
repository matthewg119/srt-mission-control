"use client";

import { MessageSquare } from "lucide-react";

export default function MessagingPage() {
  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Messaging</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            Send SMS & Email directly from Mission Control
          </p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center border border-[rgba(255,255,255,0.06)] rounded-xl">
        <div className="text-center max-w-md">
          <MessageSquare size={48} className="mx-auto mb-4 text-[rgba(255,255,255,0.15)]" />
          <h2 className="text-lg font-semibold text-white mb-2">Messaging Coming Soon</h2>
          <p className="text-sm text-[rgba(255,255,255,0.4)] leading-relaxed">
            Unified messaging is being rebuilt with Twilio SMS and Microsoft 365 email.
            In the meantime, use the AI Chat to send emails via Microsoft 365.
          </p>
        </div>
      </div>
    </div>
  );
}
