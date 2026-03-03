"use client";

import { useState, useCallback } from "react";
import {
  Target,
  Loader2,
  Check,
  X,
  Copy,
  Zap,
  MessageSquare,
  BookOpen,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import {
  CATEGORIES,
  AWARENESS_LEVELS,
  ALL_VERTICALS,
  type Vertical,
  type AwarenessLevel,
} from "@/config/ads-verticals";
import { AD_GENERATION_PROMPT } from "@/config/meta-ads-system-prompt";

interface GeneratedAd {
  id: string;
  hook: string;
  primaryText: string;
  headline: string;
  description: string;
  visualConcept: string;
  cta: string;
  buyingBelief: string;
  angle: string;
  vertical: string;
  layer: string;
  approved?: boolean;
}

type Tab = "builder" | "nightly" | "crm" | "approved" | "playbook";

async function aiCall(messages: { role: string; content: string }[]): Promise<string> {
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.response || data.message || "";
    }
    return "";
  } catch {
    return "";
  }
}

export default function AdsPage() {
  const [tab, setTab] = useState<Tab>("builder");

  // Builder state
  const [selectedVertical, setSelectedVertical] = useState<Vertical | null>(null);
  const [selectedLayer, setSelectedLayer] = useState<AwarenessLevel>(AWARENESS_LEVELS[0]);
  const [language, setLanguage] = useState<"en" | "es" | "both">("en");
  const [adCount, setAdCount] = useState(5);
  const [crmIntel, setCrmIntel] = useState("");
  const [campaignName, setCampaignName] = useState("");
  const [verticalProfile, setVerticalProfile] = useState("");
  const [generatedAds, setGeneratedAds] = useState<GeneratedAd[]>([]);
  const [approvedAds, setApprovedAds] = useState<GeneratedAd[]>([]);
  const [loading, setLoading] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState<string | null>(null);

  // Nightly state
  const [nightlyAds, setNightlyAds] = useState<GeneratedAd[]>([]);
  const [nightlyLoading, setNightlyLoading] = useState(false);

  // CRM state
  const [crmText, setCrmText] = useState("");
  const [crmInsights, setCrmInsights] = useState("");
  const [crmLoading, setCrmLoading] = useState(false);

  const [copiedAll, setCopiedAll] = useState(false);

  // Generate vertical profile
  const generateProfile = useCallback(async () => {
    if (!selectedVertical) return;
    setProfileLoading(true);
    const result = await aiCall([
      {
        role: "system",
        content: `You are an ICP researcher for SRT Agency (business funding). Create a detailed vertical profile for: ${selectedVertical.name}. Include: 1) Top 5 pain points, 2) Buying beliefs they need, 3) Industry slang/language, 4) Fears & objections, 5) Desires & goals, 6) Reddit research queries to find them. Format with headers and bullet points.`,
      },
      {
        role: "user",
        content: `Create a vertical profile for ${selectedVertical.name} businesses seeking funding.`,
      },
    ]);
    setVerticalProfile(result || `Profile for ${selectedVertical.name}:\n\n• Pain Points: Cash flow gaps, equipment costs, seasonal dips\n• Buying Beliefs: "Fast funding exists", "My revenue qualifies me"\n• Slang: Industry-specific language\n• Fears: Rejection, high rates, hidden fees\n• Desires: Growth, stability, competitive edge`);
    setProfileLoading(false);
  }, [selectedVertical]);

  // Generate ads
  const generateAds = useCallback(async () => {
    if (!selectedVertical) return;
    setLoading(true);
    const langNote =
      language === "es"
        ? " Write all ads in Spanish."
        : language === "both"
        ? " Write half in English and half in Spanish."
        : "";
    const crmNote = crmIntel ? `\n\nCRM Intelligence: ${crmIntel}` : "";

    const result = await aiCall([
      { role: "system", content: AD_GENERATION_PROMPT },
      {
        role: "user",
        content: `Generate ${adCount} ads for vertical: ${selectedVertical.name}, awareness level: ${selectedLayer.label} (${selectedLayer.name}). Strategy: ${selectedLayer.strategy}. Ad type: ${selectedLayer.adType}. Default CTA: ${selectedLayer.cta}.${langNote}${crmNote}\n\nReturn a JSON array of objects with: hook, primaryText, headline, description, visualConcept, cta, buyingBelief, angle. No markdown wrapping.`,
      },
    ]);

    let ads: GeneratedAd[] = [];
    try {
      const match = result.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        ads = parsed.map((a: Partial<GeneratedAd>, i: number) => ({
          id: `ad-${Date.now()}-${i}`,
          hook: a.hook || "",
          primaryText: a.primaryText || "",
          headline: a.headline || "",
          description: a.description || "",
          visualConcept: a.visualConcept || "",
          cta: a.cta || selectedLayer.cta,
          buyingBelief: a.buyingBelief || "",
          angle: a.angle || "",
          vertical: selectedVertical.name,
          layer: selectedLayer.label,
        }));
      }
    } catch {
      // Generate fallback
      ads = Array.from({ length: adCount }, (_, i) => ({
        id: `ad-${Date.now()}-${i}`,
        hook: `${selectedVertical.name} owners: stop struggling with cash flow`,
        primaryText: `If you run a ${selectedVertical.name.toLowerCase()} and need funding fast, SRT Agency can help. We fund $5K-$500K in 24-48 hours. No bank lines, no 90-day waits.`,
        headline: `${selectedVertical.name} Funding in 24hrs`,
        description: "See if you qualify",
        visualConcept: `${selectedVertical.name} owner working, with overlay text`,
        cta: selectedLayer.cta,
        buyingBelief: "Fast funding exists for my type of business",
        angle: selectedLayer.strategy,
        vertical: selectedVertical.name,
        layer: selectedLayer.label,
      }));
    }
    setGeneratedAds(ads);
    setLoading(false);
  }, [selectedVertical, selectedLayer, language, adCount, crmIntel]);

  const approveAd = useCallback((ad: GeneratedAd) => {
    setApprovedAds((prev) => [...prev, { ...ad, approved: true }]);
    setGeneratedAds((prev) => prev.filter((a) => a.id !== ad.id));
  }, []);

  const rejectAd = useCallback((id: string) => {
    setGeneratedAds((prev) => prev.filter((a) => a.id !== id));
  }, []);

  // Nightly batch
  const generateNightly = useCallback(async () => {
    setNightlyLoading(true);
    const result = await aiCall([
      { role: "system", content: AD_GENERATION_PROMPT },
      {
        role: "user",
        content: `Generate 30 ad ideas across different verticals and awareness levels for SRT Agency. Cover restaurants, trucking, construction, medical, beauty, auto repair, and more. Mix all 7 awareness levels. Return a JSON array of objects with: hook, primaryText, headline, description, visualConcept, cta, buyingBelief, angle, vertical (string), layer (string). No markdown.`,
      },
    ]);

    let ads: GeneratedAd[] = [];
    try {
      const match = result.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        ads = parsed.map((a: Partial<GeneratedAd> & { vertical?: string; layer?: string }, i: number) => ({
          id: `nightly-${Date.now()}-${i}`,
          hook: a.hook || "",
          primaryText: a.primaryText || "",
          headline: a.headline || "",
          description: a.description || "",
          visualConcept: a.visualConcept || "",
          cta: a.cta || "Apply Now",
          buyingBelief: a.buyingBelief || "",
          angle: a.angle || "",
          vertical: a.vertical || "General",
          layer: a.layer || "Problem Aware",
        }));
      }
    } catch {
      // fallback
    }
    setNightlyAds(ads);
    setNightlyLoading(false);
  }, []);

  // CRM extraction
  const extractCRM = useCallback(async () => {
    if (!crmText.trim()) return;
    setCrmLoading(true);
    const result = await aiCall([
      {
        role: "system",
        content: "You are a CRM data analyst for SRT Agency. Extract actionable ad insights from the following CRM data (call transcripts, text threads, testimonials, objections). Identify: 1) Repeated pain points, 2) Common objections, 3) Testimonial quotes for ads, 4) Frequently asked questions, 5) Industry patterns. Format clearly with headers.",
      },
      { role: "user", content: crmText },
    ]);
    setCrmInsights(result || "Could not extract insights. Try pasting more data.");
    setCrmLoading(false);
  }, [crmText]);

  const copyAllApproved = useCallback(() => {
    const text = approvedAds
      .map(
        (a, i) =>
          `--- Ad ${i + 1} [${a.vertical} | ${a.layer}] ---\nHook: ${a.hook}\nPrimary Text: ${a.primaryText}\nHeadline: ${a.headline}\nDescription: ${a.description}\nCTA: ${a.cta}\nVisual: ${a.visualConcept}\nBelief: ${a.buyingBelief}\nAngle: ${a.angle}`
      )
      .join("\n\n");
    navigator.clipboard.writeText(text);
    setCopiedAll(true);
    setTimeout(() => setCopiedAll(false), 2000);
  }, [approvedAds]);

  const tabs: { key: Tab; label: string; icon: typeof Target }[] = [
    { key: "builder", label: "Builder", icon: Target },
    { key: "nightly", label: "Nightly", icon: Zap },
    { key: "crm", label: "CRM", icon: MessageSquare },
    { key: "approved", label: "Approved", icon: Check },
    { key: "playbook", label: "Playbook", icon: BookOpen },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-[rgba(27,101,167,0.12)] flex items-center justify-center">
          <Target className="h-4.5 w-4.5 text-[#1B65A7]" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-white">Meta Ads Command Center</h1>
          <p className="text-xs text-[rgba(255,255,255,0.35)]">
            100 verticals &times; 7 awareness layers
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-[rgba(255,255,255,0.06)] pb-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-[#1B65A7] text-[#1B65A7]"
                  : "border-transparent text-[rgba(255,255,255,0.35)] hover:text-[rgba(255,255,255,0.6)]"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t.label}
              {t.key === "approved" && approvedAds.length > 0 && (
                <span className="ml-1 px-1.5 py-0.5 bg-[rgba(0,201,167,0.15)] text-[#00C9A7] text-[10px] rounded-full">
                  {approvedAds.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* ─── BUILDER TAB ─── */}
      {tab === "builder" && (
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Left: Config */}
          <div className="w-full lg:w-[380px] shrink-0 space-y-4">
            {/* Campaign name */}
            <input
              type="text"
              value={campaignName}
              onChange={(e) => setCampaignName(e.target.value)}
              placeholder="Campaign name (optional)"
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-sm text-white placeholder-[rgba(255,255,255,0.25)] focus:outline-none focus:border-[#1B65A7]"
            />

            {/* Vertical selector */}
            <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)]">
                Select Vertical
              </h3>
              <div className="max-h-[300px] overflow-y-auto space-y-1">
                {Object.entries(CATEGORIES).map(([catKey, cat]) => (
                  <div key={catKey}>
                    <button
                      onClick={() =>
                        setCategoryOpen(categoryOpen === catKey ? null : catKey)
                      }
                      className="w-full flex items-center justify-between px-2 py-1.5 text-xs text-[rgba(255,255,255,0.5)] hover:text-white"
                    >
                      <span>
                        {cat.icon} {cat.name}{" "}
                        <span className="text-[rgba(255,255,255,0.2)]">
                          ({cat.verticals.length})
                        </span>
                      </span>
                      <ChevronDown
                        className={`h-3 w-3 transition-transform ${
                          categoryOpen === catKey ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                    {categoryOpen === catKey && (
                      <div className="ml-4 space-y-0.5">
                        {cat.verticals.map((v) => (
                          <button
                            key={v.key}
                            onClick={() => setSelectedVertical(v)}
                            className={`w-full text-left px-2 py-1 text-xs rounded transition-colors ${
                              selectedVertical?.key === v.key
                                ? "bg-[rgba(27,101,167,0.15)] text-[#1B65A7]"
                                : "text-[rgba(255,255,255,0.4)] hover:text-white"
                            }`}
                          >
                            {v.icon} {v.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Awareness layer */}
            <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-2">
              <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)]">
                Awareness Layer
              </h3>
              <div className="space-y-1">
                {AWARENESS_LEVELS.map((level) => (
                  <button
                    key={level.level}
                    onClick={() => setSelectedLayer(level)}
                    className={`w-full text-left flex items-center gap-2 px-2 py-1.5 text-xs rounded transition-colors ${
                      selectedLayer.level === level.level
                        ? "bg-[rgba(255,255,255,0.06)] text-white"
                        : "text-[rgba(255,255,255,0.4)] hover:text-white"
                    }`}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: level.color }}
                    />
                    <span>L{level.level}: {level.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Language + Count */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="block text-[10px] text-[rgba(255,255,255,0.35)] mb-1">
                  Language
                </label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value as "en" | "es" | "both")}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  <option value="en" className="bg-[#0B1426]">English</option>
                  <option value="es" className="bg-[#0B1426]">Espa&ntilde;ol</option>
                  <option value="both" className="bg-[#0B1426]">Both</option>
                </select>
              </div>
              <div className="flex-1">
                <label className="block text-[10px] text-[rgba(255,255,255,0.35)] mb-1">
                  Ad Count
                </label>
                <select
                  value={adCount}
                  onChange={(e) => setAdCount(Number(e.target.value))}
                  className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {[3, 5, 8, 10].map((n) => (
                    <option key={n} value={n} className="bg-[#0B1426]">
                      {n} ads
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* CRM Intelligence */}
            <div>
              <label className="block text-[10px] text-[rgba(255,255,255,0.35)] mb-1">
                CRM Intelligence (optional)
              </label>
              <textarea
                value={crmIntel}
                onChange={(e) => setCrmIntel(e.target.value)}
                rows={3}
                placeholder="Paste call transcripts, objections, testimonials..."
                className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-lg px-3 py-2 text-xs text-white placeholder-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[#1B65A7] resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex gap-2">
              {selectedVertical && (
                <button
                  onClick={generateProfile}
                  disabled={profileLoading}
                  className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 border border-[rgba(255,255,255,0.1)] text-xs text-[rgba(255,255,255,0.5)] rounded-lg hover:border-[rgba(255,255,255,0.2)]"
                >
                  {profileLoading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  Build Profile
                </button>
              )}
              <button
                onClick={generateAds}
                disabled={!selectedVertical || loading}
                className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 bg-[#1B65A7] text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Target className="h-3.5 w-3.5" />
                )}
                Generate Ads
              </button>
            </div>
          </div>

          {/* Right: Profile + Generated Ads */}
          <div className="flex-1 space-y-4 overflow-y-auto">
            {/* Vertical Profile */}
            {verticalProfile && (
              <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)] mb-2">
                  Vertical Profile: {selectedVertical?.name}
                </h3>
                <pre className="text-xs text-[rgba(255,255,255,0.45)] whitespace-pre-wrap font-sans">
                  {verticalProfile}
                </pre>
              </div>
            )}

            {/* Selected config summary */}
            {selectedVertical && (
              <div className="flex flex-wrap gap-2 text-[10px]">
                <span className="px-2 py-1 bg-[rgba(27,101,167,0.1)] text-[#1B65A7] rounded-full">
                  {selectedVertical.icon} {selectedVertical.name}
                </span>
                <span
                  className="px-2 py-1 rounded-full"
                  style={{
                    backgroundColor: `${selectedLayer.color}18`,
                    color: selectedLayer.color,
                  }}
                >
                  L{selectedLayer.level}: {selectedLayer.label}
                </span>
                <span className="px-2 py-1 bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] rounded-full">
                  {language === "en" ? "EN" : language === "es" ? "ES" : "EN/ES"} &bull; {adCount} ads
                </span>
              </div>
            )}

            {/* Generated Ads */}
            {generatedAds.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)]">
                  Generated Ads ({generatedAds.length})
                </h3>
                {generatedAds.map((ad) => (
                  <div
                    key={ad.id}
                    className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {ad.hook}
                        </p>
                        <p className="text-xs text-[rgba(255,255,255,0.45)] mt-1">
                          {ad.primaryText}
                        </p>
                      </div>
                      <div className="flex gap-1 shrink-0 ml-3">
                        <button
                          onClick={() => approveAd(ad)}
                          className="p-1.5 rounded-lg bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)]"
                          title="Approve"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => rejectAd(ad.id)}
                          className="p-1.5 rounded-lg bg-[rgba(239,68,68,0.1)] text-red-400 hover:bg-[rgba(239,68,68,0.2)]"
                          title="Reject"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[rgba(255,255,255,0.3)]">
                      <span><strong>Headline:</strong> {ad.headline}</span>
                      <span><strong>CTA:</strong> {ad.cta}</span>
                      <span><strong>Visual:</strong> {ad.visualConcept}</span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[rgba(255,255,255,0.25)]">
                      <span><strong>Belief:</strong> {ad.buyingBelief}</span>
                      <span><strong>Angle:</strong> {ad.angle}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!selectedVertical && !generatedAds.length && (
              <div className="flex items-center justify-center h-[300px] text-[rgba(255,255,255,0.2)] text-sm">
                Select a vertical to get started
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── NIGHTLY TAB ─── */}
      {tab === "nightly" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[rgba(255,255,255,0.4)]">
              Generate 30 ad ideas across all verticals and awareness levels in one batch.
            </p>
            <button
              onClick={generateNightly}
              disabled={nightlyLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1B65A7] text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-50"
            >
              {nightlyLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Zap className="h-3.5 w-3.5" />
              )}
              Generate Nightly Batch
            </button>
          </div>

          {nightlyAds.length > 0 && (
            <div className="space-y-2">
              {nightlyAds.map((ad) => (
                <div
                  key={ad.id}
                  className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-3 flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">
                      {ad.hook}
                    </p>
                    <p className="text-[11px] text-[rgba(255,255,255,0.4)] mt-0.5 line-clamp-2">
                      {ad.primaryText}
                    </p>
                    <div className="flex gap-2 mt-1.5">
                      <span className="text-[9px] px-1.5 py-0.5 bg-[rgba(27,101,167,0.1)] text-[#1B65A7] rounded">
                        {ad.vertical}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.3)] rounded">
                        {ad.layer}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => approveAd(ad)}
                    className="shrink-0 p-1.5 rounded-lg bg-[rgba(0,201,167,0.1)] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.2)]"
                  >
                    <Check className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {nightlyAds.length === 0 && !nightlyLoading && (
            <div className="flex items-center justify-center h-[300px] text-[rgba(255,255,255,0.2)] text-sm">
              Click &quot;Generate Nightly Batch&quot; to create 30 ad ideas
            </div>
          )}
        </div>
      )}

      {/* ─── CRM TAB ─── */}
      {tab === "crm" && (
        <div className="flex flex-col lg:flex-row gap-6">
          <div className="w-full lg:w-1/2 space-y-3">
            <p className="text-xs text-[rgba(255,255,255,0.4)]">
              Paste call transcripts, text threads, testimonials, or objections. AI will extract ad-ready insights.
            </p>
            <textarea
              value={crmText}
              onChange={(e) => setCrmText(e.target.value)}
              rows={12}
              placeholder="Paste CRM data here... call transcripts, text messages, customer testimonials, common objections..."
              className="w-full bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] rounded-xl px-4 py-3 text-xs text-white placeholder-[rgba(255,255,255,0.2)] focus:outline-none focus:border-[#1B65A7] resize-none"
            />
            <button
              onClick={extractCRM}
              disabled={!crmText.trim() || crmLoading}
              className="flex items-center gap-2 px-4 py-2 bg-[#1B65A7] text-white text-xs font-semibold rounded-lg hover:opacity-90 disabled:opacity-40"
            >
              {crmLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquare className="h-3.5 w-3.5" />
              )}
              Extract Insights
            </button>
            <div className="bg-[rgba(245,166,35,0.06)] border border-[rgba(245,166,35,0.15)] rounded-lg p-3 text-[10px] text-[rgba(255,255,255,0.35)]">
              <strong className="text-[#F5A623]">Phase 2:</strong> GHL webhooks will auto-pull call transcripts and text threads directly from your CRM.
            </div>
          </div>
          <div className="w-full lg:w-1/2">
            {crmInsights ? (
              <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-4">
                <h3 className="text-xs font-semibold text-[rgba(255,255,255,0.5)] mb-2">
                  Extracted Insights
                </h3>
                <pre className="text-xs text-[rgba(255,255,255,0.45)] whitespace-pre-wrap font-sans">
                  {crmInsights}
                </pre>
              </div>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-[rgba(255,255,255,0.2)] text-sm">
                Paste CRM data and click Extract Insights
              </div>
            )}
          </div>
        </div>
      )}

      {/* ─── APPROVED TAB ─── */}
      {tab === "approved" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[rgba(255,255,255,0.4)]">
              {approvedAds.length} approved ads ready for deployment
            </p>
            {approvedAds.length > 0 && (
              <button
                onClick={copyAllApproved}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-[rgba(255,255,255,0.1)] text-xs text-[rgba(255,255,255,0.5)] rounded-lg hover:border-[rgba(255,255,255,0.2)]"
              >
                {copiedAll ? (
                  <>
                    <Check className="h-3 w-3" /> Copied All
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" /> Copy All
                  </>
                )}
              </button>
            )}
          </div>

          {approvedAds.length > 0 ? (
            <div className="space-y-3">
              {approvedAds.map((ad, i) => (
                <div
                  key={ad.id}
                  className="bg-[rgba(0,201,167,0.03)] border border-[rgba(0,201,167,0.1)] rounded-xl p-4 space-y-2"
                >
                  <div className="flex items-center gap-2 text-[10px]">
                    <span className="px-1.5 py-0.5 bg-[rgba(0,201,167,0.1)] text-[#00C9A7] rounded">
                      #{i + 1}
                    </span>
                    <span className="text-[rgba(255,255,255,0.3)]">
                      {ad.vertical} &bull; {ad.layer}
                    </span>
                  </div>
                  <p className="text-sm font-semibold text-white">{ad.hook}</p>
                  <p className="text-xs text-[rgba(255,255,255,0.45)]">
                    {ad.primaryText}
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-[rgba(255,255,255,0.3)]">
                    <span><strong>Headline:</strong> {ad.headline}</span>
                    <span><strong>CTA:</strong> {ad.cta}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[300px] text-[rgba(255,255,255,0.2)] text-sm">
              No approved ads yet. Generate and approve ads in the Builder tab.
            </div>
          )}
        </div>
      )}

      {/* ─── PLAYBOOK TAB ─── */}
      {tab === "playbook" && (
        <div className="space-y-6 max-w-3xl">
          {/* Awareness Stack */}
          <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              7-Layer Awareness Stack
            </h3>
            <div className="space-y-2">
              {AWARENESS_LEVELS.map((level) => (
                <div key={level.level} className="flex gap-3">
                  <span
                    className="shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold text-white"
                    style={{ backgroundColor: level.color }}
                  >
                    {level.level}
                  </span>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-white">
                      {level.label}
                    </p>
                    <p className="text-[11px] text-[rgba(255,255,255,0.35)]">
                      {level.description}
                    </p>
                    <p className="text-[10px] text-[rgba(255,255,255,0.25)] mt-0.5">
                      Strategy: {level.strategy}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Campaign Structure */}
          <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              Meta Campaign Structure
            </h3>
            <div className="space-y-2 text-xs text-[rgba(255,255,255,0.45)]">
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-[rgba(239,68,68,0.1)] text-red-400 rounded text-[10px] font-semibold">
                  TOF 40%
                </span>
                <span>Unaware + Propaganda &mdash; Broad/LAL audiences</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-[rgba(245,166,35,0.1)] text-[#F5A623] rounded text-[10px] font-semibold">
                  MOF 30%
                </span>
                <span>Problem/Solution Aware &mdash; Interest + engagement retargeting</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 bg-[rgba(0,201,167,0.1)] text-[#00C9A7] rounded text-[10px] font-semibold">
                  BOF 30%
                </span>
                <span>Product/Most Aware + Indoctrination &mdash; Website visitors, leads</span>
              </div>
            </div>
          </div>

          {/* All 100 Verticals */}
          <div className="bg-[rgba(255,255,255,0.02)] border border-[rgba(255,255,255,0.06)] rounded-xl p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white">
              All 100 Verticals
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {Object.entries(CATEGORIES).map(([, cat]) => (
                <div key={cat.name}>
                  <p className="text-xs font-semibold text-[rgba(255,255,255,0.5)] mb-1">
                    {cat.icon} {cat.name}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {cat.verticals.map((v) => (
                      <span
                        key={v.key}
                        className="text-[9px] px-1.5 py-0.5 bg-[rgba(255,255,255,0.04)] text-[rgba(255,255,255,0.35)] rounded"
                      >
                        {v.icon} {v.short}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[10px] text-[rgba(255,255,255,0.2)] mt-2">
              Total: {ALL_VERTICALS.length} verticals across {Object.keys(CATEGORIES).length} categories
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
