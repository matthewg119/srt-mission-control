"use client";

import { useState, useEffect, useRef, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, ExternalLink, Send } from "lucide-react";

interface Message {
  id: string;
  direction: "inbound" | "outbound";
  body: string;
  close_stage: number | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

interface ConversationDetail {
  id: string;
  phone: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  zoho_lead_id: string | null;
  slack_channel_id: string | null;
  close_stage: number;
  display_name: string;
  contact_id: string | null;
}

interface Template {
  id: string;
  name: string;
  body: string;
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return p;
}

export default function ConversationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [conv, setConv] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [customBody, setCustomBody] = useState("");
  const [posting, setPosting] = useState(false);
  const [postResult, setPostResult] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch(`/api/sms/conversations/${id}`).then((r) => r.json()),
      fetch(`/api/sms/conversations/${id}/messages`).then((r) => r.json()),
      fetch(`/api/templates?type=SMS`).then((r) => r.json()).catch(() => ({ templates: [] })),
    ]).then(([convData, msgData, tmplData]: [
      ConversationDetail,
      { messages: Message[] },
      { templates: Template[] }
    ]) => {
      if (convData && (convData as ConversationDetail).id) setConv(convData as ConversationDetail);
      setMessages(msgData.messages ?? []);
      setTemplates(tmplData.templates ?? []);
    });
  }, [id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handlePostDraft = async () => {
    setPosting(true);
    setPostResult(null);
    try {
      const res = await fetch(`/api/sms/conversations/${id}/draft`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          template_name: selectedTemplate || undefined,
          body: customBody || undefined,
        }),
      });
      const data = await res.json() as { ok?: boolean; channelId?: string; error?: string };
      if (data.ok) {
        setPostResult("✅ Draft posted to Slack");
        setCustomBody("");
        setSelectedTemplate("");
      } else {
        setPostResult(`❌ ${data.error ?? "Failed"}`);
      }
    } catch {
      setPostResult("❌ Network error");
    }
    setPosting(false);
  };

  if (!conv) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push("/dashboard/conversations")}
          className="flex items-center gap-1 text-[rgba(255,255,255,0.4)] hover:text-white text-sm transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-white">{conv.display_name || conv.phone}</h1>
            {conv.business_name && conv.display_name !== conv.business_name && (
              <span className="text-[rgba(255,255,255,0.4)] text-sm">{conv.business_name}</span>
            )}
            <span className="text-[rgba(255,255,255,0.4)] text-sm">{formatPhone(conv.phone)}</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            {conv.slack_channel_id && (
              <a
                href={`https://slack.com/app_redirect?channel=${conv.slack_channel_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[#00B4B4] hover:underline"
              >
                <ExternalLink size={10} />
                Slack Channel
              </a>
            )}
            {conv.zoho_lead_id && (
              <a
                href={`https://crm.zoho.com/crm/tab/Leads/${conv.zoho_lead_id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-white"
              >
                <ExternalLink size={10} />
                Zoho Lead
              </a>
            )}
          </div>
        </div>
      </div>

      {/* Message thread */}
      <div className="flex-1 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-2xl p-4 overflow-y-auto max-h-[50vh] flex flex-col gap-3">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[rgba(255,255,255,0.3)] text-sm">
            No messages yet
          </div>
        ) : (
          messages.map((msg) => {
            const isInbound = msg.direction === "inbound";
            const isAI = (msg.metadata as Record<string, unknown> | null)?.source === "ai_draft";
            return (
              <div key={msg.id} className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-2.5 ${
                    isInbound
                      ? "bg-[rgba(255,255,255,0.08)] text-white"
                      : "bg-[#00B4B4]/80 text-white"
                  }`}
                >
                  <p className="text-sm leading-relaxed">{msg.body}</p>
                  <div className="flex items-center gap-1 mt-1">
                    <span className={`text-xs ${isInbound ? "text-[rgba(255,255,255,0.4)]" : "text-white/60"}`}>
                      {timeLabel(msg.created_at)}
                    </span>
                    {isAI && (
                      <span className="text-xs text-white/50 bg-white/10 px-1.5 rounded-full ml-1">AI</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Draft composer */}
      <div className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex gap-3">
          <select
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            className="bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white focus:outline-none"
          >
            <option value="">Select template…</option>
            {templates.map((t) => (
              <option key={t.id} value={t.name}>{t.name}</option>
            ))}
          </select>
          <span className="text-[rgba(255,255,255,0.3)] text-sm self-center">or</span>
        </div>
        <textarea
          value={customBody}
          onChange={(e) => setCustomBody(e.target.value)}
          placeholder="Write a custom message…"
          rows={3}
          className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[rgba(255,255,255,0.2)] resize-none"
        />
        <div className="flex items-center justify-between">
          {postResult && (
            <span className="text-xs text-[rgba(255,255,255,0.5)]">{postResult}</span>
          )}
          <button
            onClick={handlePostDraft}
            disabled={posting || (!selectedTemplate && !customBody.trim())}
            className="ml-auto flex items-center gap-2 px-4 py-2 rounded-lg bg-[#00B4B4] hover:bg-[#00cccc] text-white text-sm font-medium transition-colors disabled:opacity-40"
          >
            <Send size={14} />
            {posting ? "Posting…" : "Post Draft to Slack"}
          </button>
        </div>
      </div>
    </div>
  );
}
