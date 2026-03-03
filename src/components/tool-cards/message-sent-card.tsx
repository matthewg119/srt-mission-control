"use client";

import { CheckCircle2, MessageSquare, Mail } from "lucide-react";

interface MessageSentResult {
  success?: boolean;
  message?: string;
  error?: string;
  rendered_body?: string;
}

export function MessageSentCard({
  data,
  tool,
}: {
  data: MessageSentResult;
  tool: string;
}) {
  const isSMS = tool === "send_sms" || tool === "send_template";
  const Icon = isSMS ? MessageSquare : Mail;
  const label = isSMS ? "SMS Sent" : "Email Sent";

  if (data.error) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.05)] px-4 py-3 flex gap-2 items-start">
        <span className="text-red-400 text-sm">{data.error}</span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(0,201,167,0.2)] bg-[rgba(0,201,167,0.05)] px-4 py-3 flex gap-3 items-start">
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <CheckCircle2 className="h-4 w-4 text-[#00C9A7]" />
        <Icon className="h-4 w-4 text-[#00C9A7]" />
      </div>
      <div>
        <p className="text-sm font-semibold text-[#00C9A7]">{label}</p>
        {data.message && (
          <p className="text-xs text-[rgba(255,255,255,0.45)] mt-0.5">{data.message}</p>
        )}
        {data.rendered_body && (
          <p className="text-xs text-[rgba(255,255,255,0.35)] mt-1 line-clamp-2">
            {data.rendered_body.replace(/<[^>]*>/g, "").slice(0, 120)}...
          </p>
        )}
      </div>
    </div>
  );
}
