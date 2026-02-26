"use client";

import { useState, useEffect, useRef } from "react";
import { Send, Search, MessageSquare, Mail, RefreshCw, ChevronLeft } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";

interface Conversation {
  id: string;
  contactId: string;
  contactName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  lastMessageBody?: string;
  lastMessageDate?: string;
  lastMessageType?: string;
  unreadCount?: number;
  type?: string;
}

interface Message {
  id: string;
  body?: string;
  message?: string;
  type: number; // 1 = SMS, 2 = Email, etc.
  direction: string; // "inbound" | "outbound"
  status?: string;
  dateAdded: string;
  contactId?: string;
  messageType?: string;
  subject?: string;
}

export default function MessagingPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedConvo, setSelectedConvo] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loadingConvos, setLoadingConvos] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [messageType, setMessageType] = useState<"SMS" | "Email">("SMS");
  const [emailSubject, setEmailSubject] = useState("");
  const [sending, setSending] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchConversations();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const fetchConversations = async () => {
    try {
      const res = await fetch("/api/ghl/messages");
      const data = await res.json();
      setConversations(data.conversations || []);
    } catch {
      setConversations([]);
    }
    setLoadingConvos(false);
  };

  const fetchMessages = async (convo: Conversation) => {
    setSelectedConvo(convo);
    setLoadingMessages(true);
    try {
      const res = await fetch(
        `/api/ghl/messages?action=messages&conversationId=${convo.id}`
      );
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    }
    setLoadingMessages(false);
  };

  const handleSend = async () => {
    if (!newMessage.trim() || !selectedConvo) return;
    setSending(true);
    try {
      const res = await fetch("/api/ghl/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: selectedConvo.contactId,
          type: messageType,
          message: newMessage,
          subject: messageType === "Email" ? emailSubject : undefined,
        }),
      });
      if (res.ok) {
        setNewMessage("");
        setEmailSubject("");
        // Refresh messages
        fetchMessages(selectedConvo);
      }
    } catch {
      // Error
    }
    setSending(false);
  };

  const filteredConvos = conversations.filter((c) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const name = (c.fullName || c.contactName || "").toLowerCase();
    const phone = (c.phone || "").toLowerCase();
    const email = (c.email || "").toLowerCase();
    return name.includes(q) || phone.includes(q) || email.includes(q);
  });

  return (
    <div className="flex flex-col h-[calc(100vh-120px)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Messaging</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            Send SMS & Email directly from Mission Control
          </p>
        </div>
        <button
          onClick={fetchConversations}
          className="flex items-center gap-2 px-3 py-2 bg-[rgba(255,255,255,0.08)] text-white rounded-lg text-sm hover:bg-[rgba(255,255,255,0.12)] transition-colors"
        >
          <RefreshCw size={14} />
          Refresh
        </button>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0 border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden">
        {/* Conversation List */}
        <div className={`w-[320px] flex-shrink-0 border-r border-[rgba(255,255,255,0.06)] flex flex-col bg-[rgba(255,255,255,0.01)] ${
          selectedConvo ? "hidden md:flex" : "flex"
        }`}>
          {/* Search */}
          <div className="p-3 border-b border-[rgba(255,255,255,0.06)]">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[rgba(255,255,255,0.3)]" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search conversations..."
                className="w-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg pl-9 pr-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
              />
            </div>
          </div>

          {/* Conversation Items */}
          <div className="flex-1 overflow-y-auto">
            {loadingConvos ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="animate-pulse h-14 bg-[rgba(255,255,255,0.03)] rounded-lg" />
                ))}
              </div>
            ) : filteredConvos.length === 0 ? (
              <div className="text-center py-12 text-[rgba(255,255,255,0.3)] text-sm">
                {conversations.length === 0
                  ? "No conversations yet"
                  : "No matching conversations"}
              </div>
            ) : (
              filteredConvos.map((convo) => (
                <button
                  key={convo.id}
                  onClick={() => fetchMessages(convo)}
                  className={`w-full text-left px-4 py-3 border-b border-[rgba(255,255,255,0.04)] hover:bg-[rgba(255,255,255,0.03)] transition-colors ${
                    selectedConvo?.id === convo.id ? "bg-[rgba(255,255,255,0.05)]" : ""
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-semibold text-white truncate">
                      {convo.fullName || convo.contactName || convo.phone || "Unknown"}
                    </span>
                    {convo.lastMessageDate && (
                      <span className="text-[10px] text-[rgba(255,255,255,0.3)] whitespace-nowrap ml-2">
                        {formatRelativeTime(convo.lastMessageDate)}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {convo.lastMessageType === "SMS" && <MessageSquare size={10} className="text-[rgba(255,255,255,0.3)]" />}
                    {convo.lastMessageType === "Email" && <Mail size={10} className="text-[rgba(255,255,255,0.3)]" />}
                    <p className="text-xs text-[rgba(255,255,255,0.4)] truncate">
                      {convo.lastMessageBody || "No messages"}
                    </p>
                  </div>
                  {convo.unreadCount && convo.unreadCount > 0 && (
                    <span className="inline-block mt-1 text-[10px] px-1.5 py-0.5 bg-[#00C9A7] text-[#0B1426] rounded-full font-bold">
                      {convo.unreadCount}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Message Thread */}
        <div className={`flex-1 flex flex-col ${!selectedConvo ? "hidden md:flex" : "flex"}`}>
          {selectedConvo ? (
            <>
              {/* Thread Header */}
              <div className="px-4 py-3 border-b border-[rgba(255,255,255,0.06)] flex items-center gap-3">
                <button
                  onClick={() => setSelectedConvo(null)}
                  className="md:hidden text-[rgba(255,255,255,0.5)] hover:text-white"
                >
                  <ChevronLeft size={20} />
                </button>
                <div>
                  <p className="text-sm font-semibold text-white">
                    {selectedConvo.fullName || selectedConvo.contactName || "Unknown"}
                  </p>
                  <p className="text-xs text-[rgba(255,255,255,0.4)]">
                    {selectedConvo.phone || selectedConvo.email || ""}
                  </p>
                </div>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {loadingMessages ? (
                  <div className="text-center py-8 text-[rgba(255,255,255,0.3)] text-sm">
                    Loading messages...
                  </div>
                ) : messages.length === 0 ? (
                  <div className="text-center py-8 text-[rgba(255,255,255,0.3)] text-sm">
                    No messages in this conversation
                  </div>
                ) : (
                  messages.map((msg) => {
                    const isOutbound = msg.direction === "outbound";
                    return (
                      <div
                        key={msg.id}
                        className={`flex ${isOutbound ? "justify-end" : "justify-start"}`}
                      >
                        <div
                          className={`max-w-[70%] rounded-xl px-4 py-2 ${
                            isOutbound
                              ? "bg-[#00C9A7] text-[#0B1426]"
                              : "bg-[rgba(255,255,255,0.05)] text-white"
                          }`}
                        >
                          {msg.subject && (
                            <p className={`text-xs font-semibold mb-1 ${isOutbound ? "text-[#0B1426]/70" : "text-[rgba(255,255,255,0.6)]"}`}>
                              {msg.subject}
                            </p>
                          )}
                          <p className="text-sm whitespace-pre-wrap">
                            {msg.body || msg.message || ""}
                          </p>
                          <p className={`text-[10px] mt-1 ${isOutbound ? "text-[#0B1426]/50" : "text-[rgba(255,255,255,0.3)]"}`}>
                            {formatRelativeTime(msg.dateAdded)}
                            {msg.messageType && ` · ${msg.messageType}`}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Compose */}
              <div className="p-4 border-t border-[rgba(255,255,255,0.06)]">
                {/* Type selector */}
                <div className="flex gap-1 mb-2">
                  <button
                    onClick={() => setMessageType("SMS")}
                    className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      messageType === "SMS"
                        ? "bg-[#00C9A7]/10 text-[#00C9A7]"
                        : "text-[rgba(255,255,255,0.4)] hover:text-white"
                    }`}
                  >
                    <MessageSquare size={12} /> SMS
                  </button>
                  <button
                    onClick={() => setMessageType("Email")}
                    className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                      messageType === "Email"
                        ? "bg-[#1B65A7]/10 text-[#1B65A7]"
                        : "text-[rgba(255,255,255,0.4)] hover:text-white"
                    }`}
                  >
                    <Mail size={12} /> Email
                  </button>
                </div>

                {messageType === "Email" && (
                  <input
                    type="text"
                    value={emailSubject}
                    onChange={(e) => setEmailSubject(e.target.value)}
                    placeholder="Subject..."
                    className="w-full bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] mb-2"
                  />
                )}

                <div className="flex gap-2">
                  <textarea
                    value={newMessage}
                    onChange={(e) => setNewMessage(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        handleSend();
                      }
                    }}
                    rows={2}
                    placeholder={`Type a ${messageType} message...`}
                    className="flex-1 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7] resize-none"
                  />
                  <button
                    onClick={handleSend}
                    disabled={!newMessage.trim() || sending}
                    className="self-end px-4 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-[rgba(255,255,255,0.3)]">
              <div className="text-center">
                <MessageSquare size={40} className="mx-auto mb-3 text-[rgba(255,255,255,0.15)]" />
                <p className="text-sm">Select a conversation to view messages</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
