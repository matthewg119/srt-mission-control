"use client";

import {
  FileText,
  Phone,
  Mail,
  MessageSquare,
  ArrowRightLeft,
  CalendarClock,
  CheckCircle2,
  Moon,
  Activity,
} from "lucide-react";

// The lead's history, from lead_activities. This view is what replaces
// scrolling a Zoho lead's Notes tab, so it deliberately shows every source —
// Zoho-imported notes sit alongside calls logged here, texts, emails and
// status changes, in one stream.

export interface TimelineActivity {
  id: string;
  activity_type: string;
  direction: string | null;
  channel: string | null;
  subject: string | null;
  body: string | null;
  outcome: string | null;
  duration_secs: number | null;
  occurred_at: string;
  actor: string | null;
  source: string;
}

const TYPE_META: Record<string, { icon: typeof FileText; tone: string; label: string }> = {
  note: { icon: FileText, tone: "#9CA3AF", label: "Note" },
  call: { icon: Phone, tone: "#00C9A7", label: "Call" },
  email: { icon: Mail, tone: "#1B65A7", label: "Email" },
  sms: { icon: MessageSquare, tone: "#9C27B0", label: "Text" },
  meeting: { icon: CalendarClock, tone: "#F5A623", label: "Meeting" },
  status_change: { icon: ArrowRightLeft, tone: "#00BCD4", label: "Status" },
  task_created: { icon: CalendarClock, tone: "#F5A623", label: "Follow-up set" },
  task_completed: { icon: CheckCircle2, tone: "#4CAF50", label: "Follow-up done" },
  snooze: { icon: Moon, tone: "#6B7280", label: "Snoozed" },
  portal: { icon: Activity, tone: "#1B65A7", label: "Portal" },
  system: { icon: Activity, tone: "#6B7280", label: "System" },
};

function meta(type: string) {
  return TYPE_META[type] ?? { icon: Activity, tone: "#6B7280", label: type };
}

function when(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function LeadTimeline({ activities }: { activities: TimelineActivity[] }) {
  if (activities.length === 0) {
    return (
      <p className="rounded-xl border border-[rgba(255,255,255,0.07)] px-4 py-6 text-center text-xs text-[rgba(255,255,255,0.35)]">
        No activity yet.
      </p>
    );
  }

  return (
    <ol className="relative space-y-3 border-l border-[rgba(255,255,255,0.07)] pl-5">
      {activities.map((a) => {
        const m = meta(a.activity_type);
        const Icon = m.icon;
        return (
          <li key={a.id} className="relative">
            <span
              className="absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full"
              style={{ background: `${m.tone}33` }}
            >
              <Icon className="h-2.5 w-2.5" style={{ color: m.tone }} />
            </span>

            <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
                <span style={{ color: m.tone }}>{m.label}</span>
                {a.outcome && (
                  <span className="text-[rgba(255,255,255,0.5)]">{a.outcome}</span>
                )}
                {a.duration_secs ? (
                  <span className="text-[rgba(255,255,255,0.35)]">
                    {Math.round(a.duration_secs / 60)}m
                  </span>
                ) : null}
                <span className="ml-auto text-[rgba(255,255,255,0.3)]">{when(a.occurred_at)}</span>
              </div>

              {a.subject && (
                <p className="mt-1 text-xs text-white">{a.subject}</p>
              )}
              {a.body && (
                <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[rgba(255,255,255,0.5)]">
                  {a.body}
                </p>
              )}

              <p className="mt-1.5 text-[10px] text-[rgba(255,255,255,0.25)]">
                {a.actor ?? "system"}
                {a.source === "zoho" && " · imported from Zoho"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
