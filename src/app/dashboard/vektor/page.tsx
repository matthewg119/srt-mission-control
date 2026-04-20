"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type NodeKind = "input" | "brain" | "action" | "output" | "monitor";

interface SystemNode {
  id: string;
  title: string;
  subtitle: string;
  kind: NodeKind;
  files: string[];
  description: string;
  livePath?: string;
}

const NODES: SystemNode[] = [
  {
    id: "zoho",
    title: "Zoho CRM",
    subtitle: "Deal stage + tags (source of truth)",
    kind: "input",
    files: ["src/lib/zoho.ts"],
    description: "Zoho is the system of record for leads, deals, notes, and pipeline stage. VeKtor reads state from Zoho (via the OAuth refresh token flow) and writes updates back when approved. Custom MCA fields live on the Lead record.",
  },
  {
    id: "supabase",
    title: "Supabase",
    subtitle: "Vektor's working memory",
    kind: "input",
    files: ["src/lib/db.ts", "docs/2026-04-18-ai-intelligence-layer.sql"],
    description: "Fast cache + audit log. Tables: ai_decisions, fine_tune_examples, pending_slack_actions, deal_submissions, contacts, deals, email_sequences. Vektor reads here for latency, reconciles back to Zoho.",
  },
  {
    id: "ms_graph",
    title: "MS Graph Webhook",
    subtitle: "Inbound funder emails",
    kind: "input",
    files: ["src/app/api/agent/submissions/route.ts", "src/lib/microsoft.ts"],
    description: "Microsoft Graph change-notification subscription on submissions@srtagency.com. Every new email fires the webhook; VeKtor reads it, classifies intent (approved / declined / stips / missing_fields / counter), matches to a merchant.",
    livePath: "/api/agent/submissions",
  },
  {
    id: "ringcentral",
    title: "RingCentral",
    subtitle: "Call activity + speed-to-lead",
    kind: "input",
    files: ["src/lib/ringcentral.ts", "src/lib/speed-to-lead.ts"],
    description: "Instant RingOut callback when new leads arrive with phones. Call outcomes logged to call_log. VeKtor reads last call outcome when classifying merchant state.",
  },
  {
    id: "zoho_webhook",
    title: "Zoho Webhook",
    subtitle: "Stage change events",
    kind: "input",
    files: ["src/app/api/webhooks/zoho-lead/route.ts"],
    description: "Zoho pushes events when stages change. Triggers Meta CAPI Purchase/DealDeclined firing (only for ad-attributed contacts).",
  },
  {
    id: "vektor_brain",
    title: "VeKtor Brain",
    subtitle: "Claude — classifies state + routes",
    kind: "brain",
    files: [
      "src/lib/claude-calls.ts",
      "src/lib/ai-intel/guardian.ts",
      "src/lib/ai-intel/inbound-classifier.ts",
      "src/lib/ai-intel/deal-submission-builder.ts",
      "src/lib/ai-intel/bank-statement-analyzer.ts",
    ],
    description: "The brain. Uses Claude Opus 4.7 for deal drafts + presentation options, Sonnet 4.6 for merchant classification, Haiku 4.5 for cheap triage. Every call logged to ai_decisions with reasoning + token counts.",
  },
  {
    id: "guardian_cron",
    title: "Guardian Cron",
    subtitle: "Every 4h — classify active deals",
    kind: "brain",
    files: ["src/app/api/cron/ai-guardian/route.ts", "src/lib/ai-intel/guardian.ts"],
    description: "Loops every active contact, checks stage + days-since-touch + sequences + last call outcome, asks Claude to classify state + recommend action.",
    livePath: "/api/cron/ai-guardian?dry_run=1&limit=5",
  },
  {
    id: "suppress",
    title: "Suppress Sequences",
    subtitle: "Funded · Declined · Dead",
    kind: "action",
    files: ["src/lib/ai-intel/guardian.ts", "src/lib/sequence-engine.ts"],
    description: "When VeKtor classifies a merchant as funded/declined/dead, it cancels all active sequence_enrollments immediately. No more drip emails to closed deals.",
  },
  {
    id: "draft",
    title: "Draft Queue",
    subtitle: "One-click send or edit",
    kind: "action",
    files: ["src/lib/ai-intel/slack-approval.ts", "src/app/api/slack/actions/route.ts"],
    description: "Drafts posted to Slack as pending_slack_actions rows. 👍 sends immediately. ✏️ opens modal for edits. 🚫 cancels. Edits get saved to fine_tune_examples for future model training.",
    livePath: "/dashboard/email-queue",
  },
  {
    id: "alert",
    title: "Alert Rep",
    subtitle: "Slack follow-up nudge",
    kind: "action",
    files: ["src/app/api/cron/submission-followups/route.ts", "src/lib/slack-bot.ts"],
    description: "Underwriting stale 72h+, approved silent 48h+, lender silent 24h+ → Slack nudge to the right channel for manual follow-up.",
  },
  {
    id: "submission",
    title: "Submission Builder",
    subtitle: "Package + route + send",
    kind: "action",
    files: ["src/lib/ai-intel/deal-submission-builder.ts"],
    description: "`/srt submit [merchant]` — Opus 4.7 drafts the email in SRT format, regenerates the application PDF, creates the OneDrive folder, and posts for approval. 👍 sends via MS Graph from submissions@srtagency.com.",
  },
  {
    id: "meta",
    title: "Meta CAPI",
    subtitle: "Purchase / DealDeclined",
    kind: "action",
    files: ["src/lib/ai-intel/meta-events.ts", "src/lib/meta-capi.ts"],
    description: "Fires Meta events on deal stage transitions — but only for contacts with _fbc (ad-attributed). WhatsApp / cold call / organic leads never fire Meta events.",
  },
  {
    id: "bank_analyzer",
    title: "Bank Statement Analyzer",
    subtitle: "Lender-ready underwriting report",
    kind: "action",
    files: ["src/lib/ai-intel/bank-statement-analyzer.ts", "src/app/api/agent/bank-statements/route.ts"],
    description: "When bank statement PDFs hit OneDrive, Opus 4.7 vision extracts every transaction and produces a 10-section lender report: monthly breakdown, MCA positions, deposit spikes, red flags, qualification snapshot. Posted to Slack #vektor-deals-matt.",
    livePath: "/api/agent/bank-statements",
  },
  {
    id: "decisions_dash",
    title: "AI Decisions",
    subtitle: "Full audit trail",
    kind: "monitor",
    files: ["src/app/dashboard/ai-decisions/page.tsx"],
    description: "Every VeKtor evaluation — merchant, state, action, reasoning, model, latency, approved_by.",
    livePath: "/dashboard/ai-decisions",
  },
  {
    id: "submissions_dash",
    title: "Deal Submissions",
    subtitle: "Per-lender tracking + red rows",
    kind: "monitor",
    files: ["src/app/dashboard/deal-submissions/page.tsx"],
    description: "Every lender submission, status, hours-since-response. Rows go red after 24h of silence.",
    livePath: "/dashboard/deal-submissions",
  },
  {
    id: "email_dash",
    title: "Email Queue",
    subtitle: "Pending + upcoming sends",
    kind: "monitor",
    files: ["src/app/dashboard/email-queue/page.tsx"],
    description: "Pending AI-drafted emails awaiting approval + sequence drips due in next 24h.",
    livePath: "/dashboard/email-queue",
  },
  {
    id: "lenders_dash",
    title: "Lenders",
    subtitle: "Tier + criteria + avg response time",
    kind: "monitor",
    files: ["src/app/dashboard/lenders/page.tsx"],
    description: "Lender database with tier, min credit, submission email, rate sheet scanner.",
    livePath: "/dashboard/lenders",
  },
];

const KIND_STYLE: Record<NodeKind, { bg: string; border: string; text: string; icon: string }> = {
  input: { bg: "rgba(27,101,167,0.12)", border: "rgba(27,101,167,0.4)", text: "#1B65A7", icon: "📥" },
  brain: { bg: "rgba(232,121,43,0.15)", border: "rgba(232,121,43,0.5)", text: "#E8792B", icon: "🧠" },
  action: { bg: "rgba(0,201,167,0.12)", border: "rgba(0,201,167,0.4)", text: "#00C9A7", icon: "⚡" },
  output: { bg: "rgba(139,92,246,0.12)", border: "rgba(139,92,246,0.4)", text: "#8b5cf6", icon: "📤" },
  monitor: { bg: "rgba(245,166,35,0.12)", border: "rgba(245,166,35,0.4)", text: "#F5A623", icon: "📊" },
};

const SECTION_ORDER: Array<{ kind: NodeKind; label: string }> = [
  { kind: "input", label: "Inputs — where signals come from" },
  { kind: "brain", label: "VeKtor Brain — decides what to do" },
  { kind: "action", label: "Actions — what Vektor does (after 👍)" },
  { kind: "monitor", label: "Monitors — where you watch it all" },
];

export default function VektorArchitecturePage() {
  const [selected, setSelected] = useState<SystemNode | null>(null);
  const [stats, setStats] = useState<{ ai_decisions: number; pending: number; submissions: number } | null>(null);
  const [imageOk, setImageOk] = useState(true);

  useEffect(() => {
    fetch("/api/vektor/stats")
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => setStats(null));
  }, []);

  const byKind = SECTION_ORDER.map(({ kind, label }) => ({
    kind,
    label,
    nodes: NODES.filter((n) => n.kind === kind),
  }));

  return (
    <div>
      <div className="flex items-center gap-4 mb-8">
        <div className="h-14 w-14 rounded-xl bg-[rgba(232,121,43,0.15)] border border-[rgba(232,121,43,0.4)] flex items-center justify-center overflow-hidden">
          {imageOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/vektor.png" alt="VeKtor" width={48} height={48} className="object-contain" onError={() => setImageOk(false)} />
          ) : (
            <span className="text-3xl">🦈</span>
          )}
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">VeKtor</h1>
          <p className="text-sm text-[rgba(255,255,255,0.5)]">SRT Agency's AI Intelligence Layer — live architecture</p>
        </div>
        {stats && (
          <div className="ml-auto flex gap-4 text-xs">
            <div className="text-right">
              <div className="text-white font-semibold">{stats.ai_decisions}</div>
              <div className="text-[rgba(255,255,255,0.4)]">AI decisions</div>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{stats.pending}</div>
              <div className="text-[rgba(255,255,255,0.4)]">Pending approvals</div>
            </div>
            <div className="text-right">
              <div className="text-white font-semibold">{stats.submissions}</div>
              <div className="text-[rgba(255,255,255,0.4)]">Submissions tracked</div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-6">
        <div className="space-y-8">
          {byKind.map(({ kind, label, nodes }) => {
            const style = KIND_STYLE[kind];
            return (
              <div key={kind}>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.5)] mb-3 flex items-center gap-2">
                  <span>{style.icon}</span>
                  {label}
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                  {nodes.map((n) => (
                    <button
                      key={n.id}
                      onClick={() => setSelected(n)}
                      className={`text-left rounded-xl border p-4 transition-colors hover:opacity-100 ${selected?.id === n.id ? "opacity-100 ring-2" : "opacity-90 hover:opacity-100"}`}
                      style={{
                        backgroundColor: style.bg,
                        borderColor: style.border,
                      }}
                    >
                      <div className="text-sm font-semibold text-white mb-1">{n.title}</div>
                      <div className="text-[11px]" style={{ color: style.text }}>{n.subtitle}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="lg:sticky lg:top-6 h-fit">
          <div className="bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl p-5">
            {selected ? (
              <>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-lg">{KIND_STYLE[selected.kind].icon}</span>
                  <h3 className="text-base font-semibold text-white">{selected.title}</h3>
                </div>
                <p className="text-xs mb-4" style={{ color: KIND_STYLE[selected.kind].text }}>{selected.subtitle}</p>
                <p className="text-sm text-[rgba(255,255,255,0.7)] leading-relaxed mb-4">{selected.description}</p>

                <div className="mb-3">
                  <div className="text-[10px] uppercase tracking-wider text-[rgba(255,255,255,0.4)] mb-1">Source files</div>
                  <div className="space-y-1">
                    {selected.files.map((f) => (
                      <code key={f} className="block text-[11px] text-[rgba(255,255,255,0.6)] bg-[rgba(0,0,0,0.25)] px-2 py-1 rounded">{f}</code>
                    ))}
                  </div>
                </div>

                {selected.livePath && (
                  <Link href={selected.livePath} className="inline-flex items-center gap-1 text-xs text-[#00C9A7] hover:underline">
                    Open live →
                  </Link>
                )}
              </>
            ) : (
              <div className="text-center py-8">
                <div className="text-4xl mb-2">🦈</div>
                <p className="text-sm text-[rgba(255,255,255,0.5)]">Click any node to see what it does.</p>
                <p className="text-xs text-[rgba(255,255,255,0.3)] mt-4">This page is the live atlas of VeKtor. Every tile links to a real file you can read.</p>
              </div>
            )}
          </div>

          <div className="mt-4 bg-[rgba(255,255,255,0.03)] border border-[rgba(255,255,255,0.08)] rounded-xl p-4">
            <div className="text-xs uppercase tracking-wider text-[rgba(255,255,255,0.4)] mb-2">Slack channels VeKtor uses</div>
            <ul className="text-xs text-[rgba(255,255,255,0.6)] space-y-1">
              <li><code className="text-[#E8792B]">#Vektor</code> — everything flows through here</li>
              <li><code className="text-[#E8792B]">#Vektor-deals-Matt</code> — submissions, approvals, bank reports</li>
              <li><code className="text-[#E8792B]">#Vektor-WorkingLeads-Matt</code> — merchant state + inbound emails</li>
              <li><code className="text-[#E8792B]">#Vektor-renewals-Matt</code> — funded deals due for renewal</li>
              <li><code className="text-[#E8792B]">#Vektor-Matt</code> — DM for $50k+ approvals</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
