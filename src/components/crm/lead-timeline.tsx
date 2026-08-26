"use client";

// The lead's history, in one stream, grouped by day.
//
// This is what replaces scrolling a Zoho lead's Notes tab, so it deliberately shows every
// source: Zoho-imported notes sit alongside calls logged here, texts, emails, status
// changes, audits, and field edits.
//
// TWO TABLES, ONE STREAM. Activities come from lead_activities; field changes come from
// lead_field_history. They are merged here rather than in the database because inserting
// a field change into lead_activities would fire the trigger that bumps
// contacts.last_activity_at and reorders the worklist. One audit writing six fields is
// one touch, not six, and letting a scan shove the hunt queue around was the whole reason
// the two tables are separate. The reader should not have to know that, hence this merge.

import { useMemo, useState } from "react";
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
  Pencil,
  Search,
} from "lucide-react";

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

export interface TimelineFieldChange {
  id: string;
  field: string;
  old_value: string | null;
  new_value: string | null;
  origin: string;
  actor: string | null;
  occurred_at: string;
}

const TYPE_META: Record<string, { icon: typeof FileText; tone: string; label: string }> = {
  note: { icon: FileText, tone: "#9CA3AF", label: "Note" },
  call: { icon: Phone, tone: "#00C9A7", label: "Call" },
  email: { icon: Mail, tone: "#0E8C77", label: "Email" },
  sms: { icon: MessageSquare, tone: "#9C27B0", label: "Text" },
  meeting: { icon: CalendarClock, tone: "#F5A623", label: "Meeting" },
  status_change: { icon: ArrowRightLeft, tone: "#00BCD4", label: "Status" },
  task_created: { icon: CalendarClock, tone: "#F5A623", label: "Follow-up set" },
  task_completed: { icon: CheckCircle2, tone: "#4CAF50", label: "Follow-up done" },
  snooze: { icon: Moon, tone: "#6B7280", label: "Snoozed" },
  portal: { icon: Activity, tone: "#0E8C77", label: "Portal" },
  system: { icon: Activity, tone: "#6B7280", label: "System" },
  audit: { icon: Search, tone: "#00C9A7", label: "AI visibility audit" },
  field_change: { icon: Pencil, tone: "#8B93A7", label: "Field" },
};

function meta(type: string) {
  return TYPE_META[type] ?? { icon: Activity, tone: "#6B7280", label: type };
}

/** 'business_name' reads as 'Business name'. */
function fieldLabel(field: string): string {
  const s = field.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function dayHeading(iso: string): string {
  const d = new Date(iso);
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86400_000).toDateString();
  if (d.toDateString() === today) return "Today";
  if (d.toDateString() === yesterday) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
}

function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function byline(actor: string | null, origin: string | null, iso: string): string {
  const who = actor || (origin === "audit_engine" ? "audit engine" : "system");
  const date = new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `by ${who} · ${date}`;
}

type Row =
  | { kind: "activity"; at: string; filter: string; data: TimelineActivity }
  | { kind: "field"; at: string; filter: string; data: TimelineFieldChange };

const FILTERS = [
  { key: "all", label: "Everything" },
  { key: "note", label: "Notes" },
  { key: "call", label: "Calls" },
  { key: "email", label: "Email" },
  { key: "sms", label: "Texts" },
  { key: "status_change", label: "Status" },
  { key: "field_change", label: "Field changes" },
  { key: "audit", label: "Audits" },
];

export function LeadTimeline({
  activities,
  fieldChanges = [],
}: {
  activities: TimelineActivity[];
  fieldChanges?: TimelineFieldChange[];
}) {
  const [filter, setFilter] = useState("all");

  const rows = useMemo<Row[]>(() => {
    const merged: Row[] = [
      ...activities.map((a) => ({
        kind: "activity" as const,
        at: a.occurred_at,
        filter: a.activity_type,
        data: a,
      })),
      ...fieldChanges.map((f) => ({
        kind: "field" as const,
        at: f.occurred_at,
        filter: "field_change",
        data: f,
      })),
    ];
    return merged.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime());
  }, [activities, fieldChanges]);

  const visible = filter === "all" ? rows : rows.filter((r) => r.filter === filter);

  // Only offer a filter that would actually match something, so the control never
  // presents a dead end.
  const present = new Set(rows.map((r) => r.filter));
  const offered = FILTERS.filter((f) => f.key === "all" || present.has(f.key));

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-[rgba(255,255,255,0.07)] px-4 py-6 text-center text-xs text-[rgba(255,255,255,0.35)]">
        No activity yet.
      </p>
    );
  }

  // Group into day buckets, preserving the sorted order.
  const groups: Array<{ key: string; at: string; rows: Row[] }> = [];
  for (const r of visible) {
    const key = dayKey(r.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.rows.push(r);
    else groups.push({ key, at: r.at, rows: [r] });
  }

  return (
    <div>
      {offered.length > 2 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {offered.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={
                "rounded-full border px-3 py-1 text-[11px] " +
                (filter === f.key
                  ? "border-[#00C9A7] bg-[rgba(0,201,167,0.15)] text-white"
                  : "border-[rgba(255,255,255,0.12)] text-[rgba(255,255,255,0.5)] hover:text-white")
              }
            >
              {f.label}
            </button>
          ))}
        </div>
      )}

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[rgba(255,255,255,0.07)] px-4 py-6 text-center text-xs text-[rgba(255,255,255,0.35)]">
          Nothing of that kind yet.
        </p>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="mb-5">
            <p className="mb-2 inline-block rounded-md bg-[rgba(255,255,255,0.05)] px-2 py-1 text-[11px] text-[rgba(255,255,255,0.5)]">
              {dayHeading(g.at)}
            </p>

            <ol className="relative space-y-2.5 border-l border-[rgba(255,255,255,0.07)] pl-5">
              {g.rows.map((r) =>
                r.kind === "activity" ? (
                  <ActivityRow key={`a-${r.data.id}`} a={r.data} />
                ) : (
                  <FieldRow key={`f-${r.data.id}`} f={r.data} />
                )
              )}
            </ol>
          </div>
        ))
      )}
    </div>
  );
}

function Dot({ tone, Icon }: { tone: string; Icon: typeof FileText }) {
  return (
    <span
      className="absolute -left-[27px] top-1 flex h-4 w-4 items-center justify-center rounded-full"
      style={{ background: `${tone}33` }}
    >
      <Icon className="h-2.5 w-2.5" style={{ color: tone }} />
    </span>
  );
}

/** On a conversation row, who sent it is the first thing you need to know. */
const DIRECTIONAL = new Set(["email", "sms", "call"]);

function ActivityRow({ a }: { a: TimelineActivity }) {
  const m = meta(a.activity_type);
  const showDirection =
    DIRECTIONAL.has(a.activity_type) &&
    (a.direction === "inbound" || a.direction === "outbound");
  return (
    <li className="relative">
      <Dot tone={m.tone} Icon={m.icon} />
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span style={{ color: m.tone }}>{m.label}</span>
          {showDirection && (
            <span
              className="rounded px-1 text-[10px]"
              style={{
                background:
                  a.direction === "inbound"
                    ? "rgba(76,175,80,0.15)"
                    : "rgba(255,255,255,0.07)",
                color:
                  a.direction === "inbound" ? "#4CAF50" : "rgba(255,255,255,0.5)",
              }}
            >
              {a.direction === "inbound" ? "in" : "out"}
            </span>
          )}
          {a.outcome && <span className="text-[rgba(255,255,255,0.5)]">{a.outcome}</span>}
          {a.duration_secs ? (
            <span className="text-[rgba(255,255,255,0.35)]">
              {Math.round(a.duration_secs / 60)}m
            </span>
          ) : null}
          <span className="ml-auto text-[rgba(255,255,255,0.3)]">{clockTime(a.occurred_at)}</span>
        </div>

        {a.subject && <p className="mt-1 text-xs text-white">{a.subject}</p>}
        {a.body && (
          <p className="mt-1 whitespace-pre-wrap text-[11px] leading-relaxed text-[rgba(255,255,255,0.5)]">
            {a.body}
          </p>
        )}

        <p className="mt-1.5 text-[10px] text-[rgba(255,255,255,0.25)]">
          {byline(a.actor, null, a.occurred_at)}
          {a.source === "zoho" && " · imported from Zoho"}
        </p>
      </div>
    </li>
  );
}

/** "Industry was updated from empty to HVAC", the way Zoho words it. */
function FieldRow({ f }: { f: TimelineFieldChange }) {
  const m = meta("field_change");
  return (
    <li className="relative">
      <Dot tone={m.tone} Icon={m.icon} />
      <div className="rounded-lg border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.02)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <span style={{ color: m.tone }}>{m.label}</span>
          <span className="ml-auto text-[rgba(255,255,255,0.3)]">{clockTime(f.occurred_at)}</span>
        </div>

        <p className="mt-1 text-xs text-[rgba(255,255,255,0.75)]">
          <span className="text-white">{fieldLabel(f.field)}</span> was updated from{" "}
          {f.old_value ? (
            <span className="font-medium text-white">{f.old_value}</span>
          ) : (
            <span className="italic text-[rgba(255,255,255,0.4)]">empty</span>
          )}{" "}
          to{" "}
          {f.new_value ? (
            <span className="font-medium text-white">{f.new_value}</span>
          ) : (
            <span className="italic text-[rgba(255,255,255,0.4)]">empty</span>
          )}
        </p>

        <p className="mt-1.5 text-[10px] text-[rgba(255,255,255,0.25)]">
          {byline(f.actor, f.origin, f.occurred_at)}
        </p>
      </div>
    </li>
  );
}
