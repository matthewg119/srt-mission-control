// Shared row shapes for the audit_reports / audit_runs tables
// (docs/2026-07-22-audit-engine-v2.sql). Kept separate from classify.ts /
// site-research.ts so API routes and UI components can import just the shapes.

import type { AuditBlock, AuditPrompt, LikelyCompetitor } from "./classify";
// Type-only, and robots-check.ts imports nothing, so this cannot create a cycle.
import type { RobotsFinding } from "./robots-check";
// Type-only import of the fetcher's failure enum: one vocabulary for "why could we not read
// this page", shared by the thing that observes it and the row that stores it.
import type { FetchFailReason } from "@/lib/medspa-owner-scrape";

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

/** Where the research that produced the 20 questions came from. See AuditReportRow.research_source.
 *
 *  ‼️ "search" and "declared" are NOT interchangeable. "search" means a site exists and we could
 *  not read it, which is a fact about their crawler setup. "declared" means there is no site at
 *  all, because Matthew ran `/audit "Business Name" | City, ST` against a business that has only
 *  a Google Business Profile. Telling a business with no website that its website is blocking
 *  crawlers is the exact failure this split prevents. */
export type ResearchSource = "site" | "search" | "site+search" | "declared";

/** What the fetcher observed. Persisted verbatim so a later reader can tell "they blocked us"
 *  from "we gave up after 20 seconds" — the distinction the old single null threw away. */
export interface CrawlBlock {
  reason: FetchFailReason;
  status: number | null;
  detail: string;
  checked_at: string;
  /** null until the run finishes. See the doc on AuditReportRow.crawl_block. */
  engines_cited_site: boolean | null;
}

export interface AuditReportRow {
  id: string;
  slug: string;
  client_name: string | null;
  /** NULL on a name-mode run: the business has no site. buildAliases() then has no bare-domain
   *  token, so client_name carries the whole mention match, and the
   *  `client_name || business_type || website` display chain loses its last rung. Read it
   *  through displayName() rather than rebuilding that chain. */
  website: string | null;
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
  /** The Outlook drafts auto-created for the newest single-email card in this thread
   *  (docs/2026-08-20-outlook-drafts-multi.sql). Every card that posts ONE finished email puts
   *  it straight in Drafts, and email 1 goes into the shared submissions box as well, so this
   *  is a LIST: `mailbox: null` is the connected account and is always first.
   *
   *  The ids are here to DELETE the superseded drafts on a redraft rather than leave a pile of
   *  near-identical ones behind. They are Graph message ids and they survive being sent, so they
   *  must only ever be passed to microsoft.deleteDraft(), which re-checks isDraft before
   *  touching anything. The url is stored so the CRM lead timeline can link into Outlook without
   *  a second Graph round trip. */
  outlook_drafts: Array<{ mailbox: string | null; id: string; url: string }> | null;
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
  /** What our own fetcher observed when it tried to read the homepage. Tri-state, and the
   *  states are NOT interchangeable:
   *    null            the page was read normally — there is nothing to say
   *    reason "blocked"  a challenge page or a 403/429/503 — the only state that is evidence
   *    reason timeout/network/http_error/not_html  OUR failure, never the prospect's
   *  `engines_cited_site` is filled in by finishReport from audit_runs.citations: true means
   *  the engines themselves cited this domain, so their crawlers get through and the block is
   *  ours alone. See crawlBlockAngle() in config/pitch.ts — nothing may be said to a prospect
   *  about a block unless reason is "blocked" AND engines_cited_site is false. */
  crawl_block: CrawlBlock | null;
  /** Where the 20 questions were derived from. "site" = we read their pages. "search" = the
   *  page could not be read and the profile came from third-party sources. "site+search" = the
   *  page was readable but too thin to classify, so search filled the gap. Anything that
   *  claims to describe THEIR SITE must check this first. */
  research_source: ResearchSource | null;
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
     * ‼️ DEAD SINCE 2026-08-25. NOTHING READS THIS AND NOTHING MAY START READING IT AGAIN.
     *
     * It held the tier a recording sold, from `loom core` / `loom complete` / `loom noads`, and it
     * was what decided whether the old money guarantee was spoken. The four tiers are gone and so
     * is `guaranteeFor()`.
     *
     * The FIELD stays because old rows still carry values in it, and a row from before the rebuild
     * is a true record of what that prospect was actually quoted. Reviving it as an input is the
     * trap: a bare `script` rebuild on one of those rows would quote an offer that no longer
     * exists, to somebody who is being sold the one that does. `postLoomScript` says the same
     * thing at the point where it deliberately does not read this.
     *
     * A hand-quoted `price` is the only per-recording override that still changes the offer.
     */
    tier?: string;
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
