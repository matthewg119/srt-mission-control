// Shared row shapes for the audit_reports / audit_runs tables
// (docs/2026-07-22-audit-engine-v2.sql). Kept separate from classify.ts /
// site-research.ts so API routes and UI components can import just the shapes.

import type { AuditBlock, AuditPrompt, LikelyCompetitor } from "./classify";
// Type-only, and robots-check.ts imports nothing, so this cannot create a cycle.
import type { RobotsFinding } from "./robots-check";

export type AuditReportStatus = "classifying" | "awaiting_city" | "running" | "done" | "failed";
/** The engines a NEW run may use. Perplexity was dropped on 2026-08-05: its key had been
 *  rejected since the engine shipped on 2026-07-23, so it never once returned data and every
 *  scorecard printed a dead "Perplexity: no data" column that also dragged the score down. */
export type AuditEngine = "openai";
/** What the `audit_runs.engine` COLUMN can hold. Rows written before 2026-08-05 still say
 *  "perplexity", so anything reading history must widen to this, not to AuditEngine. */
export type AuditRunEngine = AuditEngine | "perplexity";
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
  // `replyToMessageId` turns the "1" picker into a Graph createReply instead of a fresh message,
  // so the delivery email lands on the thread that started the conversation. `attachScorecard`
  // regenerates the PDF at draft time rather than storing a copy on the row.
  pending_drafts: Array<{
    label: string;
    subject: string;
    body: string;
    replyToMessageId?: string;
    attachScorecard?: boolean;
  }> | null;
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
   * Call notes pasted into the audit thread, verbatim (docs/2026-08-16-audit-call-notes.sql).
   *
   * The post-call email is written from these, and they OUTRANK the niche avatar set when the two
   * disagree, on the same reasoning as intake_answers: what the owner said on the phone beats what
   * the buyer-question analysis inferred about him. Kept raw and never parsed into fields.
   */
  call_notes: string | null;
  call_notes_at: string | null;
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
    /**
     * The audit-derived stand-in, used when the niche set could not be built.
     *
     * Stored rather than re-derived so the picture step, the script and a later `script` all
     * describe the same customer. There is no index because there was no menu to pick from.
     */
    derivedAvatar?: { label: string; ticket: string; whyHighRoi: string; aiQuestion: string };
    /** The six image ideas as they were offered, so a "4" later knows what 4 meant. */
    ideas?: Array<{ preset: string; label: string; line: string }>;
    /** Per-recording overrides from `loom $499` / `loom $299/mo, 45 days`. */
    price?: string;
    window?: string;
    /**
     * The name read on camera, from `loom Fran`. Overrides prospect_name.
     *
     * Stored so a later bare `script` rebuild greets the same person. A cold /audit run has no
     * contact row, so this is often the only place the owner's name exists.
     */
    greetName?: string;
  } | null;
  /**
   * Cached read of the real Outlook conversation (docs/2026-08-11-call-coach-sessions.sql).
   *
   * Shape is ThreadTruth in thread-truth.ts, deliberately typed loosely here so types.ts does not
   * import from a module that imports Graph. `thread_truth_at` older than 10 minutes is ignored.
   */
  thread_truth: unknown | null;
  thread_truth_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface AuditRunRow {
  id: string;
  report_id: string;
  block: AuditBlock;
  prompt: string;
  engine: AuditRunEngine;
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
/** One audit_runs row per prompt per engine. Was 2 until Perplexity was dropped. Anything
 *  deriving "how many rows should exist" (the watchdog's resume arithmetic) must use this
 *  rather than a literal, or a complete run reads as permanently incomplete. */
export const ENGINES_PER_PROMPT = 1;
