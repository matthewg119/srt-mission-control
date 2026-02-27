"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Plus,
  MessageSquare,
  AlertTriangle,
  Zap,
  Kanban,
  Search,
  Mail,
  FileText,
  Activity,
  ArrowRightLeft,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatRelativeTime } from "@/lib/utils";

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
}

interface Conversation {
  id: string;
  title: string;
  created_at: string;
}

// Map tool names to friendly labels and icons
const TOOL_LABELS: Record<string, { label: string; icon: typeof Zap }> = {
  get_pipeline_overview: { label: "Checking pipeline", icon: Kanban },
  get_deals_in_stage: { label: "Looking up deals", icon: Kanban },
  search_deals: { label: "Searching deals", icon: Search },
  move_deal: { label: "Moving deal", icon: ArrowRightLeft },
  send_sms: { label: "Sending SMS", icon: MessageSquare },
  send_email: { label: "Sending email", icon: Mail },
  get_templates: { label: "Checking templates", icon: FileText },
  send_template: { label: "Sending template", icon: FileText },
  get_recent_activity: { label: "Checking activity", icon: Activity },
};

function getToolLabel(action: string): { label: string; icon: typeof Zap } {
  const toolName = action.split("(")[0];
  return TOOL_LABELS[toolName] || { label: toolName, icon: Zap };
}

export function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentActions, setCurrentActions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, currentActions]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch("/api/chat?action=conversations");
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Silent fail
    }
  }, []);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  const loadConversation = async (conversationId: string) => {
    try {
      const res = await fetch(`/api/chat?action=history&conversationId=${conversationId}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
        setActiveConversation(conversationId);
      }
    } catch {
      // Silent fail
    }
  };

  const startNewChat = () => {
    setMessages([]);
    setActiveConversation(null);
    setInput("");
  };

  const handleSend = async () => {
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);
    setCurrentActions([]);

    const conversationId = activeConversation || crypto.randomUUID();
    if (!activeConversation) setActiveConversation(conversationId);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: userMessage }],
          conversationId,
        }),
      });

      if (res.status === 503) {
        const data = await res.json();
        if (data.error === "AI_NOT_CONFIGURED") {
          setAiConfigured(false);
          setMessages((prev) => prev.slice(0, -1));
          setLoading(false);
          return;
        }
      }

      if (!res.ok) throw new Error("Failed to send message");

      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response,
          actions: data.actions?.length > 0 ? data.actions : undefined,
        },
      ]);

      fetchConversations();
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: "Sorry, something went wrong. Please try again." },
      ]);
    }

    setLoading(false);
    setCurrentActions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!aiConfigured) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <AlertTriangle size={48} className="mx-auto mb-4 text-[#F5A623]" />
          <h2 className="text-xl font-semibold text-white mb-2">AI Assistant Not Configured</h2>
          <p className="text-[rgba(255,255,255,0.5)] mb-4">
            Add your Anthropic API key in Settings &rarr; AI Configuration to enable the AI assistant.
          </p>
          <a
            href="/dashboard/settings"
            className="inline-block px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg font-semibold text-sm hover:opacity-90"
          >
            Go to Settings
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Conversation Sidebar */}
      <div
        className={`${
          sidebarOpen ? "w-[280px]" : "w-0"
        } flex-shrink-0 border-r border-[rgba(255,255,255,0.06)] overflow-hidden transition-all duration-200 hidden md:block`}
      >
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[rgba(255,255,255,0.5)]">Conversations</h3>
            <button
              onClick={startNewChat}
              className="p-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md hover:opacity-90"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {conversations.length === 0 ? (
              <p className="text-xs text-[rgba(255,255,255,0.3)] text-center py-4">No conversations yet</p>
            ) : (
              conversations.map((conv) => (
                <button
                  key={conv.id}
                  onClick={() => loadConversation(conv.id)}
                  className={`w-full text-left p-2.5 rounded-lg text-sm transition-colors ${
                    activeConversation === conv.id
                      ? "bg-[rgba(255,255,255,0.08)] text-white"
                      : "text-[rgba(255,255,255,0.4)] hover:bg-[rgba(255,255,255,0.03)] hover:text-white"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <MessageSquare size={12} />
                    <span className="truncate">{conv.title}</span>
                  </div>
                  <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5 ml-5">
                    {formatRelativeTime(conv.created_at)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Toggle sidebar on mobile */}
        <div className="md:hidden p-2 border-b border-[rgba(255,255,255,0.06)]">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-xs text-[rgba(255,255,255,0.5)]"
          >
            {sidebarOpen ? "Hide" : "Show"} conversations
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[rgba(255,255,255,0.3)]">
              <div className="text-center">
                <Zap size={48} className="mx-auto mb-4 opacity-30" />
                <p className="text-lg font-medium">SRT Office Manager</p>
                <p className="text-sm mt-2 max-w-md">
                  I can check your pipeline, move deals, send messages, and manage operations. Ask me anything.
                </p>
                <div className="flex flex-wrap gap-2 justify-center mt-4">
                  {[
                    "What's the pipeline looking like?",
                    "Who's in Underwriting?",
                    "Show me recent activity",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setInput(suggestion);
                        textareaRef.current?.focus();
                      }}
                      className="px-3 py-1.5 text-xs bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            messages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`rounded-xl px-4 py-3 ${
                    msg.role === "user"
                      ? "bg-[#00C9A7] text-[#0B1426]"
                      : "bg-[rgba(255,255,255,0.05)] text-white"
                  }`}
                  style={{ maxWidth: msg.role === "user" ? "70%" : "85%" }}
                >
                  {/* Show tool actions taken */}
                  {msg.actions && msg.actions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-2 pb-2 border-b border-[rgba(255,255,255,0.08)]">
                      {msg.actions.map((action, j) => {
                        const { label, icon: Icon } = getToolLabel(action);
                        return (
                          <span
                            key={j}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-[rgba(0,201,167,0.1)] text-[#00C9A7] text-[10px] font-medium rounded-full"
                          >
                            <Icon size={10} />
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  )}
                  {msg.role === "assistant" ? (
                    <div className="prose prose-invert prose-sm max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                  )}
                </div>
              </div>
            ))
          )}

          {/* Loading indicator */}
          {loading && (
            <div className="flex justify-start">
              <div className="bg-[rgba(255,255,255,0.05)] rounded-xl px-4 py-3">
                <div className="flex items-center gap-2">
                  <div className="flex gap-1">
                    <div className="w-2 h-2 bg-[#00C9A7] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <div className="w-2 h-2 bg-[#00C9A7] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <div className="w-2 h-2 bg-[#00C9A7] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                  <span className="text-xs text-[rgba(255,255,255,0.4)]">
                    Thinking...
                  </span>
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="p-4 border-t border-[rgba(255,255,255,0.06)]">
          <div className="flex gap-2 items-end">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask the Office Manager anything..."
              rows={1}
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
              style={{ minHeight: "44px", maxHeight: "120px" }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || loading}
              className="p-3 bg-[#00C9A7] text-[#0B1426] rounded-xl hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
