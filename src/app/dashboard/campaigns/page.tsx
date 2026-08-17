"use client";

import { useState, useEffect, useRef } from "react";
import { STAGE_NAMES } from "@/config/stage-display";
import { MessageSquare, Play, Pause, Plus, Upload, Users, RefreshCw, AlertTriangle } from "lucide-react";

interface Campaign {
  id: string;
  name: string;
  template_name: string;
  status: "draft" | "running" | "paused" | "completed" | "cancelled";
  total_contacts: number;
  sent_count: number;
  reply_count: number;
  daily_limit: number;
  spacing_minutes: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  draft: "text-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]",
  running: "text-emerald-400 bg-emerald-400/10",
  paused: "text-yellow-400 bg-yellow-400/10",
  completed: "text-blue-400 bg-blue-400/10",
  cancelled: "text-red-400 bg-red-400/10",
};

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);

  const fetchCampaigns = async () => {
    try {
      const res = await fetch("/api/sms/campaign");
      const data = await res.json();
      setCampaigns(data.campaigns ?? []);
    } catch {
      setCampaigns([]);
    }
    setLoading(false);
  };

  useEffect(() => { fetchCampaigns(); }, []);

  const handleAction = async (id: string, action: "start" | "pause" | "resume") => {
    await fetch("/api/sms/campaign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, action }),
    });
    fetchCampaigns();
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">iMessage Campaigns</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            Bulk outreach across 3 dedicated senders — all conversations visible in Slack
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchCampaigns}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white text-sm transition-colors"
          >
            <RefreshCw size={14} />
            Refresh
          </button>
          <button
            onClick={() => setShowNewModal(true)}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white text-sm font-medium transition-colors"
          >
            <Plus size={14} />
            New Campaign
          </button>
        </div>
      </div>

      {/* Warmup warning */}
      <div className="flex items-start gap-3 p-4 rounded-xl border border-yellow-400/20 bg-yellow-400/5">
        <AlertTriangle size={16} className="text-yellow-400 mt-0.5 shrink-0" />
        <div className="text-sm text-[rgba(255,255,255,0.6)]">
          <span className="text-yellow-400 font-medium">Warmup period:</span> New LoopMessage numbers are limited to ~50 new conversations/day for the first 7–14 days. Set your daily limit to 50 until warmup is complete, then scale to 1,000.
        </div>
      </div>

      {/* Campaign list */}
      {loading ? (
        <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 border border-[rgba(255,255,255,0.06)] rounded-xl">
          <MessageSquare size={40} className="text-[rgba(255,255,255,0.1)] mb-4" />
          <p className="text-[rgba(255,255,255,0.3)] text-sm">No campaigns yet. Create one to start texting.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {campaigns.map((c) => (
            <CampaignRow key={c.id} campaign={c} onAction={handleAction} />
          ))}
        </div>
      )}

      {showNewModal && (
        <NewCampaignModal
          onClose={() => setShowNewModal(false)}
          onCreated={() => { setShowNewModal(false); fetchCampaigns(); }}
        />
      )}
    </div>
  );
}

function CampaignRow({
  campaign: c,
  onAction,
}: {
  campaign: Campaign;
  onAction: (id: string, action: "start" | "pause" | "resume") => void;
}) {
  const pct = c.total_contacts > 0 ? Math.round((c.sent_count / c.total_contacts) * 100) : 0;

  return (
    <div className="p-4 rounded-xl border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.02)] flex flex-col gap-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-white font-medium">{c.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[c.status]}`}>
              {c.status}
            </span>
          </div>
          <span className="text-xs text-[rgba(255,255,255,0.4)]">
            Template: {c.template_name} · {c.daily_limit}/day limit · {c.spacing_minutes}min spacing
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {c.status === "draft" && (
            <button
              onClick={() => onAction(c.id, "start")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors"
            >
              <Play size={12} />
              Start
            </button>
          )}
          {c.status === "running" && (
            <button
              onClick={() => onAction(c.id, "pause")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-yellow-400/10 hover:bg-yellow-400/20 text-yellow-400 text-xs font-medium transition-colors"
            >
              <Pause size={12} />
              Pause
            </button>
          )}
          {c.status === "paused" && (
            <button
              onClick={() => onAction(c.id, "resume")}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-xs font-medium transition-colors"
            >
              <Play size={12} />
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Progress bar */}
      <div className="flex flex-col gap-1.5">
        <div className="w-full h-1.5 bg-[rgba(255,255,255,0.06)] rounded-full overflow-hidden">
          <div
            className="h-full bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-[rgba(255,255,255,0.35)]">
          <span>{c.sent_count.toLocaleString()} / {c.total_contacts.toLocaleString()} sent</span>
          <span>{c.reply_count} replies · {pct}%</span>
        </div>
      </div>
    </div>
  );
}

function NewCampaignModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [step, setStep] = useState<"settings" | "import" | "preview">("settings");
  const [name, setName] = useState("");
  const [templateName, setTemplateName] = useState("new-lead");
  const [dailyLimit, setDailyLimit] = useState(50);
  const [spacingMin, setSpacingMin] = useState(12);
  const [importSource, setImportSource] = useState<"csv" | "zoho">("csv");
  const [csvText, setCsvText] = useState("");
  const [zohoStage, setZohoStage] = useState("New");
  const [zohoDays, setZohoDays] = useState(30);
  const [previewContacts, setPreviewContacts] = useState<Array<{phone: string; first_name: string | null; business_name: string | null}>>([]);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setCsvText((ev.target?.result as string) ?? "");
    reader.readAsText(file);
  };

  const handleImportPreview = async () => {
    setImporting(true);
    setError(null);
    try {
      const body = importSource === "csv"
        ? { source: "csv", csv: csvText }
        : { source: "zoho", stage: zohoStage, days_since_contact: zohoDays, limit: 500 };

      const res = await fetch("/api/sms/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Import failed");
      setPreviewContacts(data.contacts ?? []);
      setStep("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
    setImporting(false);
  };

  const handleCreate = async () => {
    if (!name.trim() || previewContacts.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/sms/campaign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          template_name: templateName,
          contacts: previewContacts,
          daily_limit: dailyLimit,
          spacing_minutes: spacingMin,
          auto_start: false,
        }),
      });
      const data = await res.json();
      if (!data.ok) throw new Error(data.error ?? "Failed to create campaign");
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create campaign");
    }
    setCreating(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg bg-[#0f0f0f] border border-[rgba(255,255,255,0.1)] rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(255,255,255,0.06)]">
          <h2 className="text-white font-semibold">New Campaign</h2>
          <button onClick={onClose} className="text-[rgba(255,255,255,0.4)] hover:text-white text-lg">✕</button>
        </div>

        <div className="p-5 flex flex-col gap-4 max-h-[70vh] overflow-y-auto">
          {error && (
            <div className="text-red-400 text-sm bg-red-400/10 rounded-lg px-3 py-2">{error}</div>
          )}

          {step === "settings" && (
            <>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-[rgba(255,255,255,0.5)]">Campaign name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. May Re-engagement Blast"
                  className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-white text-sm placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-emerald-500/50"
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-[rgba(255,255,255,0.5)]">SMS template name</label>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="new-lead"
                  className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-white text-sm placeholder:text-[rgba(255,255,255,0.2)] focus:outline-none focus:border-emerald-500/50"
                />
                <span className="text-xs text-[rgba(255,255,255,0.3)]">Must match a template name in Templates → SMS</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-[rgba(255,255,255,0.5)]">Daily limit (warmup: 50)</label>
                  <input
                    type="number"
                    value={dailyLimit}
                    min={10}
                    max={1000}
                    onChange={(e) => setDailyLimit(Number(e.target.value))}
                    className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs text-[rgba(255,255,255,0.5)]">Spacing (minutes)</label>
                  <input
                    type="number"
                    value={spacingMin}
                    min={5}
                    max={60}
                    onChange={(e) => setSpacingMin(Number(e.target.value))}
                    className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>

              <button
                onClick={() => setStep("import")}
                disabled={!name.trim()}
                className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
              >
                Next: Import Contacts
              </button>
            </>
          )}

          {step === "import" && (
            <>
              <div className="flex gap-2">
                {(["csv", "zoho"] as const).map((src) => (
                  <button
                    key={src}
                    onClick={() => setImportSource(src)}
                    className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors border ${
                      importSource === src
                        ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                        : "border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.4)] hover:text-white"
                    }`}
                  >
                    {src === "csv" ? (
                      <span className="flex items-center justify-center gap-1.5"><Upload size={12} /> CSV Upload</span>
                    ) : (
                      <span className="flex items-center justify-center gap-1.5"><Users size={12} /> Zoho Leads</span>
                    )}
                  </button>
                ))}
              </div>

              {importSource === "csv" ? (
                <div className="flex flex-col gap-3">
                  <p className="text-xs text-[rgba(255,255,255,0.4)]">
                    Upload a CSV with columns: <code className="bg-[rgba(255,255,255,0.06)] px-1 rounded">phone, first_name, business_name</code>
                  </p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full py-6 rounded-lg border-2 border-dashed border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] hover:border-emerald-500/40 hover:text-emerald-400 text-sm transition-colors"
                  >
                    {csvText ? `File loaded (${csvText.split("\n").length - 1} rows)` : "Click to select CSV file"}
                  </button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-[rgba(255,255,255,0.5)]">Zoho Lead Stage</label>
                    <select
                      value={zohoStage}
                      onChange={(e) => setZohoStage(e.target.value)}
                      className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                    >
                      {STAGE_NAMES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs text-[rgba(255,255,255,0.5)]">Last contacted more than X days ago</label>
                    <input
                      type="number"
                      value={zohoDays}
                      min={1}
                      onChange={(e) => setZohoDays(Number(e.target.value))}
                      className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-lg px-3 py-2 text-white text-sm focus:outline-none"
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("settings")}
                  className="px-4 py-2.5 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleImportPreview}
                  disabled={importing || (importSource === "csv" && !csvText)}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {importing ? "Loading..." : "Preview Contacts"}
                </button>
              </div>
            </>
          )}

          {step === "preview" && (
            <>
              <div className="bg-[rgba(255,255,255,0.03)] rounded-lg p-3 text-sm text-[rgba(255,255,255,0.6)]">
                <span className="text-white font-medium">{previewContacts.length.toLocaleString()}</span> contacts ready to import
              </div>

              <div className="max-h-48 overflow-y-auto flex flex-col gap-1.5">
                {previewContacts.slice(0, 10).map((c, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.02)] text-sm">
                    <span className="text-white">{c.first_name ?? "—"}</span>
                    <span className="text-[rgba(255,255,255,0.4)] text-xs">{c.business_name ?? ""}</span>
                    <span className="text-[rgba(255,255,255,0.3)] text-xs ml-auto">{c.phone}</span>
                  </div>
                ))}
                {previewContacts.length > 10 && (
                  <div className="text-xs text-[rgba(255,255,255,0.3)] px-3">
                    ...and {previewContacts.length - 10} more
                  </div>
                )}
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep("import")}
                  className="px-4 py-2.5 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white text-sm transition-colors"
                >
                  Back
                </button>
                <button
                  onClick={handleCreate}
                  disabled={creating}
                  className="flex-1 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
                >
                  {creating ? "Creating..." : `Create Campaign (${previewContacts.length.toLocaleString()} contacts)`}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
