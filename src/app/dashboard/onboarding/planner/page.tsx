"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Brain,
  Send,
  ClipboardList,
  TrendingUp,
  PhoneCall,
  ChevronDown,
  Loader2,
  Building2,
  DollarSign,
  CheckCircle2,
  AlertTriangle,
  Sparkles,
  BarChart3,
} from "lucide-react";

/* ─── Types ─── */
interface Deal {
  id: string;
  contact_name: string;
  business_name: string;
  stage: string;
  amount: number | null;
  assigned_to: string | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnalysisData {
  overview: {
    businessName: string;
    contactName: string;
    fundingAmount: string;
    stage: string;
    riskLevel: "low" | "medium" | "high";
    riskNote: string;
  };
  checklist: {
    label: string;
    status: "pass" | "warn" | "fail";
    detail: string;
  }[];
  pitchNotes: string[];
  spendingInsights: string[];
  productRecommendations: string[];
}

/* ─── Mock AI analysis (replaced with real Claude API later) ─── */
function generateAIAnalysis(deal: Deal): AnalysisData {
  const amount = deal.amount || 50000;
  const riskLevel = amount > 200000 ? "high" : amount > 75000 ? "medium" : "low";

  return {
    overview: {
      businessName: deal.business_name || "Unknown Business",
      contactName: deal.contact_name || "Unknown",
      fundingAmount: `$${amount.toLocaleString()}`,
      stage: deal.stage,
      riskLevel,
      riskNote:
        riskLevel === "high"
          ? "Large deal — verify financials closely"
          : riskLevel === "medium"
          ? "Moderate size — standard underwriting"
          : "Low amount — quick approval likely",
    },
    checklist: [
      {
        label: "Business Verification",
        status: deal.business_name ? "pass" : "fail",
        detail: deal.business_name
          ? `Verified: ${deal.business_name}`
          : "Business name missing — request before proceeding",
      },
      {
        label: "Funding Amount Reasonableness",
        status: amount > 500000 ? "warn" : "pass",
        detail:
          amount > 500000
            ? `$${amount.toLocaleString()} is unusually high — verify revenue supports this`
            : `$${amount.toLocaleString()} is within typical range`,
      },
      {
        label: "Contact Information",
        status: deal.contact_name ? "pass" : "fail",
        detail: deal.contact_name
          ? `Contact: ${deal.contact_name}`
          : "No contact name on file",
      },
      {
        label: "Pipeline Stage Progression",
        status: deal.stage === "Closed Lost" ? "fail" : "pass",
        detail: `Currently at: ${deal.stage}`,
      },
      {
        label: "Documentation Readiness",
        status: "warn",
        detail: "Ensure 3 months bank statements + voided check are collected",
      },
    ],
    pitchNotes: [
      `"Hey ${deal.contact_name?.split(" ")[0] || "there"}, I reviewed your file and you're looking at ${amount > 100000 ? "a significant funding package" : "a working capital solution"} — let me walk you through what I see."`,
      `Highlight that SRT works as a partner, not just a lender. Mention our in-house underwriting team for faster approvals.`,
      `If they mention cash flow concerns, pivot to our flexible repayment structure and how the daily/weekly pullback is based on their revenue cycle.`,
      `Close: "I want to make sure this works for you. Let me get the docs rolling and I'll have numbers back to you within 24 hours."`,
    ],
    spendingInsights: [
      `Requesting $${amount.toLocaleString()} — compare to average deal size of $75K in this stage`,
      `${deal.stage} deals typically close within 3-5 business days with complete documentation`,
      `Revenue-based funding products perform best for this profile`,
      `Consider offering a smaller initial advance with renewal option to reduce risk`,
    ],
    productRecommendations: [
      amount > 150000 ? "Term Loan (6-18 months)" : "Revenue-Based Advance",
      "Working Capital Line of Credit",
      amount > 100000 ? "SBA Express Loan referral" : "Short-term MCA bridge",
    ],
  };
}

/* ─── Component ─── */
export default function PlannerPage() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [selectedDeal, setSelectedDeal] = useState<Deal | null>(null);
  const [showDealPicker, setShowDealPicker] = useState(false);
  const [analysis, setAnalysis] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "checklist" | "pitch">("overview");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content:
        "Welcome to the AI Finance Business Planner. Select a deal from your pipeline to get started, or ask me anything about funding strategies.",
    },
  ]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/ghl/sync")
      .then(() =>
        fetch("/api/integrations")
          .then((r) => r.json())
          .catch(() => ({ integrations: [] }))
      )
      .catch(() => {});

    // Load deals from pipeline_cache via a lightweight endpoint
    async function loadDeals() {
      try {
        const res = await fetch("/api/pipeline/deals");
        if (res.ok) {
          const data = await res.json();
          setDeals(data.deals || []);
        }
      } catch {
        // Silently fail — deals will be empty
      }
    }
    loadDeals();
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  const handleSelectDeal = useCallback((deal: Deal) => {
    setSelectedDeal(deal);
    setShowDealPicker(false);
    setLoading(true);
    // Simulate AI processing
    setTimeout(() => {
      const result = generateAIAnalysis(deal);
      setAnalysis(result);
      setLoading(false);
      setChatMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: `Analyzed **${deal.business_name}** (${deal.contact_name}). Requesting ${result.overview.fundingAmount} — Risk level: **${result.overview.riskLevel}**. Check the tabs for your 5-point checklist, pitch notes, and product recommendations.`,
        },
      ]);
    }, 1200);
  }, []);

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
                content: `You are an AI finance business planner for SRT Agency, an MCA/business funding company. Help analyze deals, suggest funding strategies, and provide pitch talking points. ${
                  selectedDeal
                    ? `Current deal: ${selectedDeal.business_name} (${selectedDeal.contact_name}), requesting $${(selectedDeal.amount || 0).toLocaleString()}, stage: ${selectedDeal.stage}.`
                    : ""
                } Keep responses concise and actionable.`,
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
            { role: "assistant", content: data.response || data.message || "I couldn't generate a response. Please try again." },
          ]);
        } else {
          setChatMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content:
                "AI is not configured yet. Connect your API key in Settings > AI Configuration to enable live chat.",
            },
          ]);
        }
      } catch {
        setChatMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: "Connection error. Make sure the AI endpoint is configured.",
          },
        ]);
      }
      setChatLoading(false);
    },
    [chatInput, chatLoading, chatMessages, selectedDeal]
  );

  const RISK_COLORS = { low: "#00C9A7", medium: "#F5A623", high: "#E74C3C" };
  const STATUS_ICONS = {
    pass: <CheckCircle2 className="h-4 w-4 text-[#00C9A7]" />,
    warn: <AlertTriangle className="h-4 w-4 text-[#F5A623]" />,
    fail: <AlertTriangle className="h-4 w-4 text-[#E74C3C]" />,
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 h-[calc(100vh-120px)]">
      {/* ─── LEFT: Chat Panel ─── */}
      <div className="flex flex-col w-full lg:w-[400px] bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden shrink-0">
        {/* Chat header */}
        <div className="flex items-center gap-3 p-4 border-b border-[rgba(255,255,255,0.06)]">
          <Brain className="h-5 w-5 text-[#00C9A7]" />
          <div>
            <h2 className="text-sm font-semibold text-white">AI Planner Chat</h2>
            <p className="text-[10px] text-[rgba(255,255,255,0.35)]">
              Ask about deals, strategies, or funding
            </p>
          </div>
        </div>

        {/* Deal selector */}
        <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.04)]">
          <button
            onClick={() => setShowDealPicker(!showDealPicker)}
            className="w-full flex items-center justify-between px-3 py-2 bg-[rgba(255,255,255,0.04)] rounded-lg text-sm hover:bg-[rgba(255,255,255,0.06)] transition-colors"
          >
            <span className="text-[rgba(255,255,255,0.6)]">
              {selectedDeal
                ? `${selectedDeal.business_name} — ${selectedDeal.contact_name}`
                : "Select a deal from pipeline..."}
            </span>
            <ChevronDown className="h-4 w-4 text-[rgba(255,255,255,0.3)]" />
          </button>

          {showDealPicker && (
            <div className="mt-1 max-h-48 overflow-y-auto space-y-1">
              {deals.length === 0 && (
                <p className="text-xs text-[rgba(255,255,255,0.3)] p-2">
                  No deals in pipeline. Sync GHL or add leads first.
                </p>
              )}
              {deals.map((d) => (
                <button
                  key={d.id}
                  onClick={() => handleSelectDeal(d)}
                  className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-left hover:bg-[rgba(255,255,255,0.05)] transition-colors"
                >
                  <div>
                    <p className="text-xs font-medium text-white">
                      {d.business_name || "No name"}
                    </p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.35)]">
                      {d.contact_name} &bull; {d.stage}
                    </p>
                  </div>
                  {d.amount && (
                    <span className="text-xs text-[rgba(255,255,255,0.4)]">
                      ${d.amount.toLocaleString()}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Chat messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {chatMessages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] px-3 py-2 rounded-xl text-sm ${
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
                <Loader2 className="h-4 w-4 text-[#00C9A7] animate-spin" />
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
              placeholder="Ask about this deal..."
              className="flex-1 bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.3)] focus:outline-none focus:border-[#00C9A7]"
            />
            <button
              type="submit"
              disabled={chatLoading || !chatInput.trim()}
              className="px-3 py-2 bg-[#00C9A7] text-[#0B1426] rounded-lg hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </form>
      </div>

      {/* ─── RIGHT: Analysis Panel ─── */}
      <div className="flex-1 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl overflow-hidden flex flex-col">
        {/* Tabs */}
        <div className="flex gap-1 p-2 border-b border-[rgba(255,255,255,0.06)]">
          {[
            { key: "overview" as const, label: "Overview", icon: BarChart3 },
            { key: "checklist" as const, label: "5-Point Check", icon: ClipboardList },
            { key: "pitch" as const, label: "Pitch Notes", icon: PhoneCall },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? "bg-[rgba(255,255,255,0.08)] text-white"
                  : "text-[rgba(255,255,255,0.4)] hover:text-white"
              }`}
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <Loader2 className="h-8 w-8 text-[#00C9A7] animate-spin" />
              <p className="text-sm text-[rgba(255,255,255,0.4)]">
                Analyzing deal...
              </p>
            </div>
          ) : !analysis ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
              <Sparkles className="h-10 w-10 text-[rgba(255,255,255,0.1)]" />
              <p className="text-sm text-[rgba(255,255,255,0.3)]">
                Select a deal from the pipeline to see AI analysis
              </p>
              <p className="text-xs text-[rgba(255,255,255,0.2)]">
                Or ask the chat anything about funding strategies
              </p>
            </div>
          ) : activeTab === "overview" ? (
            <div className="space-y-5">
              {/* Deal card */}
              <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-[#1B65A7]" />
                    <div>
                      <h3 className="text-base font-bold text-white">
                        {analysis.overview.businessName}
                      </h3>
                      <p className="text-xs text-[rgba(255,255,255,0.4)]">
                        {analysis.overview.contactName} &bull;{" "}
                        {analysis.overview.stage}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-lg font-bold text-white">
                      {analysis.overview.fundingAmount}
                    </p>
                    <span
                      className="text-[10px] font-medium px-2 py-0.5 rounded-full"
                      style={{
                        backgroundColor: `${RISK_COLORS[analysis.overview.riskLevel]}18`,
                        color: RISK_COLORS[analysis.overview.riskLevel],
                      }}
                    >
                      {analysis.overview.riskLevel} risk
                    </span>
                  </div>
                </div>
                <p className="text-xs text-[rgba(255,255,255,0.4)]">
                  {analysis.overview.riskNote}
                </p>
              </div>

              {/* Spending Insights */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#F5A623]" />
                  Spending Insights
                </h4>
                <div className="space-y-2">
                  {analysis.spendingInsights.map((s, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 text-sm text-[rgba(255,255,255,0.6)]"
                    >
                      <span className="text-[rgba(255,255,255,0.2)] mt-0.5">
                        &bull;
                      </span>
                      {s}
                    </div>
                  ))}
                </div>
              </div>

              {/* Product Recommendations */}
              <div>
                <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-[#00C9A7]" />
                  Recommended Products
                </h4>
                <div className="flex flex-wrap gap-2">
                  {analysis.productRecommendations.map((p, i) => (
                    <span
                      key={i}
                      className="text-xs px-3 py-1.5 bg-[rgba(0,201,167,0.08)] border border-[rgba(0,201,167,0.15)] rounded-lg text-[#00C9A7]"
                    >
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : activeTab === "checklist" ? (
            <div className="space-y-3">
              <h3 className="text-base font-bold text-white mb-4">
                5-Point Business Checklist
              </h3>
              {analysis.checklist.map((item, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 p-3 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)] rounded-xl"
                >
                  {STATUS_ICONS[item.status]}
                  <div>
                    <p className="text-sm font-medium text-white">
                      {item.label}
                    </p>
                    <p className="text-xs text-[rgba(255,255,255,0.4)] mt-0.5">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="space-y-4">
              <h3 className="text-base font-bold text-white mb-4">
                Pitch Notes & Talking Points
              </h3>
              {analysis.pitchNotes.map((note, i) => (
                <div
                  key={i}
                  className="p-4 bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.05)] rounded-xl"
                >
                  <p className="text-sm text-[rgba(255,255,255,0.7)] leading-relaxed">
                    {note}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
