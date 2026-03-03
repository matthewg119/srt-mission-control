"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
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
  User,
  Building2,
  ListChecks,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatRelativeTime } from "@/lib/utils";
import { ToolCard } from "@/components/tool-cards/tool-card";

interface ToolResult {
  tool: string;
  data: unknown;
  input: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  actions?: string[];
  toolResults?: ToolResult[];
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
  get_contact_profile: { label: "Looking up contact", icon: User },
  add_deal_note: { label: "Adding note", icon: FileText },
  get_deal_notes: { label: "Fetching notes", icon: FileText },
  get_lenders: { label: "Checking lenders", icon: Building2 },
  enroll_in_sequence: { label: "Enrolling in sequence", icon: ListChecks },
};

function getToolLabel(action: string): { label: string; icon: typeof Zap } {
  const toolName = action.split("(")[0];
  return TOOL_LABELS[toolName] || { label: toolName, icon: Zap };
}

const SUGGESTION_CHIPS = [
  { label: "Pipeline overview", prompt: "Give me a full pipeline overview", category: "Pipeline" },
  { label: "Who's in Underwriting?", prompt: "Who's currently in Underwriting?", category: "Pipeline" },
  { label: "Stale deals", prompt: "Which deals have been stale for more than 3 days?", category: "Pipeline" },
  { label: "New leads today", prompt: "Show me new leads from the last 24 hours", category: "Pipeline" },
  { label: "Recent activity", prompt: "Show me recent activity", category: "Activity" },
  { label: "Find a contact", prompt: "Look up contact: ", category: "Contacts" },
  { label: "View lenders", prompt: "Show me all lenders", category: "Lenders" },
  { label: "MCA lenders", prompt: "What lenders do we have for MCA / Working Capital?", category: "Lenders" },
  { label: "Send SMS", prompt: "Send an SMS to ", category: "Actions" },
  { label: "Move a deal", prompt: "Move deal for ", category: "Actions" },
  { label: "Add a note", prompt: "Add a note to the deal for ", category: "Actions" },
  { label: "Enroll in sequence", prompt: "Enroll contact in sequence: ", category: "Actions" },
];

interface ActivityEntry {
  event_type: string;
  description: string;
  relativeTime: string;
}

const EVENT_DOT_COLORS: Record<string, string> = {
  lead_capture: "#00C9A7",
  lead_captured: "#00C9A7",
  application_submitted: "#8b5cf6",
  application_started: "#8b5cf6",
  sms_sent: "#0ea5e9",
  email_sent: "#0ea5e9",
  stage_changed: "#f59e0b",
  cron_sequences: "#64748b",
  ai_action: "#1B65A7",
  error: "#ef4444",
};

interface ChatInterfaceProps {
  userName?: string;
  apiEndpoint?: string;
  agentId?: string;
  recentActivity?: ActivityEntry[];
}

export function ChatInterface({ userName, apiEndpoint = "/api/chat", agentId, recentActivity }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [aiConfigured, setAiConfigured] = useState(true);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversation, setActiveConversation] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchParams = useSearchParams();
  const autoSentRef = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const fetchConversations = useCallback(async () => {
    try {
      const res = await fetch(`${apiEndpoint}?action=conversations${agentId ? `&agentId=${agentId}` : ""}`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data.conversations || []);
      }
    } catch {
      // Silent fail
    }
  }, [apiEndpoint, agentId]);

  useEffect(() => {
    fetchConversations();
  }, [fetchConversations]);

  // Auto-send from ?q= query param
  useEffect(() => {
    const q = searchParams?.get("q");
    if (q && !autoSentRef.current) {
      autoSentRef.current = true;
      setInput(q);
      setTimeout(() => {
        handleSendMessage(q);
      }, 300);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadConversation = async (conversationId: string) => {
    try {
      const res = await fetch(`${apiEndpoint}?action=history&conversationId=${conversationId}`);
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

  const handleSendMessage = async (messageText: string) => {
    if (!messageText.trim() || loading) return;

    const userMessage = messageText.trim();
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setLoading(true);

    const conversationId = activeConversation || crypto.randomUUID();
    if (!activeConversation) setActiveConversation(conversationId);

    try {
      const res = await fetch(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, { role: "user", content: userMessage }],
          conversationId,
          agentId,
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
          toolResults: data.toolResults?.length > 0 ? data.toolResults : undefined,
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
  };

  const handleSend = () => handleSendMessage(input);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleSuggestion = (prompt: string) => {
    // If prompt ends with space/colon, just fill the input
    if (prompt.endsWith(" ") || prompt.endsWith(": ")) {
      setInput(prompt);
      textareaRef.current?.focus();
    } else {
      handleSendMessage(prompt);
    }
  };

  const handleToolAction = (prompt: string) => {
    setInput(prompt);
    textareaRef.current?.focus();
  };

  if (!aiConfigured) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center max-w-md">
          <AlertTriangle size={48} className="mx-auto mb-4 text-[#F5A623]" />
          <h2 className="text-xl font-semibold text-white mb-2">AI Not Configured</h2>
          <p className="text-[rgba(255,255,255,0.5)] mb-4">
            Add your Anthropic API key in Settings → AI Configuration.
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
          sidebarOpen ? "w-[240px]" : "w-0"
        } flex-shrink-0 border-r border-[rgba(255,255,255,0.06)] overflow-hidden transition-all duration-200 hidden md:block`}
      >
        <div className="p-4 h-full flex flex-col">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider">History</h3>
            <button
              onClick={startNewChat}
              className="p-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md hover:opacity-90"
              title="New chat"
            >
              <Plus size={14} />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-0.5">
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
                    <MessageSquare size={11} className="shrink-0" />
                    <span className="truncate text-xs">{conv.title}</span>
                  </div>
                  <p className="text-[10px] text-[rgba(255,255,255,0.3)] mt-0.5 ml-[19px]">
                    {formatRelativeTime(conv.created_at)}
                  </p>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 ? (
            <div className="flex h-full items-start justify-center pt-8 px-4">
              <div className={`w-full max-w-5xl ${recentActivity && recentActivity.length > 0 ? "grid grid-cols-[1fr_320px] gap-6" : "max-w-2xl"}`}>
                {/* Left: greeting + chips */}
                <div>
                  <div className="flex items-center gap-3 mb-5">
                    <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-[rgba(0,201,167,0.1)] border border-[rgba(0,201,167,0.2)]">
                      <Zap size={22} className="text-[#00C9A7]" />
                    </div>
                    <div>
                      <h2 className="text-xl font-semibold text-white">
                        {userName ? `Hey ${userName.split(" ")[0]}` : "SRT Office Manager"}
                      </h2>
                      <p className="text-[rgba(255,255,255,0.4)] text-xs mt-0.5">
                        Check your pipeline, look up contacts, send messages, manage operations.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {["Pipeline", "Contacts", "Lenders", "Actions"].map((cat) => {
                      const chips = SUGGESTION_CHIPS.filter((c) => c.category === cat);
                      return (
                        <div key={cat}>
                          <p className="text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.25)] mb-1.5">{cat}</p>
                          <div className="flex flex-wrap gap-2">
                            {chips.map((chip) => (
                              <button
                                key={chip.label}
                                onClick={() => handleSuggestion(chip.prompt)}
                                className="px-3 py-1.5 text-xs bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg text-[rgba(255,255,255,0.5)] hover:text-white hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)] transition-all"
                              >
                                {chip.label}
                              </button>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Right: Recent Activity */}
                {recentActivity && recentActivity.length > 0 && (
                  <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] overflow-hidden">
                    <div className="px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-2">
                      <Activity size={12} className="text-[rgba(255,255,255,0.4)]" />
                      <span className="text-xs font-semibold text-[rgba(255,255,255,0.4)] uppercase tracking-wider">
                        Recent Activity
                      </span>
                    </div>
                    <div className="divide-y divide-[rgba(255,255,255,0.04)]">
                      {recentActivity.map((item, i) => (
                        <div key={i} className="flex gap-3 px-4 py-2.5 items-start">
                          <span
                            className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                            style={{ background: EVENT_DOT_COLORS[item.event_type] || "#64748b" }}
                          />
                          <p className="text-xs text-[rgba(255,255,255,0.6)] leading-relaxed flex-1 min-w-0">
                            {item.description}
                          </p>
                          <span className="text-[10px] text-[rgba(255,255,255,0.25)] shrink-0 mt-0.5">
                            {item.relativeTime}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
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
                  style={{ maxWidth: msg.role === "user" ? "70%" : "88%" }}
                >
                  {/* Tool action pills */}
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

                  {/* Rich tool result cards */}
                  {msg.toolResults && msg.toolResults.length > 0 && (
                    <div className="mb-3 space-y-2">
                      {msg.toolResults.map((tr, j) => (
                        <ToolCard key={j} toolResult={tr} onAction={handleToolAction} />
                      ))}
                    </div>
                  )}

                  {/* Message text */}
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
                  <span className="text-xs text-[rgba(255,255,255,0.4)]">Thinking...</span>
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
