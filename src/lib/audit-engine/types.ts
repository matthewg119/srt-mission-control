// Shared row shapes for the audit_reports / audit_runs tables
// (docs/2026-07-22-audit-engine-v2.sql). Kept separate from classify.ts /
// site-research.ts so API routes and UI components can import just the shapes.

import type { AuditBlock, AuditPrompt, LikelyCompetitor } from "./classify";
// Type-only, and robots-check.ts imports nothing, so this cannot create a cycle.
import type { RobotsFinding } from "./robots-check";

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
  /** Which public funnel produced this lead ("audit" | "pdf" | "contact"), null for cold
   *  /audit runs. finishReport runs in a different request and only sees this row, so the
   *  funnel has to be persisted here rather than passed through in memory. */
  lead_source: string | null;
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
  // ── Pitch v2 (docs/2026-08-03-pitch-v2.sql) ──
  /** Which AI crawlers robots.txt blocks. Same tri-state contract as site_signals: null = the
   *  check never ran and NO claim may be made, [] = ran and clean, non-empty = findings.
   *  Shape mirrors RobotsFinding in robots-check.ts. */
  robots_check: RobotsFinding[] | null;
  /** Beliefs installed in this thread + the options last offered. Shape: SeedLedger in
   *  seed-ledger.ts. Null on any report written before seeding existed. */
  seed_ledger: { installed: Array<{ belief: string; stage: string; line: string; at: string }>; offered: Array<{ belief: string; label: string; line: string }> } | null;
  /** "en" | "es" — the language of the CALL, which is the language the drafts are written in.
   *  Null means nobody has said, and the drafter asks in-thread rather than guessing. */
  call_language: string | null;
  /** Google Business Profile stats, used only to choose B1 vs B4. Null when unknown. */
  gbp_rating: number | null;
  gbp_reviews: number | null;
  /** The Loom transcript, pasted in-thread after recording. The delivery email is REFUSED until
   *  this exists, so its two timestamps are read off what was actually said. */
  loom_transcript: string | null;
  /**
   * The pending step of the `loom` wizard (docs/2026-08-04-audit-loom-state.sql).
   *
   * This is what decides whether a bare "2" in the thread means "avatar 2" or "email option 2".
   * Null means no menu is pending, which is what every row written before the wizard existed
   * means, and why a bare digit keeps creating the Outlook draft on an old thread.
   */
  loom_state: {
    /** "done" keeps avatarIndex around for `script` while releasing the digits back to email. */
    stage: "avatar" | "image" | "done";
    /** 1-based index into NicheAvatars.best. Set once the avatar is picked. */
    avatarIndex?: number;
    /** The six image ideas as they were offered, so a "4" later knows what 4 meant. */
    ideas?: Array<{ preset: string; label: string; line: string }>;
    /** Per-recording overrides from `loom $499` / `loom $299/mo, 45 days`. */
    price?: string;
    window?: string;
  } | null;
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
