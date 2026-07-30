// Shared row shapes for the audit_reports / audit_runs tables
// (docs/2026-07-22-audit-engine-v2.sql). Kept separate from classify.ts /
// site-research.ts so API routes and UI components can import just the shapes.

import type { AuditBlock, AuditPrompt, LikelyCompetitor } from "./classify";

export type AuditReportStatus = "classifying" | "awaiting_city" | "running" | "done" | "failed";
export type AuditEngine = "openai" | "perplexity";
export type AuditRunStatus = "pending" | "ok" | "no_data";

/** Cold-outreach stage for a finished report's Slack thread. `awaiting_intake` = the intake
 *  card is posted and the next free-text reply is its answers; `drafted` = a draft is queued
 *  and free text is an edit to it; `revealed` = everything has been handed over, so free text
 *  is the prospect talking. See thread-assistant.ts. */
export type OutreachStage = "awaiting_intake" | "drafted" | "revealed";

export interface AuditReportRow {
  id: string;
  slug: string;
  client_name: string | null;
  website: string;
  city: string | null;
  business_type: string | null;
  vertical_slug: string | null;
  buyer_persona: string | null;
  competitors: LikelyCompetitor[];
  prompts: AuditPrompt[];
  status: AuditReportStatus;
  score: number | null;
  requested_by: string | null;
  requester_name: string | null;
  requester_email: string | null;
  requester_phone: string | null;
  /** contacts.id when the report came from a public lead, so finishReport can
   *  reply inside that lead's #hot-leads thread instead of posting standalone. */
  contact_id: string | null;
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
  // The last set of 3 choose-from email options posted to the thread; a "1/2/3" reply turns
  // the chosen one into an Outlook draft. Shape mirrors EmailOption in email-assistant.ts
  // (kept inline here to avoid a type import cycle).
  pending_drafts: Array<{ label: string; subject: string; body: string }> | null;
  // ── Cold-outreach state (docs/2026-07-29-audit-outreach-intake.sql) ──
  // Where this thread is in the pre-pitch -> reveal flow. Null on public
  // form-fill leads, which skip the intake entirely.
  outreach_stage: OutreachStage | null;
  /** The intake questions actually asked. Mirrors IntakeQuestion in outreach-intake.ts. */
  intake_questions: Array<{ n: number; ask: string; source: "fixed" | "audit" }> | null;
  /** Matthew's reply to them, verbatim. Read as prose by every later drafter. */
  intake_answers: string | null;
  /** The human being written to. A cold /audit run has no contact row. */
  prospect_name: string | null;
  prospect_email: string | null;
  /** Reveal-only assets: withheld from every permission-stage email by design. */
  redesign_url: string | null;
  loom_url: string | null;
  /** The "one thing on your site working against you" hook (site-signals.ts). */
  site_signals: Array<{ kind: string; detail: string }> | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRunRow {
  id: string;
  report_id: string;
  block: AuditBlock;
  prompt: string;
  engine: AuditEngine;
  mentioned: boolean | null;
  status: AuditRunStatus;
  raw_response: string | null;
  citations: string[];
  recommended: string[];
  attempt: number;
  latency_ms: number | null;
  error: string | null;
  created_at: string;
}

export const TOTAL_PROMPTS = 20;
export const BATCH_SIZE = 4;
export const TOTAL_BATCHES = Math.ceil(TOTAL_PROMPTS / BATCH_SIZE);
