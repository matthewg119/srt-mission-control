"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw, Send, ChevronLeft, Paperclip } from "lucide-react";

interface MailMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  isRead: boolean;
  hasAttachments: boolean;
  receivedDateTime: string;
  from: {
    emailAddress: {
      name: string;
      address: string;
    };
  };
}

interface FullMessage extends MailMessage {
  body: {
    contentType: string;
    content: string;
  };
}

export default function MailPage() {
  const [messages, setMessages] = useState<MailMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMessage, setSelectedMessage] = useState<FullMessage | null>(null);
  const [loadingMessage, setLoadingMessage] = useState(false);

  // Compose state
  const [showCompose, setShowCompose] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [sending, setSending] = useState(false);

  // Reply state
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);

  const fetchInbox = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations/microsoft/mail?top=30");
      const data = await res.json();
      if (data.error) {
        setError(data.error);
        return;
      }
      setMessages((data.value as MailMessage[]) || []);
      setUnreadCount(data.unreadCount || 0);
    } catch {
      setError("Failed to load inbox. Is Outlook connected?");
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  const openMessage = async (msg: MailMessage) => {
    setLoadingMessage(true);
    setReplyText("");
    try {
      const res = await fetch(`/api/integrations/microsoft/mail?id=${msg.id}`);
      const data = await res.json();
      setSelectedMessage(data as FullMessage);
      // Mark as read
      if (!msg.isRead) {
        fetch("/api/integrations/microsoft/mail", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "markRead", messageId: msg.id }),
        });
        setMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, isRead: true } : m));
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      setError("Failed to load message");
    }
    setLoadingMessage(false);
  };

  const handleSend = async () => {
    if (!composeTo || !composeSubject || !composeBody) return;
    setSending(true);
    try {
      await fetch("/api/integrations/microsoft/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: composeTo, subject: composeSubject, message: composeBody }),
      });
      setShowCompose(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      fetchInbox();
    } catch {
      setError("Failed to send email");
    }
    setSending(false);
  };

  const handleReply = async () => {
    if (!replyText || !selectedMessage) return;
    setReplying(true);
    try {
      await fetch("/api/integrations/microsoft/mail", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reply", messageId: selectedMessage.id, message: replyText }),
      });
      setReplyText("");
      fetchInbox();
    } catch {
      setError("Failed to send reply");
    }
    setReplying(false);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    if (isToday) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  // Error state — likely not connected
  if (error && !loading && messages.length === 0) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white mb-2">Outlook</h1>
        <div className="bg-[rgba(231,76,60,0.1)] border border-[rgba(231,76,60,0.2)] rounded-xl p-6 text-center">
          <p className="text-[#E74C3C] mb-3">{error}</p>
          <a
            href="/dashboard/integrations"
            className="text-xs px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 inline-block"
          >
            Go to Integrations
          </a>
        </div>
      </div>
    );
  }

  // Message detail view
  if (selectedMessage) {
    return (
      <div>
        <button
          onClick={() => setSelectedMessage(null)}
          className="flex items-center gap-1 text-sm text-[rgba(255,255,255,0.5)] hover:text-white mb-4 transition-colors"
        >
          <ChevronLeft className="h-4 w-4" /> Back to inbox
        </button>

        {loadingMessage ? (
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-6 animate-pulse h-64" />
        ) : (
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl">
            <div className="p-5 border-b border-[rgba(255,255,255,0.06)]">
              <h2 className="text-lg font-semibold text-white mb-2">{selectedMessage.subject || "(No subject)"}</h2>
              <div className="flex items-center gap-2 text-sm">
                <span className="text-white">{selectedMessage.from?.emailAddress?.name}</span>
                <span className="text-[rgba(255,255,255,0.3)]">&lt;{selectedMessage.from?.emailAddress?.address}&gt;</span>
                <span className="ml-auto text-xs text-[rgba(255,255,255,0.4)]">{formatDate(selectedMessage.receivedDateTime)}</span>
              </div>
            </div>

            <div
              className="p-5 text-sm text-[rgba(255,255,255,0.8)] leading-relaxed overflow-auto max-h-[500px] [&_a]:text-[#00C9A7] [&_a]:underline"
              dangerouslySetInnerHTML={{
                __html: selectedMessage.body?.contentType === "html"
                  ? selectedMessage.body.content
                  : `<pre style="white-space:pre-wrap;font-family:inherit">${selectedMessage.body?.content || ""}</pre>`,
              }}
            />

            {/* Reply */}
            <div className="p-5 border-t border-[rgba(255,255,255,0.06)]">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder="Write a reply..."
                rows={3}
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
              />
              <button
                onClick={handleReply}
                disabled={!replyText || replying}
                className="mt-2 text-xs px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 disabled:opacity-50 flex items-center gap-1"
              >
                <Send className="h-3 w-3" />
                {replying ? "Sending..." : "Reply"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Outlook</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            {unreadCount > 0 ? `${unreadCount} unread` : "All caught up"}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchInbox}
            disabled={loading}
            className="text-xs px-3 py-1.5 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)] transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </button>
          <button
            onClick={() => setShowCompose(true)}
            className="text-xs px-3 py-1.5 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 flex items-center gap-1"
          >
            <Send className="h-3 w-3" />
            Compose
          </button>
        </div>
      </div>

      {/* Compose modal */}
      {showCompose && (
        <div className="mb-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5">
          <h3 className="text-sm font-semibold text-white mb-3">New Email</h3>
          <div className="space-y-3">
            <input
              type="email"
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              placeholder="To"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
            />
            <input
              type="text"
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              placeholder="Subject"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
            />
            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="Message"
              rows={5}
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-md px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={handleSend}
                disabled={sending || !composeTo || !composeSubject || !composeBody}
                className="text-xs px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-md font-medium hover:opacity-90 disabled:opacity-50"
              >
                {sending ? "Sending..." : "Send"}
              </button>
              <button
                onClick={() => setShowCompose(false)}
                className="text-xs px-4 py-2 bg-[rgba(255,255,255,0.08)] text-white rounded-md hover:bg-[rgba(255,255,255,0.12)]"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mb-4 bg-[rgba(231,76,60,0.1)] border border-[rgba(231,76,60,0.2)] rounded-xl p-3">
          <p className="text-xs text-[#E74C3C]">{error}</p>
        </div>
      )}

      {/* Message list */}
      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 animate-pulse h-20" />
          ))}
        </div>
      ) : messages.length === 0 ? (
        <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-8 text-center">
          <p className="text-[rgba(255,255,255,0.5)]">Inbox empty</p>
        </div>
      ) : (
        <div className="space-y-1">
          {messages.map((msg) => (
            <button
              key={msg.id}
              onClick={() => openMessage(msg)}
              className={`w-full text-left bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-4 py-3 hover:bg-[rgba(255,255,255,0.06)] transition-colors ${!msg.isRead ? "border-l-2 border-l-[#00C9A7]" : ""}`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className={`text-sm truncate ${!msg.isRead ? "font-semibold text-white" : "text-[rgba(255,255,255,0.7)]"}`}>
                  {msg.from?.emailAddress?.name || msg.from?.emailAddress?.address || "Unknown"}
                </span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  {msg.hasAttachments && <Paperclip className="h-3 w-3 text-[rgba(255,255,255,0.3)]" />}
                  <span className="text-xs text-[rgba(255,255,255,0.4)]">{formatDate(msg.receivedDateTime)}</span>
                </div>
              </div>
              <p className={`text-xs truncate ${!msg.isRead ? "text-[rgba(255,255,255,0.7)]" : "text-[rgba(255,255,255,0.4)]"}`}>
                {msg.subject || "(No subject)"}
              </p>
              <p className="text-xs text-[rgba(255,255,255,0.3)] truncate mt-0.5">
                {msg.bodyPreview}
              </p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
