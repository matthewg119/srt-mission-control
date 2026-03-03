"use client";

interface ActivityEntry {
  event_type: string;
  description: string;
  created_at: string;
}

interface ActivityResult {
  activity?: ActivityEntry[];
}

const EVENT_COLORS: Record<string, string> = {
  lead_captured: "#00C9A7",
  sms_sent: "#0ea5e9",
  email_sent: "#8b5cf6",
  stage_changed: "#f59e0b",
  ai_action: "#1B65A7",
  error: "#ef4444",
};

function formatTime(ts: string): string {
  const d = new Date(ts);
  const now = Date.now();
  const diff = Math.floor((now - d.getTime()) / 1000);
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function ActivityFeedCard({ data }: { data: ActivityResult }) {
  const activity = data.activity || [];

  if (activity.length === 0) {
    return (
      <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-4 py-3">
        <p className="text-sm text-[rgba(255,255,255,0.4)]">No recent activity</p>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.03)] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[rgba(255,255,255,0.06)]">
        <span className="text-xs font-semibold text-[rgba(255,255,255,0.5)] uppercase tracking-wider">
          Recent Activity
        </span>
      </div>
      <div className="divide-y divide-[rgba(255,255,255,0.04)] max-h-64 overflow-y-auto">
        {activity.map((item, i) => (
          <div key={i} className="flex gap-3 px-4 py-2.5 items-start">
            <div
              className="h-2 w-2 rounded-full mt-1.5 shrink-0"
              style={{ background: EVENT_COLORS[item.event_type] || "#64748b" }}
            />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-[rgba(255,255,255,0.7)] leading-relaxed">{item.description}</p>
            </div>
            <span className="text-[10px] text-[rgba(255,255,255,0.25)] shrink-0 mt-0.5">
              {formatTime(item.created_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
