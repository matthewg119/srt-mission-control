"use client";

import { useState, useEffect, use } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Pause, Play, Download, MessageSquare, Users, CheckCircle, Clock } from "lucide-react";

const STATUS_COLOR: Record<string, string> = {
  draft: "text-[rgba(255,255,255,0.4)] bg-[rgba(255,255,255,0.06)]",
  running: "text-emerald-400 bg-emerald-400/10",
  paused: "text-yellow-400 bg-yellow-400/10",
  completed: "text-blue-400 bg-blue-400/10",
  cancelled: "text-red-400 bg-red-400/10",
};

interface Campaign {
  id: string;
  name: string;
  status: string;
  total_contacts: number;
  sent_count: number;
  reply_count: number;
  daily_limit: number;
  spacing_minutes: number;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

interface ContactDetail {
  id: string;
  phone: string;
  first_name: string | null;
  business_name: string | null;
  sent_at: string | null;
  conversation_id: string | null;
  reply_preview?: string | null;
  reply_at?: string | null;
  slack_channel_id?: string | null;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatPhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 11 && digits[0] === "1") {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  return p;
}

function exportCSV(contacts: ContactDetail[], filename: string) {
  const rows = [
    ["Name", "Business", "Phone", "Sent At"],
    ...contacts.map((c) => [
      c.first_name ?? "",
      c.business_name ?? "",
      c.phone,
      c.sent_at ?? "",
    ]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${v}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [replied, setReplied] = useState<ContactDetail[]>([]);
  const [noReply, setNoReply] = useState<ContactDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showFollowUpModal, setShowFollowUpModal] = useState(false);
  const [followUpLoading, setFollowUpLoading] = useState(false);

  const fetchDetails = async () => {
    try {
      const res = await fetch(`/api/sms/campaign/${id}/details`);
      const data = await res.json() as { campaign: Campaign; replied: ContactDetail[]; noReply: ContactDetail[] };
      setCampaign(data.campaign);
      setReplied(data.replied ?? []);
      setNoReply(data.noReply ?? []);
    } catch {
      // ignore
    }
    setLoading(false);
  };

  useEffect(() => { fetchDetails(); }, [id]);

  const handleAction = async (action: "pause" | "resume") => {
    if (!campaign) return;
    setActionLoading(true);
    await fetch("/api/sms/campaign", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: campaign.id, action }),
    });
    await fetchDetails();
    setActionLoading(false);
  };

  const handleFollowUp = async () => {
    setFollowUpLoading(true);
    const res = await fetch(`/api/sms/campaign/${id}/details`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const data = await res.json() as { ok: boolean; new_campaign_id?: string; error?: string };
    setFollowUpLoading(false);
    setShowFollowUpModal(false);
    if (data.ok && data.new_campaign_id) {
      router.push(`/dashboard/campaigns/${data.new_campaign_id}`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[rgba(255,255,255,0.4)] text-sm">Loading…</div>
      </div>
    );
  }

  if (!campaign) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[rgba(255,255,255,0.4)] text-sm">Campaign not found</div>
      </div>
    );
  }

  const responseRate = campaign.sent_count > 0
    ? Math.round((campaign.reply_count / campaign.sent_count) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => router.push("/dashboard/campaigns")}
          className="flex items-center gap-1 text-[rgba(255,255,255,0.4)] hover:text-white text-sm transition-colors"
        >
          <ArrowLeft size={14} />
          Back
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-white">{campaign.name}</h1>
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${STATUS_COLOR[campaign.status] ?? STATUS_COLOR.draft}`}>
              {campaign.status}
            </span>
          </div>
          <p className="text-sm text-[rgba(255,255,255,0.5)] mt-1">
            {campaign.sent_count} sent · {campaign.reply_count} replied · {responseRate}% response rate
          </p>
        </div>
        {campaign.status === "running" && (
          <button
            onClick={() => handleAction("pause")}
            disabled={actionLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-sm font-medium transition-colors disabled:opacity-40"
          >
            <Pause size={14} />
            Pause
          </button>
        )}
        {campaign.status === "paused" && (
          <button
            onClick={() => handleAction("resume")}
            disabled={actionLoading}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-sm font-medium transition-colors disabled:opacity-40"
          >
            <Play size={14} />
            Resume
          </button>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        {[
          { label: "Total", value: campaign.total_contacts, icon: Users, color: "text-white" },
          { label: "Sent", value: campaign.sent_count, icon: MessageSquare, color: "text-blue-400" },
          { label: "Replied", value: campaign.reply_count, icon: CheckCircle, color: "text-emerald-400" },
          { label: "Response Rate", value: `${responseRate}%`, icon: Clock, color: "text-[#00B4B4]" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="bg-[rgba(255,255,255,0.04)] rounded-xl p-4 border border-[rgba(255,255,255,0.08)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-[rgba(255,255,255,0.4)]">{label}</span>
              <Icon size={14} className={color} />
            </div>
            <div className={`text-2xl font-bold ${color}`}>{value}</div>
          </div>
        ))}
      </div>

      {/* Two-column grid */}
      <div className="grid grid-cols-2 gap-6">
        {/* Replied column */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 font-semibold text-sm">Replied</span>
              <span className="text-xs bg-emerald-400/10 text-emerald-400 px-2 py-0.5 rounded-full">{replied.length}</span>
            </div>
            <button
              onClick={() => exportCSV(replied, `${campaign.name}-replied.csv`)}
              className="flex items-center gap-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-white transition-colors"
            >
              <Download size={12} />
              Export CSV
            </button>
          </div>
          <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
            {replied.length === 0 ? (
              <div className="text-[rgba(255,255,255,0.3)] text-sm py-8 text-center">No replies yet</div>
            ) : replied.map((c) => (
              <div key={c.id} className="bg-[rgba(255,255,255,0.04)] border border-emerald-400/20 rounded-xl p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-white text-sm font-medium truncate">
                      {c.business_name ?? c.first_name ?? "Unknown"}
                    </div>
                    <div className="text-[rgba(255,255,255,0.4)] text-xs">{formatPhone(c.phone)}</div>
                  </div>
                  {c.slack_channel_id && (
                    <a
                      href={`https://slack.com/app_redirect?channel=${c.slack_channel_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-shrink-0 text-xs text-[#00B4B4] hover:underline"
                    >
                      Slack
                    </a>
                  )}
                </div>
                {c.reply_preview && (
                  <p className="text-[rgba(255,255,255,0.6)] text-xs mt-2 italic truncate">
                    &ldquo;{c.reply_preview}&rdquo;
                  </p>
                )}
                {c.reply_at && (
                  <div className="text-[rgba(255,255,255,0.3)] text-xs mt-1">{timeAgo(c.reply_at)}</div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* No Reply column */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[rgba(255,255,255,0.6)] font-semibold text-sm">Did Not Reply</span>
              <span className="text-xs bg-[rgba(255,255,255,0.06)] text-[rgba(255,255,255,0.4)] px-2 py-0.5 rounded-full">{noReply.length}</span>
            </div>
            <button
              onClick={() => exportCSV(noReply, `${campaign.name}-no-reply.csv`)}
              className="flex items-center gap-1 text-xs text-[rgba(255,255,255,0.4)] hover:text-white transition-colors"
            >
              <Download size={12} />
              Export CSV
            </button>
          </div>
          <div className="flex flex-col gap-3 max-h-[60vh] overflow-y-auto pr-1">
            {noReply.length === 0 ? (
              <div className="text-[rgba(255,255,255,0.3)] text-sm py-8 text-center">Everyone replied!</div>
            ) : noReply.map((c) => (
              <div key={c.id} className="bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.08)] rounded-xl p-4">
                <div className="text-white text-sm font-medium truncate">
                  {c.business_name ?? c.first_name ?? "Unknown"}
                </div>
                <div className="text-[rgba(255,255,255,0.4)] text-xs">{formatPhone(c.phone)}</div>
                {c.sent_at && (
                  <div className="text-[rgba(255,255,255,0.3)] text-xs mt-1">Sent {timeAgo(c.sent_at)}</div>
                )}
              </div>
            ))}
          </div>

          {noReply.length > 0 && (
            <button
              onClick={() => setShowFollowUpModal(true)}
              className="mt-4 w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-[#00B4B4]/10 hover:bg-[#00B4B4]/20 text-[#00B4B4] text-sm font-medium transition-colors"
            >
              <MessageSquare size={14} />
              Send Follow-Up Campaign ({noReply.length})
            </button>
          )}
        </div>
      </div>

      {/* Follow-up modal */}
      {showFollowUpModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowFollowUpModal(false)}>
          <div className="bg-[#0f0f0f] border border-[rgba(255,255,255,0.1)] rounded-2xl p-6 w-full max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-white font-semibold text-lg mb-2">Send Follow-Up</h2>
            <p className="text-[rgba(255,255,255,0.5)] text-sm mb-6">
              Create a new campaign with the {noReply.length} contacts who didn&apos;t reply using the same template and settings.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowFollowUpModal(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] hover:text-white text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleFollowUp}
                disabled={followUpLoading}
                className="flex-1 px-4 py-2 rounded-lg bg-[#00B4B4] hover:bg-[#00cccc] text-white text-sm font-medium transition-colors disabled:opacity-40"
              >
                {followUpLoading ? "Creating…" : "Create Campaign"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
