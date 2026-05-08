"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Search, MessageSquare, RefreshCw } from "lucide-react";

interface ConvSummary {
  id: string;
  phone: string;
  display_name: string;
  first_name: string | null;
  last_name: string | null;
  business_name: string | null;
  close_stage: number;
  has_reply: boolean;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  last_message: {
    body: string;
    direction: string;
    created_at: string;
  } | null;
}

type Filter = "all" | "replied" | "noreply";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return p;
}

const lastActivity = (c: ConvSummary): string | null =>
  c.last_inbound_at ?? c.last_outbound_at ?? null;

export default function ConversationsPage() {
  const router = useRouter();
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  const fetchConversations = async (f: Filter) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sms/conversations?filter=${f}`);
      const data = await res.json() as { conversations: ConvSummary[] };
      setConversations(data.conversations ?? []);
    } catch {
      setConversations([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchConversations(filter); }, [filter]);

  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const needle = search.toLowerCase();
    return conversations.filter((c) =>
      `${c.display_name} ${c.phone}`.toLowerCase().includes(needle)
    );
  }, [conversations, search]);

  const tabs: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "replied", label: "Replied" },
    { key: "noreply", label: "No Reply" },
  ];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Conversations</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            All iMessage threads — click to view history and post drafts
          </p>
        </div>
        <button
          onClick={() => fetchConversations(filter)}
          className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white text-sm transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Filters + search */}
      <div className="flex items-center gap-3">
        <div className="flex bg-[rgba(255,255,255,0.04)] rounded-lg p-1 gap-1">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                filter === t.key
                  ? "bg-[rgba(255,255,255,0.1)] text-white"
                  : "text-[rgba(255,255,255,0.4)] hover:text-white"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
          <input
            type="text"
            placeholder="Search by name or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg pl-9 pr-4 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[rgba(255,255,255,0.2)]"
          />
        </div>
      </div>

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center h-48">
          <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading…</div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2">
          <MessageSquare size={32} className="text-[rgba(255,255,255,0.1)]" />
          <div className="text-[rgba(255,255,255,0.3)] text-sm">No conversations found</div>
        </div>
      ) : (
        <div className="flex flex-col divide-y divide-[rgba(255,255,255,0.05)]">
          {filtered.map((c) => {
            const activity = lastActivity(c);
            return (
              <button
                key={c.id}
                onClick={() => router.push(`/dashboard/conversations/${c.id}`)}
                className="flex items-center gap-4 py-4 px-2 hover:bg-[rgba(255,255,255,0.03)] transition-colors text-left rounded-lg"
              >
                {/* Avatar */}
                <div className="w-10 h-10 rounded-full bg-[#00B4B4]/20 flex items-center justify-center flex-shrink-0">
                  <span className="text-[#00B4B4] text-sm font-bold">
                    {initials(c.display_name)}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-white text-sm font-medium truncate">{c.display_name}</span>
                    {c.has_reply && (
                      <span className="flex-shrink-0 text-xs bg-emerald-400/10 text-emerald-400 px-1.5 py-0.5 rounded-full">
                        Reply
                      </span>
                    )}
                  </div>
                  <div className="text-[rgba(255,255,255,0.4)] text-xs">{formatPhone(c.phone)}</div>
                  {c.last_message && (
                    <p className={`text-xs mt-0.5 truncate ${c.last_message.direction === "inbound" ? "text-[rgba(255,255,255,0.6)]" : "text-[rgba(255,255,255,0.4)] italic"}`}>
                      {c.last_message.direction === "outbound" ? "You: " : ""}
                      {c.last_message.body}
                    </p>
                  )}
                </div>

                {/* Time */}
                {activity && (
                  <div className="text-[rgba(255,255,255,0.3)] text-xs flex-shrink-0">
                    {timeAgo(activity)}
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
