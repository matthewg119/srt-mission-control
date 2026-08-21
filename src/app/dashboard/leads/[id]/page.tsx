import Link from "next/link";
import { notFound } from "next/navigation";
import { supabaseAdmin } from "@/lib/db";
import { formatDueDate } from "@/lib/task-feed";
import { slackThreadLink } from "@/lib/slack-bot";
import { RUN_IN_FLIGHT_MINUTES } from "@/lib/audit-engine/run-audit-pipeline";
import { STAGE_PIPELINES, cadenceFor } from "@/config/stage-display";
import { formatRelativeTime } from "@/lib/utils";
import {
  LeadTimeline,
  type TimelineActivity,
  type TimelineFieldChange,
} from "@/components/crm/lead-timeline";
import { LeadLogCard } from "@/components/crm/lead-log-card";
import { LeadFieldPanels } from "@/components/crm/lead-field-panels";
import { CommsSync } from "@/components/crm/comms-sync";
import { LeadStatusPicker } from "@/components/crm/status-picker";
import { HuntNav } from "@/components/crm/hunt-nav";
import { LeadWorkflows } from "@/components/crm/lead-workflows";
import { pickLeadPanelValues } from "@/config/lead-fields";

export const dynamic = "force-dynamic";

// Everything about one lead, on one screen: identity + business + financials,
// the full timeline, and the follow-up state. This is the page that has to be
// good enough that nobody opens Zoho.

const ALL_STAGES = STAGE_PIPELINES.flatMap((p) => p.stages);

interface Task {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  priority: string;
}

function stageColor(stage: string | null): string {
  return ALL_STAGES.find((s) => s.name === stage)?.color ?? "#9CA3AF";
}

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number") return v.toLocaleString();
  return String(v);
}

// The panels themselves now live in src/config/lead-fields.ts, because the
// client island that edits them needs the same list and the same per-field
// input kinds. See that file for why a plain [column, label] tuple was not
// enough once the values became editable.

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [leadRes, tasksRes, activityRes, fieldRes, auditRes, runningRes] = await Promise.all([
    supabaseAdmin.from("contacts").select("*").eq("id", id).maybeSingle(),
    supabaseAdmin
      .from("lead_tasks")
      .select("id, title, due_at, status, priority")
      .eq("contact_id", id)
      .eq("status", "open")
      .order("due_at", { ascending: true, nullsFirst: false }),
    supabaseAdmin
      .from("lead_activities")
      .select(
        "id, activity_type, direction, channel, subject, body, outcome, duration_secs, occurred_at, actor, source"
      )
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(200),
    supabaseAdmin
      .from("lead_field_history")
      .select("id, field, old_value, new_value, origin, actor, occurred_at")
      .eq("contact_id", id)
      .order("occurred_at", { ascending: false })
      .limit(200),
    // Newest finished audit for this lead. Only reports that were linked to a contact
    // appear here: a cold /audit from Slack has no contact_id and no lead to attach to.
    supabaseAdmin
      .from("audit_reports")
      .select(
        "id, slug, score, city, business_type, vertical_slug, competitors, created_at, slack_channel_id, slack_thread_ts"
      )
      .eq("contact_id", id)
      .eq("status", "done")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    // Whether a run is in flight, asked SEPARATELY from the query above rather than by
    // dropping its status filter. Folding them would let a run that failed this morning
    // hide a perfectly good report from last week, which is the card that says why to
    // call this lead at all.
    supabaseAdmin
      .from("audit_reports")
      .select("id, created_at")
      .eq("contact_id", id)
      .in("status", ["classifying", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!leadRes.data) notFound();

  const lead = leadRes.data as Record<string, unknown>;
  const tasks = (tasksRes.data ?? []) as unknown as Task[];
  const activities = (activityRes.data ?? []) as unknown as TimelineActivity[];
  const fieldChanges = (fieldRes.data ?? []) as unknown as TimelineFieldChange[];
  const audit = auditRes.data as Record<string, unknown> | null;
  // Anything older than the window is a run that died without ever reaching `done`, and
  // the watchdog only sweeps once a day. Treating it as live would leave the audit
  // button disabled until tomorrow morning. Same constant the route refuses on.
  const running = runningRes.data as { created_at: string } | null;
  const auditRunning =
    !!running &&
    Date.now() - new Date(running.created_at).getTime() < RUN_IN_FLIGHT_MINUTES * 60_000;
  const auditThreadUrl =
    audit && typeof audit.slack_channel_id === "string" && typeof audit.slack_thread_ts === "string"
      ? slackThreadLink(audit.slack_channel_id, audit.slack_thread_ts)
      : null;

  const status = (lead.application_stage as string | null) ?? null;
  const displayName =
    [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim() ||
    (lead.business_name as string) ||
    "Unknown lead";

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/dashboard/leads"
            className="text-[11px] text-[rgba(255,255,255,0.35)] hover:text-white"
          >
            ← Leads
          </Link>
          <h1 className="mt-1 text-xl font-medium text-white">{displayName}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <span
              className="rounded-md px-1.5 py-0.5"
              style={{ background: `${stageColor(status)}22`, color: stageColor(status) }}
            >
              {status ?? "no status"}
            </span>
            <span className="text-[rgba(255,255,255,0.4)]">
              last touch{" "}
              {lead.last_activity_at
                ? formatRelativeTime(lead.last_activity_at as string)
                : "never"}
            </span>
            {tasks.length === 0 && !lead.do_not_contact && (
              <span className="text-[#9C27B0]">no follow-up scheduled</span>
            )}
            {/* The flag, not the stage, is what actually silences the outreach —
                so it is what the header says. A lead can carry it from an opt-out
                reply without ever having been put on the take-off list. */}
            {!!lead.do_not_contact && (
              <span className="rounded-md bg-[rgba(192,57,43,0.18)] px-1.5 py-0.5 text-[#E74C3C]">
                do not contact
                {lead.do_not_contact_reason
                  ? ` — ${String(lead.do_not_contact_reason)}`
                  : ""}
              </span>
            )}
          </div>
        </div>

        {/* Zoho is being retired, so its link is gone. This slot is now for working
            through a list one lead at a time. Renders nothing unless you arrived from
            one of the list pages. */}
        <HuntNav currentId={id} />
      </div>

      <div className="grid gap-5 lg:grid-cols-[300px_1fr_280px]">
        {/* Left — the record */}
        <div className="space-y-4">
          {/* What the AI visibility audit found. First card, because it is the reason
              to call: it is the only thing here that says what is wrong today. */}
          {audit && (
            <div className="rounded-xl border border-[rgba(0,201,167,0.25)] bg-[rgba(0,201,167,0.05)] p-3">
              <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
                AI visibility
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-medium text-[#00C9A7]">
                  {(audit.score as number | null) ?? "—"}
                </span>
                <span className="text-[11px] text-[rgba(255,255,255,0.4)]">out of 100</span>
              </div>
              <dl className="mt-2 space-y-1.5">
                {[
                  ["Read as", audit.business_type],
                  ["City", audit.city],
                  [
                    "Competitors",
                    Array.isArray(audit.competitors)
                      ? (audit.competitors as string[]).slice(0, 3).join(", ")
                      : null,
                  ],
                  ["Scanned", new Date(audit.created_at as string).toLocaleDateString()],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex justify-between gap-3 text-[11px]">
                    <dt className="shrink-0 text-[rgba(255,255,255,0.35)]">{label as string}</dt>
                    <dd className="truncate text-right text-[rgba(255,255,255,0.75)]">
                      {fmt(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {typeof audit.slug === "string" && (
                <Link
                  href={`/r/${audit.slug}`}
                  target="_blank"
                  className="mt-2.5 block rounded-lg border border-[rgba(0,201,167,0.3)] py-1.5 text-center text-[11px] text-[#00C9A7] hover:bg-[rgba(0,201,167,0.1)]"
                >
                  Open the report
                </Link>
              )}
            </div>
          )}

          {/* Click any value to edit it. Only the panel columns are handed to the
              client — the page selects *, which includes ssn_full, and passing the
              whole row would serialize it into the HTML payload. */}
          <LeadFieldPanels contactId={id} values={pickLeadPanelValues(lead)} />
        </div>

        {/* Centre — log a call, then the history */}
        <div className="space-y-4">
          <LeadLogCard
            contactId={id}
            leadName={displayName}
            defaultFollowUpDays={cadenceFor(status).repeatDays}
          />
          <div>
            <p className="mb-3 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
              History · {activities.length}
            </p>
            {/* Mirrors Outlook + sms_messages onto the timeline after first paint,
                so the record and the call form never wait on a mailbox. */}
            <CommsSync contactId={id} />
            <LeadTimeline activities={activities} fieldChanges={fieldChanges} />
          </div>
        </div>

        {/* Right — status and follow-ups */}
        <div className="space-y-4">
          <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-3">
            <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
              Status
            </p>
            <LeadStatusPicker contactId={id} current={status} />
          </div>

          <div className="rounded-xl border border-[rgba(255,255,255,0.07)] bg-[rgba(255,255,255,0.02)] p-3">
            <p className="mb-2 text-[10px] uppercase tracking-widest text-[rgba(255,255,255,0.3)]">
              Open follow-ups
            </p>
            {tasks.length === 0 ? (
              <p className="text-[11px] text-[#9C27B0]">
                Nothing scheduled — this lead shows on the call board.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {tasks.map((t) => (
                  <li key={t.id} className="text-[11px]">
                    <span className="text-white">{t.title}</span>
                    <span className="ml-1.5 text-[rgba(255,255,255,0.35)]">
                      {formatDueDate(t.due_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <LeadWorkflows
            contactId={id}
            hasWebsite={!!(lead.website as string | null)}
            hasBusinessName={!!(lead.business_name as string | null)?.trim()}
            hasAudit={!!audit}
            auditRunning={auditRunning}
            threadUrl={auditThreadUrl}
          />

          <Link
            href={`/dashboard/assistant?q=${encodeURIComponent(`Tell me about ${displayName}`)}`}
            className="block rounded-xl border border-[rgba(255,255,255,0.07)] px-3 py-2 text-center text-[11px] text-[rgba(255,255,255,0.5)] hover:text-white"
          >
            Ask Vektor about this lead
          </Link>
        </div>
      </div>
    </div>
  );
}
