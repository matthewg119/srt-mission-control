"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Brain, Send, X, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CHAT_MARKDOWN_COMPONENTS } from "./chat-markdown";

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

// ── Where the widget sits ─────────────────────────────────────────────
//
// The button and the panel are two mutually-exclusive elements that both used to
// hardcode `bottom-6 right-6`. They now share one stored point, the widget's
// TOP-LEFT, and clamp against their own measured size — 48x48 and 400x500 are
// different enough that a shared constant would push one of them off screen.
//
// `null` means never moved, which is also the only safe first render: localStorage
// cannot be read during SSR, so the default corner classes paint first and the
// saved point is applied after mount. Reading it into initial state instead would
// hydrate one position and re-render into another.

const POS_KEY = "srt:brainheart:pos:v1";
const EDGE = 8;
/** Below this, a pointer gesture is a click, not a drag. */
const DRAG_THRESHOLD = 4;

interface Pos {
  x: number;
  y: number;
}

function loadPos(): Pos | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(POS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const { x, y } = parsed as Record<string, unknown>;
    if (typeof x !== "number" || typeof y !== "number") return null;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return { x, y };
  } catch {
    // Safari private mode throws on any localStorage access. A remembered
    // position is a nicety, not a feature.
    return null;
  }
}

function savePos(pos: Pos) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(pos));
  } catch {
    /* private mode, quota, or a blocked origin */
  }
}

/** Keep the whole element on screen, measured rather than assumed. */
function clamp(pos: Pos, el: HTMLElement | null): Pos {
  if (typeof window === "undefined") return pos;
  const w = el?.offsetWidth ?? 48;
  const h = el?.offsetHeight ?? 48;
  const maxX = Math.max(EDGE, window.innerWidth - w - EDGE);
  const maxY = Math.max(EDGE, window.innerHeight - h - EDGE);
  return {
    x: Math.min(Math.max(EDGE, pos.x), maxX),
    y: Math.min(Math.max(EDGE, pos.y), maxY),
  };
}

const SLASH_COMMANDS: SlashCommand[] = [
  { command: "/task", label: "Create Task", description: "Create a new task", prompt: "Create a task: " },
  { command: "/status", label: "Status", description: "Pipeline overview", prompt: "Give me a quick pipeline status overview" },
  { command: "/prep", label: "Call Prep", description: "Prep for a call", prompt: "Generate call prep for " },
  { command: "/calls", label: "Call list", description: "Who to call today", prompt: "Who do we need to call today?" },
  { command: "/stage", label: "Move Lead", description: "Change a lead's stage", prompt: "Set the stage for " },
  { command: "/note", label: "Add Note", description: "Log a note on a lead", prompt: "Add a note to " },
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

  // ── Drag ────────────────────────────────────────────────────────────
  const [pos, setPos] = useState<Pos | null>(null);
  // Whichever of the two elements is currently rendered, for measuring.
  const nodeRef = useRef<HTMLElement | null>(null);
  // True between passing the threshold and the click that follows pointerup, so
  // releasing a drag on the button does not also open the chat.
  const draggedRef = useRef(false);

  useEffect(() => {
    setPos(loadPos());
  }, []);

  // Re-clamp when the element changes size (opening the panel swaps 48x48 for
  // 400x500) and when the window does. Returns the same object when nothing
  // moved so this cannot feed itself.
  useEffect(() => {
    function fit() {
      setPos((p) => {
        if (!p) return p;
        const next = clamp(p, nodeRef.current);
        return next.x === p.x && next.y === p.y ? p : next;
      });
    }
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [isOpen]);

  const startDrag = useCallback((e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const el = nodeRef.current;
    if (!el) return;

    const handle = e.currentTarget as HTMLElement;
    const rect = el.getBoundingClientRect();
    const startX = e.clientX;
    const startY = e.clientY;
    draggedRef.current = false;
    let latest: Pos | null = null;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!draggedRef.current && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      draggedRef.current = true;
      latest = clamp({ x: rect.left + dx, y: rect.top + dy }, el);
      setPos(latest);
    };

    const up = (ev: PointerEvent) => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      try {
        handle.releasePointerCapture(ev.pointerId);
      } catch {
        /* capture was never taken */
      }
      if (latest) savePos(latest);
      // The click event fires before this macrotask, so the flag is still set
      // when onClick checks it and cleared before the next gesture.
      setTimeout(() => {
        draggedRef.current = false;
      }, 0);
    };

    handle.setPointerCapture(e.pointerId);
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }, []);

  // `pos` set = absolute placement; null = the original bottom-right corner.
  const placement = pos
    ? { className: "fixed z-50", style: { left: pos.x, top: pos.y } }
    : { className: "fixed bottom-6 right-6 z-50", style: undefined };

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
          ref={(el) => {
            nodeRef.current = el;
          }}
          onPointerDown={startDrag}
          onClick={() => {
            // A drag that ends on the button is not a click on it.
            if (draggedRef.current) return;
            setIsOpen(true);
          }}
          title="Drag to move"
          style={{ ...placement.style, touchAction: "none" }}
          className={`${placement.className} w-12 h-12 rounded-full bg-[#00C9A7] text-black flex items-center justify-center shadow-lg hover:bg-[#00b396] transition-colors cursor-grab active:cursor-grabbing`}
        >
          <Brain size={20} />
          {hasUnread && (
            <div className="absolute -top-1 -right-1 w-3 h-3 bg-[#E74C3C] rounded-full" />
          )}
        </button>
      )}

      {/* Chat window */}
      {isOpen && (
        <div
          ref={(el) => {
            nodeRef.current = el;
          }}
          style={placement.style}
          className={`${placement.className} w-[400px] h-[500px] bg-[#0a0a0a] border border-[rgba(255,255,255,0.1)] rounded-2xl shadow-2xl flex flex-col overflow-hidden`}
        >
          {/* Header — also the drag handle for the open panel. */}
          <div
            onPointerDown={(e) => {
              // Let the close button be a button.
              if ((e.target as HTMLElement).closest("button")) return;
              startDrag(e);
            }}
            style={{ touchAction: "none" }}
            className="flex items-center justify-between px-4 py-3 border-b border-[rgba(255,255,255,0.06)] cursor-grab active:cursor-grabbing"
          >
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
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={CHAT_MARKDOWN_COMPONENTS}
                      >
                        {msg.content}
                      </ReactMarkdown>
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
