// Shared row shapes for the audit_reports / audit_runs tables
// (docs/2026-07-22-audit-engine-v2.sql). Kept separate from classify.ts /
// site-research.ts so API routes and UI components can import just the shapes.

import type { AuditBlock, AuditPrompt, LikelyCompetitor } from "./classify";

export type AuditReportStatus = "classifying" | "awaiting_city" | "running" | "done" | "failed";
export type AuditEngine = "openai" | "perplexity";
export type AuditRunStatus = "pending" | "ok" | "no_data";

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
  slack_channel_id: string | null;
  slack_thread_ts: string | null;
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
