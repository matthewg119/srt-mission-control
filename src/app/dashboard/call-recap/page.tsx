"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload,
  Mic,
  MicOff,
  Search,
  Phone,
  TrendingUp,
  Lightbulb,
  BarChart3,
  Clock,
  ChevronRight,
  FileAudio,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  generateMusaPosts,
  generateCallHistory,
  generateLeadMagnetIdeas,
} from "@/config/mock-calls";
import type { MusaPost } from "@/config/mock-calls";

const CATEGORY_ICONS: Record<string, typeof Phone> = {
  call_highlight: Phone,
  lead_magnet: Lightbulb,
  daily_recap: BarChart3,
  insight: TrendingUp,
};

const CATEGORY_COLORS: Record<string, string> = {
  call_highlight: "#1B65A7",
  lead_magnet: "#F5A623",
  daily_recap: "#00C9A7",
  insight: "#9B59B6",
};

function formatPostTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

export default function CallRecapPage() {
  const [posts, setPosts] = useState<MusaPost[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<"feed" | "log" | "daily">("feed");
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setPosts(generateMusaPosts(12));
  }, []);

  const filteredPosts = searchQuery.trim()
    ? posts.filter(
        (p) =>
          p.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (p.source && p.source.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : posts;

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const audioFiles = files.filter(
      (f) => f.type.startsWith("audio/") || f.name.match(/\.(mp3|wav|m4a|ogg|webm)$/i)
    );
    if (audioFiles.length > 0) {
      setUploadedFiles((prev) => [...prev, ...audioFiles.map((f) => f.name)]);
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      setUploadedFiles((prev) => [...prev, ...files.map((f) => f.name)]);
    }
  }, []);

  const toggleRecording = useCallback(() => {
    setIsRecording((prev) => !prev);
  }, []);

  const removeFile = useCallback((name: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f !== name));
  }, []);

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[rgba(27,101,167,0.15)]">
            <Phone className="h-5 w-5 text-[#1B65A7]" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">AI Call Recap</h1>
            <p className="text-sm text-[rgba(255,255,255,0.4)]">
              Insights from Musa AI
            </p>
          </div>
        </div>

        {/* Mic Button */}
        <button
          onClick={toggleRecording}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-all ${
            isRecording
              ? "bg-[rgba(231,76,60,0.15)] border border-[rgba(231,76,60,0.3)] text-[#E74C3C] animate-pulse"
              : "bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-white hover:bg-[rgba(255,255,255,0.08)]"
          }`}
        >
          {isRecording ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          {isRecording ? "Stop Recording" : "Record Call"}
        </button>
      </div>

      {/* Top Bar: Drop Zone + Search */}
      <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-3 mb-4">
        {/* Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`flex items-center gap-3 px-4 py-3 rounded-xl border border-dashed cursor-pointer transition-all ${
            dragOver
              ? "border-[#00C9A7] bg-[rgba(0,201,167,0.08)]"
              : "border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] hover:border-[rgba(255,255,255,0.2)]"
          }`}
        >
          <Upload className="h-4 w-4 text-[rgba(255,255,255,0.4)] shrink-0" />
          <span className="text-sm text-[rgba(255,255,255,0.4)]">
            Drop call recordings here to analyze
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm"
            multiple
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* CRM Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[rgba(255,255,255,0.3)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search merchant or business..."
            className="w-full md:w-64 pl-9 pr-3 py-3 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
          />
        </div>
      </div>

      {/* Uploaded files */}
      {uploadedFiles.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-4">
          {uploadedFiles.map((name) => (
            <div
              key={name}
              className="flex items-center gap-2 px-3 py-1.5 bg-[rgba(0,201,167,0.1)] border border-[rgba(0,201,167,0.2)] rounded-lg"
            >
              <FileAudio className="h-3 w-3 text-[#00C9A7]" />
              <span className="text-xs text-[#00C9A7]">{name}</span>
              <button
                onClick={() => removeFile(name)}
                className="text-[rgba(255,255,255,0.3)] hover:text-white"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
          <button
            onClick={() => setUploadedFiles([])}
            className="text-xs text-[rgba(255,255,255,0.4)] hover:text-white px-2"
          >
            Clear all
          </button>
        </div>
      )}

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-1">
        {[
          { key: "feed" as const, label: "Feed", href: "/dashboard/call-recap" },
          { key: "log" as const, label: "Call Log", href: "/dashboard/call-recap/log" },
          { key: "daily" as const, label: "Daily Recap", href: "/dashboard/call-recap/daily" },
        ].map((tab) => (
          <Link
            key={tab.key}
            href={tab.href}
            className={`flex-1 text-center px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab.key === "feed"
                ? "bg-[rgba(255,255,255,0.08)] text-white"
                : "text-[rgba(255,255,255,0.4)] hover:text-white hover:bg-[rgba(255,255,255,0.04)]"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {/* Musa Feed */}
      <div className="space-y-3">
        {filteredPosts.length === 0 && (
          <div className="text-center py-12 text-[rgba(255,255,255,0.3)] text-sm">
            {searchQuery ? "No results found" : "No posts yet"}
          </div>
        )}

        {filteredPosts.map((post) => {
          const Icon = CATEGORY_ICONS[post.category] || TrendingUp;
          const color = CATEGORY_COLORS[post.category] || "#1B65A7";

          return (
            <div
              key={post.id}
              className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 hover:border-[rgba(255,255,255,0.12)] transition-colors"
            >
              {/* Post header */}
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="flex h-9 w-9 items-center justify-center rounded-full shrink-0"
                  style={{ backgroundColor: `${color}20` }}
                >
                  <Icon className="h-4 w-4" style={{ color }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">
                      Musa AI
                    </span>
                    {post.source && (
                      <span className="text-xs text-[rgba(255,255,255,0.3)]">
                        via {post.source}
                      </span>
                    )}
                    <span className="text-xs text-[rgba(255,255,255,0.25)]">
                      &middot; {formatPostTime(post.timestamp)}
                    </span>
                  </div>
                  <span
                    className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded-full mt-0.5"
                    style={{
                      backgroundColor: `${color}18`,
                      color,
                    }}
                  >
                    {post.category.replace("_", " ")}
                  </span>
                </div>
              </div>

              {/* Post content */}
              <p className="text-sm text-[rgba(255,255,255,0.7)] leading-relaxed whitespace-pre-wrap">
                {post.content}
              </p>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="mt-6 mb-8 text-center text-xs text-[rgba(255,255,255,0.25)]">
        Powered by mock data &mdash; connect a call provider to get real insights
      </div>
    </div>
  );
}
