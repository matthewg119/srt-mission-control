"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Lightbulb,
  Send,
  Upload,
  FileAudio,
  X,
  Loader2,
  Phone,
  Sparkles,
} from "lucide-react";
import {
  generateDailyCalls,
  generateLeadMagnetIdeas,
} from "@/config/mock-calls";
import type { MockCall, LeadMagnetIdea } from "@/config/mock-calls";

const TYPE_COLORS: Record<string, string> = {
  ebook: "#1B65A7",
  checklist: "#00C9A7",
  calculator: "#F5A623",
  webinar: "#9B59B6",
  template: "#E67E22",
  guide: "#2ECC71",
  video: "#E74C3C",
  infographic: "#3498DB",
};

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function LeadMagnetsPage() {
  const [callHighlights, setCallHighlights] = useState<MockCall[]>([]);
  const [ideas, setIdeas] = useState<LeadMagnetIdea[]>([]);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        'Welcome to the Lead Magnet Generator! I can help you create lead magnet ideas based on industry pain points. Try:\n\n- "20 lead magnet ideas for a hair salon"\n- "ideas for trucking companies struggling with cash flow"\n- "create a checklist for restaurant owners"',
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setCallHighlights(generateDailyCalls(5));
    setIdeas(generateLeadMagnetIdeas(6));
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleChat = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!chatInput.trim() || chatLoading) return;
      const userMsg = chatInput.trim();
      setChatInput("");
      setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
      setChatLoading(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [
              {
                role: "system",
                content:
                  "You are a lead magnet idea generator for SRT Agency, an MCA/business funding company. Generate creative, actionable lead magnet ideas (ebooks, checklists, calculators, webinars, templates, guides, videos, infographics) based on business pain points. Format each idea with a title, description, type, and target industry. Be specific and practical.",
              },
              ...chatMessages.map((m) => ({
                role: m.role,
                content: m.content,
              })),
              { role: "user", content: userMsg },
            ],
          }),
        });

        if (res.ok) {
          const data = await res.json();
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                data.response ||
                data.message ||
                "I couldn't generate ideas. Please try again.",
            },
          ]);
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "AI is not configured yet. Connect your API key in Settings > AI Configuration to enable live generation. Here are some pre-generated ideas in the sidebar!",
            },
          ]);
        }
      } catch {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content:
              "Connection error. Make sure the AI endpoint is configured.",
          },
        ]);
      }
      setChatLoading(false);
    },
    [chatInput, chatLoading, chatMessages]
  );

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const audioFiles = files.filter(
      (f) =>
        f.type.startsWith("audio/") ||
        f.name.match(/\.(mp3|wav|m4a|ogg|webm)$/i)
    );
    if (audioFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...audioFiles.map((f) => f.name)]);
    }
  }, []);

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-120px)]">
      {/* ─── LEFT: Chat + Upload ─── */}
      <div className="flex flex-col w-full lg:w-[420px] bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden shrink-0">
        {/* Header */}
        <div className="flex items-center gap-3 p-4 border-b border-[rgba(255,255,255,0.06)]">
          <Lightbulb className="h-5 w-5 text-[#F5A623]" />
          <div>
            <h2 className="text-sm font-semibold text-white">
              Lead Magnet Generator
            </h2>
            <p className="text-[10px] text-[rgba(255,255,255,0.35)]">
              AI-powered ideas from call insights
            </p>
          </div>
        </div>

        {/* Drop zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`mx-3 mt-3 flex items-center gap-2 px-3 py-2.5 rounded-lg border border-dashed cursor-pointer transition-all ${
            dragOver
              ? "border-[#00C9A7] bg-[rgba(0,201,167,0.08)]"
              : "border-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)]"
          }`}
        >
          <Upload className="h-3.5 w-3.5 text-[rgba(255,255,255,0.3)] shrink-0" />
          <span className="text-xs text-[rgba(255,255,255,0.35)]">
            Drop call recordings to analyze
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a"
            multiple
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              setUploadedFiles((prev) => [
                ...prev,
                ...files.map((f) => f.name),
              ]);
            }}
            className="hidden"
          />
        </div>

        {uploadedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 mt-2">
            {uploadedFiles.map((name) => (
              <div
                key={name}
                className="flex items-center gap-1.5 px-2 py-1 bg-[rgba(0,201,167,0.08)] border border-[rgba(0,201,167,0.15)] rounded-md"
              >
                <FileAudio className="h-3 w-3 text-[#00C9A7]" />
                <span className="text-[10px] text-[#00C9A7]">{name}</span>
                <button
                  onClick={() =>
                    setUploadedFiles((prev) => prev.filter((f) => f !== name))
                  }
                  className="text-[rgba(255,255,255,0.3)] hover:text-white"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 mt-1">
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-[#1B65A7] text-white"
                    : "bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.7)]"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {chatLoading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 bg-[rgba(255,255,255,0.05)] rounded-xl">
                <Loader2 className="h-4 w-4 text-[#F5A623] animate-spin" />
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Chat input */}
        <form
          onSubmit={handleChat}
          className="p-3 border-t border-[rgba(255,255,255,0.06)]"
        >
          <div className="flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              placeholder="Ask for lead magnet ideas..."
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#F5A623]"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-[#F5A623] text-[#0B1426] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>

      {/* ─── RIGHT: Highlights + Ideas ─── */}
      <div className="flex-1 overflow-y-auto space-y-6">
        {/* Call Highlights */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Phone className="h-4 w-4 text-[#1B65A7]" />
            <h3 className="text-sm font-semibold text-white">
              Recent Call Highlights
            </h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
            {callHighlights.slice(0, 4).map((call) => (
              <div
                key={call.id}
                className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-medium text-white">
                    {call.contactName}
                  </span>
                  <span className="text-[10px] text-[rgba(255,255,255,0.3)]">
                    {call.industry}
                  </span>
                </div>
                <p className="text-[11px] text-[rgba(255,255,255,0.4)] mb-2 line-clamp-2">
                  {call.fundingPurpose}
                </p>
                <div className="flex flex-wrap gap-1">
                  {call.painPoints.map((p) => (
                    <span
                      key={p}
                      className="text-[9px] px-1.5 py-0.5 bg-[rgba(255,255,255,0.04)] rounded text-[rgba(255,255,255,0.35)]"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Generated Ideas */}
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Sparkles className="h-4 w-4 text-[#F5A623]" />
            <h3 className="text-sm font-semibold text-white">
              Generated Ideas
            </h3>
            <span className="text-[10px] text-[rgba(255,255,255,0.25)]">
              from recent call patterns
            </span>
          </div>
          <div className="space-y-2">
            {ideas.map((idea) => {
              const color = TYPE_COLORS[idea.type] || "#1B65A7";
              return (
                <div
                  key={idea.id}
                  className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.1)] transition-colors"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <h4 className="text-sm font-semibold text-white">
                      {idea.title}
                    </h4>
                    <span
                      className="text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0"
                      style={{
                        backgroundColor: `${color}18`,
                        color,
                      }}
                    >
                      {idea.type}
                    </span>
                  </div>
                  <p className="text-xs text-[rgba(255,255,255,0.5)] mb-2">
                    {idea.description}
                  </p>
                  <div className="flex items-center gap-2 text-[10px] text-[rgba(255,255,255,0.3)]">
                    <span>{idea.industry}</span>
                    <span>&bull;</span>
                    <span>{idea.painPoint}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
