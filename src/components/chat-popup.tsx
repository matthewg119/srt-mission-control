"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Send, X, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

interface Message {
  role: "user" | "assistant";
  content: string;
}

interface SlashCommand {
  command: string;
  label: string;
  description: string;
  prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/task", label: "Create Task", description: "Create a new task", prompt: "Create a task: " },
  { command: "/status", label: "Status", description: "Pipeline overview", prompt: "Give me a quick pipeline status overview" },
  { command: "/prep", label: "Call Prep", description: "Prep for a call", prompt: "Generate call prep for " },
  { command: "/move", label: "Move Deal", description: "Move deal to stage", prompt: "Move deal " },
  { command: "/underwrite", label: "Underwrite", description: "Analyze a deal", prompt: "Underwrite deal " },
  { command: "/submit", label: "Submit", description: "Submit to lender", prompt: "Submit deal " },
  { command: "/lenders", label: "Lenders", description: "Search lender DB", prompt: "Search lenders for " },
];

export function ChatPopup() {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showCommands, setShowCommands] = useState(false);
  const [filteredCommands, setFilteredCommands] = useState<SlashCommand[]>([]);
  const [hasUnread, setHasUnread] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
    if (isOpen) setHasUnread(false);
  }, [isOpen]);

  const handleInputChange = (value: string) => {
    setInput(value);
    if (value === "/") {
      setShowCommands(true);
      setFilteredCommands(SLASH_COMMANDS);
    } else if (value.startsWith("/")) {
      setShowCommands(true);
      setFilteredCommands(
        SLASH_COMMANDS.filter((c) => c.command.startsWith(value.split(" ")[0]))
      );
    } else {
      setShowCommands(false);
    }
  };

  const selectCommand = (cmd: SlashCommand) => {
    setInput(cmd.prompt);
    setShowCommands(false);
    inputRef.current?.focus();
  };

  const sendMessage = async () => {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setShowCommands(false);
    const userMsg: Message = { role: "user", content: text };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
          conversationId: "chat-popup",
        }),
      });

      const data = await res.json();
      const assistantMsg: Message = {
        role: "assistant",
        content: data.response || data.error || "No response",
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", content: "Failed to connect." }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {/* Floating button */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 w-12 h-12 rounded-full bg-[#00C9A7] text-black flex items-center justify-center shadow-lg hover:bg-[#00b396] transition-colors z-50"
        >
          <Brain size={20} />
          {hasUnread && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#E74C3C] rounded-full" />
          )}
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 w-[400px] h-[500px] bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl flex flex-col z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[rgba(0,201,167,0.15)] flex items-center justify-center">
                <Brain size={12} className="text-[#00C9A7]" />
              </div>
              <span className="text-sm font-medium text-white">BrainHeart</span>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-[rgba(255,255,255,0.3)] hover:text-white transition-colors"
            >
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.length === 0 && (
              <div className="text-center py-8">
                <Brain size={24} className="mx-auto mb-2 text-[rgba(255,255,255,0.1)]" />
                <p className="text-xs text-[rgba(255,255,255,0.3)]">
                  Ask me anything. Type <span className="text-[#00C9A7]">/</span> for commands.
                </p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                    msg.role === "user"
                      ? "bg-[#00C9A7] text-black"
                      : "bg-[rgba(255,255,255,0.05)] text-white"
                  }`}
                >
                  {msg.role === "assistant" ? (
                    <div className="prose prose-invert prose-sm max-w-none [&>p]:my-1 [&>ul]:my-1 [&>ol]:my-1">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                  ) : (
                    msg.content
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="bg-[rgba(255,255,255,0.05)] rounded-xl px-3 py-2">
                  <Loader2 size={14} className="animate-spin text-[#00C9A7]" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Slash command menu */}
          {showCommands && filteredCommands.length > 0 && (
            <div className="border-t border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)]">
              {filteredCommands.map((cmd) => (
                <button
                  key={cmd.command}
                  onClick={() => selectCommand(cmd)}
                  className="w-full flex items-center gap-3 px-4 py-2 hover:bg-[rgba(255,255,255,0.05)] transition-colors text-left"
                >
                  <span className="text-xs font-mono text-[#00C9A7]">{cmd.command}</span>
                  <span className="text-xs text-[rgba(255,255,255,0.5)]">{cmd.description}</span>
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-[rgba(255,255,255,0.06)] p-3">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                type="text"
                value={input}
                onChange={(e) => handleInputChange(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") sendMessage(); }}
                placeholder="Message BrainHeart..."
                className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.25)] outline-none focus:border-[rgba(0,201,167,0.3)]"
              />
              <button
                onClick={sendMessage}
                disabled={loading || !input.trim()}
                className="w-8 h-8 rounded-lg bg-[#00C9A7] text-black flex items-center justify-center disabled:opacity-30 hover:bg-[#00b396] transition-colors"
              >
                <Send size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
